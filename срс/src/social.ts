import { api, type Account, type ChatMessage, type Favorite, type Friend, type Group, type GroupMessage, type SocialSnapshot } from './api.js';
import { frame } from './frame.js';
import { ago, el, emptyState, icon, modal, plural, toast } from './ui.js';
import {
  declineRing, initVoice, joinVoice, leaveVoice, onVoiceChange, setPeerVolume, toggleDeafen, toggleMute, voiceView, parseCallMessage } from './voice.js';
import { packCard, parsePackMessage } from './share.js';
import { devBadge } from './prank.js';



let snap: SocialSnapshot = { enabled: false, online: false, me: null, friends: [], incoming: [], outgoing: [], groups: [], error: null };

const chats = new Map<string, (ChatMessage | GroupMessage)[]>();

const painters = new Set<{ node: HTMLElement; paint: () => void }>();

const openChats = new Set<string>();
let popup: { key: string; node: HTMLElement } | null = null;
let onBadgeChange: () => void = () => {};

const groupKey = (id: number): string => `g:${id}`;
const isGroupKey = (key: string): boolean => key.startsWith('g:');
const groupId = (key: string): number => Number(key.slice(2));
function groupOf(key: string): Group | undefined {
  return isGroupKey(key) ? snap.groups.find((g) => groupKey(g.id) === key) : undefined;
}
/** Голосовой канал переписки: личный звонок или канал группы. */
const roomOf = (key: string): string => (isGroupKey(key) ? key : `dm:${key}`);

export function socialState(): SocialSnapshot {
  return snap;
}

/** Кому можно отправить сборку из окна «Поделиться»: друзья и группы. */
export function shareTargets(): { key: string; name: string; send: (text: string) => Promise<unknown> }[] {
  if (!snap.enabled) return [];
  return [
    ...sorted(snap.friends).map((f) => ({ key: f.uuid, name: f.name, send: (text: string) => api.socialSend(f.uuid, text) })),
    ...snap.groups.map((g) => ({ key: groupKey(g.id), name: `Группа «${g.name}»`, send: (text: string) => api.groupSend(g.id, text) })),
  ];
}

/** Число на пункте «Друзья»: непрочитанные сообщения и заявки в друзья. */
export function socialBadge(): number {
  return snap.friends.reduce((sum, f) => sum + f.unread, 0)
    + snap.groups.reduce((sum, g) => sum + g.unread, 0)
    + snap.incoming.length;
}

function repaint(): void {
  for (const entry of [...painters]) {
    if (!entry.node.isConnected) { painters.delete(entry); continue; }
    entry.paint();
  }
  onBadgeChange();
}

function track(node: HTMLElement, paint: () => void): HTMLElement {
  painters.add({ node, paint });
  paint();
  return node;
}

/*
 * Экономим запросы к сайту. Несколько сообщений подряд в открытом чате - одна отметка
 * «прочитано». Уже загруженная переписка открывается из памяти: новое и так приходит
 * через соединение, а заново историю берём, только если она старше 10 минут или
 * соединения нет.
 */
const readTimers = new Map<string, number>();
const loadedAt = new Map<string, number>();
const HISTORY_FRESH = 10 * 60_000;

function readSoon(key: string): void {
  if (readTimers.has(key)) return;
  readTimers.set(key, window.setTimeout(() => {
    readTimers.delete(key);
    const done = isGroupKey(key) ? api.groupRead(groupId(key)) : api.socialRead(key);
    void done.catch(() => undefined);
  }, 1200));
}

function unreadOf(key: string): number {
  return isGroupKey(key)
    ? snap.groups.find((g) => groupKey(g.id) === key)?.unread ?? 0
    : snap.friends.find((f) => f.uuid === key)?.unread ?? 0;
}

/** Кто сейчас печатает в чате (ключ чата). Живёт 5 секунд после последнего сигнала. */
const typing = new Map<string, { who: string; until: number }>();

function typingText(key: string): string | null {
  const entry = typing.get(key);
  if (!entry || entry.until < Date.now()) return null;
  return isGroupKey(key) ? `${nameOf(entry.who)} печатает…` : 'печатает…';
}

type AnyMessage = ChatMessage | GroupMessage;

/** Сообщение поменяли (правка, удаление, реакция): обновляем то, что уже показано. */
function applyChange(key: string, changed: AnyMessage): void {
  const old = chats.get(key)?.find((m) => m.id === changed.id);
  if (!old) return;
  Object.assign(old, changed);
  chatVersion++;
  repaint();
}

/** События из соединения, которые не идут через /sync: «печатает» и изменения сообщений. */
function liveEvent(m: Record<string, any>): void {
  const me = snap.me?.uuid;
  if (m.t === 'typing' && typeof m.from === 'string') {
    const key = m.group ? groupKey(Number(m.group)) : m.from;
    typing.set(key, { who: m.from, until: Date.now() + 5000 });
    repaint();
    window.setTimeout(repaint, 5100);
  } else if ((m.t === 'msg-upd' || m.t === 'gmsg-upd') && m.message) {
    const message = m.message as AnyMessage;
    const key = 'group' in message ? groupKey(message.group) : message.from === me ? message.to : message.from;
    applyChange(key, message);
  }
}

/** Растёт, когда у уже показанных сообщений что-то поменялось (галочка «прочитано»): чат перерисуется. */
let chatVersion = 0;

/** Добавляет сообщения в переписку без повторов: своё сообщение приходит и ответом, и синхронизацией. */
function remember(key: string, messages: (ChatMessage | GroupMessage)[]): void {
  const list = chats.get(key);
  if (!list) return;
  const known = new Map(list.map((m) => [m.id, m]));
  for (const message of messages) {
    const old = known.get(message.id);
    if (!old) list.push(message);
    // Уже показанное сообщение пришло прочитанным (история после перерыва) - ставим вторую галочку.
    else if ('to' in message && message.read && 'to' in old && !old.read) { old.read = true; chatVersion++; }
  }
  list.sort((a, b) => a.id - b.id);
}

/** Вызвать один раз при старте интерфейса. */
export function initSocial(badgeChanged: () => void): void {
  onBadgeChange = badgeChanged;
  initVoice({
    names: nameOf,
    toast: (text, bad) => toast(text, bad),
    // Сайт присылает новое сообщение только получателю: своё кладём в переписку сами.
    record: (uuid, text) => {
      void api.socialSend(uuid, text).then((message) => { remember(uuid, [message]); repaint(); }, () => undefined);
    },
  });
  onVoiceChange(() => { paintCall(); repaint(); });
  void api.socialState().then((next) => { snap = next; repaint(); }).catch(() => undefined);
  api.onVoice((m: Record<string, any>) => liveEvent(m));
  api.onSocial(({ snapshot, messages, groupMessages, reads }) => {
    snap = snapshot;
    const me = snap.me?.uuid;
    // Друг прочитал: наши сообщения до upTo получают вторую галочку.
    for (const mark of reads ?? []) {
      for (const message of chats.get(mark.by) ?? []) {
        if (message.from === me && message.id <= mark.upTo && 'to' in message && !message.read) {
          message.read = true;
          chatVersion++;
        }
      }
    }
    for (const message of messages) {
      const other = message.from === me ? message.to : message.from;
      remember(other, [message]);
      if (message.from === me) continue;
      typing.delete(other);
      if (openChats.has(other)) {
        // Чат с ним открыт - читаем сразу, счётчик не нужен.
        readSoon(other);
      } else {
        notify(message);
      }
    }
    for (const message of groupMessages ?? []) {
      const key = groupKey(message.group);
      remember(key, [message]);
      if (message.from === me) continue;
      if (typing.get(key)?.who === message.from) typing.delete(key);
      if (openChats.has(key)) readSoon(key);
      else notify(message);
    }
    repaint();
    paintCall();
    paintTaskbar();
  });
}

/** Ник по uuid: друзья, участники групп, сам игрок. */
function nameOf(uuid: string): string {
  if (uuid === snap.me?.uuid) return snap.me.name;
  const friend = snap.friends.find((f) => f.uuid === uuid);
  if (friend) return friend.name;
  for (const group of snap.groups) {
    const member = group.members.find((m) => m.uuid === uuid);
    if (member) return member.name;
  }
  return 'Игрок';
}

