
async function redactedFetch(..._args: unknown[]): Promise<never> {
  throw new Error('Сетевой запрос вырезан из пакета аудита.');
}
import { open, readAllEntries, readEntry, openEntryReadStream } from '@xmcl/unzip';
import { createHash } from 'node:crypto';
import { ZipFile } from 'yazl';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { apiBase, UA } from './site.js';
import { create, get } from './instances.js';
import { report } from './install.js';
import { sha1, versionsByHash } from './mods.js';
import { isSafeName, isSha1 } from './guards.js';
import { downloadFile, PACK_HOSTS } from './safefetch.js';
import { instanceDir } from './paths.js';
import type { Instance } from './store.js';


type Loader = Instance['loader'];




const ALLOWED_HOSTS = new Set([
  'cdn.modrinth.com',
  'github.com',
  'raw.githubusercontent.com',
  'gitlab.com',
  
  'edge.forgecdn.net',
  'mediafilez.forgecdn.net',
  'media.forgecdn.net',
]);

interface ModrinthIndex {
  formatVersion?: number;
  game?: string;
  name?: string;
  versionId?: string;
  files?: {
    path?: string;
    hashes?: { sha1?: string; sha512?: string };
    env?: { client?: string; server?: string };
    downloads?: string[];
  }[];
  dependencies?: Record<string, string>;
}

interface CurseManifest {
  manifestType?: string;
  name?: string;
  version?: string;
  overrides?: string;
  minecraft?: {
    version?: string;
    modLoaders?: { id?: string; primary?: boolean }[];
  };
  files?: { projectID?: number; fileID?: number; required?: boolean }[];
}

export interface ImportedPack {
  instance: Instance;
  
  installed: number;
  failed: string[];
}

type Zip = Awaited<ReturnType<typeof open>>;
type Entries = Awaited<ReturnType<typeof readAllEntries>>;


function loaderFrom(key: string): Loader | null {
  if (key === 'fabric-loader' || key === 'fabric') return 'fabric';
  if (key === 'quilt-loader' || key === 'quilt') return 'quilt';
  if (key === 'neoforge') return 'neoforge';
  if (key === 'forge') return 'forge';
  return null;
}


function safeTarget(root: string, raw: string): string {
  const cleaned = raw.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('\0') || /^[a-z]:/i.test(cleaned)) {
    throw new Error(`Модпак просит записать файл по странному пути: ${raw}`);
  }
  const target = resolve(root, ...cleaned.split('/'));
  if (target !== root && !target.startsWith(root + sep)) {
    throw new Error(`Модпак просит записать файл вне своей папки: ${raw}`);
  }
  return target;
}

function checkUrl(raw: string, hosts: Set<string>): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('В модпаке битая ссылка на файл.');
  }
  if (url.protocol !== 'https:' || !hosts.has(url.hostname)) {
    throw new Error(`файлы с ${url.hostname} лаунчер не качает`);
  }
  return url;
}

/** Сборка по коду делается только из модов Modrinth (см. sharePack) - другого в ней быть не должно. */
const SHARED_HOSTS = new Set(['cdn.modrinth.com']);

/**
 * Качает файл модпака. SHA-1 обязателен: формат Modrinth требует его у каждого файла, и без него
 * github.com из списка доменов отдал бы любой файл любого репозитория. Раньше файл без хеша
 * ставился молча.
 */
async function downloadChecked(url: string, target: string, sha1: string | undefined, hosts: Set<string> = ALLOWED_HOSTS): Promise<void> {
  checkUrl(url, hosts);
  if (!isSha1(sha1)) throw new Error('у файла нет контрольной суммы');
  // Сама загрузка - safefetch.ts: редиректы только по тем же доменам (для сборки по коду - только
  // Modrinth), размер ограничен, 30 секунд тишины - обрыв, .part удаляется при ошибке.
  await downloadFile(url, target, { hosts: hosts === SHARED_HOSTS ? SHARED_HOSTS : PACK_HOSTS, sha1, requireHash: true });
}

/** Сколько можно распаковать из архива модпака: защита от «zip-бомбы». */
const OVERRIDES_MAX_BYTES = 8 * 1024 * 1024 * 1024;

