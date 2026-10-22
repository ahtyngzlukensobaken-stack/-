

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;
type Child = Node | string | null | undefined | false;


export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Attrs = {}, ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'html') {
      node.innerHTML = String(value);
    } else {
      node.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}


const PATHS: Record<string, string> = {
  home: '<path d="M4 11l8-6.5 8 6.5"/><path d="M6 9.5V19.5h12V9.5"/><path d="M10 19.5v-5h4v5"/>',
  library: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  mods: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  downloads: '<path d="M12 4v11m0 0l-4-4m4 4l4-4"/><path d="M4 18h16"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1v.3a2 2 0 11-4 0v-.2a1.6 1.6 0 00-2.8-1.1l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 004 15a2 2 0 010-4 1.6 1.6 0 00.7-2.7l-.1-.1a2 2 0 112.8-2.8l.1.1A1.6 1.6 0 0010 4.6V4a2 2 0 014 0v.3a1.6 1.6 0 002.7 1.1l.1-.1a2 2 0 112.8 2.8l-.1.1A1.6 1.6 0 0020 11a2 2 0 01-.6 4z"/>',
  back: '<path d="M14 6l-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c.9 1.3 2.1 2 3.5 2s2.6-.7 3.5-2"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.6"/>',
  star: '<path d="M12 3.8l2.5 5.1 5.6.8-4 4 .9 5.6L12 16.6l-5 2.7.9-5.6-4-4 5.6-.8z"/>',
  image: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.5" cy="10" r="1.8"/><path d="M21 15.5l-5-5L6 19.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  external: '<path d="M14 5h5v5M19 5l-8 8M17 14v5H5V7h5"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/><path d="M8 10.5V7.5a4 4 0 018 0v3"/>',
  trash: '<path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7a2 2 0 002 2h3"/>',
  logs: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M7 9h6M7 12.5h10M7 16h8"/>',
  download: '<path d="M12 4v10m0 0l-4-4m4 4l4-4"/><path d="M5 19h14"/>',
  refresh: '<path d="M4 12a8 8 0 1114.5 4.6"/><path d="M19 21v-5h-5"/>',
  folder: '<path d="M3 7.5A1.5 1.5 0 014.5 6h4l2 2.5h7A1.5 1.5 0 0119 10v7.5a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 013 17.5z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.1"/>',
  min: '<path d="M2 6h8"/>',
  max: '<rect x="2.5" y="2.5" width="7" height="7"/>',
  close: '<path d="M3 3l6 6M9 3l-6 6"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4.5M12 17.3v.1"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  moon: '<path d="M19.5 14.5A8 8 0 019.5 4.5a8 8 0 1010 10z"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0115 0"/>',
  friends: '<circle cx="9" cy="8.5" r="3.4"/><path d="M2.5 19.5a6.5 6.5 0 0113 0"/><path d="M15.5 5.3a3.4 3.4 0 010 6.4M18 14.2a6.5 6.5 0 013.5 5.3"/>',
  addUser: '<circle cx="10" cy="8.5" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0113 0M19 8v6M16 11h6"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a1 1 0 01-1 1A16 16 0 014 5a1 1 0 011-1z"/>',
  phoneOff: '<path d="M3 13.5c5-4.6 13-4.6 18 0l-2.2 2.6-3.6-1.4v-2.6a10 10 0 00-6.4 0v2.6l-3.6 1.4z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21"/>',
  micOff: '<path d="M15 10V6a3 3 0 00-5.6-1.5M9 9v2a3 3 0 004.6 2.5M5.5 11a6.5 6.5 0 0010.4 5.2M18.5 11a6.4 6.4 0 01-.6 2.6M12 17.5V21M3 3l18 18"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0116 0v3"/><rect x="3.5" y="14" width="4" height="6" rx="1.5"/><rect x="16.5" y="14" width="4" height="6" rx="1.5"/>',
  headphonesOff: '<path d="M4 15v-3a8 8 0 0113.7-5.6M20 12v3"/><rect x="3.5" y="14" width="4" height="6" rx="1.5"/><rect x="16.5" y="14" width="4" height="6" rx="1.5"/><path d="M3 3l18 18"/>',
  group: '<circle cx="12" cy="8" r="3.2"/><circle cx="5" cy="10" r="2.4"/><circle cx="19" cy="10" r="2.4"/><path d="M6.5 20a5.5 5.5 0 0111 0M1.5 19a3.6 3.6 0 015-3.2M22.5 19a3.6 3.6 0 00-5-3.2"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  send: '<path d="M4 12l16-8-6 16-2-7z"/>',
  door: '<path d="M14 4h5v16h-5M10 8l4 4-4 4M14 12H3"/>',
  java: '<path d="M5 10h11v5a5 5 0 01-5 5h-1a5 5 0 01-5-5z"/><path d="M16 11.5h1.5a2.5 2.5 0 010 5H16"/><path d="M9 3.5c-1 1.2 1 2 0 3.5M12.5 3.5c-1 1.2 1 2 0 3.5"/>',
};

