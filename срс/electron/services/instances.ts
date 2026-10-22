import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  instanceDir, instanceMods, instanceResourcePacks, instanceSaves, instanceShaderPacks,
  worldDatapacks,
} from './paths.js';
import { load, update, type Instance } from './store.js';




export type Kind = 'mod' | 'resourcepack' | 'datapack' | 'shader';


export function contentDir(id: string, kind: Kind, world = ''): string {
  if (kind === 'resourcepack') return instanceResourcePacks(id);
  if (kind === 'shader') return instanceShaderPacks(id);
  if (kind === 'datapack') {
    if (!world) throw new Error('Выбери мир - датапак ставится в мир, а не в сборку.');
    return worldDatapacks(id, world);
  }
  return instanceMods(id);
}


const EXTENSIONS: Record<Kind, string[]> = {
  mod: ['.jar'],
  resourcepack: ['.zip'],
  datapack: ['.zip'],
  shader: ['.zip'],
};

export interface NewInstance {
  name: string;
  minecraft: string;
  loader: Instance['loader'];
  loaderVersion: string;
  accent?: Instance['accent'];
}

const ACCENTS: Instance['accent'][] = ['cosmic', 'kawaii', 'aurora'];


const COVER_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];


export type InstanceView = Instance & { coverUrl?: string };


function withCover(instance: Instance): InstanceView {
  if (!instance.cover) return instance;
  const full = join(instanceDir(instance.id), instance.cover);
  try {
    const info = statSync(full);
    return { ...instance, coverUrl: `${pathToFileURL(full).href}?v=${Math.floor(info.mtimeMs)}` };
  } catch {
    // Файл удалили мимо лаунчера - показываем сборку без обложки, а не ломаем список.
    return instance;
  }
}

/** Все сборки: сначала недавно игранные, потом недавно созданные. */
export function list(): InstanceView[] {
  return [...load().instances]
    .sort((a, b) => b.lastPlayed - a.lastPlayed || b.createdAt - a.createdAt)
    .map(withCover);
}

export function get(id: string): Instance | null {
  return load().instances.find((i) => i.id === id) ?? null;
}

/**
 * Ставит обложку сборки: копирует выбранную картинку в папку сборки под именем `cover.<ext>`.
 *
 * Копируем, а не запоминаем путь к оригиналу: картинку из «Загрузок» пользователь рано или поздно
 * удалит, и обложка пропала бы сама собой. Прежний файл убираем - иначе в папке копились бы
 * cover.png, cover.jpg и так далее, и было бы не понять, какая из них показывается.
 */
export function setCover(id: string, source: string): InstanceView {
  const instance = get(id);
  if (!instance) throw new Error('Сборка не найдена.');
  const extension = extname(source).toLowerCase();
  if (!COVER_EXTENSIONS.includes(extension)) throw new Error('Обложкой может быть картинка: png, jpg, webp или gif.');

  const dir = instanceDir(id);
  mkdirSync(dir, { recursive: true });
  if (instance.cover && instance.cover !== `cover${extension}`) {
    try { rmSync(join(dir, instance.cover), { force: true }); } catch { /* файла и так нет */ }
  }
  copyFileSync(source, join(dir, `cover${extension}`));
  patch(id, { cover: `cover${extension}` });
  return withCover(get(id)!);
}

/** Убирает обложку и сам файл: держать картинку, которую уже нигде не видно, незачем. */
export function clearCover(id: string): void {
  const instance = get(id);
  if (!instance?.cover) return;
  try { rmSync(join(instanceDir(id), instance.cover), { force: true }); } catch { /* файла и так нет */ }
  patch(id, { cover: undefined });
}

export interface ImportResult {
  added: { kind: Kind; file: string }[];
  /** Имена файлов, которые не взяли: не .jar/.zip, не файл или такой уже лежит в папке. */
  skipped: string[];
}

/**
 * Копирует файлы, перетащенные в окно, в папки сборки.
 *
 * `.jar` всегда уходит в моды, `.zip` - в вид, открытый сейчас на экране (с вкладки «Моды» -
 * в ресурс-паки: zip в папке mods игра не загрузит). Файл с тем же именем не перезаписываем:
 * так можно было бы молча подменить настроенный мод другой версией.
 */
