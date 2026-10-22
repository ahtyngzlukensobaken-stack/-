const redactedClient = (): any => new Proxy({}, { get: () => async () => { throw new Error('Сетевой клиент вырезан из пакета аудита.'); } });



import { CurseforgeV1Client } from '@xmcl/curseforge/dist/index.js';
import { ModrinthV2Client } from '@xmcl/modrinth';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { apiBase } from './site.js';
import { isModrinthCdn, isSafeName, isSha1 } from './guards.js';
import { downloadFile, MOD_HOSTS } from './safefetch.js';
import { instanceMods } from './paths.js';
import { contentDir, get, mods as modsOf, type Kind } from './instances.js';
import { load, update, type Instance } from './store.js';



export type Source = 'modrinth' | 'curseforge';
export type { Kind };


const MODRINTH_TYPE: Record<Kind, string> = {
  mod: 'mod',
  resourcepack: 'resourcepack',
  datapack: 'datapack',
  shader: 'shader',
};


const CURSEFORGE_CLASS: Record<Kind, number> = {
  mod: 6,
  resourcepack: 12,
  shader: 6552,
  datapack: 6945,
};


function loaderFilter(kind: Kind, instance: Instance): string[] | undefined {
  if (kind !== 'mod') return undefined;
  return instance.loader === 'vanilla' ? undefined : [instance.loader];
}

export interface ModHit {
  source: Source;
  id: string;
  slug: string;
  name: string;
  author: string;
  summary: string;
  downloads: number;
  icon: string;
  pageUrl: string;
  
  downloadable: boolean;
}

const modrinth = redactedClient();
let curseforge: CurseforgeV1Client | null = null;
let curseforgeBase = '';




const CURSEFORGE_LOADER: Record<string, number | undefined> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };

async function curseforgeCall<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.warn('[curseforge]', error);
    throw new Error('CurseForge сейчас не отвечает. Попробуй чуть позже или найди то же самое на Modrinth.');
  }
}

function curseforgeClient(): CurseforgeV1Client {
  const base = apiBase() + '/api/cf';
  
  if (!curseforge || base !== curseforgeBase) {
    curseforge = redactedClient();
    curseforgeBase = base;
  }
  return curseforge;
}

export interface SearchQuery {
  source: Source;
  query: string;
  minecraft: string;
  loader: string;
  offset: number;
  kind?: Kind;
}


