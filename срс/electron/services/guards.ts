import { basename } from 'node:path';




export function isSafeId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

export function assertSafeId(id: unknown): string {
  if (!isSafeId(id)) throw new Error('Неизвестная сборка.');
  return id;
}


export function isSafeName(name: unknown): name is string {
  return typeof name === 'string'
    && name.length > 0 && name.length <= 255
    && name !== '.' && name !== '..'
    && name === basename(name)
    && !/[\\/:\0]/.test(name);
}


export function isModrinthCdn(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'cdn.modrinth.com' && !url.username && !url.password;
  } catch {
    return false;
  }
}

export const isSha1 = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);
export const isSha512 = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{128}$/i.test(value);


export function redact(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 16) out = out.split(secret).join('***');
  }
  return out;
}


export function isAppUrl(raw: string, indexFileUrl: string, devOrigin: string | null): boolean {
  try {
    const url = new URL(raw);
    if (devOrigin && url.origin === devOrigin) return true;
    if (url.protocol !== 'file:') return false;
    const index = new URL(indexFileUrl);
    return decodeURIComponent(url.pathname).toLowerCase() === decodeURIComponent(index.pathname).toLowerCase();
  } catch {
    return false;
  }
}



const ALLOWED_PERMISSIONS = new Set(['media', 'fullscreen', 'clipboard-sanitized-write', 'notifications', 'speaker-selection']);

export function allowPermission(permission: string, fromApp: boolean, mediaTypes: string[] = []): boolean {
  if (!fromApp || !ALLOWED_PERMISSIONS.has(permission)) return false;
  
  if (permission === 'media' && mediaTypes.some((type) => type === 'video')) return false;
  return true;
}


export const LOCKED_SETTINGS = new Set(['contentUrl', 'msClientId', 'dataRoot']);


const GIF_HOSTS = new Set(['media.giphy.com', 'media0.giphy.com', 'media1.giphy.com', 'media2.giphy.com',
  'media3.giphy.com', 'media4.giphy.com', 'i.giphy.com', 'media.tenor.com', 'static.klipy.com']);

export function isTrustedImageUrl(raw: string, siteOrigin: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (url.origin === siteOrigin) return /^\/api\/social\/media\/[0-9a-f]{64}\.(?:webp|gif)$/.test(url.pathname);
    return GIF_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}


export interface CleanNews {
  slug: string; title: string; body: string; tag: string;
  accent: 'cosmic' | 'kawaii' | 'aurora'; link: string; pinned: number; at: number;
}

const str = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export function cleanNews(raw: unknown): CleanNews[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 100).flatMap((item): CleanNews[] => {
    if (!item || typeof item !== 'object') return [];
    const n = item as Record<string, unknown>;
    const slug = str(n.slug, 100);
    if (!slug) return [];
    const link = str(n.link, 400);
    const accent = n.accent === 'kawaii' || n.accent === 'aurora' ? n.accent : 'cosmic';
    return [{
      slug, title: str(n.title, 300), body: str(n.body, 8000), tag: str(n.tag, 60), accent,
      link: /^https:\/\
    }];
  });
}

export function cleanStrings(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>).slice(0, 2000)) {
    if (/^[\w.-]{1,100}$/.test(key) && typeof value === 'string') out[key] = value.slice(0, 4000);
  }
  return out;
}
