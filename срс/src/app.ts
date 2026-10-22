import { mountAmbient } from './ambient.js';
import { windowButtons } from './frame.js';
import { homeScreen } from './home.js';
import { onboardingScreen } from './onboarding.js';
import { powerHome, powerSide } from './power.js';
import { friendsScreen, initSocial, leaveFriendsScreen, socialBadge } from './social.js';
import { initShare } from './share.js';
import { applyTheme, themeOf } from './themes.js';
import { applyRemote, mountSeasons } from './seasons.js';
import { showWhatsNew, unseenReleases } from './whatsnew.js';
import { api, type GameCrash, type GameLog, type InstallProgress, type State } from './api.js';
import { burst, bytes, el, icon, progressAmount, toast } from './ui.js';
import {
  accountFace, accountsScreen, contentScreen, detachLog, downloadsScreen, instanceScreen, libraryScreen,
  logsScreen, newInstanceScreen, pushLogLine, settingsScreen,
} from './screens.js';



type Route =
  | { name: 'home' }
  | { name: 'library' }
  | { name: 'new' }
  | { name: 'instance'; id: string }
  | { name: 'content' }
  | { name: 'downloads' }
  | { name: 'logs' }
  | { name: 'settings' }
  | { name: 'accounts' }
  | { name: 'friends' }
  | { name: 'dev' };


export interface Ctx {
  state: State;
  route: Route;
  go(route: Route): void;
  
  reload(): Promise<void>;
  
  progress: Map<string, InstallProgress>;
  logs: GameLog[];
  
  text(key: string, fallback?: string): string;
}

let state: State;
let route: Route = { name: 'library' };
const progress = new Map<string, InstallProgress>();

const logs: GameLog[] = [];
const LOG_LIMIT = 2000;


let unseenLogs = false;

const ctx: Ctx = {
  get state() { return state; },
  get route() { return route; },
  go(next) { route = next; render(); },
  async reload() { state = plain(await api.state()); render(); },
  progress,
  logs,
  text: (key, fallback = '') => state?.content.strings[key] ?? fallback,
};

const NAV = [
  { id: 'library', label: 'Библиотека', icon: 'library' },
  { id: 'content', label: 'Моды', icon: 'mods' },
  { id: 'friends', label: 'Друзья', icon: 'friends' },
  { id: 'downloads', label: 'Загрузки', icon: 'downloads' },
  { id: 'logs', label: 'Логи', icon: 'logs' },
  { id: 'settings', label: 'Настройки', icon: 'settings' },
];


const NAV_HOME = [
  { id: 'home', label: 'Играть', icon: 'home' },
  { id: 'library', label: 'Сборки', icon: 'library' },
  ...NAV.slice(1),
];

const isCosmos = (): boolean => themeOf(state.settings.theme).id === 'cosmos';
const isPower = (): boolean => themeOf(state.settings.theme).id === 'power';

const DEV_NAV = { id: 'dev', label: 'Дев', icon: 'bolt' };
const navItems = () => [...(isCosmos() ? NAV : NAV_HOME), ...(__DEV_BUILD__ && state.devBuild ? [DEV_NAV] : [])];

function devHost(): HTMLElement {
  const host = el('div', { style: 'display:contents' });
  if (__DEV_BUILD__) void import('./dev.js').then(({ devScreen }) => host.replaceWith(devScreen(ctx)));
  return host;
}


const runningSince = new Map<string, number>();
let playClock = 0;

