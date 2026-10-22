import { cp, rename, rm, stat, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { dataDir, MOVABLE, setDataRoot } from './paths.js';
import { load, update } from './store.js';



interface MoveResult {
  from: string;
  to: string;
  moved: string[];
}


export async function moveDataRoot(target: string): Promise<MoveResult> {
  const from = dataDir();
  const to = resolve(target.trim());

  if (!to) throw new Error('Не указана папка.');
  if (to === from) throw new Error('Это та же папка, что и сейчас.');
  
  if (to.startsWith(from + '\\') || to.startsWith(from + '/')) {
    throw new Error('Нельзя перенести папку внутрь себя же.');
  }

  await mkdir(to, { recursive: true });

  
  
  for (const name of MOVABLE) {
    if (existsSync(join(to, name)) && (await readdir(join(to, name))).length) {
      throw new Error(`В выбранной папке уже есть «${name}» с файлами. Выбери пустую папку.`);
    }
  }

  const moved: string[] = [];
  for (const name of MOVABLE) {
    const source = join(from, name);
    if (!existsSync(source)) continue;
    const destination = join(to, name);
    try {
      await rename(source, destination);
    } catch {
      // Другой диск или файл занят - копируем, потом удаляем.
      try {
        await cp(source, destination, { recursive: true, force: true });
      } catch (error) {
        // Недокопированная папка хуже, чем никакой: выглядит как данные, но ими не является,
        // а следующая попытка откажет «папка не пустая». Убираем её, источник не тронут.
        await rm(destination, { recursive: true, force: true }).catch(() => {});
        throw new Error(
          `Не удалось скопировать «${name}»: ${error instanceof Error ? error.message : String(error)}. `
          + 'Файлы остались на старом месте.',
        );
      }
      await rm(source, { recursive: true, force: true });
    }
    moved.push(name);
  }

  update((data) => { data.settings.dataRoot = to; });
  setDataRoot(to);
  return { from, to, moved };
}

/** Сколько занимает текущая папка данных - показываем перед переносом. */
export async function dataSize(): Promise<number> {
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else {
        try { total += (await stat(path)).size; } catch { /* файл пропал во время обхода */ }
      }
    }
  };
  for (const name of MOVABLE) await walk(join(dataDir(), name));
  return total;
}

/** Вызывается один раз при старте, до любой работы с диском. */
export function applyStoredDataRoot(): void {
  const stored = load().settings.dataRoot;
  if (stored) setDataRoot(stored);
}