/** Достаём из архива папку с готовыми конфигами. Имён бывает две: обычная и клиентская. */
async function unpackOverrides(zip: Zip, entries: Entries, prefixes: string[], root: string): Promise<void> {
  // Размеры из оглавления архива (yauzl сверяет их с распакованным): общий предел до распаковки.
  const declared = entries
    .filter((entry) => prefixes.some((item) => entry.fileName.replace(/\\/g, '/').startsWith(item + '/')))
    .reduce((sum, entry) => sum + Number(entry.uncompressedSize || 0), 0);
  if (declared > OVERRIDES_MAX_BYTES) throw new Error('Модпак распаковывается больше чем в 8 ГБ - так не бывает, это похоже на подделку.');
  for (const entry of entries) {
    const name = entry.fileName.replace(/\\/g, '/');
    const prefix = prefixes.find((item) => name.startsWith(item + '/'));
    if (!prefix) continue;
    const inner = name.slice(prefix.length + 1);
    // Папки в zip идут отдельными записями и кончаются на «/» - их создаст mkdir ниже.
    if (!inner || inner.endsWith('/')) continue;
    const target = safeTarget(root, inner);
    await mkdir(dirname(target), { recursive: true });
    const stream = await openEntryReadStream(zip, entry);
    await pipeline(stream, createWriteStream(target));
  }
}

/** Описание модпака из архива: какой это формат и что внутри. */
async function readPack(file: string): Promise<{
  zip: Zip; entries: Entries; kind: 'modrinth' | 'curseforge'; json: unknown;
}> {
  const zip = await open(file);
  const entries = await readAllEntries(zip);
  const byName = new Map(entries.map((entry) => [entry.fileName.replace(/\\/g, '/'), entry]));
  const modrinth = byName.get('modrinth.index.json');
  const curse = byName.get('manifest.json');
  const found = modrinth ?? curse;
  if (!found) {
    zip.close();
    throw new Error('Это не модпак: внутри нет ни modrinth.index.json, ни manifest.json.');
  }
  const text = await readEntry(zip, found);
  let json: unknown;
  try {
    json = JSON.parse(text.toString('utf8'));
  } catch {
    zip.close();
    throw new Error('Описание модпака не читается - архив повреждён.');
  }
  return { zip, entries, kind: modrinth ? 'modrinth' : 'curseforge', json };
}

/**
 * Поставить модпак из файла. Возвращает созданную сборку: игру и загрузчик к ней докачает
 * обычная установка - тот же код, что и для сборки, собранной руками.
 */
export async function importPack(file: string): Promise<ImportedPack> {
  const { zip, entries, kind, json } = await readPack(file);
  try {
    return kind === 'modrinth'
      ? await importModrinth(zip, entries, json as ModrinthIndex)
      : await importCurseforge(zip, entries, json as CurseManifest);
  } finally {
    zip.close();
  }
}

/** Общий финал для обоих форматов: закрыть полосу прогресса. */
function finish(instanceId: string): void {
  report({
    instanceId, stage: 'Модпак распакован', progress: 1, total: 1,
    bytesPerSecond: 0, done: true, unit: 'files',
  });
}

function step(instanceId: string, done: number, total: number): void {
  report({
    instanceId, stage: `Файлы модпака: ${done} из ${total}`,
    progress: done, total, bytesPerSecond: 0, done: false, unit: 'files',
  });
}