export function icon(name: string, size = 18, stroke = 1.6): SVGElement {
  const svg = document.createElementNS('REDACTED_ENDPOINT', 'svg');
  svg.setAttribute('viewBox', name === 'min' || name === 'max' || name === 'close' ? '0 0 12 12' : '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', String(stroke));
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = PATHS[name] ?? '';
  return svg;
}



export function modal(options: {
  title: string;
  note?: string;
  
  content?: HTMLElement | ((close: () => void) => HTMLElement);
  
  confirm?: string;
  
  danger?: boolean;
  
  wide?: boolean;
  onConfirm?: () => void;
}): void {
  const card = el('div', { class: 'crash-card', style: `max-width:${options.wide ? 560 : 420}px` },
    el('b', { class: 'modal-title' }, options.title),
    options.note ? el('p', { class: 'modal-note' }, options.note) : null,
  );
  const back = el('div', { class: 'crash-backdrop' }, card);

  const close = (): void => {
    back.remove();
    document.removeEventListener('keydown', onKey);
  };

  if (options.content) {
    card.append(typeof options.content === 'function' ? options.content(close) : options.content);
  }
  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') close();
    // Enter подтверждает - но только там, где действие обратимо. В окне «удалить насовсем»
    // рефлекторное нажатие Enter стоило бы человеку миров, поэтому там нужен именно клик.
    if (event.key === 'Enter' && !event.isComposing && !options.danger && options.confirm) {
      close();
      options.onConfirm?.();
    }
  }

  card.append(el('div', { class: 'modal-actions' },
    el('button', { class: 'btn btn-ghost btn-s', onclick: close }, options.confirm ? 'Отмена' : 'Закрыть'),
    options.confirm ? el('button', {
      class: options.danger ? 'btn btn-danger btn-s' : 'btn btn-main btn-s',
      onclick: () => { close(); options.onConfirm?.(); },
    }, options.confirm) : null,
  ));

  back.addEventListener('mousedown', (event) => { if (event.target === back) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  // Фокус внутрь окна: иначе Esc и Enter слушает то, что было под ним.
  (card.querySelector('input') ?? card.querySelector('button')) ?.focus();
}

/**
 * Блок «здесь пока пусто».
 *
 * Раньше в таких местах висела одна серая строчка посреди огромной пустоты - по ней не понять,
 * сломался лаунчер или так и задумано. Теперь: иконка, короткий заголовок и подсказка, что делать.
 */
export function emptyState(
  iconName: string, title: string, note?: string, action?: HTMLElement,
): HTMLElement {
  return el('div', { class: 'estate' },
    el('div', { class: 'estate-ico' }, icon(iconName, 26, 1.5)),
    el('b', { class: 'estate-title' }, title),
    note ? el('p', { class: 'estate-note' }, note) : null,
    action ? el('div', { style: 'margin-top:16px' }, action) : null,
  );
}

/**
 * Блок «идёт загрузка»: крутилка и текст.
 *
 * Отличается от «пусто» специально: пока крутится - ждём, перестало крутиться - значит всё.
 * Статичная надпись «Ищу…» выглядела как подвисший экран.
 */
export function loadingBox(text: string): HTMLElement {
  return el('div', { class: 'loading' }, el('i', { class: 'spinner' }), el('span', {}, text));
}

export function play(size = 15): SVGElement {
  const svg = document.createElementNS('REDACTED_ENDPOINT', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'currentColor');
  svg.innerHTML = '<path d="M7 4.5l13 7.5-13 7.5z"/>';
  return svg;
}

/** Размер в Б / КБ / МБ / ГБ. */
export function bytes(n: number): string {
  if (n < 1024) return `${n} Б`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} КБ`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} МБ`;
  return `${(n / 1024 ** 3).toFixed(2)} ГБ`;
}

