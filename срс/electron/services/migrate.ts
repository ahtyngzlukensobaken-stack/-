import { app } from 'electron';
import { existsSync } from 'node:fs';
import { cp, readFile, readdir, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { create, patch } from './instances.js';
import { report } from './install.js';
import { instanceDir } from './paths.js';
import { loaderVersions } from './versions.js';
import { load, type Instance } from './store.js';



export interface FoundInstance {
  
  path: string;
  launcher: string;
  name: string;
  minecraft: string;
  loader: Instance['loader'];
  loaderVersion: string;
  mods: number;
  worlds: number;
  
  size: number;
  
  worldsSize: number;
  
  already: boolean;
  
  problem?: string;
}


const CARRY = ['mods', 'config', 'saves', 'resourcepacks', 'shaderpacks', 'screenshots',
  'options.txt', 'servers.dat', 'optionsshaders.txt'];


const BY_UID: Record<string, Instance['loader']> = {
  'net.fabricmc.fabric-loader': 'fabric',
  'org.quiltmc.quilt-loader': 'quilt',
  'net.minecraftforge': 'forge',
  'net.neoforged': 'neoforge',
};

function roaming(...parts: string[]): string {
  return join(app.getPath('appData'), ...parts);
}

async function countIn(dir: string, endsWith?: string): Promise<number> {
  const entries = await readdir(dir).catch(() => [] as string[]);
  return endsWith ? entries.filter((name) => name.toLowerCase().endsWith(endsWith)).length : entries.length;
}


async function weigh(dir: string, budget = { left: 40000 }): Promise<number> {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (budget.left <= 0) break;
    budget.left -= 1;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) total += await weigh(full, budget);
    else total += await stat(full).then((info) => info.size, () => 0);
  }
  return total;
}


async function describe(gameDir: string): Promise<{
  mods: number; worlds: number; size: number; worldsSize: number;
}> {
  let size = 0;
  let worldsSize = 0;
  for (const name of CARRY) {
    const full = join(gameDir, name);
    if (!existsSync(full)) continue;
    const weight = await stat(full).then(
      (info) => (info.isDirectory() ? weigh(full) : Promise.resolve(info.size)),
      () => Promise.resolve(0),
    );
    size += weight;
    if (name === 'saves') worldsSize = weight;
  }
  return {
    mods: await countIn(join(gameDir, 'mods'), '.jar'),
    worlds: await countIn(join(gameDir, 'saves')),
    size,
    worldsSize,
  };
}


async function readPrism(dir: string, launcher: string): Promise<FoundInstance | null> {
  const gameDir = ['minecraft', '.minecraft'].map((name) => join(dir, name)).find((path) => existsSync(path));
  if (!gameDir) return null;

  let name = basename(dir);
  const cfg = await readFile(join(dir, 'instance.cfg'), 'utf8').catch(() => '');
  const named = /^name=(.+)$/m.exec(cfg)?.[1]?.trim();
  if (named) name = named;

  let minecraft = '';
  let loader: Instance['loader'] = 'vanilla';
  let loaderVersion = '';
  try {
    const pack = JSON.parse(await readFile(join(dir, 'mmc-pack.json'), 'utf8')) as {
      components?: { uid?: string; version?: string }[];
    };
    for (const part of pack.components ?? []) {
      if (part.uid === 'net.minecraft') minecraft = part.version ?? '';
      const match = part.uid ? BY_UID[part.uid] : undefined;
      if (match) { loader = match; loaderVersion = part.version ?? ''; }
    }
  } catch {
    
  }

  const counts = await describe(gameDir);
  return {
    path: gameDir, launcher, name, minecraft, loader, loaderVersion, ...counts, already: false,
    problem: minecraft ? undefined : 'Не удалось понять версию игры в этой сборке.',
  };
}


function detectLoader(versionId: string): { loader: Instance['loader']; loaderVersion: string } {
  const name = versionId.toLowerCase();

  const fabric = /fabric-loader-([0-9][^-]*)/.exec(name);
  if (fabric?.[1]) return { loader: 'fabric', loaderVersion: fabric[1] };

  const quilt = /quilt-loader-([0-9][^-]*)/.exec(name);
  if (quilt?.[1]) return { loader: 'quilt', loaderVersion: quilt[1] };

  
  const neo = /neoforge-([0-9][\w.+-]*)/.exec(name);
  if (neo?.[1]) return { loader: 'neoforge', loaderVersion: neo[1] };

  const forge = /forge-([0-9][\w.+-]*)/.exec(name);
  if (forge?.[1]) return { loader: 'forge', loaderVersion: forge[1] };

  if (name.includes('fabric')) return { loader: 'fabric', loaderVersion: '' };
  if (name.includes('quilt')) return { loader: 'quilt', loaderVersion: '' };
  if (name.includes('neoforge')) return { loader: 'neoforge', loaderVersion: '' };
  if (name.includes('forge')) return { loader: 'forge', loaderVersion: '' };
  return { loader: 'vanilla', loaderVersion: '' };
}