function clock(since: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

function nowCard(): HTMLElement | null {
  // Запоминаем, когда впервые увидели игру запущенной; закрытые игры забываем.
  for (const id of state.running) if (!runningSince.has(id)) runningSince.set(id, Date.now());
  for (const id of [...runningSince.keys()]) if (!state.running.includes(id)) runningSince.delete(id);

  // Часы тикают только пока идёт игра: правим одну строку текста раз в секунду, без перерисовки.
  window.clearInterval(playClock);
  if (runningSince.size) {
    playClock = window.setInterval(() => {
      for (const node of document.querySelectorAll<HTMLElement>('[data-clock]')) {
        const since = runningSince.get(node.dataset.clock ?? '');
        if (since) node.textContent = clock(since);
      }
    }, 1000);
  }

  const playing = state.running[0];
  if (playing) {
    const instance = state.instances.find((i) => i.id === playing);
    return el('button', {
      class: 'now now-play',
      title: 'Открыть сборку',
      onclick: () => ctx.go({ name: 'instance', id: playing }),
    },
      el('span', { class: 'now-pulse' }),
      el('div', { class: 'now-text' },
        el('span', { class: 'now-label' }, state.running.length > 1 ? `Играешь · ещё ${state.running.length - 1}` : 'Играешь'),
        el('b', {}, instance?.name ?? 'Сборка'),
      ),
      el('span', { class: 'now-clock', 'data-clock': playing }, clock(runningSince.get(playing) ?? Date.now())),
    );
  }

  const job = [...progress.values()].find((p) => !p.done && !p.error);
  if (!job) return null;
  const instance = state.instances.find((i) => i.id === job.instanceId);
  const percent = job.total ? Math.round((job.progress / job.total) * 100) : 0;
  return el('button', { class: 'now now-load', title: 'Открыть загрузки', onclick: () => ctx.go({ name: 'downloads' }) },
    el('div', { class: 'now-row' },
      el('div', { class: 'now-text' },
        el('span', { class: 'now-label' }, job.stage),
        el('b', {}, instance?.name ?? 'Загрузка'),
      ),
      el('span', { class: 'now-clock', 'data-percent': job.instanceId }, `${percent}%`),
    ),
    el('div', { class: 'now-track' }, el('i', { 'data-bar': job.instanceId, style: `width:${percent}%` })),
  );
}

/** Пункты меню. Одни и те же для бокового меню и для вкладок сверху. */
function navButtons(): HTMLElement[] {
  const busy = [...progress.values()].filter((p) => !p.done).length;
  return navItems().map((item) => {
    // «Новая сборка» и страница сборки подсвечивают пункт библиотеки.
    const on = route.name === item.id
      || (item.id === 'library' && (route.name === 'new' || route.name === 'instance'));
    return el('button', {
      class: on ? 'on' : '',
      onclick: () => ctx.go({ name: item.id } as Route),
    },
      icon(item.icon),
      el('span', {}, item.label),
      item.id === 'downloads' && busy > 0 ? el('span', { class: 'count' }, String(busy)) : null,
      item.id === 'friends' && socialBadge() > 0 ? el('span', { class: 'count pink' }, String(socialBadge())) : null,
      item.id === 'logs' && unseenLogs && route.name !== 'logs'
        ? el('span', { class: 'dot', title: 'Есть новые строки' })
        : null,
    );
  });
}

function logo(): HTMLElement {
  return el('div', {
    class: 'mark',
    onclick: (e: Event) => {
      const m = e as MouseEvent;
      burst(m.clientX, m.clientY, '#50e7ad');
      countLogoClick();
    },
  },
    // Логотип: три вращающиеся орбиты и пульсирующее ядро (анимации - в styles.css).
    el('div', { class: 'mark-logo', html:
      '<svg viewBox="0 0 512 512" class="mark-svg" xmlns="REDACTED_ENDPOINT">'
      + '<g fill="none" stroke-width="26" stroke-linecap="round" transform="rotate(-18 256 256)">'
      + '<g class="spin-a"><ellipse cx="256" cy="256" rx="216" ry="76" stroke="#ff78bd"/></g>'
      + '<g transform="rotate(55 256 256)"><g class="spin-b"><ellipse cx="256" cy="256" rx="216" ry="76" stroke="#9f86ff"/></g></g>'
      + '<g transform="rotate(122 256 256)"><g class="spin-c"><ellipse cx="256" cy="256" rx="216" ry="76" stroke="#50e7ad"/></g></g>'
      + '</g>'
      + '<g class="mark-core"><circle cx="256" cy="256" r="30" fill="#f0edff"/><circle cx="256" cy="256" r="16" fill="#ff78bd"/></g>'
      + '</svg>',
    }),
    el('span', { class: 'mark-name' }, 'POWER LAUNCHER'),
  );
}

/**
 * Вкладки сверху - для тем «Светлая» и «Игровая». Здесь же аккаунт, карточка «Сейчас»
 * и кнопки окна: шапки экранов в этих темах их не показывают, иначе кнопки были бы дважды.
 */
function topbar(): HTMLElement {
  const account = state.accounts.find((a) => a.id === state.selectedAccount);
  return el('header', { class: 'topbar' },
    logo(),
    el('nav', { class: 'topnav' }, ...navButtons()),
    nowCard(),
    el('button', { class: 'top-acct', title: 'Аккаунты', onclick: () => ctx.go({ name: 'accounts' }) },
      accountFace(account),
      el('span', {}, account?.name ?? 'Войти'),
    ),
    windowButtons(),
  );
}

/**
 * Узкая колонка значков - тема «Power». Подписи пунктов всплывают при наведении.
 * Аккаунт и «Сейчас» здесь не нужны: на главной они справа и сверху, на остальных экранах -
 * в шапке экрана.
 */
function rail(): HTMLElement {
  const buttons = navButtons();
  // Настройки - отдельно внизу, как в большинстве лаунчеров с такой колонкой.
  const settings = buttons.pop();
  for (const button of [...buttons, settings]) {
    const label = button?.querySelector('span:not(.count):not(.dot)');
    if (label) label.className = 'tip';
  }
  return el('aside', { class: 'rail' },
    el('div', {
      class: 'rail-logo',
      onclick: (e: Event) => { const m = e as MouseEvent; burst(m.clientX, m.clientY, '#50e7ad'); countLogoClick(); },
      html: '<svg viewBox="0 0 32 32" width="34" height="34" fill="none" stroke-width="2.4">'
        + '<ellipse cx="16" cy="16" rx="13" ry="5.5" stroke="#9f86ff"/>'
        + '<ellipse cx="16" cy="16" rx="13" ry="5.5" stroke="#ff7ab8" transform="rotate(60 16 16)"/>'
        + '<ellipse cx="16" cy="16" rx="13" ry="5.5" stroke="#50e7ad" transform="rotate(120 16 16)"/>'
        + '<circle cx="16" cy="16" r="2.6" fill="#fff" stroke="none"/></svg>',
    }),
    el('nav', { class: 'rail-nav' }, ...buttons),
    el('div', { class: 'rail-gap' }),
    settings ?? null,
  );
}

/** Левая панель: логотип, меню и выбранный аккаунт внизу. В темах с вкладками - верхняя полоса. */
function sidebar(): HTMLElement {
  const layout = themeOf(state.settings.theme).layout;
  if (layout === 'top') return topbar();
  if (layout === 'rail') return rail();
  const account = state.accounts.find((a) => a.id === state.selectedAccount);

  return el('aside', { class: 'side' },
    logo(),
    el('nav', { class: 'nav' }, ...navButtons()),
    nowCard(),
    el('button', { class: 'acct', onclick: () => ctx.go({ name: 'accounts' }) },
      // Первая буква ника вместо пустого квадрата: так строка аккаунта читается как «ты вошёл
      // вот этим человеком», а не как заглушка, которую забыли дорисовать.
      accountFace(account),
      el('div', { style: 'min-width:0;flex:1' },
        el('b', {}, account?.name ?? 'Нет аккаунта'),
        el('span', {}, account
          ? (account.kind === 'microsoft' ? 'Microsoft · лицензия' : 'Офлайн')
          : 'нажми, чтобы добавить'),
      ),
    ),
  );
}

/** Экран для текущего маршрута. */
function screen(): HTMLElement {
  // Уходим с экрана логов - отключаем живую ленту, её DOM сейчас будет выброшен.
  if (route.name !== 'logs') detachLog();
  if (route.name !== 'friends') leaveFriendsScreen();
  switch (route.name) {
    case 'logs': unseenLogs = false; return logsScreen(ctx);
    case 'new': return newInstanceScreen(ctx);
    case 'instance': return instanceScreen(ctx, route.id);
    case 'content': return contentScreen(ctx);
    case 'downloads': return downloadsScreen(ctx);
    case 'settings': return settingsScreen(ctx);
    case 'dev': return __DEV_BUILD__ && state.devBuild ? devHost() : settingsScreen(ctx);
    case 'accounts': return accountsScreen(ctx);
    case 'friends': return friendsScreen(state.accounts.find((a) => a.id === state.selectedAccount));
    case 'home':
      if (isCosmos()) return libraryScreen(ctx);
      return isPower() ? powerHome(ctx, nowCard()) : homeScreen(ctx);
    default: return libraryScreen(ctx);
  }
}

let root: HTMLElement;
/** Экран, который уже показан. Анимация входа - только при переходе на другой экран. */
let shownRoute = '';

/** Полная перерисовка окна. */
function render(): void {
  document.body.classList.toggle('lite', state.settings.liteMode);
  applyTheme(state.settings.theme);
  // У «Космоса» главной нет: тема сменилась на него, пока были на главной - уходим в библиотеку.
  if (route.name === 'home' && isCosmos()) route = { name: 'library' };
  // Первый запуск (onboarding.ts): нет аккаунта или ещё не выбрали тему. Показываем его вместо
  // всего окна: без аккаунта играть нельзя, а меню и пустая библиотека новичку ничего не объясняют.
  //
  // Исключение - «Настройки» и «Аккаунты»: раньше приветствие было ловушкой. Удалил человек
  // единственный аккаунт - и всё окно подменялось приветствием, откуда не попасть ни в папку
  // лаунчера, ни в управление аккаунтами. Теперь на эти два экрана уйти можно, а с любого
  // другого нас честно возвращает к приветствию: играть-то всё равно не с кем.
  const firstRun = !state.accounts.length || !state.settings.onboarded;
  if (firstRun && route.name !== 'settings' && route.name !== 'accounts') {
    document.querySelectorAll('.vmenu, .iselect-list').forEach((node) => node.remove());
    root.replaceChildren(el('div', { class: 'app app-solo' }, onboardingScreen(ctx)));
    shownRoute = 'welcome';
    return;
  }

  // Меню висят на body, а кнопки, к которым они привязаны, перерисовка сейчас заменит.
  // Без этого меню оставалось бы висеть над новым экраном, привязанное к уже несуществующей кнопке.
  document.querySelectorAll('.vmenu, .iselect-list').forEach((node) => node.remove());

  const view = screen();
  // Обычная перерисовка (прогресс, reload) не должна каждый раз заново «въезжать».
  const key = route.name === 'instance' ? `instance:${route.id}` : route.name;
  if (key !== shownRoute) {
    view.classList.add('screen-enter');
    shownRoute = key;
    // Класс снимаем сами, а не ждём конца анимации: пока окно перекрыто, Chromium ставит анимации
    // на паузу, и строки списка оставались бы прозрачными. Позже добавленные строки тоже не должны
    // «въезжать» заново при каждой перерисовке списка.
    window.setTimeout(() => view.classList.remove('screen-enter'), 900);
  }
  const layout = themeOf(state.settings.theme).layout;
  // У «Power» на главной справа своя колонка: игрок и друзья.
  const side = layout === 'rail' && route.name === 'home' ? powerSide(ctx) : null;
  // На главной «Игровой» пейзаж - и есть экран, поэтому шапка и панели там прозрачные.
  const cls = `app${layout === 'top' ? ' app-top' : ''}${layout === 'rail' ? ' app-rail' : ''}`
    + `${side ? ' with-side' : ''}${route.name === 'home' ? ' app-home' : ''}`;
  root.replaceChildren(el('div', { class: cls }, sidebar(), view, side));
}

/*
 * Пасхалка: четыре быстрых клика по логотипу показывают мем с котом Степаном, Esc или клик
 * закрывают. Фото лежит в src/public/stepan.jpg: исходник 252×200 увеличен в 4 раза нейросетью
 * Real-ESRGAN, иначе на весь экран он был бы мыльным. Старая easter.png больше не показывается.
 */
let logoClicks = 0;
let logoClickTimer: number | undefined;

function countLogoClick(): void {
  logoClicks += 1;
  window.clearTimeout(logoClickTimer);
  // Паузу больше секунды между кликами считаем новой серией, чтобы обычные клики не копились.
  logoClickTimer = window.setTimeout(() => { logoClicks = 0; }, 1000);
  if (logoClicks >= 4) {
    logoClicks = 0;
    showEaster();
  }
}

/** Подписи в духе мемов: верх и низ. Каждый раз случайная пара. */
const CAT_MEMES: [string, string][] = [
  ['Ты кликнул 4 раза', 'Степан это видел'],
  ['Игра вылетела?', 'Степан тут ни при чём'],
  ['Ещё один мод', 'и точно всё заработает'],
  ['400 модов', 'загрузились за 4 секунды'],
  ['Лаунчер в трее', 'Степан на страже'],
  ['Java обновлена', 'Степан одобряет'],
];

function showEaster(): void {
  if (document.querySelector('.easter-backdrop')) return;

  const close = () => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  };
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };

  const [top, bottom] = CAT_MEMES[Math.floor(Math.random() * CAT_MEMES.length)]!;
  const backdrop = el('div', { class: 'easter-backdrop', onclick: close },
    el('div', { class: 'cat-card' },
      el('img', { class: 'cat-photo', src: './stepan.jpg', alt: 'Кот Степан' }),
      el('div', { class: 'cat-meme cat-top' }, top),
      el('div', { class: 'cat-meme cat-bottom' }, bottom),
    ),
  );
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
}

