
function redactedSocket(..._args: unknown[]): never {
  throw new Error('Сетевое соединение вырезано из пакета аудита.');
}

async function redactedFetch(..._args: unknown[]): Promise<never> {
  throw new Error('Сетевой запрос вырезан из пакета аудита.');
}
import { createPrivateKey, sign } from 'node:crypto';
import { apiBase, UA } from './site.js';
import { microsoftToken } from './accounts.js';
import { hwid } from './hwid.js';
import { get as getInstance } from './instances.js';
import { journal } from './journal.js';
import * as launch from './launch.js';
import { load, update } from './store.js';



export interface Friend {
  uuid: string;
  name: string;
  
  licensed: boolean;
  online: boolean;
  
  status: '' | 'launcher' | 'menu' | 'world' | 'server';
  build: string;
  minecraft: string;
  server: string;
  seenAt: number;
  unread: number;
  
  dnd?: boolean;
  
  avatar?: string;
}

export interface Pending {
  uuid: string;
  name: string;
  licensed: boolean;
  at: number;
  avatar?: string;
}

export interface Message {
  id: number;
  from: string;
  to: string;
  body: string;
  at: number;
  
  read?: boolean;
  
  replyTo?: number | null;
  edited?: boolean;
  deleted?: boolean;
  reactions?: Record<string, string[]>;
}


export interface ReadMark { by: string; upTo: number }

export interface GroupMember { uuid: string; name: string; licensed: boolean; avatar?: string }

export interface Group {
  id: number;
  name: string;
  
  owner: string;
  members: GroupMember[];
  unread: number;
}

export interface GroupMessage {
  id: number;
  group: number;
  from: string;
  body: string;
  at: number;
  
  replyTo?: number | null;
  edited?: boolean;
  deleted?: boolean;
  reactions?: Record<string, string[]>;
}

export interface Snapshot {
  
  enabled: boolean;
  
  online: boolean;
  me: { uuid: string; name: string; licensed?: boolean; mode?: Mode; avatar?: string } | null;
  
  site?: string;
  friends: Friend[];
  incoming: Pending[];
  outgoing: Pending[];
  groups: Group[];
  error: string | null;
  
  accountId?: string | null;
}


const FALLBACK = 60_000;
const FALLBACK_CHAT = 15_000;

const PING = 30_000;
const PONG_WAIT = 10_000;

const RETRY = [2_000, 5_000, 15_000, 30_000, 60_000];

const EMPTY: Snapshot = { enabled: false, online: false, me: null, friends: [], incoming: [], outgoing: [], groups: [], error: null };
let snapshot: Snapshot = { ...EMPTY };

let lastId = 0;

let lastGroupId = 0;

const seen = new Set<number>();
const seenGroup = new Set<number>();

let primed = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let fast = false;
let syncing: Promise<void> | null = null;

let again = false;

let socket: WebSocket | null = null;

let live = false;
let attempts = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let pongTimer: ReturnType<typeof setTimeout> | null = null;

type Listener = (snapshot: Snapshot, messages: Message[], groupMessages: GroupMessage[], reads: ReadMark[]) => void;
const listeners = new Set<Listener>();

export function onUpdate(listener: Listener): void {
  listeners.add(listener);
}

function emit(messages: Message[] = [], groupMessages: GroupMessage[] = [], reads: ReadMark[] = []): void {
  for (const listener of listeners) listener(current(), messages, groupMessages, reads);
}


type VoiceListener = (message: Record<string, unknown>) => void;
const voiceListeners = new Set<VoiceListener>();

export function onVoice(listener: VoiceListener): void {
  voiceListeners.add(listener);
}

export function current(): Snapshot {
  return { ...snapshot, accountId: load().social?.accountId ?? null, site: apiBase() };
}

const plainUuid = (uuid: string): string => uuid.replace(/-/g, '').toLowerCase();