/** Число непрочитанных на иконке лаунчера в панели задач Windows. Рисуем только когда число поменялось. */
let badgeShown = -1;
function paintTaskbar(): void {
  const count = socialBadge();
  if (count === badgeShown) return;
  badgeShown = count;
  let image = '';
  if (count) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#ff4f8b';
    g.beginPath();
    g.arc(16, 16, 15, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = `bold ${count > 9 ? 16 : 20}px Segoe UI, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(count > 99 ? '99+' : String(count), 16, 17);
    image = canvas.toDataURL('image/png');
  }
  void api.setBadge(count, image).catch(() => undefined);
}

const SOUND_KEY = 'pv-chat-sound';
export const chatSound = {
  get on(): boolean { try { return localStorage.getItem(SOUND_KEY) !== '0'; } catch { return true; } },
  set on(value: boolean) { try { localStorage.setItem(SOUND_KEY, value ? '1' : '0'); } catch { /* не страшно */ } },
};
let soundContext: AudioContext | null = null;

/** Тихий двойной «тюк» о новом сообщении. Звук синтезируем: файлов в сборке не прибавится. */
function ping(): void {
  if (!chatSound.on) return;
  try {
    soundContext ??= new AudioContext();
    const ctx = soundContext;
    const t = ctx.currentTime;
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + i * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.05, t + i * 0.09 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * 0.09);
      osc.stop(t + i * 0.09 + 0.25);
    }
  } catch { /* без звука так без звука */ }
}

/** Всплывашка о новом сообщении. Клик открывает чат. */
function notify(message: ChatMessage | GroupMessage): void {
  ping();
  document.querySelector('.chat-note')?.remove();
  const group = 'group' in message ? snap.groups.find((g) => g.id === message.group) : undefined;
  const key = group ? groupKey(group.id) : message.from;
  const node = el('button', {
    class: 'chat-note',
    onclick: () => { node.remove(); openChat(key); },
  },
    face(message.from, nameOf(message.from), 'chat-note-face'),
    el('div', { class: 'chat-note-text' },
      el('b', {}, group ? `${nameOf(message.from)} · ${group.name}` : nameOf(message.from)),
      el('span', {}, snippet(message))),
  );
  document.body.append(node);
  window.setTimeout(() => node.remove(), 7000);
}

// ---------------------------------------------------------------- мелкие части

/** uuid -> хэш своей аватарки. Строится заново, только когда пришёл новый снимок. */
let avatarIndex: { from: SocialSnapshot | null; map: Map<string, string> } = { from: null, map: new Map() };
function avatarOf(uuid: string): string {
  if (avatarIndex.from !== snap) {
    const map = new Map<string, string>();
    const add = (p: { uuid: string; avatar?: string } | null | undefined): void => { if (p?.avatar) map.set(p.uuid, p.avatar); };
    add(snap.me);
    snap.friends.forEach(add);
    snap.incoming.forEach(add);
    snap.outgoing.forEach(add);
    for (const group of snap.groups) group.members.forEach(add);
    avatarIndex = { from: snap, map };
  }
  return avatarIndex.map.get(uuid) ?? '';
}

/**
 * Лицо друга по uuid: своя аватарка с нашего сайта (адрес по хэшу, лаунчер кэширует её навсегда)
 * или голова скина с mc-heads.net. Пока не загрузилась или нет сети - первая буква ника.
 */
const loadedFaces = new Set<string>();
export function face(uuid: string, name: string, cls = 'fr-face'): HTMLElement {
  const hash = avatarOf(uuid);
  const src = hash && snap.site ? `${snap.site}/api/social/avatar/${hash}` : `https:
  const img = el('img', { src, alt: '', draggable: 'false', class: hash ? 'av-own' : '' });
  
  if (loadedFaces.has(src)) return el('span', { class: cls }, img);
  const box = el('span', { class: cls }, name.slice(0, 1).toUpperCase());
  img.addEventListener('load', () => { loadedFaces.add(src); box.replaceChildren(img); });
  return box;
}


async function squareWebp(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 128, 128);
  bitmap.close();
  for (const quality of [0.86, 0.7, 0.5]) {
    const url = canvas.toDataURL('image/webp', quality);
    if (url.length < 80_000) return url;
  }
  throw new Error('Картинка не подошла.');
}


function avatarButton(): HTMLElement {
  const button = el('button', { class: 'me-avatar', title: 'Аватарка' });
  return track(button, () => {
    const me = snap.me;
    if (!me) return;
    button.replaceChildren(face(me.uuid, me.name, 'fr-face'));
    button.onclick = (event) => {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const pick = (): void => {
        const input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' }) as HTMLInputElement;
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          if (file) void act(() => squareWebp(file).then((image) => api.socialAvatar(image)), 'Аватарка обновлена');
        });
        input.click();
      };
      popupMenu(rect.left, rect.bottom + 6, [
        { label: 'Загрузить картинку', run: pick },
        ...(me.avatar ? [{ label: 'Лицо скина', run: () => void act(() => api.socialAvatar('')) }] : []),
      ]);
    };
  });
}


function nick(name: string, licensed: boolean | undefined): HTMLElement {
  return el('b', { class: 'nick' }, el('span', { class: 'nick-name', title: name }, name),
    licensed ? el('i', { class: 'fr-ok', title: 'Лицензия: ник подтверждён Mojang' }, icon('check', 9, 3.2)) : null,
    devBadge(name, licensed));
}




export function statusOf(friend: Friend): { text: string; tone: 'tn-play' | 'tn-here' | 'tn-off' } {
  if (!friend.online) return { text: friend.seenAt ? `Не в сети · ${ago(friend.seenAt)}` : 'Не в сети', tone: 'tn-off' };
  const where = [friend.build, friend.minecraft].filter(Boolean).join(' · ');
  if (friend.status === 'server') return { text: `На сервере ${friend.server}${where ? ` · ${where}` : ''}`, tone: 'tn-play' };
  if (friend.status === 'world') return { text: `Одиночная игра${where ? ` · ${where}` : ''}`, tone: 'tn-play' };
  if (friend.status === 'menu') return { text: `В игре${where ? ` · ${where}` : ''}`, tone: 'tn-play' };
  return { text: 'В лаунчере', tone: 'tn-here' };
}


function sorted(friends: Friend[]): Friend[] {
  const rank = (f: Friend) => (!f.online ? 2 : f.status && f.status !== 'launcher' ? 0 : 1);
  return [...friends].sort((a, b) => rank(a) - rank(b) || b.unread - a.unread || b.seenAt - a.seenAt);
}

function joinButton(friend: Friend): HTMLElement | null {
  if (!friend.online || friend.status !== 'server' || !friend.server) return null;
  return el('button', {
    class: 'fr-join',
    title: `Зайти на ${friend.server}`,
    onclick: (event: Event) => {
      event.stopPropagation();
      void api.socialJoin(friend.uuid).catch((error: unknown) => toast(error instanceof Error ? error.message : String(error), true));
    },
  }, 'Зайти');
}

async function act(action: () => Promise<unknown>, done?: string): Promise<void> {
  try {
    await action();
    if (done) toast(done);
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), true);
  }
}

/** Позвонить / войти в голосовой. Ошибки (нет микрофона, звонки выключены) - всплывашкой. */
function startVoice(room: string): void {
  void joinVoice(room).catch((error: unknown) => toast(error instanceof Error ? error.message : String(error), true));
}

/** Окно «Добавить друга»: ник и кнопка. */
export function addFriendDialog(): void {
  const input = el('input', { placeholder: 'Ник в Minecraft', maxlength: 16, spellcheck: 'false' });
  modal({
    title: 'Добавить друга',
    note: 'Друг должен включить друзей в Power Launcher. Когда он примет заявку, вы увидите друг друга в списке.',
    content: el('label', { class: 'field', style: 'margin-top:14px' }, input),
    confirm: 'Отправить заявку',
    onConfirm: () => void act(async () => report(await api.socialAdd(input.value), input.value)),
  });
}

function report(result: { result: string; name: string; candidates?: { uuid: string; name: string; licensed: boolean }[] }, typed: string): void {
  if (result.result === 'choose' && result.candidates) { chooseFriend(typed, result.candidates); return; }
  toast(result.result === 'friends' ? `Вы с ${result.name} теперь друзья`
    : result.result === 'already' ? `${result.name} уже в друзьях`
      : `Заявка ушла: ${result.name}`);
}

/** Под одним ником двое: лицензия и игрок без лицензии. Спрашиваем, кого звать. */
function chooseFriend(typed: string, candidates: { uuid: string; name: string; licensed: boolean }[]): void {
  modal({
    title: `Кого из ${candidates[0]?.name ?? typed} позвать?`,
    note: 'Под этим ником двое: игрок с лицензией (у него галочка) и игрок без лицензии. Если не уверен, спроси друга, с лицензией ли он.',
    content: (close) => el('div', { class: 'fr-choose' }, ...candidates.map((c) => el('button', {
      class: 'fr-row',
      onclick: () => { close(); void act(async () => report(await api.socialAdd(typed, c.uuid), typed)); },
    },
      face(c.uuid, c.name),
      el('div', { class: 'fr-text' }, nick(c.name, c.licensed), el('span', {}, c.licensed ? 'С лицензией' : 'Без лицензии')),
    ))),
  });
}

/** Список друзей с галочками - для создания группы и приглашения в неё. */
function friendPicker(exclude: Set<string>): { node: HTMLElement; picked: () => string[] } {
  const chosen = new Set<string>();
  const candidates = sorted(snap.friends).filter((f) => !exclude.has(f.uuid));
  const node = el('div', { class: 'fr-pick' }, ...(candidates.length
    ? candidates.map((f) => {
        const row = el('button', { class: 'fr-row', type: 'button' },
          face(f.uuid, f.name),
          el('div', { class: 'fr-text' }, nick(f.name, f.licensed), el('span', { class: statusOf(f).tone }, statusOf(f).text)),
          el('span', { class: 'fr-check' }, icon('check', 12, 3)),
        );
        row.addEventListener('click', () => {
          if (chosen.has(f.uuid)) chosen.delete(f.uuid); else chosen.add(f.uuid);
          row.classList.toggle('on', chosen.has(f.uuid));
        });
        return row;
      })
    : [el('p', { class: 'fr-empty-note' }, 'Всех друзей уже позвали.')]));
  return { node, picked: () => [...chosen] };
}