/** Окно «Ой»: что сломалось при вылете игры и кнопки автоисправления. */
function showCrash(report: GameCrash): void {
  document.querySelector('.crash-backdrop')?.remove();

  // Esc закрывает окно, как и любое другое окно лаунчера. Слушатель снимаем вместе с окном.
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
  const close = () => { document.removeEventListener('keydown', onKey); backdrop.remove(); };
  document.addEventListener('keydown', onKey);

  const runAutofix = (button: HTMLButtonElement, autofix: GameCrash['autofixes'][number]) => {
    void (async () => {
      button.disabled = true;
      try {
        if (autofix.kind === 'update') {
          const result = await api.crashAutofixUpdate(report.instanceId, autofix.nameHints);
          if (!result) { toast('Свежей версии на Modrinth не нашлось - попробуй отключить мод', true); return; }
          toast(`Обновил «${result.file}»: ${result.from} → ${result.to}, запускаю снова`);
        } else {
          const disabled = await api.crashAutofixDisable(report.instanceId, autofix.nameHints);
          if (!disabled) { toast('Не нашёл подходящий мод - отключи вручную во вкладке Моды', true); return; }
          toast(`Отключил «${disabled}», запускаю снова`);
        }
        close();
        await api.launchStart(report.instanceId);
      } catch (error) {
        toast(error instanceof Error ? error.message : String(error), true);
      } finally {
        button.disabled = false;
      }
    })();
  };

  const fixButtons = report.autofixes.map((autofix) => {
    const button = el('button', { class: autofix.kind === 'update' ? 'btn btn-main btn-s' : 'btn btn-ghost btn-s' }, autofix.label);
    button.addEventListener('click', () => runAutofix(button, autofix));
    return button;
  });

  // Пункты «что делать»: нужны как раз тогда, когда кнопки-исправления не нашлись,
  // то есть в самом частом случае - непонятный вылет.
  const steps = report.steps?.length
    ? el('ol', { class: 'crash-steps' }, ...report.steps.map((step) => el('li', {}, step)))
    : null;

  // Кнопка, которая помогает всегда: скопировать отчёт и отправить тому, кто разберётся.
  const copyButton = el('button', {
    class: 'btn btn-ghost btn-s',
    onclick: () => void (async () => {
      try {
        await api.copyText(report.details);
        toast('Отчёт скопирован - можно вставить в чат');
      } catch {
        toast('Не получилось скопировать', true);
      }
    })(),
  }, 'Скопировать отчёт');

  // Клик по затемнению (мимо карточки) закрывает окно.
  // Кнопки в два ряда смыслов: слева то, что помогает разобраться, справа «Закрыть».
  // Раньше все шесть кнопок шли одной строкой и переносились как попало, «Закрыть» терялась посередине.
  const backdrop = el('div', { class: 'crash-backdrop', onclick: (event: Event) => { if (event.target === backdrop) close(); } },
    el('div', { class: 'crash-card crash-wide' },
      el('div', { class: 'crash-head' },
        el('div', { class: 'crash-ico' }, icon('alert', 22, 1.8)),
        el('div', { style: 'min-width:0' },
          el('p', { class: 'eyebrow' }, 'Игра закрылась'),
          el('h2', { class: 'crash-title' }, report.title),
        ),
      ),
      el('p', { class: 'crash-summary' }, report.summary),
      steps,
      fixButtons.length ? el('div', { class: 'crash-fixes' }, ...fixButtons) : null,
      el('div', { class: 'crash-actions' },
        el('div', { class: 'crash-actions-left' },
          el('button', {
            class: 'btn btn-ghost btn-s',
            onclick: () => { close(); ctx.go({ name: 'logs' }); },
          }, 'Открыть логи'),
          copyButton,
          report.reportPath
            ? el('button', {
                class: 'btn btn-ghost btn-s',
                onclick: () => void api.showCrashReport(report.reportPath as string)
                  .catch(() => toast('Не получилось открыть папку с отчётом', true)),
              }, 'Файл отчёта')
            : null,
        ),
        el('button', { class: 'btn btn-s', onclick: close }, 'Закрыть'),
      ),
      el('details', {},
        el('summary', {}, 'Подробности'),
        el('pre', {}, report.details),
      ),
    ),
  );
  document.body.append(backdrop);
}