/** zip - архив с папкой overrides; у сборки по коду архива нет, только описание. */
async function importModrinth(zip: Zip | null, entries: Entries | null, index: ModrinthIndex, hosts: Set<string> = ALLOWED_HOSTS): Promise<ImportedPack> {
  if (index.formatVersion !== 1 || (index.game && index.game !== 'minecraft')) {
    throw new Error('Такой modrinth.index.json лаунчер пока не понимает.');
  }
  const deps = index.dependencies ?? {};
  const minecraft = deps.minecraft;
  if (!minecraft) throw new Error('В модпаке не указана версия Minecraft.');

  let loader: Loader = 'vanilla';
  let loaderVersion = '';
  for (const [key, version] of Object.entries(deps)) {
    const match = loaderFrom(key);
    if (match) { loader = match; loaderVersion = version; break; }
  }

  const instance = create({
    name: index.name?.trim() || 'Модпак',
    minecraft,
    loader,
    loaderVersion,
  });
  const root = resolve(instanceDir(instance.id));

  // Клиентские файлы: то, что помечено «только для сервера», игроку не нужно.
  const wanted = (index.files ?? []).filter((item) => item.env?.client !== 'unsupported');
  const failed: string[] = [];
  let installed = 0;

  step(instance.id, 0, wanted.length || 1);
  if (zip && entries) await unpackOverrides(zip, entries, ['overrides', 'client-overrides'], root);

  for (const item of wanted) {
    const url = item.downloads?.[0];
    if (!item.path || !url) {
      failed.push(item.path ?? 'файл без пути');
    } else {
      try {
        await downloadChecked(url, safeTarget(root, item.path), item.hashes?.sha1, hosts);
        installed += 1;
      } catch (error) {
        failed.push(`${posix.basename(item.path)} - ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    step(instance.id, installed + failed.length, wanted.length);
  }

  finish(instance.id);
  return { instance, installed, failed };
}

async function importCurseforge(zip: Zip, entries: Entries, manifest: CurseManifest): Promise<ImportedPack> {
  const minecraft = manifest.minecraft?.version;
  if (!minecraft) throw new Error('В manifest.json не указана версия Minecraft.');

  // Загрузчик у CurseForge записан одной строкой: «fabric-0.14.21», «forge-47.1.0».
  const primary = manifest.minecraft?.modLoaders?.find((item) => item.primary)
    ?? manifest.minecraft?.modLoaders?.[0];
  let loader: Loader = 'vanilla';
  let loaderVersion = '';
  if (primary?.id) {
    const dash = primary.id.indexOf('-');
    const match = loaderFrom(dash > 0 ? primary.id.slice(0, dash) : primary.id);
    if (match) { loader = match; loaderVersion = dash > 0 ? primary.id.slice(dash + 1) : ''; }
  }

  const instance = create({
    name: manifest.name?.trim() || 'Модпак',
    minecraft,
    loader,
    loaderVersion,
  });
  const root = resolve(instanceDir(instance.id));

  const wanted = (manifest.files ?? []).filter((item) => item.fileID);
  const failed: string[] = [];
  let installed = 0;

  step(instance.id, 0, wanted.length || 1);
  await unpackOverrides(zip, entries, [manifest.overrides?.replace(/\/+$/, '') || 'overrides'], root);

  // Ссылок в manifest.json нет - только номера файлов. Адреса спрашиваем у CurseForge
  // через наш сайт: ключ API лежит там, игроку вписывать ничего не нужно.
  const ids = wanted.map((item) => item.fileID as number);
  const links = new Map<number, { url: string; name: string; sha1?: string }>();
  for (let from = 0; from < ids.length; from += 50) {
    try {
      const response = await redactedFetch(`${apiBase()}/api/cf/v1/mods/files`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'PowerVisualLauncher' },
        body: JSON.stringify({ fileIds: ids.slice(from, from + 50) }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json() as {
        data?: { id?: number; fileName?: string; downloadUrl?: string; hashes?: { algo?: number; value?: string }[] }[];
      };
      for (const file of body.data ?? []) {
        if (file.id && file.downloadUrl && file.fileName) {
          // algo 1 у CurseForge - SHA-1.
          links.set(file.id, { url: file.downloadUrl, name: file.fileName, sha1: file.hashes?.find((h) => h.algo === 1)?.value });
        }
      }
    } catch {
      // Падать не из-за чего: эти файлы просто попадут в список «не вышло» ниже.
    }
  }

  for (const item of wanted) {
    const link = links.get(item.fileID as number);
    if (!link) {
      // Автор мода может запретить скачивание вне сайта - тогда CurseForge не даёт ссылку.
      failed.push(`файл ${item.fileID} - автор запретил скачивание вне сайта`);
    } else {
      try {
        if (!isSafeName(link.name)) throw new Error('странное имя файла');
        await downloadChecked(link.url, safeTarget(root, join('mods', link.name)), link.sha1);
        installed += 1;
      } catch (error) {
        failed.push(`${link.name} - ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    step(instance.id, installed + failed.length, wanted.length);
  }

  finish(instance.id);
  return { instance, installed, failed };
}

/* ---------------------------------------------------------------- экспорт сборки в .mrpack */

/** Что лаунчер кладёт в архив помимо модов: правленые настройки, а не гигабайты миров. */
const EXPORT_EXTRAS = ['config', 'options.txt', 'shaderpacks', 'resourcepacks'];

export interface ExportedPack {
  path: string;
  /** Сколько модов ушло ссылкой на Modrinth, а сколько пришлось положить файлом внутрь. */
  linked: number;
  packed: number;
}

/**
 * Собрать из сборки файл `.mrpack`, которым можно поделиться.
 *
 * Моды, которые Modrinth узнаёт по хешу, записываются ссылкой - архив весит килобайты вместо
 * сотен мегабайт, и это то, чего ждёт любой другой лаунчер. Всё остальное (моды «мимо
 * Modrinth», конфиги, шейдеры) кладём файлами в `overrides`.
 *
 * Миры в архив не попадают намеренно: они весят больше всего и в чужой сборке бесполезны.
 */
export async function exportPack(instanceId: string, target: string): Promise<ExportedPack> {
  const instance = get(instanceId);
  if (!instance) throw new Error('Такой сборки больше нет.');

  const root = resolve(instanceDir(instanceId));
  const modsDir = join(root, 'mods');
  const jars = (await readdir(modsDir).catch(() => [] as string[]))
    .filter((name) => name.toLowerCase().endsWith('.jar'));

  // Хеши считаем все сразу, потом одним запросом спрашиваем Modrinth.
  const hashes = new Map<string, string>();
  for (const name of jars) {
    const hash = await sha1(join(modsDir, name)).catch(() => '');
    if (hash) hashes.set(name, hash);
  }
  const known = await versionsByHash([...hashes.values()]);

  const files: {
    path: string; hashes: { sha1: string; sha512: string };
    env: { client: string; server: string }; downloads: string[]; fileSize: number;
  }[] = [];
  const packed: string[] = [];

  for (const name of jars) {
    const hash = hashes.get(name);
    const version = hash ? known[hash] : undefined;
    const remote = version?.files.find((item) => item.hashes?.sha1 === hash);
    if (!remote?.url || !remote.hashes?.sha512) { packed.push(name); continue; }
    files.push({
      // В модпаке пути всегда через «/», даже если архив собран на Windows.
      path: `mods/${remote.filename || name}`,
      hashes: { sha1: remote.hashes.sha1, sha512: remote.hashes.sha512 },
      env: { client: 'required', server: 'required' },
      downloads: [remote.url],
      fileSize: remote.size,
    });
  }

  const dependencies: Record<string, string> = { minecraft: instance.minecraft };
  if (instance.loader === 'fabric') dependencies['fabric-loader'] = instance.loaderVersion;
  if (instance.loader === 'quilt') dependencies['quilt-loader'] = instance.loaderVersion;
  if (instance.loader === 'forge') dependencies.forge = instance.loaderVersion;
  if (instance.loader === 'neoforge') dependencies.neoforge = instance.loaderVersion;

  const index = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: new Date().toISOString().slice(0, 10),
    name: instance.name,
    files,
    dependencies,
  };

  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(index, null, 2), 'utf8'), 'modrinth.index.json');
  for (const name of packed) zip.addFile(join(modsDir, name), `overrides/mods/${name}`);
  for (const extra of EXPORT_EXTRAS) {
    for (const [disk, inner] of await walk(join(root, extra), extra)) {
      zip.addFile(disk, `overrides/${inner}`);
    }
  }
  zip.end();
  await pipeline(zip.outputStream, createWriteStream(target));

  return { path: target, linked: files.length, packed: packed.length };
}