export async function search(q: SearchQuery): Promise<ModHit[]> {
  const kind = q.kind ?? 'mod';
  if (q.source === 'modrinth') {
    const facets: string[][] = [[`project_type:${MODRINTH_TYPE[kind]}`]];
    if (q.minecraft) facets.push([`versions:${q.minecraft}`]);
    // Загрузчик важен только для модов - см. loaderFilter.
    if (kind === 'mod' && q.loader && q.loader !== 'vanilla') facets.push([`categories:${q.loader}`]);

    const result = await modrinth.searchProjects({
      query: q.query,
      facets: JSON.stringify(facets),
      offset: q.offset,
      limit: 20,
      index: 'downloads',
    });
    return result.hits.map((hit) => ({
      source: 'modrinth' as const,
      id: hit.project_id,
      slug: hit.slug,
      name: hit.title,
      author: hit.author,
      summary: hit.description,
      downloads: hit.downloads,
      icon: hit.icon_url ?? '',
      pageUrl: `https:
      downloadable: true,
    }));
  }

  const client = curseforgeClient();
  const result = await curseforgeCall(() => client.searchMods({
    gameId: 432,
    classId: CURSEFORGE_CLASS[kind],
    searchFilter: q.query,
    gameVersion: q.minecraft || undefined,
    index: q.offset,
    pageSize: 20,
  }));
  return result.data.map((mod) => ({
    source: 'curseforge' as const,
    id: String(mod.id),
    slug: mod.slug,
    name: mod.name,
    author: mod.authors[0]?.name ?? '',
    summary: mod.summary,
    downloads: mod.downloadCount,
    icon: mod.logo?.thumbnailUrl ?? '',
    pageUrl: mod.links?.websiteUrl ?? `REDACTED_ENDPOINT${mod.slug}`,
    // Это выбор автора: при запрете CurseForge не отдаёт ссылку на файл вообще,
    // поэтому интерфейс отправляет пользователя на сайт.
    downloadable: mod.allowModDistribution !== false,
  }));
}

/** Скачивает файл. Сначала в .part - оборванная загрузка не будет выглядеть рабочим модом. */
/**
 * Имя файла приходит из чужого API. Без проверки имя вида `../../x.exe` записало бы файл мимо
 * папки сборки, поэтому пропускаем только голое имя без разделителей пути.
 */
function fileIn(dir: string, name: string): string {
  if (!name || name !== basename(name) || name === '.' || name === '..' || /[\\/:\0]/.test(name)) {
    throw new Error(`Подозрительное имя файла: ${name}`);
  }
  return join(dir, name);
}

/**
 * Качает файл через `.part` и только целиком кладёт на место.
 *
 * Два сторожа, которых раньше не было:
 * - зависание: если 30 секунд не пришло ни байта, загрузка обрывается с понятной ошибкой,
 *   а не висит вечной полоской;
 * - целостность: когда сайт знает SHA-1 файла, сверяем. Битый jar иначе ложился в папку
 *   и ронял игру при запуске ошибкой, по которой причину не угадать.
 * Недокачанный `.part` удаляем при любой ошибке, чтобы не копился мусор.
 */
async function download(url: string, target: string, sha1Expected?: string): Promise<void> {
  // Сама загрузка - в safefetch.ts: только Modrinth и CDN CurseForge, редиректы проверяются
  // по тому же списку, размер ограничен.
  await downloadFile(url, target, { hosts: MOD_HOSTS, sha1: sha1Expected });
}

/** SHA-1 из списка хешей файла CurseForge (algo 1 - это SHA-1). */
function curseforgeSha1(hashes: { algo: number; value: string }[] | undefined): string | undefined {
  return hashes?.find((h) => h.algo === 1)?.value;
}

interface InstallResult {
  file: string;
  version: string;
}

export interface ContentVersion {
  /** Передаётся обратно в {@link install}, чтобы поставить именно эту версию. */
  id: string;
  /** Как назвал автор: `0.6.13`, `r5.5.1`, `сборка 9 сен`. */
  label: string;
  channel: 'release' | 'beta' | 'alpha';
  /** Запустится ли эта версия в сборке, куда её собираются поставить. */
  fits: boolean;
  /** Строка-пояснение под версией: «Подходит · 1.21.11 · Fabric» или почему не подходит. */
  note: string;
  date: string;
  downloads: number;
}

const CHANNELS = new Set(['release', 'beta', 'alpha']);

function channelOf(raw: string | undefined): ContentVersion['channel'] {
  return raw && CHANNELS.has(raw) ? (raw as ContentVersion['channel']) : 'release';
}

/**
 * Все версии проекта, новые первыми, и у каждой отметка - подходит ли она этой сборке.
 *
 * Отметка здесь главное. Список без неё перекладывает угадывание на игрока: ресурс-пак под 1.20
 * молча встанет в сборку 1.21 и потом покажет половину текстур розово-чёрными.
 */
export async function versions(
  instanceId: string,
  source: Source,
  projectId: string,
  kind: Kind = 'mod',
): Promise<ContentVersion[]> {
  const instance = get(instanceId);
  if (!instance) throw new Error('Сборка не найдена.');
  const loaderLabel = instance.loader === 'vanilla' ? 'без загрузчика' : instance.loader;

  if (source === 'modrinth') {
    // Неподходящие не выбрасываем, а сортируем в конец: у старого проекта версий под другие
    // версии игры намного больше, и без сортировки подходящие потонут.
    const list = await modrinth.getProjectVersions(projectId);
    return list.map((version) => {
      const gameOk = version.game_versions.includes(instance.minecraft);
      const loaders = loaderFilter(kind, instance);
      const loaderOk = !loaders || loaders.some((l) => version.loaders.includes(l));
      const fits = gameOk && loaderOk;
      let note: string;
      if (!gameOk) note = `Только ${version.game_versions.slice(0, 3).join(', ')} - не встанет`;
      else if (!loaderOk) note = `Не под ${loaderLabel} - не встанет`;
      else note = `Подходит · ${instance.minecraft}${kind === 'mod' ? ` · ${loaderLabel}` : ''}`;
      return {
        id: version.id,
        label: version.version_number || version.name,
        channel: channelOf(version.version_type),
        fits,
        note,
        date: new Date(version.date_published).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
        downloads: version.downloads ?? 0,
      };
    }).sort((a, b) => Number(b.fits) - Number(a.fits));
  }

  const client = curseforgeClient();
  const files = await curseforgeCall(() => client.getModFiles({ modId: Number(projectId), pageSize: 50 }));
  
  
  const wantLoader = kind === 'mod' && instance.loader !== 'vanilla' ? instance.loader : '';
  return files.data.map((file): ContentVersion => {
    const gameOk = file.gameVersions.includes(instance.minecraft);
    const tagged = file.gameVersions.map((v) => v.toLowerCase());
    const anyLoader = tagged.some((v) => ['fabric', 'forge', 'neoforge', 'quilt'].includes(v));
    
    const loaderOk = !wantLoader || !anyLoader || tagged.includes(wantLoader)
      
      || (wantLoader === 'quilt' && tagged.includes('fabric'));
    return {
      id: String(file.id),
      label: file.displayName || file.fileName,
      
      channel: file.releaseType === 2 ? 'beta' : file.releaseType === 3 ? 'alpha' : 'release',
      fits: gameOk && loaderOk && Boolean(file.downloadUrl),
      note: !gameOk
        ? `Только ${file.gameVersions.filter((v) => /^\d/.test(v)).slice(0, 3).join(', ')} - не встанет`
        : !loaderOk
          ? `Не под ${loaderLabel} - не встанет`
          : file.downloadUrl
            ? `Подходит · ${instance.minecraft}${wantLoader ? ` · ${loaderLabel}` : ''}`
            : 'Автор закрыл скачивание вне сайта',
      date: new Date(file.fileDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }),
      downloads: file.downloadCount ?? 0,
    };
  }).sort((a, b) => Number(b.fits) - Number(a.fits));
}

type ModrinthVersion = Awaited<ReturnType<typeof modrinth.getProjectVersions>>[number];


async function projectOwners(instanceId: string): Promise<Map<string, string>> {
  const dir = instanceMods(instanceId);
  const files = modsOf(instanceId).filter((mod) => mod.enabled);
  if (!files.length) return new Map();

  const byHash = await hashFiles(dir, files.map((mod) => mod.file));

  const owners = new Map<string, string>();
  try {
    const known = await modrinth.getProjectVersionsByHash([...byHash.keys()]);
    for (const [hash, version] of Object.entries(known)) {
      const file = byHash.get(hash);
      if (file) owners.set(version.project_id, file);
    }
  } catch {
    
  }
  return owners;
}


async function resolveTree(
  instance: Instance,
  root: ModrinthVersion,
): Promise<Map<string, ModrinthVersion>> {
  const picked = new Map<string, ModrinthVersion>([[root.project_id, root]]);
  const queue = [root];

  
  while (queue.length) {
    const current = queue.shift();
    if (!current) break;

    for (const dependency of current.dependencies ?? []) {
      if (dependency.dependency_type !== 'required') continue;

      let pick: ModrinthVersion | undefined;
      if (dependency.version_id) {
        pick = await modrinth.getProjectVersion(dependency.version_id).catch(() => undefined);
      } else if (dependency.project_id) {
        const list = await modrinth.getProjectVersions(dependency.project_id, {
          gameVersions: [instance.minecraft],
          loaders: instance.loader === 'vanilla' ? undefined : [instance.loader],
        }).catch(() => []);
        pick = list[0];
      }
      if (!pick || picked.has(pick.project_id)) continue;

      picked.set(pick.project_id, pick);
      queue.push(pick);
    }
  }
  return picked;
}


const ESSENTIALS: Partial<Record<Instance['loader'], string[]>> = {
  fabric: ['fabric-api', 'sodium', 'lithium'],
};


export async function installEssentials(
  instanceId: string,
  onStatus?: (line: string) => void,
): Promise<void> {
  const instance = get(instanceId);
  const slugs = instance ? ESSENTIALS[instance.loader] : undefined;
  if (!instance || !slugs) return;

  for (const slug of slugs) {
    try {
      onStatus?.(`Ставлю ${slug}…`);
      await install({ instanceId, source: 'modrinth', projectId: slug });
    } catch (error) {
      onStatus?.(`Пропустил ${slug}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  onStatus?.('Оптимизация установлена.');
}

export interface InstallRequest {
  instanceId: string;
  source: Source;
  projectId: string;
  kind?: Kind;
  /** Нужен для датапаков, для остального игнорируется: датапак принадлежит миру, а не сборке. */
  world?: string;
  /** Конкретная версия из {@link versions}. Если не указана - новейшая подходящая. */
  versionId?: string;
}

/** Ставит проект в сборку. Для модов с Modrinth - вместе с зависимостями и заменой старых версий. */
export async function install(request: InstallRequest): Promise<InstallResult> {
  const { instanceId, source, projectId } = request;
  const kind = request.kind ?? 'mod';
  const instance = get(instanceId);
  if (!instance) throw new Error('Сборка не найдена.');
  const dir = contentDir(instanceId, kind, request.world ?? '');
  await mkdir(dir, { recursive: true });

  if (source === 'modrinth') {
    const version = request.versionId
      ? await modrinth.getProjectVersion(request.versionId)
      : (await modrinth.getProjectVersions(projectId, {
          gameVersions: [instance.minecraft],
          loaders: loaderFilter(kind, instance),
        }))[0];
    const file = version?.files.find((f) => f.primary) ?? version?.files[0];
    if (!version || !file) {
      throw new Error(`Нет сборки под ${instance.minecraft}${kind === 'mod' ? ` / ${instance.loader}` : ''}.`);
    }

    
    
    
    if (kind !== 'mod') {
      await download(file.url, fileIn(dir, file.filename), file.hashes?.sha1);
      return { file: file.filename, version: version.version_number };
    }

    const wanted = await resolveTree(instance, version);
    const owners = await projectOwners(instanceId);

    for (const pick of wanted.values()) {
      const primary = pick.files.find((f) => f.primary) ?? pick.files[0];
      if (!primary) continue;
      await download(primary.url, fileIn(dir, primary.filename), primary.hashes?.sha1);
      
      const previous = owners.get(pick.project_id);
      if (previous && previous !== primary.filename) await rm(join(dir, previous), { force: true });
    }
    return { file: file.filename, version: version.version_number };
  }

  const client = curseforgeClient();
  let file;
  if (request.versionId) {
    file = await curseforgeCall(() => client.getModFile(Number(projectId), Number(request.versionId)));
  } else {
    
    
    const loaderType = kind === 'mod' ? CURSEFORGE_LOADER[instance.loader] : undefined;
    const files = await curseforgeCall(() => client.getModFiles({
      modId: Number(projectId),
      gameVersion: instance.minecraft,
      modLoaderType: loaderType as never,
      pageSize: 20,
    }));
    file = files.data.find((f) => f.downloadUrl) ?? files.data[0];
  }
  if (!file) throw new Error(`Нет файлов под ${instance.minecraft}.`);
  if (!file.downloadUrl) {
    throw new Error('Автор запретил скачивание вне CurseForge - открой страницу на сайте.');
  }
  await download(file.downloadUrl, fileIn(dir, file.fileName), curseforgeSha1(file.hashes as never));
  return { file: file.fileName, version: file.displayName };
}

export interface Identified {
  source: Source;
  projectId: string;
  versionId: string;
  label: string;
  /** Как мод называется у автора - чтобы в списке не висело `sodium-fabric-0.6.13+mc1.21.jar`. */
  name?: string;
  /** Ссылка на картинку проекта. Может не быть: не у всех модов есть иконка. */
  icon?: string;
}

/**
 * Описания проектов, уже спрошенные у Modrinth, - по id.
 *
 * Один проект обычно лежит сразу в нескольких сборках, а опознание идёт на каждый файл.
 * Без этой памятки лаунчер дёргал бы Modrinth одним и тем же вопросом по десять раз за минуту.
 */
const projectCache = new Map<string, { name?: string; icon?: string }>();

async function projectBrief(projectId: string): Promise<{ name?: string; icon?: string }> {
  const known = projectCache.get(projectId);
  if (known) return known;
  try {
    const project = await modrinth.getProject(projectId);
    const brief = { name: project.title, icon: project.icon_url || undefined };
    projectCache.set(projectId, brief);
    return brief;
  } catch {
    // Сети нет или проект удалён - не беда: список покажет имя файла, как и раньше.
    return {};
  }
}

/**
 * Что за файл уже лежит на диске.
 *
 * Определяем по хешу через Modrinth. null - нормальный ответ для файла только с CurseForge
 * или собранного руками: тогда интерфейс покажет имя файла вместо списка версий.
 */
export async function identify(
  instanceId: string, file: string, kind: Kind = 'mod', world = '',
): Promise<Identified | null> {
  return (await identifyMany(instanceId, [file], kind, world))[file] ?? null;
}

/** Ответы по файлам, пока файл тот же (путь, размер, время изменения). null - Modrinth его не знает. */
const identifyCache = new Map<string, Identified | null>();

/**
 * Опознание сразу пачки файлов: хеши считаются по 8 за раз, а Modrinth получает один запрос
 * на все хеши и один на названия проектов (по сотне за раз).
 *
 * Раньше список модов спрашивал про каждый файл отдельно: на сборке из 442 модов это было
 * около 900 запросов, Modrinth упирался в свой лимит (~300 в минуту), и названия с иконками
 * появлялись минуту, а часть не появлялась вовсе. Теперь - пара запросов и пара секунд.
 * Ответ запоминаем: повторное открытие вкладки не читает jar-файлы и не ходит в сеть.
 */
export async function identifyMany(
  instanceId: string, files: string[], kind: Kind = 'mod', world = '',
): Promise<Record<string, Identified | null>> {
  const dir = contentDir(instanceId, kind, world);
  const out: Record<string, Identified | null> = {};
  const todo: { file: string; key: string; hash: string }[] = [];

  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < files.length) {
      const file = files[next++]!;
      // Имя приходит из интерфейса - берём только имя файла, без «..\» и чужих папок.
      const path = join(dir, basename(file));
      const info = await stat(path).catch(() => null);
      if (!info) { out[file] = null; continue; }
      const key = `${path}|${info.size}|${info.mtimeMs}`;
      const known = identifyCache.get(key);
      if (known !== undefined) { out[file] = known; continue; }
      const hash = await sha1(path).catch(() => '');
      if (hash) todo.push({ file, key, hash });
      else out[file] = null;
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker));
  if (!todo.length) return out;

  let found: Record<string, ModrinthVersion> | null = {};
  try {
    for (let i = 0; i < todo.length; i += 500) {
      const chunk = todo.slice(i, i + 500).map((item) => item.hash);
      Object.assign(found, await modrinth.getProjectVersionsByHash(chunk, 'sha1', AbortSignal.timeout(30_000)));
    }
  } catch {
    // Нет сети или Modrinth не ответил - покажем имена файлов, а в память ничего не пишем:
    // в следующий раз спросим снова.
    found = null;
  }
  if (found) await warmProjects(Object.values(found).map((v) => v.project_id));

  for (const item of todo) {
    if (!found) { out[item.file] = null; continue; }
    const version = found[item.hash];
    if (!version) { identifyCache.set(item.key, null); out[item.file] = null; continue; }
    const brief = await projectBrief(version.project_id);
    const result: Identified = {
      source: 'modrinth',
      projectId: version.project_id,
      versionId: version.id,
      label: version.version_number,
      name: brief.name,
      icon: brief.icon,
    };
    identifyCache.set(item.key, result);
    out[item.file] = result;
  }
  return out;
}

/** Заполняет память названий проектов пачкой (до 100 за запрос - больше Modrinth в адрес не влезает). */
async function warmProjects(ids: string[]): Promise<void> {
  const missing = [...new Set(ids)].filter((id) => !projectCache.has(id));
  for (let i = 0; i < missing.length; i += 100) {
    try {
      const projects = await modrinth.getProjects(missing.slice(i, i + 100), AbortSignal.timeout(20_000));
      for (const project of projects) {
        projectCache.set(project.id, { name: project.title, icon: project.icon_url || undefined });
      }
    } catch {
      // Не страшно: projectBrief спросит по одному, а если и там нет сети - покажем имя файла.
    }
  }
}

/**
 * Меняет установленный файл на другую версию того же проекта.
 *
 * Сначала качаем, потом удаляем - никогда наоборот: упавшая загрузка оставит рабочий файл на месте.
 * Закрепление переезжает на новое имя файла: пользователь закреплял выбор, а не имя.
 */
export async function switchVersion(
  instanceId: string, file: string, versionId: string, kind: Kind = 'mod', world = '',
): Promise<string> {
  const dir = contentDir(instanceId, kind, world);
  const version = await modrinth.getProjectVersion(versionId);
  const primary = version.files.find((f) => f.primary) ?? version.files[0];
  if (!primary) throw new Error('У этой версии нет файла.');
  await download(primary.url, fileIn(dir, primary.filename), primary.hashes?.sha1);
  if (primary.filename !== file) {
    await rm(join(dir, file), { force: true });
    const instance = get(instanceId);
    if (instance?.pinned?.includes(file)) {
      setPinned(instanceId, file, false);
      setPinned(instanceId, primary.filename, true);
    }
  }
  return primary.filename;
}

/** SHA-1 файла потоком: jar мода может весить десятки мегабайт. */
/**
 * Что Modrinth знает про эти файлы - одним запросом на все хеши сразу.
 *
 * Нужно экспорту сборки: по хешу он узнаёт ссылку на мод, чтобы класть в модпак ссылку,
 * а не сам jar. Отдельный запрос на каждый мод превратил бы экспорт в минуту ожидания.
 */
export async function versionsByHash(hashes: string[]): Promise<Record<string, {
  files: { hashes: { sha1: string; sha512: string }; url: string; size: number; filename: string }[];
}>> {
  if (!hashes.length) return {};
  try {
    return await modrinth.getProjectVersionsByHash(hashes) as never;
  } catch {
    // Сети нет - не беда: экспорт просто положит все моды файлами внутрь архива.
    return {};
  }
}

/**
 * Хеши файлов папки: хеш → имя файла. По 8 файлов за раз - раньше шли строго по одному,
 * и на сборке из сотен модов проверка обновлений ждала диск, хотя он мог больше.
 */
async function hashFiles(dir: string, files: string[]): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < files.length) {
      const file = files[next++]!;
      const hash = await sha1(join(dir, file)).catch(() => '');
      if (hash) hashes.set(hash, file);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker));
  return hashes;
}