/**
 * Новости и подсказки с сайта без длинных тире: в лаунчере их нет нигде, и текст с сайта
 * не должен выбиваться. Сам сайт не трогаем, меняем только то, что показываем.
 */
function plain(next: State): State {
  const dashless = (text: string): string => text.replace(/[--]/g, '-');
  const content = next.content;
  return {
    ...next,
    content: {
      ...content,
      strings: Object.fromEntries(Object.entries(content.strings).map(([key, value]) => [key, dashless(value)])),
      news: content.news.map((item) => ({ ...item, title: dashless(item.title), body: dashless(item.body) })),
    },
  };
}

/** Старт интерфейса: первое состояние, первая отрисовка и все подписки. */
async function boot(): Promise<void> {
  root = document.getElementById('app') as HTMLElement;
  // Окно без фокуса - фон замирает (см. .idle в styles.css и ambient.ts). Чаще всего это значит,
  // что человек в игре, и видеокарта нужна ей, а не переливам лаунчера за её окном.
  const idle = (): void => { document.body.classList.toggle('idle', !document.hasFocus()); };
  window.addEventListener('blur', idle);
  window.addEventListener('focus', idle);
  idle();
  mountAmbient();
  mountSeasons();
  // Ctrl+1...6 - пункты меню по порядку, как вкладки в браузере.
  document.addEventListener('keydown', (event) => {
    if (!event.ctrlKey || event.altKey || event.shiftKey || !/^[1-9]$/.test(event.key)) return;
    const item = navItems()[Number(event.key) - 1];
    if (!item || !state || !state.accounts.length || !state.settings.onboarded) return;
    event.preventDefault();
    ctx.go({ name: item.id } as Route);
  });
  // Файл, брошенный мимо зоны сборки, Electron открыл бы прямо в окне вместо интерфейса.
  for (const type of ['dragover', 'drop']) document.addEventListener(type, (event) => event.preventDefault());
  state = plain(await api.state());
  applyRemote(state.content.strings);
  // В новых темах лаунчер открывается на главной «Играть», в «Космосе» - как раньше, в библиотеке.
  if (!isCosmos()) route = { name: 'home' };
  render();

  // «Что нового» - один раз на версию. Новичку (аккаунтов ещё нет) не показываем: ему не с чем
  // сравнивать, и окно легло бы поверх приветствия. Поверх первого запуска тоже: он и есть
  // главная новинка, а два окна подряд - перебор. Версию отмечаем сразу, даже если окно
  // закроют по Esc, иначе оно вылезало бы при каждом запуске.
  if (state.version && state.settings.seenVersion !== state.version) {
    if (state.accounts.length && state.settings.onboarded) showWhatsNew(state.version, unseenReleases(state.settings.seenVersion, state.version));
    void api.saveSettings({ seenVersion: state.version }).catch(() => undefined);
  }

  // Склеивает пачку событий в одну перерисовку за кадр. Нужна только для смены стадий (см. ниже) -
  // обычное движение байтов до неё не доходит.
  let sideQueued = false;
  const queueSide = (): void => {
    if (sideQueued) return;
    sideQueued = true;
    requestAnimationFrame(() => {
      sideQueued = false;
      document.querySelector('.side, .topbar, .rail')?.replaceWith(sidebar());
    });
  };
  let renderQueued = false;
  const queueRender = (): void => {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  };

  api.onInstallProgress((p) => {
    const previous = progress.get(p.instanceId);
    progress.set(p.instanceId, p);
    if (p.error) {
      toast(p.error, true);
      // И в лог: тост исчезнет, а этот текст как раз и нужно скопировать, спрашивая, почему не ставится.
      addLog({ instanceId: p.instanceId, line: p.error, level: 'err' });
    } else if (p.stage !== previous?.stage) {
      addLog({ instanceId: p.instanceId, line: p.stage, level: 'status' });
    }

    // Полная перерисовка пересоздаёт все плитки и перезапускает все CSS-анимации - при нескольких
    // перерисовках в секунду окно «трясётся» и теряет клики. Движение байтов - самое частое
    // событие, поэтому просто правим ширину бара и цифры на месте (элементы с data-bar/-percent/
    // -bytes/-speed). Полностью перерисовываем только при смене стадии, старте или завершении.
    const percent = p.total ? Math.round((p.progress / p.total) * 100) : 0;
    const bars = document.querySelectorAll<HTMLElement>(`[data-bar="${p.instanceId}"]`);
    const percents = document.querySelectorAll<HTMLElement>(`[data-percent="${p.instanceId}"]`);
    const byteEls = document.querySelectorAll<HTMLElement>(`[data-bytes="${p.instanceId}"]`);
    const speedEls = document.querySelectorAll<HTMLElement>(`[data-speed="${p.instanceId}"]`);
    for (const bar of bars) bar.style.width = `${percent}%`;
    for (const el_ of percents) el_.textContent = `${percent}%`;
    for (const el_ of byteEls) el_.textContent = progressAmount(p.progress, p.total, p.unit);
    for (const el_ of speedEls) el_.textContent = `${bytes(p.bytesPerSecond)}/с`;

    const needsFullRender = p.error || p.done !== previous?.done || p.stage !== previous?.stage || !bars.length;
    if (needsFullRender && (route.name === 'downloads' || route.name === 'library' || route.name === 'home')) queueRender();
    // На других экранах меняем только боковое меню с карточкой «Сейчас»: полная перерисовка
    // сбросила бы, например, недописанное поле в настройках.
    else if (needsFullRender) queueSide();
  });

  const addLog = (entry: GameLog): void => {
    logs.push(entry);
    if (route.name === 'logs') pushLogLine(entry);
    else unseenLogs = true;
    if (logs.length > LOG_LIMIT) logs.splice(0, logs.length - LOG_LIMIT);
  };

  api.onGameLog((line) => {
    // Один кусок вывода игры обычно содержит несколько строк. Делим, чтобы фильтровать,
    // красить и считать их по отдельности.
    for (const text of line.line.split(/\r?\n/)) {
      if (text.trim()) addLog({ ...line, line: text });
    }
    // Главный процесс не сообщает отдельно о закрытии игры - ловим строку из launch.ts,
    // иначе кнопка так и показывала бы «ЗАПУЩЕНА».
    if (line.level === 'status' && line.line.startsWith('Игра закрылась')) void ctx.reload();
  });

  api.onGameCrash((report) => showCrash(report));

  // Друзья обновляются раз в 20 секунд - меняем только число на пункте «Друзья» и значок
  // в шапке «Power», а не всё окно: иначе раз в 20 секунд сбрасывалось бы всё, что набрано.
  initShare(ctx);
  initSocial(() => {
    queueSide();
    const count = socialBadge();
    for (const badge of document.querySelectorAll<HTMLElement>('[data-social-badge]')) {
      badge.textContent = String(count);
      badge.hidden = !count;
    }
  });

  api.onContent((content) => {
    state = plain({ ...state, content });
    applyRemote(content.strings);
    render();
  });

  // Тост о скачивании обновления лаунчера («нет обновлений» не показываем).
  let updateToast: HTMLElement | null = null;
  api.onLauncherUpdate((update) => {
    if (update.status === 'checking' || update.status === 'none') return;
    // Скачалось или сорвалось - тост загрузки больше не нужен. Раньше эти события не приходили,
    // и «Скачиваю обновление… 100%» висел в углу до самого перезапуска.
    if (update.status === 'downloaded' || update.status === 'error') {
      updateToast?.remove();
      updateToast = null;
      return;
    }
    const text = update.status === 'available'
      ? `Найдено обновление лаунчера ${update.version}, скачиваю…`
      : `Скачиваю обновление лаунчера… ${update.percent}%`;
    // Прогресс приходит много раз в секунду - меняем текст на месте, а не пересоздаём тост с анимацией.
    if (updateToast?.isConnected) { updateToast.textContent = text; return; }
    updateToast = el('div', { class: 'toast' }, text);
    document.body.append(updateToast);
  });
}

void boot().catch((error: unknown) => {
  document.body.append(el('div', { class: 'toast bad' },
    error instanceof Error ? error.message : String(error)));
});