/** Все файлы папки с путями внутри архива. Пустой список, если папки нет, - это норма. */
async function walk(dir: string, prefix: string): Promise<[string, string][]> {
  const out: [string, string][] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  if (!entries.length) {
    // Это может быть и одиночный файл (options.txt), а не папка.
    const single = await stat(dir).catch(() => null);
    if (single?.isFile()) out.push([dir, prefix]);
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const inner = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...await walk(full, inner));
    else if (entry.isFile()) out.push([full, inner]);
  }
  return out;
}

/* ---------------------------------------------------------------- обмен сборками по коду */

/** Папки, файлы которых Modrinth узнаёт по хешу и которые можно передать ссылкой. */
const SHARE_DIRS: { dir: string; ext: string[] }[] = [
  { dir: 'mods', ext: ['.jar'] },
  { dir: 'resourcepacks', ext: ['.zip'] },
  { dir: 'shaderpacks', ext: ['.zip'] },
];

export interface SharedPack {
  code: string;
  /** Сколько файлов ушло ссылкой и что передать не вышло (нет на Modrinth). */
  linked: number;
  skipped: string[];
}

/**
 * Поделиться сборкой: на сайт уходит только описание (версия игры, загрузчик, ссылки на файлы
 * Modrinth с хешами), а сайт отвечает коротким кодом. Моды, которых нет на Modrinth (скачанные
 * руками или с CurseForge), и конфиги по коду не передаются - про них человеку говорим честно.
 */