export function sha1(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha1');
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

export interface ModUpdate {
  /** Файл, который лежит сейчас. */
  file: string;
  name: string;
  current: string;
  latest: string;
  url: string;
  filename: string;
  /** SHA-1 новой версии от Modrinth: без него applyUpdate файл не поставит. */
  sha1?: string;
}

/**
 * Ищет моды, у которых есть более новая версия под версию игры и загрузчик сборки.
 *
 * Определяем по хешу файла, а не по имени. Два пакетных запроса: «что это за файлы сейчас»
 * и «какая у них новейшая версия под сборку». Разница между ответами - это обновления.
 *
 * Моды, которых Modrinth не знает (только CurseForge или собранные руками), просто пропускаются.
 */
export async function checkUpdates(instanceId: string): Promise<ModUpdate[]> {
  const instance = get(instanceId);
  if (!instance) throw new Error('Сборка не найдена.');
  const dir = instanceMods(instanceId);

  // Закреплённые пропускаем: пользователь выбрал эту версию нарочно.
  const pinned = new Set(instance.pinned ?? []);
  const files = modsOf(instanceId).filter((mod) => mod.enabled && !pinned.has(mod.file));
  if (!files.length) return [];

  const hashes = await hashFiles(dir, files.map((mod) => mod.file));
  const list = [...hashes.keys()];

  const [current, latest] = await Promise.all([
    modrinth.getProjectVersionsByHash(list, 'sha1', AbortSignal.timeout(30_000)),
    modrinth.getLatestVersionsFromHashes(list, {
      gameVersions: [instance.minecraft],
      loaders: instance.loader === 'vanilla' ? undefined : [instance.loader],
    }, AbortSignal.timeout(30_000)),
  ]);

  const updates: ModUpdate[] = [];
  for (const [hash, file] of hashes) {
    const now = current[hash];
    const next = latest[hash];
    if (!now || !next || now.id === next.id) continue;
    const primary = next.files.find((f) => f.primary) ?? next.files[0];
    if (!primary) continue;
    updates.push({
      file,
      name: next.name || primary.filename,
      current: now.version_number,
      latest: next.version_number,
      url: primary.url,
      filename: primary.filename,
      sha1: primary.hashes?.sha1,
    });
  }
  return updates;
}

/**
 * Подходит ли мод к той версии игры, которая сейчас стоит у сборки.
 *
 * `ok` - подходит, `update` - есть сборка посвежее, `missing` - мод существует, но под эту
 * версию игры его не выпускали, `unknown` - Modrinth этот файл не знает (CurseForge или
 * собран руками), и судить о нём лаунчер не берётся.
 */
export interface ModFit {
  file: string;
  name: string;
  state: 'ok' | 'update' | 'missing' | 'unknown';
  current?: string;
  latest?: string;
  url?: string;
  filename?: string;
  sha1?: string;
}

/**
 * Разбор всех модов сборки: что подойдёт, что обновится, а что под эту версию игры не выходило.
 *
 * Нужен после смены версии сборки. Раньше смена версии означала вылет при запуске: моды
 * оставались от старой версии, и человек узнавал об этом из окна с крашем. Обновления лаунчер
 * искать умел и раньше, а вот сказать «этого мода под 1.20.1 не существует» - нет, и такой мод
 * молча оставался в папке.
 */
export async function checkFit(instanceId: string): Promise<ModFit[]> {
  const instance = get(instanceId);
  if (!instance) throw new Error('Сборка не найдена.');
  const dir = instanceMods(instanceId);

  const files = modsOf(instanceId).filter((mod) => mod.enabled);
  if (!files.length) return [];

  const hashes = await hashFiles(dir, files.map((mod) => mod.file));
  const list = [...hashes.keys()];

  const [current, latest] = await Promise.all([
    modrinth.getProjectVersionsByHash(list, 'sha1', AbortSignal.timeout(30_000)),
    modrinth.getLatestVersionsFromHashes(list, {
      gameVersions: [instance.minecraft],
      loaders: instance.loader === 'vanilla' ? undefined : [instance.loader],
    }, AbortSignal.timeout(30_000)),
  ]);

  // Названия всех модов - пачкой, а не запросом на каждый.
  await warmProjects(Object.values(current).map((v) => v.project_id));

  const report: ModFit[] = [];
  for (const [hash, file] of hashes) {
    const now = current[hash];
    if (!now) { report.push({ file, name: file, state: 'unknown' }); continue; }

    const brief = await projectBrief(now.project_id);
    const name = brief.name || now.name || file;
    const next = latest[hash];

    // Закреплённые не трогаем: человек выбрал эту версию нарочно. Но если она не подходит
    // к версии игры, смолчать нельзя - иначе закрепление тихо ломает запуск.
    const pinned = (instance.pinned ?? []).includes(file);

    if (!next) { report.push({ file, name, state: 'missing', current: now.version_number }); continue; }
    if (next.id === now.id || pinned) { report.push({ file, name, state: 'ok', current: now.version_number }); continue; }

    const primary = next.files.find((f) => f.primary) ?? next.files[0];
    if (!primary) { report.push({ file, name, state: 'ok', current: now.version_number }); continue; }
    report.push({
      file, name, state: 'update',
      current: now.version_number, latest: next.version_number,
      url: primary.url, filename: primary.filename, sha1: primary.hashes?.sha1,
    });
  }
  return report;
}

/**
 * Привести моды в порядок по разбору: обновить что обновляется, выключить что не подходит.
 *
 * Непод­ходящие именно выключаются, а не удаляются: мод мог быть скачан руками с сайта, и
 * удалить его насовсем из-за смены версии лаунчер права не имеет. Вернётся старая версия игры -
 * хватит одного щелчка.
 */
export async function applyFit(instanceId: string, report: ModFit[]): Promise<{
  updated: string[]; disabled: string[]; failed: string[];
}> {
  const updated: string[] = [];
  const disabled: string[] = [];
  const failed: string[] = [];

  for (const item of report) {
    try {
      if (item.state === 'update' && item.url && item.filename) {
        await applyUpdate(instanceId, {
          file: item.file, name: item.name, current: item.current ?? '',
          latest: item.latest ?? '', url: item.url, filename: item.filename, sha1: item.sha1,
        });
        updated.push(item.name);
      } else if (item.state === 'missing') {
        await toggle(instanceId, item.file);
        disabled.push(item.name);
      }
    } catch (error) {
      failed.push(`${item.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { updated, disabled, failed };
}

/** Ставит обновление: сначала качает новую версию, потом удаляет старый файл. */
export async function applyUpdate(instanceId: string, update: ModUpdate): Promise<string> {
  // Описание обновления приходит из интерфейса. Раньше по нему качался файл с любого адреса,
  // а старый файл удалялся по любому пути (`..\..\что-угодно`). Теперь: только CDN Modrinth,
  // только с SHA-1, и оба имени - голые имена файлов в папке модов этой сборки.
  if (!get(instanceId)) throw new Error('Сборка не найдена.');
  if (!isModrinthCdn(update?.url)) throw new Error('Обновления модов лаунчер качает только с Modrinth.');
  if (!isSha1(update.sha1)) throw new Error('У обновления нет контрольной суммы - ставить не буду.');
  if (!isSafeName(update.file)) throw new Error(`Подозрительное имя файла: ${String(update.file)}`);
  const dir = instanceMods(instanceId);
  await download(update.url, fileIn(dir, update.filename), update.sha1);
  if (update.filename !== update.file) await rm(join(dir, update.file), { force: true });
  return update.filename;
}

/** Включает/выключает файл, добавляя или убирая суффикс `.disabled`. Возвращает новое имя. */
/**
 * Полный путь к файлу контента сборки - только если имя честное.
 *
 * Имя файла приходит из интерфейса. Без проверки `..\..\что-угодно` превратило бы
 * «отключить мод» в переименование любого файла на диске.
 */
export function contentFile(instanceId: string, file: string, kind: Kind = 'mod', world = ''): string {
  if (!file || basename(file) !== file || file === '.' || file === '..') throw new Error('Странное имя файла.');
  if (world && (basename(world) !== world || world === '..')) throw new Error('Странное имя мира.');
  return join(contentDir(instanceId, kind, world), file);
}

export async function toggle(
  instanceId: string, file: string, kind: Kind = 'mod', world = '',
): Promise<string> {
  contentFile(instanceId, file, kind, world);
  const dir = contentDir(instanceId, kind, world);
  const next = file.endsWith('.disabled') ? file.slice(0, -'.disabled'.length) : file + '.disabled';
  await rename(join(dir, file), join(dir, next));
  return next;
}


/**
 * Закрепляет файл на текущей версии или снимает закрепление.
 *
 * Без этого выбранная руками версия продержалась бы только до следующей проверки обновлений.
 * Возвращает новый список закреплённых файлов сборки.
 */
export function setPinned(instanceId: string, file: string, pinned: boolean): string[] {
  let result: string[] = [];
  update((data) => {
    const instance = data.instances.find((i) => i.id === instanceId);
    if (!instance) return;
    const list = new Set(instance.pinned ?? []);
    if (pinned) list.add(file); else list.delete(file);
    instance.pinned = [...list];
    result = instance.pinned;
  });
  return result;
}

// ---------------------------------------------------------------- автоисправление вылетов

/** Как в crash.ts: только буквы и цифры в нижнем регистре. */
const fold = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Первый включённый файл, в имени которого есть одна из подсказок. */
function findByHints(files: string[], nameHints: string[]): string | undefined {
  return files.find((file) => !file.endsWith('.disabled')
    && nameHints.some((hint) => hint && fold(file).includes(hint)));
}

/** Выключает мод, названный в отчёте о вылете. Поиск по имени файла (не по манифесту),
 *  но чтобы найти мод, который отчёт уже назвал, этого хватает. null - не нашли. */
export async function autofixDisable(instanceId: string, nameHints: string[]): Promise<string | null> {
  const dir = instanceMods(instanceId);
  const files = await readdir(dir).catch(() => [] as string[]);
  const target = findByHints(files, nameHints);
  if (!target) return null;
  return toggle(instanceId, target);
}

interface AutofixUpdateResult {
  file: string;
  filename: string;
  from: string;
  to: string;
}

/**
 * Обновляет мод из отчёта о вылете до новейшей версии на Modrinth под эту сборку -
 * настоящее исправление для «нужна версия X поновее», в отличие от {@link autofixDisable}.
 *
 * null вместо ошибки, когда делать нечего: файл не найден, Modrinth его не знает или версия
 * уже новейшая. Тогда интерфейс предлагает выключить мод.
 */
export async function autofixUpdate(instanceId: string, nameHints: string[]): Promise<AutofixUpdateResult | null> {
  const instance = get(instanceId);
  if (!instance) return null;
  const dir = instanceMods(instanceId);
  const files = await readdir(dir).catch(() => [] as string[]);
  const file = findByHints(files, nameHints);
  if (!file) return null;

  const hash = await sha1(join(dir, file));
  const [current, latest] = await Promise.all([
    modrinth.getProjectVersionsByHash([hash]),
    modrinth.getLatestVersionsFromHashes([hash], {
      gameVersions: [instance.minecraft],
      loaders: instance.loader === 'vanilla' ? undefined : [instance.loader],
    }),
  ]);
  const now = current[hash];
  const next = latest[hash];
  if (!now || !next || now.id === next.id) return null;
  const primary = next.files.find((f) => f.primary) ?? next.files[0];
  if (!primary) return null;

  await download(primary.url, fileIn(dir, primary.filename), primary.hashes?.sha1);
  if (primary.filename !== file) await rm(join(dir, file), { force: true });
  return { file, filename: primary.filename, from: now.version_number, to: next.version_number };
}