export function importFiles(id: string, preferred: Kind, world: string, paths: string[]): ImportResult {
  if (!get(id)) throw new Error('Сборка не найдена.');
  const result: ImportResult = { added: [], skipped: [] };
  for (const path of paths.slice(0, 200)) {
    const name = basename(path);
    const extension = extname(name).toLowerCase();
    const kind: Kind | null = extension === '.jar'
      ? 'mod'
      : extension === '.zip' ? (preferred === 'mod' ? 'resourcepack' : preferred) : null;
    let isFile = false;
    try { isFile = statSync(path).isFile(); } catch { /* файла уже нет */ }
    if (!kind || !isFile || !EXTENSIONS[kind].includes(extension)) { result.skipped.push(name); continue; }

    const dir = contentDir(id, kind, kind === 'datapack' ? world : '');
    const target = join(dir, name);
    if (existsSync(target) || existsSync(`${target}.disabled`)) { result.skipped.push(name); continue; }
    mkdirSync(dir, { recursive: true });
    copyFileSync(path, target);
    result.added.push({ kind, file: name });
  }
  return result;
}

export interface Screenshot {
  file: string;
  /** file:// адрес - интерфейс показывает картинку прямо с диска. */
  url: string;
  size: number;
  at: number;
}

/** Скриншоты сборки (F2 в игре), новые первыми. */
export function screenshots(id: string): Screenshot[] {
  const dir = join(instanceDir(id), 'screenshots');
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(png|jpe?g)$/i.test(entry.name))
      .map((entry) => {
        const full = join(dir, entry.name);
        const info = statSync(full);
        return { file: entry.name, url: pathToFileURL(full).href, size: info.size, at: Math.floor(info.mtimeMs / 1000) };
      })
      .sort((a, b) => b.at - a.at)
      .slice(0, 120);
  } catch {
    return [];
  }
}

/** Путь к одному скриншоту. Имя приходит из интерфейса, поэтому `../` и не-картинки не пропускаем. */
export function screenshotPath(id: string, file: string): string {
  if (file !== basename(file) || !/\.(png|jpe?g)$/i.test(file)) throw new Error('Это не скриншот.');
  return join(instanceDir(id), 'screenshots', file);
}

export function create(input: NewInstance): Instance {
  const name = input.name.trim();
  if (!name) throw new Error('У сборки должно быть название.');
  if (input.loader !== 'vanilla' && !input.loaderVersion) {
    throw new Error('Выбери версию загрузчика.');
  }

  const settings = load().settings;
  const instance: Instance = {
    id: randomUUID(),
    name,
    minecraft: input.minecraft,
    loader: input.loader,
    loaderVersion: input.loader === 'vanilla' ? '' : input.loaderVersion,
    // Установщик потом заменит: для загрузчика запускается не версия игры,
    // а та версия, которую загрузчик записал в общую папку.
    versionId: input.minecraft,
    // Цвет плитки по кругу.
    accent: input.accent ?? (ACCENTS[load().instances.length % ACCENTS.length] as Instance['accent']),
    memory: settings.memory,
    installed: false,
    lastPlayed: 0,
    createdAt: Math.floor(Date.now() / 1000),
  };

  mkdirSync(instanceMods(instance.id), { recursive: true });
  update((data) => {
    data.instances.push(instance);
    data.selectedInstance = instance.id;
  });
  return instance;
}

/**
 * Сменить версию игры или загрузчик у готовой сборки.
 *
 * Раньше этого было нельзя вовсе: выбор при создании оставался навсегда, и человеку,
 * собравшему сборку кнопкой «Собрать за меня», оставалось только завести вторую и
 * перетащить моды руками.
 *
 * `installed: false` - это не пометка «сломано», а задание: перед следующим запуском
 * лаунчер поставит игру под новую версию. Моды, конфиги и миры остаются на месте: часть
 * модов под новую версию может не подойти, но решать, что с ними делать, - дело человека,
 * а не лаунчера.
 */
export function setVersion(
  id: string,
  input: { minecraft: string; loader: Instance['loader']; loaderVersion: string },
): Instance {
  if (!input.minecraft) throw new Error('Выбери версию игры.');
  if (input.loader !== 'vanilla' && !input.loaderVersion) {
    throw new Error('Выбери версию загрузчика.');
  }
  const result = patch(id, {
    minecraft: input.minecraft,
    loader: input.loader,
    loaderVersion: input.loader === 'vanilla' ? '' : input.loaderVersion,
    versionId: input.minecraft,
    installed: false,
  });
  if (!result) throw new Error('Такой сборки больше нет.');
  return result;
}

export function patch(id: string, changes: Partial<Instance>): Instance | null {
  let result: Instance | null = null;
  update((data) => {
    const found = data.instances.find((i) => i.id === id);
    if (!found) return;
    Object.assign(found, changes);
    result = found;
  });
  return result;
}

/**
 * Убирает сборку из списка. Папку не трогает: её main.ts отправляет в Корзину.
 *
 * Сначала проверяем, что сборка есть. Раньше папка сносилась по любому id, даже несуществующему:
 * id приходит из интерфейса, и ошибка в нём могла стоить чужой папки.
 */
