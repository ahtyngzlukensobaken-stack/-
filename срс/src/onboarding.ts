import { api } from './api.js';
import type { Ctx } from './app.js';
import { windowButtons } from './frame.js';
import { accountFace, guard } from './screens.js';
import { applyTheme, THEMES, themeOf, type ThemeId } from './themes.js';
import { el, icon, toast } from './ui.js';
import { devPrank, isDevName } from './prank.js';



type Step = 'account' | 'hello' | 'theme';


let step: Step = 'account';

let picked: ThemeId | null = null;

let typedNick = '';
let shownStep: Step | null = null;


const NICK = /^[A-Za-z0-9_]{3,16}$/;

function nickProblem(nick: string): string {
  if (NICK.test(nick)) return '';
  if (nick.length < 3) return 'минимум 3 символа';
  if (nick.length > 16) return 'не длиннее 16 символов';
  return 'только латиница, цифры и _';
}

function steps(current: Step): HTMLElement {
  const order: [Step, string][] = [['account', 'Аккаунт'], ['hello', 'Знакомство'], ['theme', 'Тема']];
  const index = order.findIndex(([id]) => id === current);
  return el('div', { class: 'ob-steps' },
    ...order.map(([, label], i) =>
      el('div', { class: i < index ? 'ob-done' : i === index ? 'ob-now' : '' }, el('i', {}), label)),
  );
}


async function signedIn(ctx: Ctx): Promise<void> {
  if (!ctx.state.settings.onboarded) step = 'hello';
  await ctx.reload();
}

function accountStep(ctx: Ctx): HTMLElement[] {
  const account = ctx.state.accounts.find((a) => a.id === ctx.state.selectedAccount) ?? ctx.state.accounts[0];

  const nick = el('input', { placeholder: 'Ник в игре', maxlength: 16, spellcheck: 'false' }) as HTMLInputElement;
  const verdict = el('small', {});
  const offline = el('button', { class: 'btn btn-ghost ob-btn' }, 'Играть с этим ником') as HTMLButtonElement;
  const check = (): void => {
    const problem = nick.value ? nickProblem(nick.value) : '';
    verdict.textContent = nick.value ? problem || 'подходит' : '';
    verdict.classList.toggle('bad', Boolean(problem));
    offline.disabled = !nick.value || Boolean(problem);
  };
  nick.value = typedNick;
  nick.addEventListener('input', () => { typedNick = nick.value; check(); });
  check();
  const addOffline = (): void => {
    if (offline.disabled) { nick.focus(); return; }
    if (isDevName(nick.value)) { devPrank(); return; }
    offline.disabled = true;
    void guard(async () => {
      await api.addOffline(nick.value.trim());
      await signedIn(ctx);
    }, () => { offline.disabled = false; });
  };
  offline.addEventListener('click', addOffline);
  nick.addEventListener('keydown', (event) => { if ((event as KeyboardEvent).key === 'Enter') addOffline(); });

  const microsoft = el('button', { class: 'btn btn-main ob-btn' }, 'Войти через Microsoft') as HTMLButtonElement;
  microsoft.addEventListener('click', () => {
    microsoft.disabled = true;
    void guard(async () => {
      await api.signInMicrosoft();
      toast('Вошли');
      await signedIn(ctx);
    }, () => { microsoft.disabled = false; });
  });

  return [
    el('div', { class: 'ob-logo', html:
      '<svg viewBox="0 0 512 512"><g fill="none" stroke-width="30" stroke-linecap="round" transform="rotate(-18 256 256)">'
      + '<ellipse cx="256" cy="256" rx="216" ry="76" stroke="#ff78bd"/><ellipse cx="256" cy="256" rx="216" ry="76" stroke="#9f86ff" transform="rotate(55 256 256)"/>'
      + '<ellipse cx="256" cy="256" rx="216" ry="76" stroke="#50e7ad" transform="rotate(122 256 256)"/></g>'
      + '<circle cx="256" cy="256" r="34" fill="#f0edff"/><circle cx="256" cy="256" r="18" fill="#ff78bd"/></svg>' }),
    el('h1', { class: 'ob-title' }, 'Добро пожаловать в Power Launcher'),
    el('p', { class: 'ob-lead' }, 'Чтобы играть, нужен аккаунт. Выбери, как тебе удобнее.'),
    el('div', { class: 'ob-two ob-st', style: '--b:260ms' },
      el('div', { class: 'ob-opt' },
        el('div', { class: 'ob-ico ob-ico-key' }, icon('lock', 22, 1.7)),
        el('b', {}, 'Есть лицензия Minecraft'),
        el('p', {}, 'Вход через Microsoft. Официальные серверы, твой скин и плащи. Пароль вводится '
          + 'на сайте Microsoft, лаунчер его не видит.'),
        microsoft,
      ),
      el('div', { class: 'ob-opt' },
        el('div', { class: 'ob-ico ob-ico-user' }, icon('user', 22, 1.7)),
        el('b', {}, 'Играть без лицензии'),
        el('p', {}, 'Просто придумай ник. Подходит для одиночной игры и серверов без проверки лицензии.'),
        el('label', { class: 'ob-field' }, nick, verdict),
        offline,
      ),
    ),
    account
      ? el('div', { class: 'ob-have' },
          accountFace(account),
          el('span', {}, 'Ты уже входил раньше как ', el('b', {}, account.name)),
          el('button', { class: 'btn btn-main btn-s', onclick: () => { step = 'hello'; ctx.go(ctx.route); } }, 'Продолжить'),
        )
      
      : el('div', { class: 'ob-links' },
          el('button', { class: 'linkish', onclick: () => ctx.go({ name: 'accounts' }) }, 'Все аккаунты'),
          el('button', { class: 'linkish', onclick: () => ctx.go({ name: 'settings' }) }, 'Настройки'),
        ),
  ];
}

