import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isIP } from 'node:net';




export const MOD_HOSTS: ReadonlySet<string> = new Set([
  'cdn.modrinth.com', 'edge.forgecdn.net', 'mediafilez.forgecdn.net', 'media.forgecdn.net',
]);


export const PACK_HOSTS: ReadonlySet<string> = new Set([
  ...MOD_HOSTS, 'github.com', 'raw.githubusercontent.com', 'objects.githubusercontent.com',
  'release-assets.githubusercontent.com', 'gitlab.com',
]);


export const MAX_FILE_BYTES = 512 * 1024 * 1024;


export function allowedUrl(raw: string | URL, hosts: ReadonlySet<string>): URL | null {
  let url: URL;
  try { url = new URL(String(raw)); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, '')) || !hosts.has(host)) return null;
  return url;
}


export function publicHttpsUrl(raw: string | URL): URL | null {
  let url: URL;
  try { url = new URL(String(raw)); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host.includes('.') || isIP(host.replace(/^\[|\]$/g, ''))) return null;
  if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/.test(host)) return null;
  return url;
}

export interface SafeFetchOptions {
  
  check: (url: URL) => boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
}


export async function safeFetch(raw: string, options: SafeFetchOptions): Promise<Response> {
  const doFetch = options.fetchImpl ?? fetch;
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Битая ссылка на файл.'); }
  for (let hop = 0; hop <= (options.maxRedirects ?? 5); hop++) {
    if (!options.check(url)) throw new Error(`Файлы с ${url.hostname || 'этого адреса'} лаунчер не качает.`);
    const response = await doFetch(url, { headers: options.headers, signal: options.signal, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      if (!location) throw new Error('Сервер прислал редирект без адреса.');
      url = new URL(location, url);
      continue;
    }
    return response;
  }
  throw new Error('Слишком много редиректов.');
}

export interface DownloadOptions {
  hosts: ReadonlySet<string>;
  /** Ожидаемый SHA-1 (hex). required: true - без него не качаем. */
  sha1?: string;
  requireHash?: boolean;
  maxBytes?: number;
  /** Сколько ждать хоть одного байта, прежде чем оборвать. */
  idleMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Качает файл в target через target.part: размер ограничен, SHA-1 сверяется, недокачанное удаляется.
 * На место файл встаёт только целиком и только после всех проверок.
 */
export async function downloadFile(url: string, target: string, options: DownloadOptions): Promise<void> {
  const sha1 = options.sha1?.toLowerCase();
  if (options.requireHash && !/^[0-9a-f]{40}$/.test(sha1 ?? '')) throw new Error('У файла нет контрольной суммы - ставить не буду.');
  const max = options.maxBytes ?? MAX_FILE_BYTES;
  const controller = new AbortController();
  let idle: ReturnType<typeof setTimeout> | undefined;
  const poke = (): void => { clearTimeout(idle); idle = setTimeout(() => controller.abort(), options.idleMs ?? 30_000); };
  const part = target + '.part';
  const hash = createHash('sha1');
  let bytes = 0;
  poke();
  try {
    const response = await safeFetch(url, {
      check: (u) => allowedUrl(u, options.hosts) !== null,
      headers: { 'user-agent': 'PowerVisualLauncher' }, signal: controller.signal, fetchImpl: options.fetchImpl,
    });
    if (!response.ok || !response.body) throw new Error(`Не скачалось: сервер ответил ${response.status}.`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > max) throw new Error('Файл слишком большой.');
    await mkdir(dirname(target), { recursive: true });
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        poke();
        bytes += chunk.length;
        if (bytes > max) { done(new Error('Файл слишком большой.')); return; }
        hash.update(chunk);
        done(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body as never), counter, createWriteStream(part));
    if (sha1 && hash.digest('hex') !== sha1) throw new Error('Файл скачался повреждённым - не сошлась контрольная сумма.');
    await rm(target, { force: true });
    await rename(part, target);
  } catch (error) {
    await rm(part, { force: true }).catch(() => {});
    if (controller.signal.aborted) throw new Error('Загрузка зависла: сервер перестал присылать данные.');
    throw error;
  } finally {
    clearTimeout(idle);
  }
}