/** Окно «Новая группа»: название и друзья с галочками. */
export function createGroupDialog(): void {
  const name = el('input', { placeholder: 'Название группы', maxlength: 32, spellcheck: 'false' });
  const picker = friendPicker(new Set());
  modal({
    title: 'Новая группа',
    note: 'Общий чат и голосовой канал на всех. Позвать в группу можно только своих друзей, до 20 человек.',
    content: el('div', {}, el('label', { class: 'field', style: 'margin-top:14px' }, name), picker.node),
    confirm: 'Создать',
    onConfirm: () => void act(async () => {
      const members = picker.picked();
      const title = name.value.trim() || members.slice(0, 3).map(nameOf).join(', ') || 'Группа';
      const id = await api.groupCreate(title, members);
      openChat(groupKey(id));
    }),
  });
}

/** Участники группы кроме себя: сервер присылает всех, вместе с самим игроком. */
function others(group: Group): Group['members'] {
  return group.members.filter((m) => m.uuid !== snap.me?.uuid);
}

/** Участники группы: позвать друга, убрать (создатель), переименовать, выйти. */
function groupDialog(group: Group): void {
  const mine = group.owner === snap.me?.uuid;
  const inVoice = new Set(voiceView().rooms.get(groupKey(group.id)) ?? []);
  const everyone = [{ uuid: snap.me?.uuid ?? '', name: snap.me?.name ?? 'Ты', licensed: snap.me?.licensed ?? false }, ...others(group)];
  modal({
    title: group.name,
    note: plural(everyone.length, 'участник', 'участника', 'участников'),
    wide: true,
    content: (close) => el('div', { class: 'fr-choose' },
      ...everyone.map((m) => el('div', { class: 'fr-row' },
        face(m.uuid, m.name),
        el('div', { class: 'fr-text' }, nick(m.name, m.licensed),
          el('span', {}, [m.uuid === group.owner ? 'Создатель' : '', m.uuid === snap.me?.uuid ? 'Это ты' : '', inVoice.has(m.uuid) ? 'В голосовом' : '']
            .filter(Boolean).join(' · ') || 'Участник')),
        mine && m.uuid !== snap.me?.uuid
          ? el('button', {
              class: 'fr-x', title: `Убрать ${m.name} из группы`,
              onclick: () => { close(); void act(() => api.groupKick(group.id, m.uuid), `${m.name} больше не в группе`); },
            }, icon('close', 11, 1.6))
          : null,
      )),
      el('div', { class: 'fr-group-actions' },
        el('button', { class: 'btn btn-ghost btn-s', onclick: () => { close(); inviteDialog(group); } }, icon('addUser', 14, 1.8), 'Позвать друзей'),
        mine ? el('button', { class: 'btn btn-ghost btn-s', onclick: () => { close(); renameDialog(group); } }, icon('edit', 14, 1.8), 'Переименовать') : null,
        el('button', {
          class: 'btn btn-ghost btn-s',
          onclick: () => {
            close();
            modal({
              title: `Выйти из «${group.name}»?`,
              note: mine && others(group).length
                ? 'Группа останется у остальных, а создателем станет тот, кто в ней дольше всех. Вернуться можно, только если позовут снова.'
                : 'Вернуться можно, только если позовут снова.',
              confirm: 'Выйти',
              danger: true,
              onConfirm: () => void act(async () => {
                if (voiceView().room === groupKey(group.id)) leaveVoice();
                if (popup?.key === groupKey(group.id)) closeChat();
                await api.groupLeave(group.id);
              }),
            });
          },
        }, icon('door', 14, 1.7), 'Выйти'),
      ),
    ),
  });
}

function inviteDialog(group: Group): void {
  const picker = friendPicker(new Set(group.members.map((m) => m.uuid)));
  modal({
    title: `Позвать в «${group.name}»`,
    content: picker.node,
    confirm: 'Позвать',
    onConfirm: () => void act(async () => {
      for (const uuid of picker.picked()) await api.groupAdd(group.id, uuid);
    }),
  });
}

function renameDialog(group: Group): void {
  const name = el('input', { value: group.name, maxlength: 32, spellcheck: 'false' });
  modal({
    title: 'Новое название',
    content: el('label', { class: 'field', style: 'margin-top:14px' }, name),
    confirm: 'Сохранить',
    onConfirm: () => void act(() => api.groupRename(group.id, name.value)),
  });
}

/** Карточка «включить друзей». Без неё никто не попадает в список: показываться в сети - выбор игрока. */
function enableCard(compact: boolean): HTMLElement {
  const button = el('button', { class: 'btn btn-main btn-s' }, icon('friends', 15, 1.8), 'Включить друзей');
  button.addEventListener('click', () => {
    button.disabled = true;
    void act(() => api.socialEnable().then((next) => { snap = next; repaint(); }))
      .finally(() => { button.disabled = false; });
  });
  return el('div', { class: compact ? 'fr-enable compact' : 'fr-enable' },
    el('b', {}, 'Друзья и чат'),
    el('p', {}, 'Видно, кто из друзей в сети и во что играет, можно переписываться, созваниваться и заходить к ним на сервер в один клик. '
      + 'Ник лицензии подтверждает Mojang, а ник без лицензии закрепляется за твоим компьютером: чужим ником тут не назваться.'),
    snap.error ? el('p', { class: 'fr-error' }, snap.error) : null,
    button,
  );
}

function requestRow(uuid: string, name: string, licensed: boolean, incoming: boolean): HTMLElement {
  return el('div', { class: 'fr-row fr-req' },
    face(uuid, name),
    el('div', { class: 'fr-text' }, nick(name, licensed), el('span', {}, incoming ? 'Хочет дружить' : 'Ждём ответа')),
    incoming ? el('button', { class: 'fr-join', onclick: () => void act(() => api.socialAccept(uuid), `${name} теперь в друзьях`) }, 'Принять') : null,
    el('button', {
      class: 'fr-x', title: incoming ? 'Отклонить' : 'Отозвать заявку',
      onclick: () => void act(() => api.socialRemove(uuid)),
    }, icon('close', 11, 1.6)),
  );
}

function friendRow(friend: Friend, selected: boolean, onPick: (key: string) => void): HTMLElement {
  const state = statusOf(friend);
  const typed = typingText(friend.uuid);
  return el('div', { class: `fr-row${selected ? ' on' : ''}`, onclick: () => onPick(friend.uuid) },
    el('span', { class: 'fr-av' }, face(friend.uuid, friend.name), el('i', { class: `fr-dot ${state.tone}` })),
    el('div', { class: 'fr-text' }, nick(friend.name, friend.licensed),
      typed ? el('span', { class: 'tn-type' }, typed) : el('span', { class: state.tone, title: state.text }, state.text)),
    friend.dnd ? el('span', { class: 'fr-dnd', title: 'Не беспокоить' }, icon('moon', 12, 1.8)) : null,
    joinButton(friend),
    voiceView().room === `dm:${friend.uuid}` ? el('span', { class: 'fr-voice on', title: 'Идёт звонок' }, icon('phone', 12, 2)) : null,
    friend.unread ? el('span', { class: 'fr-unread' }, String(friend.unread)) : null,
  );
}

function groupRow(group: Group, selected: boolean, onPick: (key: string) => void): HTMLElement {
  const key = groupKey(group.id);
  const inVoice = voiceView().rooms.get(key) ?? [];
  const total = others(group).length + 1;
  const sub = typingText(key) ?? (inVoice.length ? `В голосовом: ${inVoice.length}` : plural(total, 'участник', 'участника', 'участников'));
  return el('div', { class: `fr-row${selected ? ' on' : ''}`, onclick: () => onPick(key) },
    el('span', { class: 'fr-av' }, el('span', { class: 'fr-face fr-gface' }, icon('group', 18, 1.6))),
    el('div', { class: 'fr-text' }, el('b', {}, group.name), el('span', { class: inVoice.length ? 'tn-play' : 'tn-off' }, sub)),
    inVoice.length
      ? el('span', { class: `fr-voice${voiceView().room === key ? ' on' : ''}`, title: 'Голосовой канал' }, icon('mic', 12, 2))
      : null,
    group.unread ? el('span', { class: 'fr-unread' }, String(group.unread)) : null,
  );
}

// ---------------------------------------------------------------- список друзей

/**
 * Список друзей и групп с заявками. Один и тот же для правой колонки «Power» и экрана «Друзья».
 * `onPick` - что делать по клику на друга или группу (по умолчанию открыть всплывающий чат).
 */
export function friendsList(options: { compact?: boolean; selected?: () => string | null; onPick?: (key: string) => void } = {}): HTMLElement {
  const box = el('div', { class: 'fr-list' });
  const pick = options.onPick ?? openChat;
  return track(box, () => {
    if (!snap.enabled) { box.replaceChildren(enableCard(Boolean(options.compact))); return; }
    const online = snap.friends.filter((f) => f.online).length;
    const selected = options.selected?.() ?? null;
    box.replaceChildren(...[
      el('div', { class: 'fr-head' },
        el('b', {}, 'Друзья'),
        el('span', {}, snap.online ? `${online} в сети` : 'нет связи с сайтом'),
        el('button', { class: 'fr-add', title: 'Добавить друга', onclick: addFriendDialog }, icon('addUser', 16, 1.8)),
      ),
      ...snap.incoming.map((r) => requestRow(r.uuid, r.name, r.licensed, true)),
      ...sorted(snap.friends).map((f) => friendRow(f, f.uuid === selected, pick)),
      ...(options.compact ? [] : snap.outgoing.map((r) => requestRow(r.uuid, r.name, r.licensed, false))),
      !snap.friends.length && !snap.incoming.length
        ? el('div', { class: 'fr-empty' },
            el('p', {}, 'Друзей пока нет. Добавь друга по нику в Minecraft.'),
            el('button', { class: 'btn btn-ghost btn-s', onclick: addFriendDialog }, icon('addUser', 14, 1.8), 'Добавить'))
        : null,
      snap.friends.length || snap.groups.length
        ? el('div', { class: 'fr-head fr-head-sub' },
            el('b', {}, 'Группы'),
            el('span', {}, snap.groups.length ? String(snap.groups.length) : ''),
            el('button', { class: 'fr-add', title: 'Создать группу', onclick: createGroupDialog }, icon('plus', 16, 1.8)))
        : null,
      ...snap.groups.map((g) => groupRow(g, groupKey(g.id) === selected, pick)),
    ].filter((node): node is HTMLElement => Boolean(node)));
  });
}