function helloStep(ctx: Ctx): HTMLElement[] {
  const account = ctx.state.accounts.find((a) => a.id === ctx.state.selectedAccount) ?? ctx.state.accounts[0];
  
  const java = el('span', {}, icon('check', 14, 2.4), 'Аккаунт готов');
  const javaChip = el('span', {}, icon('java', 14, 1.8), 'Проверяю Java…');
  const folderChip = el('span', {}, icon('folder', 14, 1.8), 'Папка лаунчера…');
  void api.newestJava().then((major) => {
    javaChip.replaceChildren(icon('check', 14, 2.4), major ? `Java ${major} на месте` : 'Java скачается сама');
  }).catch(() => javaChip.remove());
  void api.dataInfo().then((info) => {
    folderChip.replaceChildren(icon('check', 14, 2.4), `Папка: ${info.path}`);
  }).catch(() => folderChip.remove());

  return [
    el('div', { class: 'ob-ring' }, el('div', { class: 'ob-face' }, accountFace(account))),
    el('h1', { class: 'ob-wave' }, 'Привет, ', el('span', { class: 'ob-nick' }, account?.name ?? 'игрок'), '! ',
      el('span', { class: 'ob-hand' }, '👋')),
    el('p', { class: 'ob-lead ob-lead-big' }, 'Давай настроим всё по твоему вкусу. Это займёт полминуты.'),
    el('div', { class: 'ob-chips ob-st', style: '--b:420ms' }, java, javaChip, folderChip),
    el('div', { class: 'ob-pair' },
      el('button', { class: 'btn btn-main ob-btn', onclick: () => { step = 'theme'; ctx.go(ctx.route); } }, 'Давай!'),
      el('button', { class: 'btn btn-ghost ob-btn', onclick: (event: Event) => finish(ctx, event, themeOf(ctx.state.settings.theme).id) }, 'Пропустить'),
    ),
  ];
}