export function remove(id: string): void {
  if (!get(id)) throw new Error('Такой сборки больше нет.');
  update((data) => {
    data.instances = data.instances.filter((i) => i.id !== id);
    if (data.selectedInstance === id) data.selectedInstance = data.instances[0]?.id ?? null;
  });
}

/**
 * Переименование сборки.
 *
 * Меняется только подпись: папка сборки названа по её id и никуда не переезжает. Иначе
 * переименование ломало бы пути к мирам и модам - а это как раз то, что человек терять не готов.
 */
export function rename(id: string, name: string): Instance {
  const clean = name.trim();
  if (!clean) throw new Error('У сборки должно быть название.');
  const result = patch(id, { name: clean });
  if (!result) throw new Error('Такой сборки больше нет.');
  return result;
}

/**
 * Копия сборки со всем содержимым: моды, конфиги, миры, скриншоты.
 *
 * Зачем: единственный безопасный способ поэкспериментировать с модами, не рискуя миром, в который
 * уже вложено сто часов. Копируем файлами, а не ссылками, - иначе правка в копии меняла бы оригинал.
 *
 * Общая папка `shared` не трогается: версии игры и библиотеки и так одни на всех, копия
 * занимает ровно столько, сколько весят её моды и миры.
 */
export async function duplicate(id: string): Promise<Instance> {
  const source = get(id);
  if (!source) throw new Error('Такой сборки больше нет.');

  const names = new Set(load().instances.map((i) => i.name));
  let name = `${source.name} (копия)`;
  for (let n = 2; names.has(name); n += 1) name = `${source.name} (копия ${n})`;

  const copy: Instance = {
    ...source,
    id: randomUUID(),
    name,
    // Время игры и дата последнего запуска принадлежат оригиналу: в копию ещё не играли.
    lastPlayed: 0,
    playSeconds: 0,
    createdAt: Math.floor(Date.now() / 1000),
  };

  const from = instanceDir(source.id);
  const to = instanceDir(copy.id);
  mkdirSync(to, { recursive: true });
  if (existsSync(from)) {
    await cp(from, to, {
      recursive: true,
      // Логи и отчёты о вылетах принадлежат запускам оригинала - в копии они будут врать.
      filter: (path) => !/[\/](logs|crash-reports)([\/]|$)/i.test(path.slice(from.length)),
    });
  }
  mkdirSync(instanceMods(copy.id), { recursive: true });

  update((data) => {
    data.instances.push(copy);
    data.selectedInstance = copy.id;
  });
  return copy;
}

export function select(id: string): void {
  update((data) => {
    if (data.instances.some((i) => i.id === id)) data.selectedInstance = id;
  });
}

export interface ModFile {
  file: string;
  size: number;
  enabled: boolean;
}

/**
 * Что реально лежит в папке этого вида контента.
 *
 * Выключенный мод - это файл с суффиксом `.disabled`, игра такие не грузит. Поэтому переключатель -
 * это просто переименование, а файл, закинутый руками, показывается так же, как поставленный нами.
 */
export function files(id: string, kind: Kind = 'mod', world = ''): ModFile[] {
  let dir: string;
  try {
    dir = contentDir(id, kind, world);
  } catch {
    // Вкладка датапаков, а мир ещё не выбран: пустой список, а не ошибка.
    return [];
  }
  const allowed = EXTENSIONS[kind];
  try {
    return readdirSync(dir)
      .filter((file) => allowed.some((ext) => file.endsWith(ext) || file.endsWith(ext + '.disabled')))
      .map((file) => ({
        file,
        size: statSync(join(dir, file)).size,
        enabled: !file.endsWith('.disabled'),
      }))
      .sort((a, b) => a.file.localeCompare(b.file));
  } catch {
    return [];
  }
}

/** Только моды (jar). */
export function mods(id: string): ModFile[] {
  return files(id, 'mod');
}

export interface World {
  /** Имя папки мира - из него строится путь к датапакам. */
  folder: string;
  /** Название мира (сейчас это то же имя папки). */
  name: string;
  datapacks: number;
  lastPlayed: number;
}

/**
 * Миры в папке saves сборки.
 *
 * Название берём из имени папки, а не из `level.dat`: там NBT внутри gzip, и тянуть парсер ради одной
 * подписи незачем - Minecraft и так называет папку по имени, которое ввёл игрок.
 */
export function worlds(id: string): World[] {
  const dir = instanceSaves(id);
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        let lastPlayed = 0;
        try { lastPlayed = Math.floor(statSync(join(dir, entry.name, 'level.dat')).mtimeMs / 1000); } catch { /* в мир ещё не заходили */ }
        return {
          folder: entry.name,
          name: entry.name,
          datapacks: files(id, 'datapack', entry.name).length,
          lastPlayed,
        };
      })
      .sort((a, b) => b.lastPlayed - a.lastPlayed || a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}