/** «12 МБ из 430 МБ» или, пока идёт проверка уже скачанного, «12 из 3000 файлов»
 *  («12 из 3000 Б» вводило бы в заблуждение). */
export function progressAmount(progress: number, total: number, unit?: 'bytes' | 'files'): string {
  if (unit === 'files') return `${progress} из ${total} файлов`;
  return `${bytes(progress)} из ${bytes(total)}`;
}

/** Короткое число: 1.2M, 34K. */
export function count(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}K`;
  return String(n);
}

/**
 * Число с правильным окончанием: 1 строка, 2 строки, 5 строк.
 * Смотрим на две последние цифры: 11-14 - всегда «строк», хотя кончаются на 1-4.
 */
export function plural(n: number, one: string, few: string, many: string): string {
  const tens = n % 100;
  const ones = n % 10;
  if (tens >= 11 && tens <= 14) return `${n} ${many}`;
  if (ones === 1) return `${n} ${one}`;
  if (ones >= 2 && ones <= 4) return `${n} ${few}`;
  return `${n} ${many}`;
}

/** «только что», «5 мин назад», «3 дн назад» или дата. Принимает секунды Unix. */
export function ago(seconds: number): string {
  if (!seconds) return 'ни разу';
  const diff = Math.floor(Date.now() / 1000) - seconds;
  if (diff < 90) return 'только что';
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} дн назад`;
  return new Date(seconds * 1000).toLocaleDateString('ru-RU');
}

/** Время в игре: «3 ч 12 мин», «45 мин», «меньше минуты». */
export function playtime(seconds: number): string {
  if (seconds < 60) return 'меньше минуты';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (!hours) return `${minutes} мин`;
  return minutes ? `${hours} ч ${minutes} мин` : `${hours} ч`;
}

/**
 * Разлёт частиц из точки клика - просто украшение для кнопок.
 *
 * `fill: 'forwards'` держит частицу прозрачной до удаления: без него в конце анимации
 * она на миг снова становилась видимой точкой.
 */
export function burst(x: number, y: number, color = '#9f86ff'): void {
  const n = 10;
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n + Math.random() * 0.5;
    const dist = 40 + Math.random() * 50;
    const dur = 550 + Math.random() * 200;
    const p = el('div', {
      style: `position:fixed;left:${x}px;top:${y}px;width:6px;height:6px;border-radius:1px;`
        + `background:${color};box-shadow:0 0 6px ${color};pointer-events:none;z-index:999`,
    });
    document.body.append(p);
    p.animate(
      [
        { transform: 'translate(0,0) scale(1) rotate(0)', opacity: 1 },
        { transform: `translate(${Math.cos(angle) * dist}px,${Math.sin(angle) * dist}px) scale(0) rotate(180deg)`, opacity: 0 },
      ],
      { duration: dur, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' },
    );
    window.setTimeout(() => p.remove(), dur);
  }
}

let toastTimer = 0;

/**
 * Частые технические ошибки - человеческими словами.
 *
 * Из сети и файловой системы приходят строки вроде `fetch failed` или `EBUSY: resource busy`.
 * Они правдивы, но новичку ничего не говорят. Понятная фраза идёт первой строкой, а исходный
 * текст остаётся мелко под ней: его и нужно копировать, если спрашиваешь, что сломалось.
 */