function themeStep(ctx: Ctx, screen: () => HTMLElement): HTMLElement[] {
  const current = picked ?? themeOf(ctx.state.settings.theme).id;
  const cards = THEMES.map((theme) => {
    const card = el('button', {
      class: theme.id === current ? 'ob-theme on' : 'ob-theme',
      style: `--acc:${theme.accent}`,
      onclick: () => {
        picked = theme.id;
        for (const other of cards) other.classList.toggle('on', other === card);
        screen().style.setProperty('--acc', theme.accent);
      },
    },
      el('span', { class: 'ob-check' }, icon('check', 15, 2.6)),
      el('span', { class: 'ob-shot' }, el('img', { src: `./themes/${theme.id}.jpg`, alt: '' })),
      el('b', {}, theme.name),
      el('span', { class: 'ob-note' }, theme.note),
    );
    return card;
  });
  return [
    el('h1', { class: 'ob-title' }, 'Как будет выглядеть лаунчер?'),
    el('p', { class: 'ob-lead' }, 'Выбери тему. Поменять можно в любой момент в настройках.'),
    el('div', { class: 'ob-themes ob-st', style: '--b:180ms' }, ...cards),
    el('div', { class: 'ob-foot' },
      el('small', {}, 'Для слабых компьютеров: «Лёгкий режим» в настройках', el('br'), 'выключает анимации в любой теме.'),
      el('button', { class: 'btn btn-ghost ob-btn', style: 'margin-left:auto', onclick: () => { step = 'hello'; ctx.go(ctx.route); } }, 'Назад'),
      el('button', { class: 'btn btn-main ob-btn', onclick: (event: Event) => finish(ctx, event, picked ?? current) }, 'Готово, поехали'),
    ),
  ];
}

/**
 * Конец первого запуска: круг цвета выбранной темы раскрывается от кнопки на весь окно,
 * под ним тема включается, и круг тает. Без перехода смена темы выглядела бы как мигание.
 */
function finish(ctx: Ctx, event: Event, themeId: ThemeId): void {
  const button = event.currentTarget as HTMLButtonElement;
  button.disabled = true;
  const theme = themeOf(themeId);
  const mouse = event as MouseEvent;
  const wipe = el('div', { class: 'ob-wipe', style: `background:${theme.background};--x:${mouse.clientX}px;--y:${mouse.clientY}px` });
  document.body.append(wipe);
  requestAnimationFrame(() => wipe.classList.add('go'));
  const still = document.body.classList.contains('lite') || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.setTimeout(() => void guard(async () => {
    await api.saveSettings({ theme: theme.id, onboarded: true });
    applyTheme(theme.id);
    step = 'account';
    picked = null;
    typedNick = '';
    await ctx.reload();
    ctx.go({ name: theme.id === 'cosmos' ? 'library' : 'home' });
    wipe.classList.add('out');
    window.setTimeout(() => wipe.remove(), 500);
  }, () => { button.disabled = false; window.setTimeout(() => wipe.remove(), 600); }), still ? 0 : 700);
}

export function onboardingScreen(ctx: Ctx): HTMLElement {
  // Без аккаунта дальше первого шага идти некуда.
  if (!ctx.state.accounts.length) step = 'account';
  const screen = el('main', { class: `ob ob-${step}${shownStep === step ? '' : ' ob-anim'}` });
  shownStep = step;
  const accent = step === 'theme' ? themeOf(picked ?? ctx.state.settings.theme).accent : '#8f7bff';
  screen.style.setProperty('--acc', accent);
  const content = step === 'account' ? accountStep(ctx)
    : step === 'hello' ? helloStep(ctx)
      : themeStep(ctx, () => screen);
  screen.append(
    el('div', { class: 'ob-blob ob-blob-1' }),
    el('div', { class: 'ob-blob ob-blob-2' }),
    // Своя шапка: у окна нет системной рамки, без неё лаунчер нельзя было бы ни сдвинуть, ни закрыть.
    el('header', { class: 'ob-top' }, steps(step), windowButtons()),
    el('div', { class: 'ob-in-wrap' }, el('div', { class: `ob-in ob-st ob-in-${step}` }, ...content)),
  );
  return screen;
}
