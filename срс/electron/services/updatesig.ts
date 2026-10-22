import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';




export const TRUSTED_KEYS: Readonly<Record<string, string>> = Object.freeze({
  'pl-2026-10': 'MCowBQYDK2VwAyEAs+NyDorMec4FqswkTbCPQ04Sts7irA1FfVek6rERAd0=',
});

export const SIGNATURE_FORMAT = 'power-launcher-update-signature';
export const PRODUCT = 'power-launcher';
export type Channel = 'stable' | 'dev';

export interface UpdateManifest {
  product: string;
  channel: Channel;
  platform: string;
  version: string;
  
  file: string;
  size: number;
  
  sha512: string;
  
  minVersion: string;
  
  signedAt: string;
}

const MANIFEST_FIELDS = ['product', 'channel', 'platform', 'version', 'file', 'size', 'sha512', 'minVersion', 'signedAt'];

export type Verdict = { ok: true; manifest: UpdateManifest } | { ok: false; reason: string };

const VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,6})$/;


export function compareVersions(a: string, b: string): number | null {
  const x = VERSION.exec(a);
  const y = VERSION.exec(b);
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}


export const currentPlatform = (): string => `${process.platform}-${process.arch}`;

/** Разбор latest.sig и проверка подписи. Не смотрит ни на версию, ни на файл. */
export function openSignature(text: string, keys: Readonly<Record<string, string>> = TRUSTED_KEYS): Verdict {
  let envelope: unknown;
  try { envelope = JSON.parse(text); } catch { return { ok: false, reason: 'подпись не разобралась' }; }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return { ok: false, reason: 'подпись не разобралась' };
  const e = envelope as Record<string, unknown>;
  if (e.format !== SIGNATURE_FORMAT) return { ok: false, reason: 'неизвестный формат подписи' };
  if (typeof e.keyId !== 'string' || !Object.hasOwn(keys, e.keyId)) return { ok: false, reason: 'неизвестный ключ' };
  if (typeof e.manifest !== 'string' || typeof e.signature !== 'string') return { ok: false, reason: 'подпись не разобралась' };

  const bytes = Buffer.from(e.manifest, 'base64');
  const sig = Buffer.from(e.signature, 'base64');
  // base64 молча пропускает мусор - сверяем обратным кодированием.
  if (bytes.toString('base64') !== e.manifest || sig.toString('base64') !== e.signature || sig.length !== 64 || bytes.length > 4096) {
    return { ok: false, reason: 'подпись повреждена' };
  }
  let good = false;
  try {
    const key = createPublicKey({ key: Buffer.from(keys[e.keyId]!, 'base64'), format: 'der', type: 'spki' });
    good = key.asymmetricKeyType === 'ed25519' && verify(null, bytes, key, sig);
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: 'подпись не сходится' };

  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { return { ok: false, reason: 'манифест не разобрался' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'манифест не разобрался' };
  const m = parsed as Record<string, unknown>;
  const keysOf = Object.keys(m).sort().join(',');
  if (keysOf !== [...MANIFEST_FIELDS].sort().join(',')) return { ok: false, reason: 'в манифесте лишние или недостающие поля' };
  const strings = ['product', 'channel', 'platform', 'version', 'file', 'sha512', 'minVersion', 'signedAt'];
  if (strings.some((k) => typeof m[k] !== 'string') || typeof m.size !== 'number') return { ok: false, reason: 'поля манифеста неверного типа' };
  const manifest = m as unknown as UpdateManifest;
  if (!Number.isSafeInteger(manifest.size) || manifest.size <= 0) return { ok: false, reason: 'неверный размер' };
  if (!/^[A-Za-z0-9+/]{86}==$/.test(manifest.sha512)) return { ok: false, reason: 'неверный sha512' };
  if (!/^[\w. -]{1,200}\.exe$/.test(manifest.file)) return { ok: false, reason: 'неверное имя файла' };
  if (compareVersions(manifest.version, manifest.minVersion) === null || compareVersions(manifest.minVersion, manifest.version)! > 0) {
    return { ok: false, reason: 'неверная версия' };
  }
  return { ok: true, manifest };
}

/** sha512 файла в base64 и его размер. */
export async function hashFile(path: string): Promise<{ sha512: string; size: number }> {
  const hash = createHash('sha512');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return { sha512: hash.digest('base64'), size: (await stat(path)).size };
}

export interface UpdateCheck {
  /** UpdateInfo electron-updater: то, что он скачал. */
  info: { version?: string; files?: { url?: string; sha512?: string; size?: number }[] };
  /** Путь к скачанному установщику (UpdateDownloadedEvent.downloadedFile). */
  downloadedFile: string;
  /** Текст latest.sig; null - не скачался. */
  signature: string | null;
  currentVersion: string;
  channel: Channel;
  /** Порог «не ниже», запомненный с прошлых обновлений. */
  floor: string;
  platform?: string;
  keys?: Readonly<Record<string, string>>;
}

/** Главная проверка перед установкой. Только ok: true разрешает ставить. */
export async function checkUpdate(c: UpdateCheck): Promise<Verdict> {
  if (!c.signature) return { ok: false, reason: 'нет подписи' };
  const opened = openSignature(c.signature, c.keys);
  if (!opened.ok) return opened;
  const m = opened.manifest;
  if (m.product !== PRODUCT) return { ok: false, reason: 'подпись от другого продукта' };
  if (m.channel !== c.channel) return { ok: false, reason: 'подпись от другого канала' };
  if (m.platform !== (c.platform ?? currentPlatform())) return { ok: false, reason: 'подпись для другой платформы' };

  const file = c.info.files?.[0];
  if (m.version !== c.info.version || m.file !== file?.url || m.sha512 !== file?.sha512) {
    return { ok: false, reason: 'подпись не от этого обновления' };
  }
  if (file?.size !== undefined && file.size !== m.size) return { ok: false, reason: 'размер не совпадает с подписанным' };
  const newer = compareVersions(m.version, c.currentVersion);
  if (newer === null || newer <= 0) return { ok: false, reason: 'откат на старую версию' };
  if (c.floor && compareVersions(m.version, c.floor) !== null && compareVersions(m.version, c.floor)! < 0) {
    return { ok: false, reason: 'версия ниже допустимой' };
  }

  let actual: { sha512: string; size: number };
  try { actual = await hashFile(c.downloadedFile); } catch { return { ok: false, reason: 'скачанный файл не читается' }; }
  if (actual.size !== m.size || actual.sha512 !== m.sha512) return { ok: false, reason: 'скачанный файл не совпадает с подписанным' };
  return { ok: true, manifest: m };
}

/** Скачивает latest.sig. Любая ошибка сети - null, и тогда checkUpdate откажет. */
export async function fetchSignature(
  feed: string,
  headers: Record<string, string> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  try {
    const response = await fetchImpl(`${feed}/latest.sig`, { headers, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return null;
    const text = await response.text();
    return text.length > 0 && text.length < 16_384 ? text : null;
  } catch {
    return null;
  }
}