const HUMANE: [RegExp, string][] = [
  [/ENOTFOUND|EAI_AGAIN|getaddrinfo|fetch failed|Failed to fetch|ERR_INTERNET_DISCONNECTED|network/i,
    'Нет связи с сервером. Проверь интернет и попробуй ещё раз.'],
  [/ETIMEDOUT|TimeoutError|timed? ?out|aborted due to timeout/i,
    'Сервер слишком долго не отвечает. Попробуй ещё раз чуть позже.'],
  [/ECONNRESET|ECONNREFUSED|socket hang up|other side closed/i,
    'Связь с сервером оборвалась. Попробуй ещё раз.'],
  [/EBUSY|EPERM|EACCES|operation not permitted|resource busy/i,
    'Файл занят другой программой или к нему нет доступа. Закрой игру и папку в проводнике и попробуй снова.'],
  [/ENOSPC|no space left/i, 'На диске закончилось место.'],
  [/ENOENT|no such file/i, 'Нужный файл не найден - возможно, его удалили или переместили.'],
];

function humane(message: string): { main: string; detail: string } {
  // Русский текст уже написан для человека - его показываем как есть.
  if (/[а-яё]/i.test(message)) return { main: message, detail: '' };
  const hit = HUMANE.find(([pattern]) => pattern.test(message));
  return hit ? { main: hit[1], detail: message } : { main: 'Что-то пошло не так.', detail: message };
}

/**
 * Всплывашка в правом нижнем углу. `bad` - ошибка: висит дольше, у неё значок, красная полоса
 * и кнопка «Копировать». Пока мышь над ней, она не исчезает - длинную ошибку можно дочитать.
 *
 * Раньше ошибка была полупрозрачной, как всё стекло, и ложилась прямо на кнопки: текст ошибки
 * смешивался с надписями под ним. Теперь у всплывашек плотный фон.
 */
export function toast(message: string, bad = false): void {
  document.querySelector('.toast')?.remove();
  // Длинный текст обрезаем: ошибку целиком читают в логе, а тост на несколько экранов не прочитать.
  const clipped = message.length > 600 ? message.slice(0, 600) + '…' : message;
  const { main, detail } = bad ? humane(clipped) : { main: clipped, detail: '' };

  const close = (): void => { window.clearTimeout(toastTimer); node.remove(); };
  const copy = el('button', {
    class: 'toast-act',
    title: 'Скопировать текст ошибки',
    onclick: (event: Event) => {
      event.stopPropagation();
      void navigator.clipboard.writeText(detail ? `${main}\n${detail}` : main)
        .then(() => { copy.textContent = 'Скопировано'; })
        .catch(() => { copy.textContent = 'Не вышло'; });
    },
  }, 'Копировать');

  const node = el('div', { class: bad ? 'toast bad' : 'toast', role: bad ? 'alert' : 'status' },
    bad ? el('span', { class: 'toast-ico' }, icon('alert', 18, 1.8)) : null,
    el('div', { class: 'toast-text' },
      el('div', {}, main),
      detail ? el('div', { class: 'toast-detail mono' }, detail) : null,
      bad && (detail || main.length > 60) ? copy : null,
    ),
    el('button', { class: 'toast-x', title: 'Закрыть', onclick: close }, icon('close', 11, 1.6)),
  );
  document.body.append(node);

  // Длинная ошибка висит 20 секунд, короткая - 9, обычное сообщение - 4.
  const life = bad ? (clipped.length > 200 ? 20000 : 9000) : 4000;
  const arm = (ms: number): void => {
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => node.remove(), ms);
  };
  node.addEventListener('mouseenter', () => window.clearTimeout(toastTimer));
  node.addEventListener('mouseleave', () => arm(bad ? 5000 : 2500));
  arm(life);
}

/** Загрузчики модов на экране «Новая сборка». */
export const LOADERS = [
  { id: 'fabric', name: 'Fabric', note: 'Лёгкий, быстро выходит под новые версии.' },
  { id: 'neoforge', name: 'NeoForge', note: 'Ответвление Forge, обновляется быстрее оригинала.' },
  { id: 'forge', name: 'Forge', note: 'Большие сборки и техномоды.' },
  { id: 'quilt', name: 'Quilt', note: 'Форк Fabric, совместим с большинством его модов.' },
  { id: 'vanilla', name: 'Без модов', note: 'Чистая игра. Загрузчик можно поставить позже.' },
] as const;