async function readDotMinecraft(gameDir: string, launcher: string): Promise<FoundInstance | null> {
  if (!existsSync(gameDir)) return null;

  const versionsDir = join(gameDir, 'versions');
  const names = await readdir(versionsDir).catch(() => [] as string[]);

  
  let newest = { name: '', at: 0 };
  for (const name of names) {
    const when = await stat(join(versionsDir, name)).then((s) => s.mtimeMs, () => 0);
    if (when > newest.at) newest = { name, at: when };
  }
  if (!newest.name) return null;

  const detected = detectLoader(newest.name);

  let minecraft = '';
  try {
    const meta = JSON.parse(await readFile(join(versionsDir, newest.name, `${newest.name}.json`), 'utf8')) as {
      inheritsFrom?: string; id?: string;
    };
    // `inheritsFrom` есть только у модовых версий, и там лежит настоящая версия игры.
    if (meta.inheritsFrom) minecraft = meta.inheritsFrom;
  } catch {
    // json версии не прочитался - ниже достанем версию из имени папки.
  }
  // У ванильной версии имя папки и есть версия. У модовой без `inheritsFrom` версия игры
  // тоже записана в имени, но рядом с версией загрузчика - берём ту, что не загрузчик.
  if (!minecraft) {
    if (detected.loader === 'vanilla') minecraft = newest.name;
    else {
      const numbers = newest.name.match(/\d+\.\d+(?:\.\d+)?/g) ?? [];
      minecraft = numbers.find((one) => one !== detected.loaderVersion && one.startsWith('1.')) ?? '';
    }
  }

  const counts = await describe(gameDir);
  const looksLikeVersion = /^\d+\.\d+(\.\d+)?$/.test(minecraft);
  return {
    path: gameDir, launcher, name: basename(gameDir) === '.minecraft' ? 'Папка .minecraft' : basename(gameDir),
    minecraft, loader: detected.loader, loaderVersion: detected.loaderVersion, ...counts, already: false,
    problem: looksLikeVersion ? undefined
      : minecraft ? `Непонятная версия игры: ${minecraft}.`
      : 'Не удалось понять, какая версия игры в этой папке.',
  };
}

/** Где искать чужие сборки. Чего нет - просто пропускаем. */
export async function scan(): Promise<FoundInstance[]> {
  const found: FoundInstance[] = [];
  const taken = new Set(load().instances.map((one) => one.source).filter(Boolean));

  const packs: [string, string][] = [
    [roaming('PrismLauncher', 'instances'), 'Prism Launcher'],
    [roaming('MultiMC', 'instances'), 'MultiMC'],
    [roaming('com.modrinth.theseus', 'profiles'), 'Modrinth App'],
  ];
  for (const [dir, launcher] of packs) {
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      // У Prism рядом со сборками лежат служебные файлы - у них нет своей папки.
      const full = join(dir, name);
      if (!await stat(full).then((s) => s.isDirectory(), () => false)) continue;
      const one = await readPrism(full, launcher)
        // Modrinth App держит файлы игры прямо в папке профиля, без вложенной minecraft.
        ?? await readDotMinecraft(full, launcher);
      if (one) found.push({ ...one, already: taken.has(one.path) });
    }
  }

  const plain = await readDotMinecraft(roaming('.minecraft'), 'Обычная папка .minecraft');
  if (plain) found.push({ ...plain, already: taken.has(plain.path) });

  return found;
}

export interface Adopted {
  instance: Instance;
  /** Что именно скопировали - это и показываем человеку вместо «готово». */
  carried: string[];
}

/**
 * Создать у себя сборку по чужой и скопировать её содержимое.
 *
 * Копируем только то, что принадлежит сборке: моды, конфиги, миры, ресурс-паки, шейдеры,
 * скриншоты и настройки игры. Версии, библиотеки и ассеты не трогаем - они у нас лежат в общей
 * папке и качаются один раз на все сборки.
 *
 * `withWorlds = false` оставляет миры в покое: в них почти весь вес, а переносят иногда
 * только набор модов.
 */
export async function adopt(found: FoundInstance, withWorlds = true): Promise<Adopted> {
  if (found.problem) throw new Error(found.problem);
  if (!existsSync(found.path)) throw new Error('Папка этой сборки больше не на месте.');

  // Имя папки версии не всегда содержит версию загрузчика (например просто «Fabric 1.21»).
  // Тогда берём свежую рекомендованную под эту версию игры: моды привязаны к версии игры,
  // а не к версии загрузчика, так что сборка соберётся правильно.
  let loaderVersion = found.loaderVersion;
  if (found.loader !== 'vanilla' && !loaderVersion) {
    const available = await loaderVersions(found.loader, found.minecraft).catch(() => []);
    loaderVersion = (available.find((one) => one.recommended) ?? available[0])?.version ?? '';
    if (!loaderVersion) {
      throw new Error(`Не нашёл версию ${found.loader} под Minecraft ${found.minecraft}. Проверь интернет.`);
    }
  }

  const instance = create({
    name: found.name,
    minecraft: found.minecraft,
    loader: found.loader,
    loaderVersion,
  });
  const target = instanceDir(instance.id);

  // Откуда перенесли - чтобы следующий поиск показал эту папку как уже перенесённую.
  patch(instance.id, { source: found.path });

  const carried: string[] = [];
  let done = 0;
  for (const name of CARRY) {
    // Миры весят больше всего остального вместе взятого, и они не всегда нужны:
    // человек мог захотеть перенести только набор модов.
    if (name === 'saves' && !withWorlds) { done += 1; continue; }
    const from = join(found.path, name);
    if (!existsSync(from)) { done += 1; continue; }
    report({
      instanceId: instance.id, stage: `Переношу: ${name}`, progress: done, total: CARRY.length,
      bytesPerSecond: 0, done: false, unit: 'files',
    });
    // force:false - ничего уже существующего не затираем: сборка только что создана, но
    // мало ли что успел положить установщик модов по умолчанию.
    await cp(from, join(target, name), { recursive: true, force: false, errorOnExist: false });
    carried.push(name);
    done += 1;
  }

  report({
    instanceId: instance.id, stage: 'Перенос закончен', progress: 1, total: 1,
    bytesPerSecond: 0, done: true, unit: 'files',
  });
  return { instance, carried };
}