// ---------------------------------------------------------------- переписка

/** «Сегодня», «Вчера» или дата - над первым сообщением нового дня. */
function dayLabel(at: number, previousAt: number | undefined): string | null {
  const day = new Date(at * 1000);
  if (previousAt !== undefined && new Date(previousAt * 1000).toDateString() === day.toDateString()) return null;
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (day.toDateString() === today.toDateString()) return 'Сегодня';
  if (day.toDateString() === yesterday.toDateString()) return 'Вчера';
  return day.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(day.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }) });
}

/** Время, «изм.» и, у своих личных сообщений, галочки: одна - дошло до сайта, две - друг прочитал. */
function meta(message: AnyMessage, mine: boolean, group: boolean, extra = ''): HTMLElement {
  const time = new Date(message.at * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const read = !group && mine && 'to' in message && Boolean(message.read);
  const ticks = !group && mine
    ? el('i', { class: `msg-ticks${read ? ' read' : ''}`, title: read ? 'Прочитано' : 'Доставлено' },
        icon('check', 11, 2.4), read ? icon('check', 11, 2.4) : null)
    : null;
  return el('span', { class: `msg-meta${extra}` }, message.edited && !message.deleted ? 'изм. ' : '', time, ticks);
}

function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h ? `${h} ч` : '', m ? `${m} мин` : '', !h && s ? `${s} с` : ''].filter(Boolean).join(' ') || '0 с';
}

const LINK = /(https?:\/\/[^\s<>"«»]+[^\s<>"«».,!?;:)\]])/g;

/** Текст со ссылками: ссылки открываются в браузере (обработчик клика - в conversation). */
function linkify(text: string): (string | HTMLElement)[] {
  return text.split(LINK).map((part, i) => (i % 2 ? el('a', { class: 'msg-link', 'data-url': part, href: '#' }, part) : part));
}

/**
 * Сообщение-картинка: всё сообщение - одна ссылка на картинку с нашего сайта (/api/social/media/...)
 * или с GIPHY, Tenor, KLIPY. Картинку лаунчер грузит сам, без клика, поэтому с чужого сервера её
 * не грузим: по такому запросу отправитель узнал бы IP и время входа каждого, кто открыл чат.
 * Ссылка на картинку с другого сайта остаётся обычной ссылкой и открывается в браузере.
 * Та же проверка - isTrustedImageUrl в electron/services/guards.ts (там на неё есть тесты).
 */
const SITE_ORIGIN = 'REDACTED_ENDPOINT';
const GIF_HOSTS = new Set(['media.giphy.com', 'media0.giphy.com', 'media1.giphy.com', 'media2.giphy.com',
  'media3.giphy.com', 'media4.giphy.com', 'i.giphy.com', 'media.tenor.com', 'static.klipy.com']);
function imageOf(body: string): string | null {
  const text = body.trim();
  if (/\s/.test(text)) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (url.origin === SITE_ORIGIN) return /^\/api\/social\/media\/[0-9a-f]{64}\.(?:webp|gif)$/.test(url.pathname) ? text : null;
    return GIF_HOSTS.has(url.hostname) ? text : null;
  } catch {
    return null;
  }
}

/** Картинку на весь экран. Клик или Esc - закрыть. */
function viewImage(src: string): void {
  const close = (): void => { box.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
  const box = el('div', { class: 'img-view', onclick: close },
    el('img', { src, alt: '', draggable: 'false' }),
    el('button', {
      class: 'img-view-open', title: 'Открыть в браузере',
      onclick: (event: Event) => { event.stopPropagation(); void api.openExternal(src); },
    }, icon('external', 15, 1.8)));
  document.addEventListener('keydown', onKey, true);
  document.body.append(box);
}

/** Картинку с диска или из буфера - для отправки. GIF до 4 МБ уходит как есть (с анимацией), остальное - WebP. */
async function chatImage(file: Blob): Promise<string> {
  const read = (blob: Blob): Promise<string> => new Promise((ok, bad) => {
    const reader = new FileReader();
    reader.onload = () => ok(String(reader.result));
    reader.onerror = () => bad(new Error('Картинка не открылась.'));
    reader.readAsDataURL(blob);
  });
  if (file.type === 'image/gif' && file.size <= 4 * 1024 * 1024) return read(file);
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw new Error('Это не картинка.'); }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const g = canvas.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.82, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL('image/webp', quality);
    if (url.length * 0.75 < 1000 * 1024) return url;
  }
  throw new Error('Картинка слишком большая.');
}

/** Короткая выжимка сообщения для цитаты и строки ответа. */
function snippet(message: AnyMessage): string {
  if (message.deleted) return 'Сообщение удалено';
  const image = imageOf(message.body);
  if (image) return /\.gif(\?|$)|giphy|tenor|klipy/i.test(image) ? 'Гифка' : 'Картинка';
  if (parseCallMessage(message.body)) return 'Звонок';
  const pack = parsePackMessage(message.body);
  if (pack) return `Сборка «${pack.name}»`;
  return message.body.length > 90 ? message.body.slice(0, 90) + '…' : message.body;
}

/** Реакции под сообщением: эмодзи и сколько, своя подсвечена. Клик - поставить или снять. */
function reactionsRow(message: AnyMessage): HTMLElement | null {
  const entries = Object.entries(message.reactions ?? {}).filter(([, who]) => who.length);
  if (!entries.length || message.deleted) return null;
  const me = snap.me?.uuid ?? '';
  return el('div', { class: 'msg-reacts' }, ...entries.map(([emoji, who]) =>
    el('button', {
      class: `msg-react${who.includes(me) ? ' on' : ''}`, 'data-emoji': emoji,
      title: who.map(nameOf).join(', '),
    }, emoji, who.length > 1 ? el('b', {}, String(who.length)) : null)));
}

