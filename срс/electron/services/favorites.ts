import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { UA } from './site.js';
import { publicHttpsUrl, safeFetch } from './safefetch.js';
import { dataDir } from './paths.js';



export interface Favorite {
  id: string;
  
  url: string;
  gif: boolean;
  
  src: string;
  at: number;
}

interface Stored { id: string; url: string; file: string; gif: boolean; at: number }

const LIMIT = 200;
const SIZE_MAX = 8 * 1024 * 1024;

const dir = (): string => join(dataDir(), 'favorites');
const indexFile = (): string => join(dir(), 'index.json');

function read(): Stored[] {
  try {
    const list = JSON.parse(readFileSync(indexFile(), 'utf8')) as Stored[];
    return Array.isArray(list) ? list.filter((f) => existsSync(join(dir(), f.file))) : [];
  } catch {
    return [];
  }
}

function write(list: Stored[]): void {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(indexFile(), JSON.stringify(list));
}

const view = (f: Stored): Favorite => ({ id: f.id, url: f.url, gif: f.gif, at: f.at, src: pathToFileURL(join(dir(), f.file)).href });


export function list(): Favorite[] {
  return read().sort((a, b) => b.at - a.at).map(view);
}

const EXT: Record<string, string> = { 'image/gif': 'gif', 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' };

export async function add(url: string): Promise<Favorite[]> {
  if (!/^https:\/\/\S+$/.test(url)) throw new Error('Эту картинку не сохранить.');
  const id = createHash('sha1').update(url).digest('hex').slice(0, 16);
  const stored = read();
  if (stored.some((f) => f.id === id)) return list();
  if (stored.length >= LIMIT) throw new Error(`В избранном уже ${LIMIT} штук. Убери что-нибудь.`);
  // Адрес приходит из чата. Только https и не внутренняя сеть (localhost, 192.168.x.x и т.п.) -
  // в том числе после редиректов: иначе картинкой из чата можно было бы дёрнуть роутер игрока.
  if (!publicHttpsUrl(url)) throw new Error('Эту картинку не сохранить.');
  let response: Response;
  try {
    response = await safeFetch(url, { check: (u) => publicHttpsUrl(u) !== null, headers: UA, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error('Картинка не скачалась. Проверь интернет.');
  }
  if (!response.ok) throw new Error('Картинка уже удалена.');
  const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
  const ext = EXT[type];
  if (!ext) throw new Error('Это не картинка.');
  if (Number(response.headers.get('content-length') || 0) > SIZE_MAX) throw new Error('Слишком большая для избранного.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > SIZE_MAX) throw new Error('Слишком большая для избранного.');
  const file = `${id}.${ext}`;
  mkdirSync(dir(), { recursive: true });
  writeFileSync(join(dir(), file), bytes);
  write([...stored, { id, url, file, gif: ext === 'gif', at: Date.now() }]);
  return list();
}

export function remove(id: string): Favorite[] {
  const stored = read();
  const found = stored.find((f) => f.id === id);
  if (found) rmSync(join(dir(), found.file), { force: true });
  write(stored.filter((f) => f.id !== id));
  return list();
}

/**
 * Что отправить. Чужая гифка - просто ссылка. Наша картинка с сайта могла уже удалиться, поэтому
 * отдаём копию с диска: интерфейс зальёт её заново (тот же файл - тот же адрес, и срок хранения
 * на сайте начнётся сначала).
 */
export function payload(id: string): { url: string; data?: string } {
  const found = read().find((f) => f.id === id);
  if (!found) throw new Error('Такой картинки в избранном уже нет.');
  if (!/\/api\/social\/media\//.test(found.url)) return { url: found.url };
  const bytes = readFileSync(join(dir(), found.file));
  const type = found.gif ? 'gif' : 'webp';
  return { url: found.url, data: `data:image/${type};base64,${bytes.toString('base64')}` };
}