export async function sharePack(instanceId: string): Promise<SharedPack> {
  const instance = get(instanceId);
  if (!instance) throw new Error('Такой сборки больше нет.');
  const root = resolve(instanceDir(instanceId));

  const found: { dir: string; name: string; hash: string }[] = [];
  const skipped: string[] = [];
  for (const { dir, ext } of SHARE_DIRS) {
    const names = (await readdir(join(root, dir)).catch(() => [] as string[]))
      .filter((name) => ext.some((e) => name.toLowerCase().endsWith(e)));
    for (const name of names) {
      const hash = await sha1(join(root, dir, name)).catch(() => '');
      if (hash) found.push({ dir, name, hash }); else skipped.push(name);
    }
  }
  const known = await versionsByHash(found.map((f) => f.hash));

  const files = [];
  for (const item of found) {
    const remote = known[item.hash]?.files.find((file) => file.hashes?.sha1 === item.hash);
    if (!remote?.url || !remote.hashes?.sha512 || !remote.url.startsWith('REDACTED_ENDPOINT')) {
      skipped.push(item.name);
      continue;
    }
    files.push({
      path: `${item.dir}/${remote.filename || item.name}`,
      hashes: { sha1: remote.hashes.sha1, sha512: remote.hashes.sha512 },
      env: { client: 'required', server: 'required' },
      downloads: [remote.url],
      fileSize: remote.size,
    });
  }
  if (!files.length) {
    throw new Error('В сборке нет модов с Modrinth: передать кодом нечего. Сохрани её файлом .mrpack.');
  }

  const dependencies: Record<string, string> = { minecraft: instance.minecraft };
  if (instance.loader === 'fabric') dependencies['fabric-loader'] = instance.loaderVersion;
  if (instance.loader === 'quilt') dependencies['quilt-loader'] = instance.loaderVersion;
  if (instance.loader === 'forge') dependencies.forge = instance.loaderVersion;
  if (instance.loader === 'neoforge') dependencies.neoforge = instance.loaderVersion;
  const index = {
    formatVersion: 1, game: 'minecraft', versionId: new Date().toISOString().slice(0, 10),
    name: instance.name, files, dependencies,
  };

  let response: Response;
  try {
    response = await redactedFetch(`${apiBase()}/api/packs/share`, {
      method: 'POST',
      headers: { ...UA, 'content-type': 'application/json' },
      body: JSON.stringify({ index }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error('Сайт недоступен. Проверь интернет.');
  }
  const body = await response.json().catch(() => ({})) as { ok?: boolean; code?: string; message?: string };
  if (!body.ok || !body.code) throw new Error(body.message || `Сайт не принял сборку (${response.status}).`);
  return { code: body.code, linked: files.length, skipped };
}

export interface SharedPreview {
  code: string;
  name: string;
  minecraft: string;
  loader: string;
  loaderVersion: string;
  files: number;
}

/** Код как его ввёл человек: пробелы, дефисы и строчные буквы прощаем. */
function normalizeCode(raw: string): string {
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{8}$/.test(code)) throw new Error('Код - это 8 букв и цифр, например K7F3QX2M.');
  return code;
}

async function fetchShared(raw: string): Promise<SharedPreview & { index: ModrinthIndex }> {
  const code = normalizeCode(raw);
  let response: Response;
  try {
    response = await redactedFetch(`${apiBase()}/api/packs/${code}`, { headers: UA, signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error('Сайт недоступен. Проверь интернет.');
  }
  const body = await response.json().catch(() => ({})) as { ok?: boolean; message?: string; pack?: SharedPreview & { index: ModrinthIndex } };
  if (!body.ok || !body.pack) throw new Error(body.message || `Сборка не нашлась (${response.status}).`);
  return body.pack;
}

/** Что за сборка под кодом - показать человеку до установки. */
export async function previewShared(code: string): Promise<SharedPreview> {
  const { index: _index, ...preview } = await fetchShared(code);
  return preview;
}

/** Поставить сборку по коду: создаётся новая сборка, файлы качаются с Modrinth и сверяются по хешу. */
export async function importShared(code: string): Promise<ImportedPack> {
  const pack = await fetchShared(code);
  // Сайт сам пускает в сборку по коду только CDN Modrinth, но проверяем и здесь: код мог
  // собрать не лаунчер, а кто угодно прямым запросом к сайту.
  return importModrinth(null, null, pack.index, SHARED_HOSTS);
}