function bubble(message: AnyMessage, previous: AnyMessage | undefined, group: boolean, byId: Map<number, AnyMessage>): HTMLElement {
  const mine = message.from === snap.me?.uuid;
  const full = new Date(message.at * 1000).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'long' });
  const side = `${mine ? 'mine' : 'them'}`;
  // В группе над чужим сообщением - ник, если перед ним писал кто-то другой.
  const author = group && !mine && previous?.from !== message.from ? el('span', { class: 'msg-from' }, nameOf(message.from)) : null;
  const base = { 'data-id': String(message.id), title: full };
  if (message.deleted) {
    return el('div', { ...base, class: `msg ${side} deleted${author ? ' first' : ''}` },
      author, 'Сообщение удалено', el('span', { class: 'msg-pad' }), meta(message, mine, group));
  }
  // Сборка, которой поделились: карточка с кнопкой «Установить» вместо голого кода.
  const pack = parsePackMessage(message.body);
  if (pack) {
    return el('div', { ...base, class: `msg msg-pack ${side}${author ? ' first' : ''}` },
      author, packCard(pack.name, pack.code, mine), meta(message, mine, group, ' block'), reactionsRow(message));
  }
  // Звонок: карточка как в Телеграме - входящий, исходящий или пропущенный и сколько длился.
  const callInfo = parseCallMessage(message.body);
  if (callInfo) {
    const title = mine
      ? (callInfo.answered ? 'Исходящий звонок' : 'Звонок без ответа')
      : (callInfo.answered ? 'Входящий звонок' : 'Пропущенный звонок');
    return el('div', { ...base, class: `msg msg-call ${side}${callInfo.answered ? '' : ' missed'}` },
      el('span', { class: 'msg-call-ico' }, icon(callInfo.answered ? 'phone' : 'phoneOff', 15, 1.9)),
      el('div', { class: 'msg-call-text' }, el('b', {}, title),
        el('span', {}, callInfo.answered ? duration(callInfo.seconds) : mine ? 'Друг не ответил' : 'Перезвони')),
      meta(message, mine, group, ' block'), reactionsRow(message));
  }
  // Ответ: цитата сверху, клик прокручивает к исходному сообщению.
  const original = message.replyTo ? byId.get(message.replyTo) : undefined;
  const image = imageOf(message.body);
  const quote = message.replyTo
    ? el('div', { class: 'msg-quote', 'data-jump': String(message.replyTo) },
        el('b', {}, original ? (original.from === snap.me?.uuid ? 'Ты' : nameOf(original.from)) : 'Ответ'),
        el('span', {}, original ? snippet(original) : 'Сообщение выше'))
    : null;
  if (image) {
    const pic = el('img', { class: 'msg-pic', src: image, alt: '', loading: 'lazy', draggable: 'false', 'data-view': image });
    // Через 30 дней картинка с сайта удаляется: вместо пустой рамки - надпись.
    pic.addEventListener('error', () => pic.replaceWith(el('span', { class: 'msg-pic-gone' }, 'Картинка удалена')), { once: true });
    return el('div', { ...base, class: `msg msg-img ${side}${author ? ' first' : ''}` },
      author, quote, pic, meta(message, mine, group, ' block'), reactionsRow(message));
  }
  // Невидимая распорка в конце текста держит место под время, чтобы оно не налезало на слова.
  const padClass = `msg-pad${!group && mine ? ' ticks' : ''}${message.edited ? ' edited' : ''}`;
  return el('div', { ...base, class: `msg ${side}${author ? ' first' : ''}` },
    author, quote, ...linkify(message.body), el('span', { class: padClass }), meta(message, mine, group), reactionsRow(message));
}

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
/** Смайлики для поля ввода и реакций. Тот же набор проверяет сайт (power-visual-api/src/social.js). */
const EMOJI = ['😀', '😂', '🤣', '😊', '😍', '🥰', '😘', '😎', '🤔', '🤨', '😐', '🙄', '😏', '😴', '😭', '😢', '😮', '😡', '🤬', '😱', '😳', '🥺', '😇', '🤡', '💀', '👻', '👽', '🤖', '💩', '👍', '👎', '👌', '✌️', '🤝', '👏', '🙏', '💪', '👀', '🫡', '🤙', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔', '🔥', '✨', '⭐', '💯', '🎉', '🎁', '🏆', '⚔️', '🛡️', '💎', '⛏️', '🪓', '🍖', '🍪', '☕'];

/** Сетка смайликов под кнопкой. pick - что делать с выбранным. */
function emojiGrid(anchor: HTMLElement, pick: (emoji: string) => void, keepOpen = false): void {
  const rect = anchor.getBoundingClientRect();
  const grid = el('div', { class: 'pop-emoji' }, ...EMOJI.map((emoji) =>
    el('button', { 'data-close': keepOpen ? undefined : '1', onclick: () => pick(emoji) }, emoji)));
  popupMenu(rect.left, rect.top, [], grid);
  above(rect);
}

/** Только что открытое меню - вплотную над кнопкой, а не от её верха вниз. */
function above(rect: DOMRect): void {
  const menu = document.querySelector<HTMLElement>('.pop-menu');
  if (menu) menu.style.top = `${Math.max(8, rect.top - menu.offsetHeight - 8)}px`;
}

let favCache: Favorite[] | null = null;
async function favorites(): Promise<Favorite[]> {
  favCache ??= await api.favList().catch(() => []);
  return favCache;
}

/** Всплывающее меню у курсора. Закрывается кликом мимо, Esc или прокруткой. */
export function popupMenu(x: number, y: number, items: ({ label: string; icon?: string; danger?: boolean; run: () => void } | null)[],
  top?: HTMLElement): void {
  document.querySelector('.pop-menu')?.remove();
  const menu = el('div', { class: 'pop-menu' }, top ?? null,
    ...items.filter((i): i is NonNullable<typeof i> => Boolean(i)).map((item) => el('button', {
      class: `pop-item${item.danger ? ' danger' : ''}`,
      onclick: () => { close(); item.run(); },
    }, item.icon ? icon(item.icon, 14, 1.8) : null, item.label)));
  const close = (): void => {
    menu.remove();
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', close);
  };
  const outside = (event: Event): void => { if (!menu.contains(event.target as Node)) close(); };
  const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
  menu.addEventListener('click', (event) => event.stopPropagation());
  window.setTimeout(() => {
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', close);
  });
  // Реакции в шапке меню тоже закрывают его.
  menu.querySelectorAll('[data-close]').forEach((node) => node.addEventListener('click', close));
}

/** Кнопка звонка в шапке переписки: позвонить / войти в голосовой / положить трубку. */
function callButton(key: string): HTMLElement | null {
  const room = roomOf(key);
  const view = voiceView();
  if (view.room === room) {
    return el('button', { class: 'chat-call end', title: 'Завершить', onclick: () => leaveVoice() }, icon('phoneOff', 16, 1.8));
  }
  const inside = view.rooms.get(room) ?? [];
  const label = isGroupKey(key) ? (inside.length ? `Войти · ${inside.length}` : 'Голосовой') : null;
  return el('button', {
    class: `chat-call${inside.length ? ' live' : ''}`,
    title: isGroupKey(key) ? 'Войти в голосовой канал группы' : 'Позвонить',
    disabled: view.joining ? 'true' : undefined,
    onclick: () => startVoice(room),
  }, icon(isGroupKey(key) ? 'mic' : 'phone', 16, 1.8), label);
}

/**
 * Переписка с другом или группой: история, поле ввода, отправка по Enter.
 * Сама подгружает историю и сама обновляется, когда приходят новые сообщения.
 */
function conversation(key: string, onClose?: () => void): HTMLElement {
  const group = isGroupKey(key);
  const list = el('div', { class: 'msgs' });
  const placeholder = group ? `Написать в ${groupOf(key)?.name ?? 'группу'}…` : `Написать ${nameOf(key)}…`;
  const input = el('textarea', { class: 'chat-input', rows: 1, maxlength: 500, placeholder });
  const sendButton = el('button', { class: 'chat-send', title: 'Отправить' }, icon('send', 16, 2));
  const attachButton = el('button', { class: 'chat-attach', title: 'Картинки и избранное (можно Ctrl+V)' }, icon('image', 17, 1.7));
  const emojiButton = el('button', { class: 'chat-attach', title: 'Смайлики' }, icon('smile', 17, 1.7));
  const head = el('header', { class: 'chat-head' });
  // Строка над полем: «Ответ Нику: …» или «Изменение сообщения», с крестиком.
  const replyBar = el('div', { class: 'chat-reply', hidden: true });
  const root = el('div', { class: 'chat' }, head, list, replyBar, el('div', { class: 'chat-bar' }, attachButton, emojiButton, input, sendButton));
  let loaded = false;
  let replyTo: AnyMessage | null = null;
  let editing: AnyMessage | null = null;
  let typedAt = 0;

  const setMode = (reply: AnyMessage | null, edit: AnyMessage | null): void => {
    replyTo = reply;
    editing = edit;
    const target = edit ?? reply;
    if (!target) {
      replyBar.hidden = true;
      replyBar.replaceChildren();
      return;
    }
    replyBar.hidden = false;
    replyBar.replaceChildren(
      icon(edit ? 'edit' : 'chat', 14, 1.8),
      el('div', {},
        el('b', {}, edit ? 'Изменение' : `Ответ ${target.from === snap.me?.uuid ? 'себе' : nameOf(target.from)}`),
        el('span', {}, snippet(target))),
      el('button', { class: 'chat-reply-x', title: 'Отмена (Esc)', onclick: () => cancel() }, icon('close', 11, 1.8)),
    );
    if (edit) { input.value = edit.body; input.dispatchEvent(new Event('input')); }
    input.focus();
  };
  const cancel = (): void => {
    if (editing) { input.value = ''; input.style.height = ''; }
    setMode(null, null);
  };
  const find = (id: number): AnyMessage | undefined => chats.get(key)?.find((m) => m.id === id);
  const change = (id: number, what: { body?: string; remove?: boolean; emoji?: string }): void => {
    void api.messageChange(group, id, what).then((updated) => applyChange(key, updated),
      (error: unknown) => toast(error instanceof Error ? error.message : String(error), true));
  };

  // Один обработчик на весь список: ссылки, цитаты, реакции.
  list.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const link = target.closest<HTMLElement>('.msg-link');
    if (link) { event.preventDefault(); void api.openExternal(link.dataset.url ?? ''); return; }
    const pic = target.closest<HTMLElement>('[data-view]');
    if (pic) { viewImage(pic.dataset.view ?? ''); return; }
    const jump = target.closest<HTMLElement>('[data-jump]');
    if (jump) {
      const node = list.querySelector<HTMLElement>(`[data-id="${jump.dataset.jump}"]`);
      if (node) { node.scrollIntoView({ block: 'center', behavior: 'smooth' }); node.classList.remove('flash'); void node.offsetWidth; node.classList.add('flash'); }
      return;
    }
    const chip = target.closest<HTMLElement>('.msg-react');
    const host = chip?.closest<HTMLElement>('[data-id]');
    if (chip && host) change(Number(host.dataset.id), { emoji: chip.dataset.emoji ?? '' });
  });
  // Правая кнопка по сообщению: реакции, ответить, скопировать, изменить, удалить.
  list.addEventListener('contextmenu', (event) => {
    const node = (event.target as HTMLElement).closest<HTMLElement>('[data-id]');
    const message = node ? find(Number(node.dataset.id)) : undefined;
    if (!message || message.deleted) return;
    event.preventDefault();
    const mine = message.from === snap.me?.uuid;
    const plainText = !parsePackMessage(message.body) && !parseCallMessage(message.body) && !imageOf(message.body);
    const more = el('button', { class: 'pop-more', title: 'Ещё' }, icon('plus', 14, 2));
    const reacts = el('div', { class: 'pop-reacts' }, ...REACTIONS.map((emoji) =>
      el('button', { 'data-close': '1', onclick: () => change(message.id, { emoji }) }, emoji)), more);
    more.addEventListener('click', () => emojiGrid(more, (emoji) => change(message.id, { emoji })));
    const image = imageOf(message.body);
    const faved = image ? (favCache ?? []).some((f) => f.url === image) : false;
    popupMenu(event.clientX, event.clientY, [
      { label: 'Ответить', icon: 'chat', run: () => setMode(message, null) },
      image ? {
        label: faved ? 'Убрать из избранного' : 'В избранное', icon: 'star',
        run: () => void act(async () => {
          const list = await favorites();
          const found = list.find((f) => f.url === image);
          favCache = found ? await api.favRemove(found.id) : await api.favAdd(image);
        }, faved ? 'Убрано из избранного' : 'Добавлено в избранное'),
      } : null,
      plainText ? { label: 'Скопировать', icon: 'copy', run: () => void navigator.clipboard.writeText(message.body).then(() => toast('Скопировано')) } : null,
      mine && plainText ? { label: 'Изменить', icon: 'edit', run: () => setMode(null, message) } : null,
      mine ? {
        label: 'Удалить', icon: 'trash', danger: true,
        run: () => modal({
          title: 'Удалить сообщение?', note: 'Оно пропадёт у обоих.', confirm: 'Удалить', danger: true,
          onConfirm: () => { if (editing?.id === message.id) cancel(); change(message.id, { remove: true }); },
        }),
      } : null,
    ], reacts);
  });

  let shown = -1;
  let shownVersion = chatVersion;
  /** Уже показанные сообщения: при перерисовке списка они не появляются заново с анимацией. */
  const drawn = new Set<number>();
  const pending: HTMLElement[] = [];
  let queue: Promise<unknown> = Promise.resolve();

  const closeButton = onClose ? el('button', { class: 'chat-more', title: 'Закрыть', onclick: onClose }, icon('close', 12, 1.6)) : null;

  const paintHead = (): boolean => {
    if (group) {
      const g = groupOf(key);
      if (!g) { head.replaceChildren(el('b', {}, 'Ты больше не в этой группе'), ...(closeButton ? [closeButton] : [])); return false; }
      const inside = voiceView().rooms.get(key) ?? [];
      const total = others(g).length + 1;
      head.replaceChildren(...[
        el('span', { class: 'chat-face fr-gface' }, icon('group', 18, 1.6)),
        el('div', { class: 'chat-who' }, el('b', {}, g.name),
          typingText(key)
            ? el('span', { class: 'tn-type' }, typingText(key)!)
            : el('span', { class: inside.length ? 'tn-play' : 'tn-off' },
                inside.length
                  ? `В голосовом: ${inside.map(nameOf).join(', ')}`
                  : plural(total, 'участник', 'участника', 'участников'))),
        callButton(key),
        el('button', { class: 'chat-more', title: 'Участники', onclick: () => groupDialog(g) }, icon('friends', 15, 1.7)),
        closeButton,
      ].filter((node): node is HTMLElement => Boolean(node)));
      return true;
    }
    const friend = snap.friends.find((f) => f.uuid === key);
    if (!friend) { head.replaceChildren(el('b', {}, 'Больше не в друзьях'), ...(closeButton ? [closeButton] : [])); return false; }
    const state = statusOf(friend);
    head.replaceChildren(...[
      face(friend.uuid, friend.name, 'chat-face'),
      el('div', { class: 'chat-who' }, nick(friend.name, friend.licensed),
        typingText(key) ? el('span', { class: 'tn-type' }, typingText(key)!) : el('span', { class: state.tone }, state.text)),
      joinButton(friend),
      callButton(key),
      el('button', {
        class: 'chat-more', title: 'Удалить из друзей',
        onclick: () => modal({
          title: `Удалить ${friend.name} из друзей?`,
          note: 'Переписка останется.',
          confirm: 'Удалить',
          danger: true,
          onConfirm: () => void act(() => api.socialRemove(key)),
        }),
      }, icon('trash', 15, 1.7)),
      closeButton,
    ].filter((node): node is HTMLElement => Boolean(node)));
    return true;
  };

  const paint = (): void => {
    if (!paintHead()) return;
    const messages = chats.get(key) ?? [];
    if (!loaded) { list.replaceChildren(el('div', { class: 'msgs-note' }, 'Загружаю переписку…')); return; }
    if (messages.length === shown && chatVersion === shownVersion) return;
    shownVersion = chatVersion;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const byId = new Map(messages.map((m) => [m.id, m]));
    const first = drawn.size === 0;
    const me = snap.me?.uuid;
    const still = (node: HTMLElement, m: ChatMessage | GroupMessage): HTMLElement => {
      // Своё сообщение уже появилось бледным черновиком - подтверждённое не анимируем второй раз.
      if (!first && (drawn.has(m.id) || m.from === me)) node.classList.add('still');
      drawn.add(m.id);
      return node;
    };
    for (const ghost of pending) if (ghost.isConnected) ghost.classList.add('still');
    list.replaceChildren(...(messages.length || pending.length
      ? messages.flatMap((m, i) => {
          const previous = messages[i - 1];
          const day = dayLabel(m.at, previous?.at);
          return day ? [el('div', { class: 'msg-day' }, day), still(bubble(m, undefined, group, byId), m)] : [still(bubble(m, previous, group, byId), m)];
        })
      : [el('div', { class: 'msgs-note' }, group ? 'Сообщений пока нет. Начни разговор!' : 'Сообщений пока нет. Напиши первым!')]),
    ...pending);
    // Новое сообщение прокручивает вниз, только если человек и так был внизу, а не читал старое.
    if (atBottom || shown <= 0) {
      list.scrollTop = list.scrollHeight;
      // Первый раз список рисуется до вставки на экран: высоты ещё нет, и прокрутка не срабатывает.
      // Докручиваем вниз, когда он появится.
      if (!list.isConnected || !list.clientHeight) {
        let tries = 0;
        const toBottom = (): void => {
          if (list.clientHeight) list.scrollTop = list.scrollHeight;
          else if (++tries < 30) requestAnimationFrame(toBottom);
        };
        requestAnimationFrame(toBottom);
      }
    }
    shown = messages.length;
  };

  // Сообщение видно сразу, бледным, пока сайт не подтвердит. Отправки идут по очереди,
  // чтобы быстрые сообщения подряд не перепутались местами.
  const send = (): void => {
    const text = input.value.trim();
    if (!text) return;
    if (editing) {
      const id = editing.id;
      const same = editing.body === text;
      cancel();
      if (!same) change(id, { body: text });
      return;
    }
    const reply = replyTo?.id;
    setMode(null, null);
    input.value = '';
    input.style.height = '';
    input.focus();
    post(text, reply, text, text);
  };
  const post = (text: string | Promise<string>, reply: number | undefined, label: string, failText?: string): void => {
    const ghost = el('div', { class: 'msg mine pending', title: 'Отправляю…' }, label);
    pending.push(ghost);
    list.querySelector('.msgs-note')?.remove();
    list.append(ghost);
    list.scrollTop = list.scrollHeight;
    const drop = (): void => { pending.splice(pending.indexOf(ghost), 1); ghost.remove(); };
    // Картинка грузится на сайт параллельно, а в очередь сообщений встаёт уже её адрес.
    const ready = Promise.resolve(text);
    ready.catch(() => undefined);
    queue = queue.then(() => ready)
      .then((body) => (group ? api.groupSend(groupId(key), body, reply) : api.socialSend(key, body, reply)) as Promise<AnyMessage>)
      .then((message) => {
        drop();
        if (!chats.has(key)) chats.set(key, []);
        remember(key, [message]);
        shownVersion = -1;
        repaint();
        list.scrollTop = list.scrollHeight;
      }, (error: unknown) => {
        drop();
        // Не ушло - текст обратно в поле, чтобы не набирать заново.
        if (!input.value && failText) input.value = failText;
        toast(error instanceof Error ? error.message : String(error), true);
      });
  };
  const sendImage = (file: Blob): void => {
    if (!file.type.startsWith('image/')) { toast('Это не картинка.', true); return; }
    const reply = replyTo?.id;
    if (!editing) setMode(null, null);
    post(chatImage(file).then((data) => api.socialMedia(data)), reply,
      file.type === 'image/gif' ? 'Отправляю гифку…' : 'Отправляю картинку…');
  };
  const pickFiles = (): void => {
    const picker = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp', multiple: true }) as HTMLInputElement;
    picker.addEventListener('change', () => { for (const file of [...(picker.files ?? [])].slice(0, 10)) sendImage(file); });
    picker.click();
  };
  const sendFavorite = (fav: Favorite): void => {
    const reply = replyTo?.id;
    if (!editing) setMode(null, null);
    post(api.favPayload(fav.id).then((p) => (p.data ? api.socialMedia(p.data) : p.url)), reply,
      fav.gif ? 'Отправляю гифку…' : 'Отправляю картинку…');
  };
  // Панель над полем: «С компьютера» и сетка избранного. Клик - отправить, правая кнопка - убрать.
  attachButton.addEventListener('click', () => {
    void favorites().then((list) => {
      const rect = attachButton.getBoundingClientRect();
      const grid = el('div', { class: 'fav-grid' });
      const fill = (items: Favorite[]): void => {
        grid.replaceChildren(...(items.length ? items.map((fav) => {
          const cell = el('button', { class: 'fav-cell', 'data-close': '1', title: 'Отправить · правая кнопка - убрать', onclick: () => sendFavorite(fav) },
            el('img', { src: fav.src, alt: '', loading: 'lazy', draggable: 'false' }));
          cell.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void api.favRemove(fav.id).then((next) => { favCache = next; fill(next); });
          });
          return cell;
        }) : [el('div', { class: 'fav-empty' }, 'Тут будут избранные. Правая кнопка по картинке в чате - «В избранное».')]));
      };
      fill(list);
      const top = el('div', { class: 'fav-panel' },
        el('button', { class: 'pop-item', 'data-close': '1', onclick: pickFiles }, icon('folder', 14, 1.8), 'С компьютера'),
        el('div', { class: 'fav-title' }, icon('star', 12, 1.8), 'Избранное'),
        grid);
      popupMenu(rect.left, rect.top, [], top);
      above(rect);
    });
  });
  emojiButton.addEventListener('click', () => emojiGrid(emojiButton, (emoji) => {
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.setRangeText(emoji, start, end, 'end');
    input.dispatchEvent(new Event('input'));
    input.focus();
  }, true));
  input.addEventListener('paste', (event) => {
    const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    for (const file of files.slice(0, 10)) sendImage(file);
  });
  root.addEventListener('dragover', (event) => {
    if (![...(event.dataTransfer?.types ?? [])].includes('Files')) return;
    event.preventDefault();
    root.classList.add('drop');
  });
  root.addEventListener('dragleave', (event) => { if (!root.contains(event.relatedTarget as Node)) root.classList.remove('drop'); });
  root.addEventListener('drop', (event) => {
    root.classList.remove('drop');
    const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    for (const file of files.slice(0, 10)) sendImage(file);
  });
  // Картинка догрузилась и сдвинула ленту: если читали низ - остаёмся внизу.
  list.addEventListener('load', (event) => {
    const pic = event.target as HTMLElement;
    if (!(pic instanceof HTMLImageElement)) return;
    if (list.scrollHeight - list.scrollTop - list.clientHeight < pic.clientHeight + 80) list.scrollTop = list.scrollHeight;
  }, true);
  sendButton.addEventListener('click', send);
  input.addEventListener('keydown', (event) => {
    // Enter - отправить, Shift+Enter - новая строка, как в любом мессенджере.
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(); }
    // Esc - отменить ответ или правку; стрелка вверх в пустом поле - изменить своё последнее.
    else if (event.key === 'Escape' && (replyTo || editing)) { event.preventDefault(); event.stopPropagation(); cancel(); }
    else if (event.key === 'ArrowUp' && !input.value) {
      const last = [...(chats.get(key) ?? [])].reverse()
        .find((m) => m.from === snap.me?.uuid && !m.deleted && !parsePackMessage(m.body) && !parseCallMessage(m.body));
      if (last) { event.preventDefault(); setMode(null, last); }
    }
  });
  // Поле растёт вместе с текстом до четырёх строк. Пока печатаешь - другу «печатает…»,
  // не чаще раза в 3 секунды и только через соединение (сайт и базу это не трогает).
  input.addEventListener('input', () => {
    input.style.height = '';
    input.style.height = `${Math.min(input.scrollHeight, 96)}px`;
    if (!input.value.trim() || editing || Date.now() - typedAt < 3000) return;
    typedAt = Date.now();
    void api.voiceSend(group ? { t: 'typing', group: groupId(key) } : { t: 'typing', to: key }).catch(() => undefined);
  });

  const fresh = chats.has(key) && snap.online && Date.now() - (loadedAt.get(key) ?? 0) < HISTORY_FRESH;
  if (fresh) {
    loaded = true;
    if (unreadOf(key)) readSoon(key);
  }
  const history: Promise<{ messages: (ChatMessage | GroupMessage)[] } | null> = fresh
    ? Promise.resolve(null)
    : group ? api.groupHistory(groupId(key)) : api.socialHistory(key);
  void history
    .then((page) => {
      if (page) {
        chats.set(key, []);
        remember(key, page.messages);
        loadedAt.set(key, Date.now());
      }
      loaded = true;
      repaint();
    })
    .catch((error: unknown) => {
      list.replaceChildren(el('div', { class: 'msgs-note' }, error instanceof Error ? error.message : 'Переписка не загрузилась.'));
    });

  window.setTimeout(() => input.focus(), 50);
  return track(root, paint);
}