async function call<T>(path: string, body: unknown = {}, token?: string): Promise<{ status: number; body: T & { ok?: boolean; message?: string; error?: string } }> {
  const response = await redactedFetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { ...UA, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  return { status: response.status, body: (await response.json().catch(() => ({}))) as never };
}

/** Ответ сайта с ошибкой - в понятный текст. */
function problem(body: { message?: string }, fallback: string): Error {
  return new Error(body.message || fallback);
}

/**
 * Вход в друзей. Без аргумента - выбранным аккаунтом.
 * Ошибки - понятным текстом: их показывает интерфейс.
 */
export async function enable(accountId?: string): Promise<Snapshot> {
  await login(accountId);
  await syncNow();
  return current();
}

/** Тело ключа из PEM: Mojang подписывает «RSA PRIVATE KEY», но внутри там PKCS#8. */
const pemBody = (pem: string): Buffer => Buffer.from(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''), 'base64');

/** Подписанный профиль и сертификат Mojang плюс подпись строки сайта ключом сертификата. */
async function licensedProof(accountId: string, uuid: string, serverId: string): Promise<Record<string, unknown>> {
  const accessToken = await microsoftToken(accountId);
  const certResponse = await redactedFetch('REDACTED_ENDPOINT', {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(12_000),
  }).catch(() => null);
  if (!certResponse) throw new Error('Mojang недоступен. Проверь интернет.');
  if (certResponse.status === 401) throw new Error('Сессия Microsoft истекла. Войди в аккаунт заново.');
  if (!certResponse.ok) throw new Error(`Mojang не выдал игровой сертификат (${certResponse.status}). Попробуй позже.`);
  const cert = (await certResponse.json()) as {
    keyPair: { privateKey: string; publicKey: string };
    publicKeySignatureV2: string;
    expiresAt: string;
  };

  const profileResponse = await redactedFetch(
    `https:
    { signal: AbortSignal.timeout(12_000) },
  ).catch(() => null);
  const profile = profileResponse?.ok
    ? ((await profileResponse.json()) as { properties?: { name: string; value: string; signature?: string }[] })
    : null;
  const textures = profile?.properties?.find((p) => p.name === 'textures');
  if (!textures?.signature) throw new Error('Mojang не прислал профиль. Попробуй через минуту.');

  let key;
  try {
    key = createPrivateKey({ key: pemBody(cert.keyPair.privateKey), format: 'der', type: 'pkcs8' });
  } catch {
    key = createPrivateKey({ key: pemBody(cert.keyPair.privateKey), format: 'der', type: 'pkcs1' });
  }
  return {
    textures: { value: textures.value, signature: textures.signature },
    certificate: {
      publicKey: pemBody(cert.keyPair.publicKey).toString('base64'),
      signature: cert.publicKeySignatureV2,
      expiresAt: cert.expiresAt,
    },
    proof: sign('sha256', Buffer.from(serverId), key).toString('base64'),
  };
}


async function login(accountId?: string): Promise<void> {
  const data = load();
  const account = data.accounts.find((a) => a.id === (accountId ?? data.selectedAccount));
  if (!account) throw new Error('Сначала добавь аккаунт.');

  let signed;
  if (account.kind === 'microsoft') {
    let challenge;
    try {
      challenge = await call<{ serverId: string }>('/api/social/challenge');
    } catch {
      throw new Error('Сайт недоступен. Проверь интернет.');
    }
    if (!challenge.body.ok) throw problem(challenge.body, 'Сайт не ответил.');
    const proof = await licensedProof(account.id, account.uuid, challenge.body.serverId);
    signed = await call<{ token: string; me: Snapshot['me'] & object }>(
      '/api/social/login', { serverId: challenge.body.serverId, ...proof }).catch(() => null);
  } else {
    signed = await call<{ token: string; me: Snapshot['me'] & object }>(
      '/api/social/login-offline', { name: account.name, hwid: await hwid() }).catch(() => null);
  }
  if (!signed) throw new Error('Сайт недоступен. Проверь интернет.');
  if (!signed.body.ok || !signed.body.token) throw problem(signed.body, 'Не получилось войти.');

  update((d) => { d.social = { accountId: account.id, uuid: signed.body.me.uuid, name: signed.body.me.name, token: signed.body.token }; });
  snapshot = { ...snapshot, enabled: true, me: signed.body.me, error: null };
  lastId = 0;
  lastGroupId = 0;
  seen.clear();
  seenGroup.clear();
  primed = false;
  connect();
}


export async function disable(): Promise<void> {
  const social = load().social;
  stop();
  update((d) => { d.social = null; });
  snapshot = { ...EMPTY };
  emit();
  if (social) await call('/api/social/logout', {}, social.token).catch(() => undefined);
}


function myStatus(): Record<string, string> {
  const info = launch.currentActivity();
  if (!info) return { status: 'launcher' };
  const build = getInstance(info.instanceId)?.name ?? '';
  const base = { build, minecraft: info.minecraft };
  if (info.activity.kind === 'server') return { ...base, status: 'server', server: launch.serverAddress(info.activity) };
  return { ...base, status: info.activity.kind };
}

async function doSync(retried = false): Promise<void> {
  const social = load().social;
  if (!social) return;
  let result;
  try {
    result = await call<Snapshot & { messages: Message[]; groupMessages?: GroupMessage[] }>(
      '/api/social/sync', { ...myStatus(), after: lastId, gafter: lastGroupId }, social.token);
  } catch {
    snapshot = { ...snapshot, enabled: true, online: false };
    emit();
    return;
  }
  if (result.status === 401 && !retried) {
    
    try {
      await login(social.accountId);
      await doSync(true);
    } catch (error) {
      snapshot = { ...snapshot, enabled: true, online: false, error: error instanceof Error ? error.message : String(error) };
      emit();
    }
    return;
  }
  if (!result.body.ok) {
    snapshot = { ...snapshot, enabled: true, online: false };
    emit();
    return;
  }
  const messages = result.body.messages ?? [];
  const groupMessages = result.body.groupMessages ?? [];
  
  
  const fresh = primed ? messages.filter((m) => !seen.has(m.id)) : [];
  const freshGroup = primed ? groupMessages.filter((m) => !seenGroup.has(m.id)) : [];
  primed = true;
  for (const message of messages) lastId = Math.max(lastId, message.id);
  for (const message of groupMessages) lastGroupId = Math.max(lastGroupId, message.id);
  for (const id of seen) if (id <= lastId) seen.delete(id);
  for (const id of seenGroup) if (id <= lastGroupId) seenGroup.delete(id);
  snapshot = {
    enabled: true,
    online: true,
    me: result.body.me,
    friends: result.body.friends,
    incoming: result.body.incoming,
    outgoing: result.body.outgoing,
    groups: result.body.groups ?? [],
    error: null,
  };
  emit(fresh, freshGroup);
}


export function syncNow(): Promise<void> {
  if (syncing) {
    again = true;
    return syncing;
  }
  syncing = doSync()
    .catch((error) => journal('Друзья: сбой синхронизации', error))
    .finally(() => {
      syncing = null;
      if (again) {
        again = false;
        void syncNow();
      } else {
        schedule();
      }
    });
  return syncing;
}


function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = load().social && !live ? setTimeout(() => void syncNow(), fast ? FALLBACK_CHAT : FALLBACK) : null;
}




function connect(): void {
  const social = load().social;
  if (!social || socket) return;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const url = `${apiBase().replace(/^http/, 'ws')}/api/social/live`;
  // WebSocket из Node (undici) умеет заголовки: токен идёт так же, как в остальных запросах, а не в адресе.
  const ws = redactedSocket(url, { headers: { ...UA, authorization: `Bearer ${social.token}` } } as never);
  socket = ws;

  ws.addEventListener('open', () => {
    if (socket !== ws) return;
    live = true;
    attempts = 0;
    // Связь с хабом (пере)открылась: идущий звонок должен заново войти в канал - хаб его забыл.
    for (const listener of voiceListeners) listener({ t: 'hub-open' });
    if (timer) clearTimeout(timer);
    timer = null;
    pingTimer = setInterval(() => {
      try { ws.send('ping'); } catch { /* закрывается - разберётся close */ }
      if (!pongTimer) pongTimer = setTimeout(() => ws.close(), PONG_WAIT);
    }, PING);
    // Пока соединения не было, могло прийти что угодно - забираем.
    void syncNow();
  });
  ws.addEventListener('message', (event) => {
    if (event.data === 'pong') {
      if (pongTimer) clearTimeout(pongTimer);
      pongTimer = null;
      return;
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(String(event.data)) as Record<string, unknown>;
    } catch {
      return;
    }
    if (data.t === 'sync') void syncNow();
    else if (data.t === 'msg') pushed(data.message as Message);
    else if (data.t === 'gmsg') pushedGroup(data.message as GroupMessage);
    else if (data.t === 'read') {
      if (typeof data.by === 'string' && Number(data.upTo) > 0) emit([], [], [{ by: data.by, upTo: Number(data.upTo) }]);
    }
    else if (typeof data.t === 'string') for (const listener of voiceListeners) listener(data);
  });
  const lost = (): void => {
    if (socket !== ws) return;
    dropSocket();
    if (!load().social) return;
    // Соединения нет: пока опрашиваем по-старому, редко, и пробуем снова с паузой.
    // Синхронизация заодно перевойдёт, если сессия на сайте истекла (иначе соединению не пройти).
    void syncNow();
    const delay = RETRY[Math.min(attempts, RETRY.length - 1)] ?? 60_000;
    attempts++;
    retryTimer = setTimeout(connect, delay);
  };
  ws.addEventListener('close', lost);
  ws.addEventListener('error', lost);
}

/** Новое личное сообщение пришло прямо в соединение: показываем без /sync. */
function pushed(message: Message): void {
  if (!message?.id || seen.has(message.id) || message.id <= lastId) return;
  seen.add(message.id);
  const me = snapshot.me?.uuid;
  if (message.from !== me) {
    snapshot = { ...snapshot, friends: snapshot.friends.map((f) => (f.uuid === message.from ? { ...f, unread: f.unread + 1 } : f)) };
  }
  emit([message]);
}

function pushedGroup(message: GroupMessage): void {
  if (!message?.id || seenGroup.has(message.id) || message.id <= lastGroupId) return;
  seenGroup.add(message.id);
  if (message.from !== snapshot.me?.uuid) {
    snapshot = { ...snapshot, groups: snapshot.groups.map((g) => (g.id === message.group ? { ...g, unread: g.unread + 1 } : g)) };
  }
  emit([], [message]);
}

/** Отправить хабу служебное сообщение звонка. false - соединения нет. */
export function voiceSend(message: Record<string, unknown>): boolean {
  if (!socket || !live) return false;
  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

let ice: { servers: unknown[]; until: number } | null = null;

/** Доступ к ретранслятору звонков (TURN). Сайт выдаёт его на сутки - берём с запасом в час. */
export async function iceServers(): Promise<unknown[]> {
  if (ice && ice.until > Date.now()) return ice.servers;
  const body = await action<{ iceServers: unknown[]; ttl: number }>('/api/social/turn', {}, 'Звонки сейчас недоступны.');
  ice = { servers: body.iceServers, until: Date.now() + Math.max(60, body.ttl - 3600) * 1000 };
  return ice.servers;
}

function dropSocket(): void {
  const ws = socket;
  socket = null;
  live = false;
  if (pingTimer) clearInterval(pingTimer);
  if (pongTimer) clearTimeout(pongTimer);
  pingTimer = null;
  pongTimer = null;
  try { ws?.close(1000); } catch { /* уже закрыто */ }
}

function stop(): void {
  if (timer) clearTimeout(timer);
  if (retryTimer) clearTimeout(retryTimer);
  timer = null;
  retryTimer = null;
  dropSocket();
}

/**
 * Открыт чат или список друзей. С живым соединением сообщения и так приходят сразу;
 * без него опрашиваем чаще, чтобы переписка не стояла.
 */
export function setFast(value: boolean): void {
  if (fast === value) return;
  fast = value;
  if (live) return;
  if (fast) void syncNow();
  else schedule();
}

/** Старт лаунчера: если друзья включены, сразу в сеть. */
export function boot(): void {
  const social = load().social;
  // Аккаунт, которым включали друзей, удалили - выключаем и друзей, иначе писали бы от его имени.
  if (social && !load().accounts.some((a) => a.id === social.accountId)) {
    void disable();
    return;
  }
  if (social) {
    snapshot = { ...snapshot, enabled: true, me: { uuid: social.uuid, name: social.name } };
    // Первую синхронизацию сделает само соединение (или его сбой, если сети нет).
    connect();
  }
  // Зашёл на сервер или в мир - говорим сайту сразу, а он толкает друзей.
  launch.onActivity(() => { if (load().social) void syncNow(); });
}

/** Выход из лаунчера: сразу «не в сети». Ждём недолго - закрытие окна важнее. */
export async function bye(): Promise<void> {
  const social = load().social;
  stop();
  if (!social) return;
  await Promise.race([
    call('/api/social/bye', {}, social.token).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);
}

function token(): string {
  const social = load().social;
  if (!social) throw new Error('Друзья выключены.');
  return social.token;
}

async function action<T>(path: string, body: unknown, fallback: string): Promise<T> {
  let result;
  try {
    result = await call<T>(path, body, token());
  } catch {
    throw new Error('Сайт недоступен. Проверь интернет.');
  }
  if (!result.body.ok) throw problem(result.body, fallback);
  return result.body;
}

export interface Candidate { uuid: string; name: string; licensed: boolean }

/** result 'choose' - под ником двое (лицензия и игрок без лицензии): интерфейс спросит, кого звать. */
export async function addFriend(name: string, uuid?: string): Promise<{ result: string; name: string; candidates?: Candidate[] }> {
  const body = await action<{ result: string; name: string; candidates?: Candidate[] }>(
    '/api/social/friends/request', { name: name.trim(), uuid }, 'Не получилось отправить заявку.');
  void syncNow();
  return body;
}

export async function accept(uuid: string): Promise<void> {
  await action('/api/social/friends/accept', { uuid }, 'Не получилось принять заявку.');
  void syncNow();
}

export async function remove(uuid: string): Promise<void> {
  await action('/api/social/friends/remove', { uuid }, 'Не получилось.');
  void syncNow();
}

export async function history(uuid: string, before?: number): Promise<{ messages: Message[]; more: boolean }> {
  const body = await action<{ messages: Message[]; more: boolean }>('/api/social/messages', { with: uuid, before }, 'Переписка не загрузилась.');
  // История отмечает сообщения прочитанными - счётчик у друга должен погаснуть сразу.
  snapshot = { ...snapshot, friends: snapshot.friends.map((f) => (f.uuid === uuid ? { ...f, unread: 0 } : f)) };
  emit();
  return body;
}

export async function send(uuid: string, text: string, replyTo?: number): Promise<Message> {
  // lastId здесь не двигаем: друг мог написать между нашими запросами, и его сообщение бы потерялось.
  // Своё же сообщение следующая синхронизация пришлёт ещё раз - интерфейс отсеет его по id.
  const body = await action<{ message: Message }>('/api/social/messages/send', { to: uuid, body: text, replyTo }, 'Сообщение не ушло.');
  return body.message;
}

/*
 * Правка, удаление и реакции. Ответ сайта - уже изменённое сообщение: интерфейс сразу его
 * показывает, а собеседнику сайт отдаёт его прямо в соединение ({"t":"msg-upd"}).
 */
export async function changeMessage(group: boolean, id: number, change: { body?: string; remove?: boolean; emoji?: string }): Promise<Message | GroupMessage> {
  const base = group ? '/api/social/groups/' : '/api/social/messages/';
  const what = change.emoji ? 'react' : change.remove ? 'delete' : 'edit';
  const body = await action<{ message: Message | GroupMessage }>(base + what, { id, body: change.body, emoji: change.emoji }, 'Не получилось.');
  return body.message;
}

export type Mode = '' | 'dnd' | 'invisible';

/** «В сети», «не беспокоить» или «невидимка». */
export async function setMode(mode: Mode): Promise<void> {
  await action('/api/social/mode', { mode }, 'Не получилось.');
  if (snapshot.me) snapshot = { ...snapshot, me: { ...snapshot.me, mode } };
  emit();
}

/** Картинка в чат: data:image/webp|gif;base64,... Ответ - адрес, его и шлём сообщением. */
export async function uploadMedia(image: string): Promise<string> {
  const match = /^data:image\/(webp|gif);base64,/.exec(image);
  if (!match) throw new Error('Картинка не подошла.');
  let response: Response;
  try {
    response = await redactedFetch(`${apiBase()}/api/social/media`, {
      method: 'POST',
      headers: { ...UA, 'content-type': `image/${match[1]}`, authorization: `Bearer ${token()}` },
      body: Buffer.from(image.slice(match[0].length), 'base64'),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new Error('Сайт недоступен. Проверь интернет.');
  }
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; url?: string; message?: string };
  if (!body.ok || !body.url) throw problem(body, 'Картинка не отправилась.');
  return body.url;
}

/** Своя аватарка: WebP (data:image/webp;base64,...), пустая строка - снова лицо скина. */
export async function setAvatar(image: string): Promise<void> {
  const prefix = 'data:image/webp;base64,';
  const bytes = image.startsWith(prefix) ? Buffer.from(image.slice(prefix.length), 'base64') : Buffer.alloc(0);
  let response: Response;
  try {
    response = await redactedFetch(`${apiBase()}/api/social/avatar`, {
      method: 'POST',
      headers: { ...UA, 'content-type': 'image/webp', authorization: `Bearer ${token()}` },
      body: bytes,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error('Сайт недоступен. Проверь интернет.');
  }
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; avatar?: string; message?: string };
  if (!body.ok) throw problem(body, 'Не получилось.');
  if (snapshot.me) snapshot = { ...snapshot, me: { ...snapshot.me, avatar: body.avatar ?? '' } };
  emit();
}

export async function markRead(uuid: string): Promise<void> {
  await action('/api/social/read', { uuid }, 'Не получилось.');
  snapshot = { ...snapshot, friends: snapshot.friends.map((f) => (f.uuid === uuid ? { ...f, unread: 0 } : f)) };
  emit();
}

// ---------------------------------------------------------------- группы

export async function groupCreate(name: string, members: string[]): Promise<number> {
  const body = await action<{ id: number }>('/api/social/groups/create', { name, members }, 'Группа не создалась.');
  void syncNow();
  return body.id;
}

export async function groupAdd(group: number, uuid: string): Promise<void> {
  await action('/api/social/groups/add', { group, uuid }, 'Не получилось позвать в группу.');
  void syncNow();
}

export async function groupKick(group: number, uuid: string): Promise<void> {
  await action('/api/social/groups/kick', { group, uuid }, 'Не получилось.');
  void syncNow();
}

export async function groupLeave(group: number): Promise<void> {
  await action('/api/social/groups/leave', { group }, 'Не получилось выйти из группы.');
  void syncNow();
}

export async function groupRename(group: number, name: string): Promise<void> {
  await action('/api/social/groups/rename', { group, name }, 'Не получилось переименовать.');
  void syncNow();
}

export async function groupHistory(group: number, before?: number): Promise<{ messages: GroupMessage[]; more: boolean }> {
  const body = await action<{ messages: GroupMessage[]; more: boolean }>('/api/social/groups/history', { group, before }, 'Переписка не загрузилась.');
  snapshot = { ...snapshot, groups: snapshot.groups.map((g) => (g.id === group ? { ...g, unread: 0 } : g)) };
  emit();
  return body;
}

export async function groupSend(group: number, text: string, replyTo?: number): Promise<GroupMessage> {
  const body = await action<{ message: GroupMessage }>('/api/social/groups/send', { group, body: text, replyTo }, 'Сообщение не ушло.');
  return body.message;
}

export async function groupRead(group: number): Promise<void> {
  await action('/api/social/groups/read', { group }, 'Не получилось.');
  snapshot = { ...snapshot, groups: snapshot.groups.map((g) => (g.id === group ? { ...g, unread: 0 } : g)) };
  emit();
}
