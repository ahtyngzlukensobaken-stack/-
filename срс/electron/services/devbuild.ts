
async function redactedFetch(..._args: unknown[]): Promise<never> {
  throw new Error('Сетевой запрос вырезан из пакета аудита.');
}
import { app, safeStorage } from 'electron';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_ROOT } from './paths.js';
import { apiBase, UA } from './site.js';



export const devBuild: boolean = (() => {
  if (process.env.PV_DEV === '1') return true;
  try {
    return JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')).pvDevBuild === true;
  } catch {
    return false;
  }
})();

const TOKEN_FILE = () => join(CONFIG_ROOT, 'admin-token.bin');

export function adminToken(): string {
  if (!devBuild || !existsSync(TOKEN_FILE())) return '';
  try {
    return safeStorage.decryptString(readFileSync(TOKEN_FILE()));
  } catch {
    return '';
  }
}

export function hasToken(): boolean {
  return adminToken() !== '';
}


export async function setToken(token: string): Promise<void> {
  if (!devBuild) throw new Error('Это есть только в дев-сборке.');
  const clean = token.trim();
  if (!clean) throw new Error('Пустой ключ.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows не даёт зашифровать ключ.');
  const response = await redactedFetch(`${apiBase()}/api/admin/launcher/strings`, { headers: { ...UA, 'x-admin-token': clean } });
  if (response.status === 403) throw new Error('Сайт не принял ключ.');
  if (!response.ok) throw new Error(`Сайт ответил ${response.status}.`);
  writeFileSync(TOKEN_FILE(), safeStorage.encryptString(clean));
}

export function clearToken(): void {
  rmSync(TOKEN_FILE(), { force: true });
}

/** Запрос к админке сайта. body есть - POST с JSON, нет - GET. */
export async function call(path: string, body?: unknown): Promise<unknown> {
  if (!devBuild) throw new Error('Это есть только в дев-сборке.');
  if (!/^\/api\/admin\/[\w/.-]+(\?[\w=&.-]*)?$/.test(path)) throw new Error('Неверный адрес.');
  const token = adminToken();
  if (!token) throw new Error('Сначала введи админ-ключ.');
  const response = await redactedFetch(apiBase() + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...UA, 'x-admin-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null) as { ok?: boolean; message?: string; error?: string } | null;
  if (!response.ok || !data || data.ok === false) {
    throw new Error(data?.message || (response.status === 403 ? 'Ключ больше не подходит.' : `Сайт ответил ${response.status}.`));
  }
  return data;
}
