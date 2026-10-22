import { ZipFile } from 'yazl';
import { createWriteStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { instanceSaves } from './paths.js';



export interface BackupResult {
  path: string;
  files: number;
  size: number;
}


async function walk(dir: string): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    
    if (entry.isDirectory()) found.push(...await walk(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}


export async function backupWorld(id: string, folder: string, target: string): Promise<BackupResult> {
  
  if (!folder || folder !== basename(folder)) throw new Error('Неизвестный мир.');
  const dir = join(instanceSaves(id), folder);

  const files = await walk(dir);
  if (!files.length) throw new Error('В папке мира нет файлов - похоже, мир ещё не сохранялся.');

  const zip = new ZipFile();
  for (const file of files) {
    
    zip.addFile(file, `${folder}/${relative(dir, file).split(/[\\/]/).join('/')}`);
  }
  zip.end();

  await pipeline(zip.outputStream, createWriteStream(target));
  const info = await stat(target);
  return { path: target, files: files.length, size: info.size };
}