/** Чат всплывающим окном в углу, поверх любого экрана. Одновременно - один. */
export function openChat(key: string): void {
  if (popup?.key === key) { popup.node.querySelector('textarea')?.focus(); return; }
  closeChat();
  // На экране «Друзья» этот чат и так открыт справа - второе окно поверх не нужно.
  if (openChats.has(key)) return;
  const close = (): void => closeChat();
  const node = el('section', { class: 'chat-pop' }, conversation(key, close));
  const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape' && popup?.node === node) close(); };
  document.addEventListener('keydown', onKey);
  node.addEventListener('remove-chat', () => document.removeEventListener('keydown', onKey));
  document.body.append(node);
  popup = { key, node };
  openChats.add(key);
  void api.socialFast(true).catch(() => undefined);
}

export function closeChat(): void {
  if (!popup) return;
  popup.node.dispatchEvent(new Event('remove-chat'));
  popup.node.remove();
  openChats.delete(popup.key);
  popup = null;
  if (!openChats.size) void api.socialFast(false).catch(() => undefined);
}

// ---------------------------------------------------------------- звонок

let callNode: HTMLElement | null = null;
let ringNode: HTMLElement | null = null;
let clockTimer: number | null = null;

function clock(startedAt: number): string {
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** Название канала для панели звонка. */
function roomTitle(room: string): string {
  if (room.startsWith('dm:')) return nameOf(room.slice(3));
  return groupOf(room)?.name ?? 'Группа';
}

/**
 * Громкость собеседника: всплывающий ползунок у курсора (правая кнопка по лицу в панели звонка).
 * До 200%: тихого можно сделать громче, а слишком громкого - тише. Запоминается для этого игрока.
 */
function volumePopover(uuid: string, volume: number, x: number, y: number): void {
  document.querySelector('.vc-pop')?.remove();
  const percent = Math.round(volume * 100);
  const slider = el('input', { type: 'range', min: 0, max: 200, step: 5, value: percent, class: 'vc-range' });
  const label = el('span', { class: 'vc-range-val' }, `${percent}%`);
  const update = (value: number): void => {
    slider.value = String(value);
    label.textContent = `${value}%`;
    setPeerVolume(uuid, value / 100);
  };
  slider.addEventListener('input', () => update(Number(slider.value)));
  const pop = el('div', { class: 'vc-pop' },
    el('div', { class: 'vc-pop-head' }, face(uuid, nameOf(uuid), 'vc-face'), el('b', {}, nameOf(uuid))),
    el('div', { class: 'vc-volume' }, icon('headphones', 15, 1.8), slider, label),
    el('div', { class: 'vc-pop-tools' },
      el('button', { class: 'btn btn-ghost btn-s', onclick: () => update(100) }, 'Сбросить'),
      el('button', { class: 'btn btn-ghost btn-s', onclick: () => update(0) }, 'Без звука')),
  );
  document.body.append(pop);
  // У нижнего края экрана панель звонка: окошко ставим над курсором и не даём вылезти за окно.
  const box = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(x - box.width / 2, window.innerWidth - box.width - 8))}px`;
  pop.style.top = `${Math.max(8, y - box.height - 12)}px`;
  const away = (event: MouseEvent): void => {
    if (pop.contains(event.target as Node)) return;
    pop.remove();
    document.removeEventListener('mousedown', away, true);
  };
  window.setTimeout(() => document.addEventListener('mousedown', away, true), 0);
}

/**
 * Панель звонка в углу окна (видна на любом экране) и карточка входящего звонка.
 * Перерисовывается целиком: она маленькая, а состояние меняется редко (кроме «говорит»).
 */
function paintCall(): void {
  const view = voiceView();

  // Входящий звонок.
  if (view.ringing && view.room !== view.ringing.room) {
    const { room, from } = view.ringing;
    if (!ringNode || ringNode.dataset.room !== room) {
      ringNode?.remove();
      ringNode = el('div', { class: 'vc-ring', 'data-room': room },
        face(from, nameOf(from), 'vc-ring-face'),
        el('div', { class: 'vc-ring-text' }, el('b', {}, nameOf(from)), el('span', {}, 'звонит тебе')),
        el('button', { class: 'vc-btn vc-accept', title: 'Ответить', onclick: () => startVoice(room) }, icon('phone', 18, 1.9)),
        el('button', { class: 'vc-btn vc-end', title: 'Отклонить', onclick: () => declineRing() }, icon('phoneOff', 18, 1.9)),
      );
      document.body.append(ringNode);
    }
  } else {
    ringNode?.remove();
    ringNode = null;
  }

  if (!view.room) {
    callNode?.remove();
    callNode = null;
    if (clockTimer) window.clearInterval(clockTimer);
    clockTimer = null;
    return;
  }
  if (!callNode) {
    callNode = el('div', { class: 'vc-bar' });
    document.body.append(callNode);
    draggable(callNode);
  }
  const me = snap.me;
  const time = el('span', { class: 'vc-time' }, view.waiting ? 'Вызов…' : clock(view.startedAt));
  if (!clockTimer) {
    clockTimer = window.setInterval(() => {
      const t = callNode?.querySelector('.vc-time');
      const v = voiceView();
      if (t && v.room && !v.waiting) t.textContent = clock(v.startedAt);
    }, 1000);
  }
  const lost = view.peers.some((p) => p.state === 'lost');
  callNode.replaceChildren(
    el('div', { class: 'vc-top' },
      el('span', { class: `vc-led${view.waiting ? ' wait' : lost ? ' bad' : ''}` }),
      el('button', {
        class: 'vc-title', title: 'Открыть переписку',
        onclick: () => openChat(view.room!.startsWith('dm:') ? view.room!.slice(3) : view.room!),
      }, roomTitle(view.room)),
      time,
    ),
    el('div', { class: 'vc-people' },
      me ? el('span', { class: `vc-person${view.meSpeaking ? ' talk' : ''}${view.muted ? ' muted' : ''}`, title: `${me.name} (ты)` },
        face(me.uuid, me.name, 'vc-face')) : null,
      ...view.peers.map((p) => {
        const node = el('button', {
          class: `vc-person${p.speaking ? ' talk' : ''}${p.state !== 'connected' ? ' wait' : ''}`,
          title: `${nameOf(p.uuid)}${p.state === 'connected' ? '' : ' · соединяю…'} · громкость ${Math.round(p.volume * 100)}%`
            + ' · правая кнопка - громкость',
          onclick: (event: Event) => { const e = event as MouseEvent; volumePopover(p.uuid, p.volume, e.clientX, e.clientY); },
        }, face(p.uuid, nameOf(p.uuid), 'vc-face'),
          p.volume !== 1 ? el('i', { class: 'vc-vol' }, `${Math.round(p.volume * 100)}`) : null);
        node.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          volumePopover(p.uuid, p.volume, event.clientX, event.clientY);
        });
        return node;
      }),
    ),
    el('div', { class: 'vc-tools' },
      el('button', {
        class: `vc-btn${view.muted ? ' off' : ''}`,
        title: view.muted ? 'Включить микрофон (Ctrl+Shift+M)' : 'Выключить микрофон (Ctrl+Shift+M)',
        onclick: () => toggleMute(),
      }, icon(view.muted ? 'micOff' : 'mic', 17, 1.8)),
      el('button', {
        class: `vc-btn${view.deafened ? ' off' : ''}`,
        title: view.deafened ? 'Снова слышать' : 'Никого не слышать',
        onclick: () => toggleDeafen(),
      }, icon(view.deafened ? 'headphonesOff' : 'headphones', 17, 1.8)),
      el('button', { class: 'vc-btn vc-end', title: 'Завершить', onclick: () => leaveVoice() }, icon('phoneOff', 17, 1.9)),
    ),
  );
}

const BAR_KEY = 'pv-callbar';

/** Куда человек утащил панель звонка: доли окна, чтобы место не терялось при смене размера. */
function barPlace(node: HTMLElement, x: number, y: number): void {
  const w = node.offsetWidth;
  const h = node.offsetHeight;
  const left = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - w - 8));
  const top = Math.min(Math.max(40, y), Math.max(40, window.innerHeight - h - 8));
  node.classList.add('moved');
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
}

/**
 * Панель звонка таскается за любое место. Сдвиг меньше 5 пикселей - это обычный клик
 * (по лицу, кнопке), больше - перетаскивание, и клик после него не срабатывает.
 */
function draggable(node: HTMLElement): void {
  const restore = (): void => {
    try {
      const at = JSON.parse(localStorage.getItem(BAR_KEY) ?? 'null') as { x: number; y: number } | null;
      if (at) barPlace(node, at.x * window.innerWidth, at.y * window.innerHeight);
    } catch { /* нет места - стоит по центру снизу */ }
  };
  requestAnimationFrame(restore);
  const onResize = (): void => { if (!node.isConnected) { window.removeEventListener('resize', onResize); return; } restore(); };
  window.addEventListener('resize', onResize);

  let start: { x: number; y: number; left: number; top: number; id: number } | null = null;
  let moved = false;
  node.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const rect = node.getBoundingClientRect();
    start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, id: event.pointerId };
    moved = false;
  });
  node.addEventListener('pointermove', (event) => {
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!moved && Math.hypot(dx, dy) < 5) return;
    if (!moved) { moved = true; node.setPointerCapture(event.pointerId); node.classList.add('dragging'); }
    barPlace(node, start.left + dx, start.top + dy);
  });
  const finish = (event: PointerEvent): void => {
    if (!start || event.pointerId !== start.id) return;
    start = null;
    node.classList.remove('dragging');
    if (!moved) return;
    const rect = node.getBoundingClientRect();
    try {
      localStorage.setItem(BAR_KEY, JSON.stringify({ x: rect.left / window.innerWidth, y: rect.top / window.innerHeight }));
    } catch { /* не страшно */ }
  };
  node.addEventListener('pointerup', finish);
  node.addEventListener('pointercancel', finish);
  // Отпустили после перетаскивания - клик по кнопке под пальцем не считаем.
  node.addEventListener('click', (event) => {
    if (moved) { event.stopPropagation(); event.preventDefault(); moved = false; }
  }, true);
  // Двойной клик по пустому месту - панель обратно вниз по центру.
  node.addEventListener('dblclick', (event) => {
    if ((event.target as HTMLElement).closest('button')) return;
    node.classList.remove('moved');
    node.style.left = '';
    node.style.top = '';
    try { localStorage.removeItem(BAR_KEY); } catch { /* не страшно */ }
  });
}

// ---------------------------------------------------------------- экран «Друзья»

let screenChat: string | null = null;

/**
 * Выбран не тот аккаунт, которым включены друзья, - предлагаем переключиться.
 * Офлайн на офлайн - это смена ника: игрока сайт узнаёт по компьютеру, друзья остаются.
 */
function switchCard(account: Account | undefined): HTMLElement | null {
  if (!snap.enabled || !account || !snap.accountId || account.id === snap.accountId) return null;
  const sameOffline = account.kind === 'offline' && snap.me?.licensed === false;
  const button = el('button', { class: 'btn btn-main btn-s' }, sameOffline ? `Сменить ник на ${account.name}` : `Перейти на ${account.name}`);
  button.addEventListener('click', () => {
    button.disabled = true;
    void act(() => api.socialEnable(account.id).then((next) => { snap = next; repaint(); }),
      sameOffline ? `Теперь ты ${account.name}` : undefined)
      .finally(() => { button.disabled = false; });
  });
  return el('div', { class: 'fr-enable compact' },
    el('b', {}, `Друзья включены для ${snap.me?.name ?? 'другого аккаунта'}`),
    el('p', {}, sameOffline
      ? 'Друзья и переписка останутся, у друзей сменится только ник. Старый ник 10 дней будет держаться за тобой - вдруг передумаешь.'
      : `Сейчас выбран ${account.name}. У каждого аккаунта с лицензией свои друзья.`),
    button,
  );
}

const MODES: { mode: '' | 'dnd' | 'invisible'; label: string; tone: string }[] = [
  { mode: '', label: 'В сети', tone: 'tn-play' },
  { mode: 'dnd', label: 'Не беспокоить', tone: 'tn-dnd' },
  { mode: 'invisible', label: 'Невидимка', tone: 'tn-off' },
];

/** «В сети» / «Не беспокоить» (звонки не звонят) / «Невидимка» (друзья видят «не в сети»). */
function modeButton(): HTMLElement {
  const button = el('button', { class: 'btn btn-ghost btn-s' });
  return track(button, () => {
    const current = MODES.find((m) => m.mode === (snap.me?.mode ?? '')) ?? MODES[0]!;
    button.replaceChildren(el('i', { class: `fr-dot mode-dot ${current.tone}` }), current.label);
    button.onclick = (event) => {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      popupMenu(rect.left, rect.bottom + 6, MODES.map((m) => ({
        label: m.label,
        run: () => void act(() => api.socialMode(m.mode)),
      })));
    };
  });
}

/** Экран «Друзья»: список слева, переписка справа. Есть во всех темах. */
export function friendsScreen(account?: Account): HTMLElement {
  closeChat();
  const side = el('div', { class: 'frs-list' });
  const pane = el('div', { class: 'frs-chat' });

  const exists = (key: string): boolean => (isGroupKey(key) ? Boolean(groupOf(key)) : snap.friends.some((f) => f.uuid === key));
  const show = (key: string | null): void => {
    if (screenChat) openChats.delete(screenChat);
    screenChat = key && exists(key) ? key : null;
    if (!screenChat) {
      pane.replaceChildren(emptyState('chat', 'Выбери чат', snap.enabled ? '' : 'Сначала включи друзей.'));
      void api.socialFast(false).catch(() => undefined);
      return;
    }
    openChats.add(screenChat);
    void api.socialFast(true).catch(() => undefined);
    pane.replaceChildren(conversation(screenChat));
  };

  const switcher = el('div', {});
  side.append(track(switcher, () => switcher.replaceChildren(...[switchCard(account)].filter((n): n is HTMLElement => Boolean(n)))),
    friendsList({ selected: () => screenChat, onPick: (key) => { show(key); repaint(); } }));
  show(screenChat);

  const body = el('div', { class: 'body frs' }, side, pane);
  const tools = snap.enabled
    ? el('div', { class: 'top-tools' }, avatarButton(), modeButton(), el('button', {
        class: 'btn btn-ghost btn-s',
        title: 'Выйти из друзей на этом компьютере',
        onclick: () => modal({
          title: 'Выключить друзей?',
          note: 'Друзья и переписка сохранятся.',
          confirm: 'Выключить',
          onConfirm: () => void act(() => {
            leaveVoice();
            return api.socialDisable().then(() => { screenChat = null; repaint(); });
          }),
        }),
      }, icon('door', 14, 1.7), 'Выключить'))
    : null;
  return frame({ title: 'Друзья', sub: snap.me ? snap.me.name : '', extra: tools, body });
}

/** Ушли с экрана «Друзья» - его переписка больше не открыта. */
export function leaveFriendsScreen(): void {
  if (screenChat) openChats.delete(screenChat);
  if (!openChats.size) void api.socialFast(false).catch(() => undefined);
}
