
async function redactedFetch(..._args: unknown[]): Promise<never> {
  throw new Error('Сетевой запрос вырезан из пакета аудита.');
}
import { dialog, type BrowserWindow } from 'electron';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { microsoftToken } from './accounts.js';
import { apiBase, UA } from './site.js';
import { load } from './store.js';



export type SkinModel = 'classic' | 'slim';


export interface SkinFile {
  name: string;
  png: string;
  width: number;
  height: number;
}

export interface CurrentSkin {
  model: SkinModel;
  dataUrl: string;
}

const MC_SKINS_URL = 'REDACTED_ENDPOINT';
const MC_PROFILE_URL = 'REDACTED_ENDPOINT';
const MAX_BYTES = 64 * 1024;


function pngSize(buffer: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function checkSkin(buffer: Buffer): { width: number; height: number } {
  const size = pngSize(buffer);
  if (!size) throw new Error('Это не PNG-файл.');
  if (size.width !== 64 || (size.height !== 64 && size.height !== 32)) {
    throw new Error(`Скин должен быть 64×64 (или старый 64×32), а этот ${size.width}×${size.height}.`);
  }
  if (buffer.length > MAX_BYTES) throw new Error('Файл скина больше 64 КБ.');
  return size;
}

/** Окно выбора PNG. null - пользователь закрыл окно. */
export async function pick(parent: BrowserWindow | null): Promise<SkinFile | null> {
  const options = {
    title: 'Выбери скин',
    filters: [{ name: 'Скин Minecraft (PNG)', extensions: ['png'] }],
    properties: ['openFile' as const],
  };
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  const path = result.filePaths[0];
  if (result.canceled || !path) return null;

  const buffer = await readFile(path);
  const size = checkSkin(buffer);
  return { name: basename(path), png: buffer.toString('base64'), ...size };
}

/** Ставит скин: в Mojang для лицензии, на сайт для офлайна. */
export async function apply(accountId: string, model: SkinModel, png: string): Promise<void> {
  const account = load().accounts.find((a) => a.id === accountId);
  if (!account) throw new Error('Аккаунт не найден.');
  const buffer = Buffer.from(png, 'base64');
  checkSkin(buffer);

  if (account.kind === 'microsoft') {
    const token = await microsoftToken(account.id);
    const form = new FormData();
    form.append('variant', model);
    form.append('file', new Blob([buffer], { type: 'image/png' }), 'skin.png');
    const response = await redactedFetch(MC_SKINS_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(20000),
    });
    if (response.status === 401) throw new Error('Mojang не принял сессию. Войди в аккаунт Microsoft заново.');
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      throw new Error(`Mojang не принял скин (${response.status}). ${detail}`);
    }
    return;
  }

  throw new Error('Скин меняется только у аккаунта с лицензией.');
}

/** У лицензии скин не удаляется, только заменяется. Офлайн-скинов в лаунчере нет. */
export async function reset(_accountId: string): Promise<void> {
  /* убирать нечего */
}

async function asDataUrl(raw: string, headers: Record<string, string> = {}): Promise<string | null> {
  // Скин берём только с текстур Mojang (они отдают http - поднимаем до https) и с нашего сайта.
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.hostname === 'textures.minecraft.net') url.protocol = 'https:';
  else if (url.origin !== new URL(apiBase()).origin || !/^\/api\/skins\/texture\/[0-9a-f]{16,128}$/.test(url.pathname)) return null;
  const response = await redactedFetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
  if (!response.ok) return null;
  if (Number(response.headers.get('content-length') || 0) > 256 * 1024) return null;
  return 'data:image/png;base64,' + Buffer.from(await response.arrayBuffer()).toString('base64');
}

/** Текущий скин аккаунта для превью. null - скина нет или сеть недоступна. */
export async function current(accountId: string): Promise<CurrentSkin | null> {
  const account = load().accounts.find((a) => a.id === accountId);
  if (!account) return null;
  try {
    if (account.kind === 'microsoft') {
      const token = await microsoftToken(account.id);
      const profile = await redactedFetch(MC_PROFILE_URL, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!profile.ok) return null;
      const body = (await profile.json()) as { skins?: { state: string; url: string; variant: string }[] };
      const active = body.skins?.find((s) => s.state === 'ACTIVE');
      const dataUrl = active ? await asDataUrl(active.url) : null;
      return dataUrl ? { model: active!.variant.toLowerCase() === 'slim' ? 'slim' : 'classic', dataUrl } : null;
    }

    const profile = await redactedFetch(`${apiBase()}/api/skins/profile/${encodeURIComponent(account.name)}`, {
      headers: UA,
      signal: AbortSignal.timeout(10000),
    });
    if (!profile.ok) return null;
    const body = (await profile.json()) as { model: SkinModel; hash: string };
    const dataUrl = await asDataUrl(`${apiBase()}/api/skins/texture/${body.hash}`, UA);
    return dataUrl ? { model: body.model, dataUrl } : null;
  } catch {
    return null;
  }
}
