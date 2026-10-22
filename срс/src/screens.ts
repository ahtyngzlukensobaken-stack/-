import { bugfixOnPlay, scareOnPlay, seasonsSetting } from './seasons.js';
import {
  api, type ContentVersion, type GameLog, type GameVersion, type Instance, type JavaInfo, type Kind,
  type FoundInstance, type Identified, type LoaderVersion, type ModUpdate, type ModFile, type ModHit, type Screenshot, type SkinFile, type SkinModel,
  type World,
} from './api.js';
import type { Ctx } from './app.js';
import { frame } from './frame.js';
import { showWhatsNew } from './whatsnew.js';
import { codeImportButton, shareDialog } from './share.js';
import { devPrank, isDevName } from './prank.js';
import { chatSound, shareTargets } from './social.js';
import { listDevices, micTest, setInput, setNoise, setOutput, voiceSettings, type VoiceDevices } from './voice.js';
import type { NoiseMode } from './denoise.js';
import { forgetSkin3d } from './skin3d.js';
import { applyTheme, instanceArt, THEMES, themeOf } from './themes.js';
import { ago, burst, bytes, count, el, emptyState, icon, loadingBox, LOADERS, modal, play, playtime, plural, progressAmount, toast } from './ui.js';



const loaderName = (id: string) => LOADERS.find((l) => l.id === id)?.name ?? id;

export function describe(instance: Instance): string {
  return instance.loader === 'vanilla'
    ? `${instance.minecraft} · без модов`
    : `${instance.minecraft} · ${loaderName(instance.loader)} ${instance.loaderVersion}`;
}

/** Выполняет действие и показывает ошибку тостом вместо необработанного исключения. */
export async function guard(action: () => Promise<unknown>, always?: () => void): Promise<void> {
  try {
    await action();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), true);
  } finally {
    // Вернуть кнопку в рабочий вид нужно и после ошибки: иначе она навсегда остаётся
    // с надписью «Копирую…» и выключенной.
    always?.();
  }
}

/** Четыре вида контента в том порядке, в каком они идут вкладками. */
const KINDS: { id: Kind; label: string; many: string }[] = [
  { id: 'mod', label: 'Моды', many: 'модов' },
  { id: 'resourcepack', label: 'Ресурс-паки', many: 'ресурс-паков' },
  { id: 'datapack', label: 'Датапаки', many: 'датапаков' },
  { id: 'shader', label: 'Шейдеры', many: 'шейдеров' },
];

const kindLabel = (kind: Kind) => KINDS.find((k) => k.id === kind)?.label ?? kind;
const kindMany = (kind: Kind) => KINDS.find((k) => k.id === kind)?.many ?? '';

/** Ряд вкладок с необязательными счётчиками; `trailing` - элементы справа от вкладок. */
function tabRow(
  items: { id: string; label: string; count?: number }[],
  current: string,
  pick: (id: string) => void,
  ...trailing: (Node | null)[]
): HTMLElement {
  return el('div', { class: 'tabs' },
    ...items.map((item) =>
      el('button', { class: item.id === current ? 'on' : '', onclick: () => pick(item.id) },
        item.label,
        item.count === undefined ? null : el('span', { class: 'tab-count' }, String(item.count)),
      )),
    ...trailing.filter((node): node is Node => Boolean(node)),
  );
}

/**
 * Всплывающее меню под кнопкой. Возвращает функцию закрытия.
 *
 * Меню кладётся прямо в <body> с `position: fixed`. Внутри экрана нельзя: у `.main` стоит
 * `overflow: hidden` (чтобы длинные списки прокручивались), и он молча обрезал бы меню у края.
 * Закрывается кликом мимо меню и при изменении размера окна.
 */
function popup(anchor: HTMLElement, build: (close: () => void) => HTMLElement, width = 400): () => void {
  let node: HTMLElement | null = null;
  const close = (): void => {
    node?.remove();
    node = null;
    anchor.classList.remove('on');
    document.removeEventListener('mousedown', onOutside);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', close);
  };
  const onOutside = (event: MouseEvent): void => {
    if (!anchor.contains(event.target as Node) && !node?.contains(event.target as Node)) close();
  };
  // Esc закрывает меню, как и любое окно лаунчера. Раньше для этого надо было кликнуть мимо.
  const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close(); };
  const rect = anchor.getBoundingClientRect();
  node = build(close);
  node.classList.add('vmenu');
  // Если снизу меньше 300px, открываем меню над кнопкой, иначе оно уйдёт за край окна.
  const below = window.innerHeight - rect.bottom > 300;
  node.style.position = 'fixed';
  node.style.width = `${width}px`;
  node.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
  if (below) node.style.top = `${rect.bottom + 8}px`;
  else node.style.bottom = `${window.innerHeight - rect.top + 8}px`;
  document.body.append(node);
  anchor.classList.add('on');
  document.addEventListener('mousedown', onOutside);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', close);
  return close;
}

/**
 * Заполняет меню версий только теми версиями, которые реально запустятся.
 *
 * У проекта есть все когда-либо выпущенные версии, в основном под другие версии игры (у Sodium -
 * вплоть до 1.14). Один неосторожный клик - и игра падает с "Incompatible mods found!",
 * поэтому неподходящие версии вообще не показываем.
 */
function fillVersionList(
  box: HTMLElement,
  all: ContentVersion[],
  currentId: string | null,
  pick: (version: ContentVersion) => void,
): void {
  const fitting = all.filter((v) => v.fits);
  if (!fitting.length) {
    box.className = '';
    box.replaceChildren(el('div', { class: 'empty', style: 'padding:22px;font-size:13px' },
      'Под эту сборку версий нет.'));
    return;
  }

  box.className = 'vmenu-list';
  box.replaceChildren(...fitting.map((version) =>
    el('button', {
      class: version.id === currentId ? 'on' : '',
      onclick: () => pick(version),
    },
      el('i', {
        class: 'dot',
        style: `background:var(--${version.channel === 'release' ? 'aurora' : 'cosmic'})`,
      }),
      el('span', { class: 'mono vmenu-ver' }, version.label),
      el('span', { class: 'vmenu-note', title: version.note }, version.note),
      el('span', { class: 'mono vmenu-date' }, version.date),
    )));
}

/**
 * Выпадающий выбор сборки в шапке экрана «Контент» (свой, вместо <select> - причина у места вызова).
 * Список, как и popup(), кладётся в <body> с `position: fixed`, чтобы его не обрезал `.main`.
 */
export function instancePicker(ctx: Ctx, selectedId: string | undefined): HTMLElement {
  const label = ctx.state.instances.find((i) => i.id === selectedId)?.name ?? 'Выбери сборку';
  const button = el('button', { type: 'button', class: 'iselect-btn' },
    el('span', {}, label),
    icon('chevron', 12, 1.8),
  );

  let list: HTMLElement | null = null;
  const close = (): void => {
    list?.remove();
    list = null;
    document.removeEventListener('mousedown', onOutside);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', close);
  };
  const onOutside = (event: MouseEvent): void => {
    if (!button.contains(event.target as Node) && !list?.contains(event.target as Node)) close();
  };
  const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close(); };

  button.addEventListener('click', () => {
    if (list) { close(); return; }
    const rect = button.getBoundingClientRect();
    list = el('div', {
      class: 'iselect-list',
      style: `position:fixed;top:${rect.bottom + 6}px;right:${window.innerWidth - rect.right}px;min-width:${rect.width}px`,
    },
      ...ctx.state.instances.map((i) =>
        el('button', {
          type: 'button',
          class: i.id === selectedId ? 'on' : '',
          onclick: () => void guard(async () => {
            close();
            await api.selectInstance(i.id);
            await ctx.reload();
          }),
        }, i.name)),
    );
    document.body.append(list);
    // Внизу окна (нижняя полоса темы «Игровая») списку некуда раскрываться вниз - открываем вверх.
    const height = list.getBoundingClientRect().height;
    if (rect.bottom + 6 + height > window.innerHeight) list.style.top = `${Math.max(8, rect.top - height - 6)}px`;
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
  });

  return button;
}

/**
 * Кнопка «Играть» в состоянии «ЗАПУСКАЮ…».
 *
 * До появления окна игры может пройти от мгновения до целой установки, и без этого второй клик
 * выглядел так, будто первый не сработал. Успешный запуск заканчивается ctx.reload(), который
 * заменяет кнопку целиком (уже с «ЗАПУЩЕНА»), поэтому возвращать надпись нужно только при ошибке,
 * когда старая кнопка всё ещё на экране.
 */
function setPlayPending(button: HTMLButtonElement, pending: boolean): void {
  if (pending) {
    button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.textContent = 'ЗАПУСКАЮ…';
  } else if (document.body.contains(button)) {
    button.disabled = false;
    if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
  }
}

/** Клик по кнопке «Играть»: искры, «ЗАПУСКАЮ…», запуск и перерисовка. */
export function startFrom(event: Event, ctx: Ctx, id: string): void {
  const mouse = event as MouseEvent;
  const button = event.currentTarget as HTMLButtonElement;
  burst(mouse.clientX, mouse.clientY, '#50e7ad');
  scareOnPlay();
  setPlayPending(button, true);
  void guard(async () => {
    if (!(await bugfixOnPlay())) return;
    await api.launchStart(id);
    await ctx.reload();
  }).finally(() => setPlayPending(button, false));
}

// ---------------------------------------------------------------- Библиотека (плитки сборок)

/**
 * Имя для новой сборки: «Моя сборка», а если занято - с номером.
 * Две сборки с одинаковым именем в списке не различить.
 */
function freeName(ctx: Ctx, base: string): string {
  const taken = new Set(ctx.state.instances.map((i) => i.name));
  let name = base;
  for (let n = 2; taken.has(name); n += 1) name = `${base} ${n}`;
  return name;
}

/** Что подставить в «Собрать за меня»: последний релиз и рекомендованный Fabric. */
async function suggest(kind: 'mods' | 'vanilla'): Promise<Picked> {
  const versions = await api.gameVersions('release');
  const newest = versions[0]?.id;
  if (!newest) throw new Error('Не удалось получить список версий игры. Проверь интернет и попробуй снова.');
  if (kind === 'vanilla') return { minecraft: newest, loader: 'vanilla', loaderVersion: '' };

  const available = await api.loaderVersions('fabric', newest);
  // Рекомендованная, потом просто стабильная, потом любая: список никогда не бывает пустым,
  // но полагаться на это без проверки нельзя.
  const pick = available.find((item) => item.recommended) ?? available.find((item) => item.stable) ?? available[0];
  if (!pick) throw new Error('Для этой версии игры пока нет сборки Fabric. Выбери версию вручную.');
  return { minecraft: newest, loader: 'fabric', loaderVersion: pick.version };
}

interface Picked { minecraft: string; loader: Instance['loader']; loaderVersion: string; }

/**
 * Три списка: версия игры, загрузчик, версия загрузчика.
 *
 * Живёт отдельно, потому что нужен в двух местах: в окне «Собрать за меня» (где всё уже
 * подставлено и можно просто согласиться) и в окне смены версии у готовой сборки.
 * Полноценный экран создания сборки остаётся как был - там выбор просторнее.
 */
function versionPicker(start: Partial<Picked> = {}): {
  element: HTMLElement; value: () => Picked; ready: Promise<void>;
} {
  const game = el('select', { class: 'field', style: 'width:100%' }) as HTMLSelectElement;
  const loader = el('select', { class: 'field', style: 'width:100%' }) as HTMLSelectElement;
  const version = el('select', { class: 'field', style: 'width:100%' }) as HTMLSelectElement;
  const hint = el('div', { class: 'crow-meta', style: 'margin-top:7px;white-space:normal' });

  const option = (value: string, label: string): HTMLOptionElement =>
    el('option', { value }, label) as HTMLOptionElement;

  for (const item of LOADERS) loader.append(option(item.id, item.name));
  loader.value = start.loader ?? 'fabric';

  /** Версии загрузчика под выбранную версию игры. Список зависит от обоих списков выше. */
  // Номер запроса: пока шёл медленный ответ, человек мог выбрать другое - тогда старый ответ
  // пришёл бы последним и затёр свежий. Опоздавший ответ просто выбрасываем.
  let fillTicket = 0;
  async function fillLoaderVersions(): Promise<void> {
    const ticket = ++fillTicket;
    const kind = loader.value;
    hint.textContent = LOADERS.find((one) => one.id === kind)?.note ?? '';

    if (kind === 'vanilla') {
      version.replaceChildren(option('', 'не нужна'));
      version.disabled = true;
      return;
    }

    version.disabled = true;
    version.replaceChildren(option('', 'Ищу версии…'));
    const list = await api.loaderVersions(kind, game.value);
    if (ticket !== fillTicket) return;
    if (!list.length) {
      version.replaceChildren(option('', 'под эту версию игры пока нет'));
      return;
    }
    version.replaceChildren(...list.map((one) =>
      option(one.version, one.recommended ? `${one.version} - рекомендуется` : one.version)));
    // Рекомендованная, потом стабильная, потом просто первая: так же, как в «Собрать за меня».
    const pick = (start.loader === kind && start.loaderVersion)
      || (list.find((one) => one.recommended) ?? list.find((one) => one.stable) ?? list[0])?.version;
    if (pick) version.value = pick;
    version.disabled = false;
  }

  const ready = (async () => {
    game.replaceChildren(option('', 'Загружаю список версий…'));
    game.disabled = true;
    const versions = await api.gameVersions('release');
    game.replaceChildren(...versions.map((one) => option(one.id, one.id)));
    if (start.minecraft && versions.some((one) => one.id === start.minecraft)) {
      game.value = start.minecraft;
    } else if (start.minecraft) {
      // Версии снапшота в списке релизов нет - показываем её отдельной строкой, чтобы
      // человек не увидел вместо своей версии чужую.
      game.prepend(option(start.minecraft, start.minecraft));
      game.value = start.minecraft;
    }
    game.disabled = false;
    await fillLoaderVersions();
  })();

  game.addEventListener('change', () => void guard(fillLoaderVersions));
  loader.addEventListener('change', () => void guard(fillLoaderVersions));

  const labelled = (text: string, control: HTMLElement): HTMLElement =>
    el('div', {}, el('p', { class: 'eyebrow', style: 'margin:0 0 8px' }, text), control);

  return {
    element: el('div', { class: 'picker' },
      labelled('Версия игры', game),
      labelled('Загрузчик модов', loader),
      labelled('Версия загрузчика', version),
      hint,
    ),
    value: () => ({
      minecraft: game.value,
      loader: loader.value as Instance['loader'],
      loaderVersion: version.value,
    }),
    ready,
  };
}

/**
 * После смены версии: разобрать моды и предложить подогнать их под новую версию игры.
 *
 * Без этого смена версии была ловушкой: моды оставались от старой версии, и человек узнавал
 * об этом из окна с вылетом. Лаунчер обновляет то, что обновляется, и выключает (не удаляет!)
 * то, чего под новую версию не выпускали.
 */
async function offerModFit(ctx: Ctx, id: string, minecraft: string): Promise<void> {
  const report = await api.checkModFit(id);
  // У сборки без модов разбирать нечего - лишнее окно и лишний шум.
  if (!report.length) return;
  const updates = report.filter((one) => one.state === 'update');
  const missing = report.filter((one) => one.state === 'missing');
  const unknown = report.filter((one) => one.state === 'unknown');

  if (!updates.length && !missing.length) {
    toast(unknown.length
      ? `Моды подходят. ${plural(unknown.length, 'файл', 'файла', 'файлов')} лаунчер не опознал - проверь сам`
      : 'Все моды подходят к новой версии');
    return;
  }

  const line = (text: string): HTMLElement => el('div', { class: 'crow-meta', style: 'white-space:normal;margin-top:6px' }, text);
  const names = (list: typeof report): string => list.map((one) => one.name).join(', ');

  modal({
    title: 'Подогнать моды?',
    note: `Сборка теперь на ${minecraft}. Вот что с модами:`,
    content: el('div', { style: 'margin-top:12px' },
      updates.length ? line(`Обновлю: ${plural(updates.length, 'мод', 'мода', 'модов')} - ${names(updates)}.`) : null,
      missing.length ? line(`Под эту версию не выходили: ${names(missing)}. Выключу - файлы останутся на месте, вернёшь одним щелчком.`) : null,
      unknown.length ? line(`Не опознал (не с Modrinth): ${names(unknown)}. Их не трогаю - проверь сам.`) : null,
    ),
    confirm: 'Подогнать',
    onConfirm: () => void guard(async () => {
      const result = await api.applyModFit(id, report);
      await ctx.reload();
      const said = [
        result.updated.length ? `обновлено ${result.updated.length}` : '',
        result.disabled.length ? `выключено ${result.disabled.length}` : '',
      ].filter(Boolean).join(', ');
      if (result.failed.length) toast(`Готово (${said}), но не вышло: ${result.failed[0]}`, true);
      else toast(said ? `Моды подогнаны: ${said}` : 'Менять было нечего');
    }),
  });
}

/**
 * Кнопка «сделай за меня»: одна на пустой библиотеке и на экране создания сборки.
 *
 * Раньше она создавала сборку молча. Выходило непонятно: человек получал сборку и не знал,
 * что именно ему выбрали и можно ли это поменять. Теперь выбор **показан уже заполненным** -
 * согласиться можно одним нажатием, а поменять версию или загрузчик - тут же, не уходя на
 * отдельный экран. Спрашивать с чистого листа нельзя: тогда кнопка ничем не отличалась бы
 * от «Выбрать версию самому», ради ухода от которой она и появилась.
 */
/**
 * Кнопка «занята»: гасим её и пишем, что происходит. Возвращает функцию, которая всё вернёт.
 *
 * Запоминаем сами узлы, а не текст: раньше подпись возвращали через textContent, и значок
 * на кнопке («Импорт модпака») после первого нажатия пропадал насовсем.
 */
function busy(button: HTMLButtonElement, text: string): () => void {
  const was = [...button.childNodes];
  button.disabled = true;
  button.replaceChildren(text);
  return () => { button.disabled = false; button.replaceChildren(...was); };
}

/**
 * Действия стартовой карточки: главная кнопка отдельной строкой, остальные - ровной сеткой.
 * Раньше пять кнопок шли одной строкой с переносом, и последняя одиноко висела снизу.
 */
export function startActions(ctx: Ctx, extra?: HTMLElement): HTMLElement {
  const more = [quickCreateButton(ctx, 'vanilla', 'Только чистая игра', false, 'library'), extra, importPackButton(ctx), codeImportButton(), migrateButton(ctx)]
    .filter((node): node is HTMLElement => !!node);
  return el('div', { class: 'start-actions' },
    el('div', { class: 'start-hero' }, quickCreateButton(ctx, 'mods', 'Собрать за меня', true, 'sparkle')),
    el('div', { class: 'start-or' }, el('span', {}, 'или')),
    el('div', { class: 'start-more', style: `--n:${more.length}` }, ...more),
  );
}

function quickCreateButton(ctx: Ctx, kind: 'mods' | 'vanilla', label: string, main = true, glyph?: string): HTMLElement {
  const button = el('button', { class: main ? 'btn btn-main' : 'btn btn-ghost' },
    glyph ? icon(glyph, 15, 1.7) : null, label) as HTMLButtonElement;

  button.addEventListener('click', () => void guard(async () => {
    const done = busy(button, 'Подбираю…');
    let start: Picked;
    try {
      start = await suggest(kind);
    } finally {
      done();
    }

    const picker = versionPicker(start);
    const nameField = el('input', {
      value: freeName(ctx, kind === 'mods' ? 'Моя сборка' : 'Чистый Minecraft'), maxlength: 40,
    }) as HTMLInputElement;

    modal({
      title: kind === 'mods' ? 'Соберу сборку с модами' : 'Соберу чистую игру',
      note: kind === 'mods'
        ? 'Уже выбрал последнюю версию игры и проверенный загрузчик модов. Согласись - или поменяй, если знаешь, что тебе нужно.'
        : 'Последняя версия игры, без модов. Загрузчик можно добавить позже, сменив версию сборки.',
      content: el('div', {},
        picker.element,
        el('p', { class: 'eyebrow', style: 'margin:18px 0 8px' }, 'Название'),
        el('label', { class: 'field' }, nameField),
      ),
      confirm: 'Собрать',
      onConfirm: () => void guard(async () => {
        // Списки могли ещё не догрузиться - ждём, иначе уедут пустые значения.
        await picker.ready;
        const choice = picker.value();
        const instance = await api.createInstance({ ...choice, name: nameField.value });
        await ctx.reload();
        ctx.go({ name: 'instance', id: instance.id });
        toast(`Сборка «${instance.name}» готова - жми «Играть»`);
      }),
    });
  }));

  return button;
}

/**
 * Кнопка «Импорт модпака».
 *
 * Готовые сборки из интернета раздают файлами `.mrpack` (Modrinth) и `.zip` (CurseForge).
 * Раньше такой файл в лаунчер было не засунуть вообще: человек видел список модов и должен был
 * ставить их по одному, угадывая версии. Теперь лаунчер читает описание из архива сам.
 */
export function importPackButton(ctx: Ctx): HTMLElement {
  const button = el('button', { class: 'btn btn-ghost' },
    icon('download', 15, 1.7), 'Импорт модпака') as HTMLButtonElement;
  button.addEventListener('click', () => void guard(async () => {
    const done = busy(button, 'Распаковываю…');
    try {
      const result = await api.importPack();
      if (!result) return;
      await ctx.reload();
      ctx.go({ name: 'instance', id: result.instance.id });
      // Часть модов может не скачаться (автор запретил раздачу вне CurseForge) - об этом надо
      // сказать сразу, иначе человек узнает об отсутствующем моде только от вылета игры.
      if (result.failed.length) {
        toast(`Поставлено ${result.installed}, не вышло ${result.failed.length}: ${result.failed[0]}`, true);
      } else {
        toast(`Модпак «${result.instance.name}» распакован - жми «Играть»`);
      }
    } finally {
      done();
    }
  }));
  return button;
}

/**
 * Перенос сборки из другого лаунчера.
 *
 * Человек, который уже играл в Prism или в обычном лаунчере Mojang, не станет собирать всё
 * заново руками. Лаунчер сам смотрит обычные места на диске и копирует найденное к себе -
 * копирует, а не переносит: чужой лаунчер после этого работает как работал.
 */
export function migrateButton(ctx: Ctx): HTMLElement {
  const button = el('button', { class: 'btn btn-ghost' },
    icon('folder', 15, 1.7), 'Из другого лаунчера') as HTMLButtonElement;

  button.addEventListener('click', () => {
    // Миры - это почти весь вес переноса, и нужны они не всегда: бывает, человеку нужен
    // только набор модов. Поэтому их можно не брать, и цифры в списке сразу это показывают.
    let withWorlds = true;
    const repaint: (() => void)[] = [];

    const box = el('div', {}, loadingBox('Ищу сборки на диске…'));
    const footer = el('div', {});

    const row = (found: FoundInstance, close: () => void): HTMLElement => {
      const take = el('button', {
        class: found.already ? 'btn btn-ghost btn-s' : 'btn btn-s',
      }, found.already ? 'Перенести ещё раз' : 'Перенести') as HTMLButtonElement;

      take.addEventListener('click', () => void guard(async () => {
        take.disabled = true;
        take.textContent = 'Копирую…';
        const result = await api.adopt(found, withWorlds);
        close();
        await ctx.reload();
        ctx.go({ name: 'instance', id: result.instance.id });
        toast(result.carried.length
          ? `Сборка «${result.instance.name}» перенесена: ${result.carried.join(', ')}`
          : `Сборка «${result.instance.name}» создана, но копировать было нечего`);
      }, () => { take.disabled = false; take.textContent = 'Перенести'; }));

      const meta = el('div', { class: 'crow-meta' });
      const paint = (): void => {
        // «Без модов · 1.21.1 · 0 модов» читалось глупо: у чистой игры пишем просто версию,
        // а нули в счётчиках не показываем вовсе.
        const about = !found.minecraft ? ''
          : found.loader === 'vanilla' ? `Minecraft ${found.minecraft}`
          : `${loaderName(found.loader)} ${found.minecraft}`;
        const size = withWorlds ? found.size : found.size - found.worldsSize;
        meta.textContent = [
          found.launcher,
          about,
          found.mods ? plural(found.mods, 'мод', 'мода', 'модов') : '',
          withWorlds && found.worlds ? plural(found.worlds, 'мир', 'мира', 'миров') : '',
          size ? bytes(size) : '',
        ].filter(Boolean).join(' · ');
      };
      paint();
      repaint.push(paint);

      // Название и подпись - друг под другом: .crow-main раскладывает детей в строку,
      // поэтому текстовый столбец заворачиваем в отдельный блок, как в списке модов.
      return el('div', { class: 'crow' },
        el('div', { class: 'crow-main' },
          // Значок вместо пустоты: сборка с модами и чистая игра различаются с одного взгляда.
          el('div', { class: 'crow-art' },
            icon(found.loader === 'vanilla' ? 'library' : 'mods', 17, 1.7)),
          el('div', { style: 'min-width:0' },
            el('div', { class: 'crow-name' }, found.name,
              // Эту папку уже переносили: без пометки легко наделать одинаковых сборок
              // по двадцать гигабайт каждая.
              found.already ? el('span', { class: 'chip-done' }, 'уже перенесена') : null),
            meta,
          ),
        ),
        found.problem
          ? el('span', { class: 'crow-meta', style: 'max-width:210px;white-space:normal' }, found.problem)
          : take,
      );
    };

    modal({
      title: 'Перенос из другого лаунчера',
      note: 'Моды, конфиги, миры, ресурс-паки, шейдеры и настройки скопируются в новую сборку. '
        + 'Старая останется на месте - другой лаунчер продолжит работать.',
      wide: true,
      content: (close) => {
        void guard(async () => {
          const found = await api.scanOther();
          if (!found.length) {
            box.replaceChildren(emptyState('folder', 'Чужих сборок не нашлось',
              'Лаунчер смотрит папки сборок Prism Launcher, MultiMC, Modrinth App и папку '
              + '.minecraft. Если твои сборки лежат в другом месте, собери из них модпак .mrpack '
              + 'и ввези его кнопкой рядом.'));
            return;
          }

          box.replaceChildren(el('div', { class: 'found-list' },
            ...found.map((one) => row(one, close))));

          // Переключатель показываем только если миры вообще есть: иначе он бессмыслен.
          const worldsWeight = found.reduce((sum, one) => sum + one.worldsSize, 0);
          if (!worldsWeight) return;

          const sw = el('button', { class: 'sw on' }, el('i', {})) as HTMLButtonElement;
          sw.addEventListener('click', () => {
            withWorlds = !withWorlds;
            sw.classList.toggle('on', withWorlds);
            // Цифры в строках пересчитываются сразу: видно, сколько экономит отказ от миров.
            for (const again of repaint) again();
          });
          footer.replaceChildren(el('div', { class: 'found-foot' },
            el('div', {},
              el('b', { class: 'crow-name' }, 'Переносить миры'),
              el('div', { class: 'crow-meta' },
                `Все сохранённые миры - ${bytes(worldsWeight)}. Без них переедут только моды и настройки.`),
            ),
            sw,
          ));
        }, () => {
          if (box.firstElementChild?.classList.contains('loading')) box.replaceChildren();
        });
        return el('div', {}, box, footer);
      },
    });
  });

  return button;
}

/** Java, которая нужна новым версиям игры (1.20.5 и новее). */
const NEWEST_JAVA = 21;
/** Самая свежая Java на компьютере: узнаём один раз за запуск, библиотека перерисовывается часто. */
let newestJava: number | null = null;
/** «Не сейчас» - до следующего запуска лаунчера. */
let javaNudgeHidden = false;
/** Идёт скачивание - карточка при перерисовке не должна терять прогресс. */
let javaDownload: Promise<unknown> | null = null;

/**
 * Карточка «Ого! Да вы старичок»: на компьютере нет Java 21, а без неё новые версии игры
 * не запустятся. Раньше это всплывало только при запуске игры, посреди ожидания. Теперь
 * лаунчер говорит об этом сразу и качает Java одной кнопкой - официальную сборку Mojang
 * в свою папку, в систему ничего не ставит.
 */
function javaNudge(): HTMLElement {
  const box = el('div');
  const paint = (newest: number): void => {
    if (javaNudgeHidden || newest >= NEWEST_JAVA) { box.replaceChildren(); return; }
    const none = newest === 0;
    const bar = el('i', { style: 'width:0%' });
    const progress = el('div', { class: 'bar nudge-bar', style: 'display:none' }, bar);
    const go = el('button', { class: 'btn btn-main btn-s' }, none ? `Скачать Java ${NEWEST_JAVA}` : 'Обновим!');
    const later = el('button', { class: 'btn btn-ghost btn-s' }, 'Не сейчас');
    const text = el('p', {},
      none
        ? `Без неё игра не запустится. Скачаю официальную Java ${NEWEST_JAVA} от Mojang к себе в папку - `
          + 'ставить и настраивать ничего не придётся.'
        : `Понимаю, раньше было лучше. Но, может, Java всё-таки обновим? Самая свежая у тебя - Java ${newest}, `
          + `а Minecraft 1.20.5 и новее нужна Java ${NEWEST_JAVA}. Скачаю официальную от Mojang к себе в папку, `
          + 'в систему ничего не ставлю.');
    const card = el('div', { class: 'nudge' },
      el('span', { class: 'nudge-ico' }, icon('java', 26, 1.6)),
      el('div', { class: 'nudge-main' },
        el('b', {}, none ? 'Java не нашлась вовсе' : 'Ого! Да вы старичок.'),
        text,
        progress,
        el('div', { class: 'nudge-actions' }, go, later),
      ),
    );

    const start = (): void => {
      go.disabled = true;
      later.remove();
      progress.style.display = '';
      go.textContent = 'Качаю…';
      const off = api.onJavaProgress(({ done, total }) => {
        const percent = total ? Math.round((done / total) * 100) : 0;
        bar.style.width = `${percent}%`;
        go.textContent = `Качаю… ${percent}%`;
      });
      javaDownload ??= api.downloadJava();
      void javaDownload
        .then(() => {
          newestJava = NEWEST_JAVA;
          card.classList.add('done');
          card.replaceChildren(
            el('span', { class: 'nudge-ico' }, icon('check', 24, 2)),
            el('div', { class: 'nudge-main' },
              el('b', {}, `Готово, Java ${NEWEST_JAVA} на месте`),
              el('p', {}, 'Теперь запустятся любые версии игры. Лаунчер сам выберет нужную Java под каждую сборку.'),
            ),
          );
          window.setTimeout(() => box.replaceChildren(), 6000);
        })
        .catch((error: unknown) => {
          go.disabled = false;
          go.textContent = 'Попробовать ещё раз';
          progress.style.display = 'none';
          toast(error instanceof Error ? error.message : String(error), true);
        })
        .finally(() => { off(); javaDownload = null; });
    };
    go.addEventListener('click', start);
    later.addEventListener('click', () => { javaNudgeHidden = true; box.replaceChildren(); });
    box.replaceChildren(card);
    // Перерисовка посреди скачивания: подхватываем уже идущую загрузку, а не начинаем новую.
    if (javaDownload) start();
  };
  if (newestJava !== null) paint(newestJava);
  else void api.newestJava().then((value) => { newestJava = value; paint(value); }).catch(() => { /* не узнали - молчим */ });
  return box;
}

/**
 * Лицо из скина аккаунта (голова 8×8 и слой шапки поверх), как в списке игроков Minecraft.
 *
 * Пока скин не пришёл или его нет, остаётся первая буква ника. Готовые лица держим в памяти:
 * боковое меню перерисовывается часто, и без памяти лицо мигало бы буквой при каждой перерисовке,
 * а лаунчер каждый раз ходил бы в сеть за скином.
 */
const faces = new Map<string, string | null>();
const facesLoading = new Map<string, Promise<string | null>>();

/** Скин поменяли или сбросили - лицо надо нарисовать заново. */
export function forgetFace(accountId: string): void {
  faces.delete(accountId);
  facesLoading.delete(accountId);
  // И 3D-скин в теме «Power»: он тоже держит прежний скин в памяти.
  forgetSkin3d();
}

async function headFrom(dataUrl: string): Promise<string | null> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  // Скин 64×64 или старый 64×32; лицо в обоих лежит на одном месте.
  const scale = image.width / 64;
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.imageSmoothingEnabled = false;
  g.drawImage(image, 8 * scale, 8 * scale, 8 * scale, 8 * scale, 0, 0, 8, 8);
  g.drawImage(image, 40 * scale, 8 * scale, 8 * scale, 8 * scale, 0, 0, 8, 8);
  return canvas.toDataURL();
}

export function accountFace(account: { id: string; name: string; kind: string } | undefined): HTMLElement {
  const box = el('div', { class: account?.kind === 'microsoft' ? 'acct-face lic' : 'acct-face' },
    (account?.name ?? '?').slice(0, 1).toUpperCase());
  if (!account) return box;
  const show = (url: string | null): void => {
    if (!url) return;
    box.classList.add('skin');
    box.replaceChildren(el('img', { src: url, alt: '' }));
  };
  if (faces.has(account.id)) { show(faces.get(account.id) ?? null); return box; }
  let job = facesLoading.get(account.id);
  if (!job) {
    job = api.currentSkin(account.id)
      .then((skin) => (skin ? headFrom(skin.dataUrl) : null))
      .catch(() => null)
      .then((url) => { faces.set(account.id, url); return url; });
    facesLoading.set(account.id, job);
  }
  void job.then(show);
  return box;
}

/**
 * Выбранный фильтр библиотеки живёт вне экрана. Экран пересоздаётся при каждой перерисовке
 * (игра закрылась, сборка установилась), и фильтр внутри него сбрасывался на «Все» сам собой.
 */
let libraryFilter = 'all';

export function libraryScreen(ctx: Ctx): HTMLElement {
  const { instances, selectedInstance, content } = ctx.state;
  const selected = instances.find((i) => i.id === selectedInstance) ?? instances[0];

  const body = el('div', { class: 'body' }, javaNudge());

  // «Продолжить»: сборка, в которую играли последней, одной кнопкой - чаще всего нужна именно она.
  const last = instances.filter((i) => i.lastPlayed > 0).sort((a, b) => b.lastPlayed - a.lastPlayed)[0];
  const totalPlayed = instances.reduce((sum, i) => sum + (i.playSeconds ?? 0), 0);
  if (last) {
    const running = ctx.state.running.includes(last.id);
    body.append(el('div', { class: 'resume' },
      el('div', {
        class: `resume-art tile-art ${last.accent}`,
        // Обложка ложится поверх цветной заливки; нет файла - остаётся прежний градиент.
        style: last.coverUrl
          ? `background-image:url("${last.coverUrl}");background-size:cover;background-position:center`
          : '',
      }),
      el('div', { class: 'resume-text' },
        el('span', { class: 'eyebrow', style: 'margin:0 0 6px' }, 'Продолжить'),
        el('b', {}, last.name),
        el('span', { class: 'resume-sub' },
          `${describe(last)} · ${ago(last.lastPlayed)}${last.playSeconds ? ` · в игре ${playtime(last.playSeconds)}` : ''}`),
      ),
      totalPlayed
        ? el('div', { class: 'resume-stat' }, el('b', {}, playtime(totalPlayed)), el('span', {}, 'всего в игре'))
        : null,
      el('button', {
        class: 'btn btn-main', disabled: running,
        onclick: (event: Event) => startFrom(event, ctx, last.id),
      }, play(14), running ? 'ЗАПУЩЕНА' : 'Играть'),
    ));
  }

  if (content.news.length) {
    body.append(
      el('p', { class: 'eyebrow' }, 'Новости'),
      el('div', { class: 'news', style: 'margin-bottom:26px' },
        ...content.news.slice(0, 3).map((item) =>
          el('article', { class: item.accent },
            el('span', { class: 'tag' }, item.tag || 'новость'),
            el('h3', {}, item.title),
            item.body ? el('p', {}, item.body) : null,
            item.link
              ? el('button', {
                  class: 'btn btn-ghost btn-s', style: 'margin-top:10px',
                  onclick: () => void guard(() => api.openExternal(item.link)),
                }, 'Подробнее', icon('external', 13, 1.8))
              : null,
          )),
      ),
    );
  }

  const grid = el('div', { class: 'grid' });
  const filterRow = el('div', { style: 'display:flex;align-items:center;gap:9px;margin-bottom:16px;flex-wrap:wrap' });

  const FILTERS = [
    { id: 'all', label: 'Все', keep: () => true },
    { id: 'fabric', label: 'С модами', keep: (i: Instance) => i.loader !== 'vanilla' },
    { id: 'vanilla', label: 'Ваниль', keep: (i: Instance) => i.loader === 'vanilla' },
    { id: 'played', label: 'Недавние', keep: (i: Instance) => i.lastPlayed > 0 },
  ];

  function paintGrid(): void {
    const keep = FILTERS.find((f) => f.id === libraryFilter)?.keep ?? (() => true);
    const shown = instances.filter(keep);
    grid.replaceChildren(
      ...shown.map((instance) => {
        const job = ctx.progress.get(instance.id);
        const running = ctx.state.running.includes(instance.id);
        const open = (e: Event): void => void guard(async () => {
          const m = e as MouseEvent;
          burst(m.clientX, m.clientY, '#9f86ff');
          await api.selectInstance(instance.id);
          await ctx.reload();
          ctx.go({ name: 'instance', id: instance.id });
        });

        
        
        return el('div', {
          class: instance.id === selected?.id ? 'card tile on' : 'card tile',
          role: 'button',
        },
          el('div', {
            class: `tile-art ${instance.accent}`,
            onclick: open,
            style: instance.coverUrl
              ? `background-image:url("${instance.coverUrl}");background-size:cover;background-position:center`
              : '',
          },
            // Без обложки плитка была просто цветным прямоугольником: одинаковые сборки
            // не различить взглядом. Буква названия решает это, ничего не занимая.
            instance.coverUrl
              ? null
              : el('span', { class: 'tile-mono' }, instance.name.trim().charAt(0).toUpperCase()),
            // В новых темах вместо буквы - пиксельный пейзаж сборки (themes.ts). В «Космосе» не рисуем вовсе.
            !instance.coverUrl && document.body.classList.contains('flat')
              ? el('img', { class: 'tile-px', src: instanceArt(instance), alt: '', draggable: 'false' })
              : null,
            running
              ? el('span', { class: 'tile-live' }, el('i', {}), 'Запущена')
              : null,
            el('span', { class: 'tile-ver mono' }, describe(instance)),
          ),
          el('div', { class: 'tile-body' },
            el('b', { onclick: open, style: 'cursor:pointer' }, instance.name),
            el('div', { class: 'tile-sub' },
              el('span', {}, instance.installed ? 'установлена' : 'не установлена'),
              el('span', {}, '·'),
              el('span', {}, ago(instance.lastPlayed)),
              instance.playSeconds ? el('span', {}, '·') : null,
              instance.playSeconds ? el('span', {}, playtime(instance.playSeconds)) : null,
            ),
            job && !job.done
              ? el('div', { class: 'bar', style: 'margin-top:12px' },
                  el('i', { 'data-bar': instance.id, style: `width:${job.total ? Math.round((job.progress / job.total) * 100) : 0}%` }))
              : null,
            el('div', { style: 'display:flex;gap:8px;margin-top:14px' },
              el('button', {
                class: 'btn btn-main btn-s',
                style: 'flex:1;padding:9px 18px',
                disabled: running,
                onclick: (e: Event) => {
                  const m = e as MouseEvent;
                  const button = e.currentTarget as HTMLButtonElement;
                  burst(m.clientX, m.clientY, '#50e7ad');
                  scareOnPlay();
                  setPlayPending(button, true);
                  void guard(async () => {
                    if (!(await bugfixOnPlay())) return;
                    await api.launchStart(instance.id);
                    await ctx.reload();
                  }).finally(() => setPlayPending(button, false));
                },
              }, play(13), running ? 'ЗАПУЩЕНА' : 'Играть'),
              el('button', {
                class: 'tile-more', title: 'Открыть сборку',
                onclick: open,
              }, icon('chevron', 15, 2)),
            ),
          ),
        );
      }),
      // Единственная кнопка «Новая сборка» - плитка рядом с остальными сборками. В пустой
      // библиотеке её нет: там те же действия уже собраны в карточке «Сборок пока нет».
      ...(instances.length ? [el('button', {
        class: 'tile-new',
        onclick: (e: Event) => { const m = e as MouseEvent; burst(m.clientX, m.clientY, '#50e7ad'); ctx.go({ name: 'new' }); },
      }, icon('plus', 26, 1.5), 'Новая сборка')] : []),
    );
  }

  function paintFilters(): void {
    filterRow.replaceChildren(
      ...FILTERS.map((item) =>
        el('button', {
          class: item.id === libraryFilter ? 'chip on' : 'chip',
          onclick: () => { libraryFilter = item.id; paintFilters(); paintGrid(); },
        }, item.label)),
    );
  }

  body.append(el('p', { class: 'eyebrow' }, 'Сборки'));

  if (!instances.length) {
    // Пустая библиотека - это первый экран новичка. Вместо надписи «пусто» даём ему готовое
    // действие: одна кнопка собирает сборку с последней версией игры и модами.
    body.append(el('div', { class: 'card start-card' },
      el('b', { class: 'start-title' }, 'Сборок пока нет'),
      el('p', { class: 'start-note' },
        ctx.text('library.empty',
          'Сборка - это отдельная игра со своими модами и мирами. Можно собрать за тебя: '
          + 'возьмём последнюю версию Minecraft и загрузчик модов, ничего выбирать не придётся.')),
      startActions(ctx, el('button', {
        class: 'btn btn-ghost',
        onclick: () => ctx.go({ name: 'new' }),
      }, icon('settings', 15, 1.7), 'Выбрать версию самому')),
    ));
  } else {
    paintFilters();
    body.append(filterRow);
  }

  paintGrid();
  body.append(grid);

  // Нижней панели «Играть» здесь нет: у каждой плитки своя кнопка.
  return frame({
    title: 'Библиотека',
    sub: plural(instances.length, 'сборка', 'сборки', 'сборок'),
    body,
  });
}

// ---------------------------------------------------------------- Новая сборка

export function newInstanceScreen(ctx: Ctx): HTMLElement {
  let games: GameVersion[] = [];
  let loaderVersions: LoaderVersion[] = [];
  let minecraft = '';
  let loader: string = 'fabric';
  let loaderVersion = '';
  let name = '';
  let channel: 'release' | 'snapshot' | 'old' = ctx.state.settings.showSnapshots ? 'snapshot' : 'release';
  let filter = '';

  const versionList = el('div', {
    class: 'card',
    style: 'padding:7px;display:flex;flex-direction:column;gap:2px;max-height:330px;overflow-y:auto',
  });
  const filterField = el('input', { placeholder: '1.21…' });
  const loaderBox = el('div', { style: 'display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:12px' });
  const versionSelect = el('select', { class: 'field', style: 'width:100%' });
  const versionHint = el('div', { class: 'mono', style: 'font-size:11.5px;color:var(--dim);margin-top:8px' });
  const nameField = el('input', { placeholder: 'Название сборки', maxlength: 40 });
  const createButton = el('button', { class: 'btn btn-main', style: 'padding:12px 36px' }, 'Создать');

  const CHANNELS = [
    { id: 'release', label: 'Релизы' },
    { id: 'snapshot', label: 'Снапшоты' },
    { id: 'old', label: 'Старые' },
  ] as const;
  const chipRow = el('div', { style: 'display:flex;gap:7px;margin-bottom:12px' });

  function paintChips(): void {
    chipRow.replaceChildren(
      ...CHANNELS.map((item) =>
        el('button', {
          class: item.id === channel ? 'chip on' : 'chip',
          onclick: () => {
            if (item.id === channel) return;
            channel = item.id;
            paintChips();
            void loadGames();
          },
        }, item.label)),
    );
  }
  paintChips();

  function paintVersions(): void {
    const needle = filter.trim().toLowerCase();
    const shown = needle ? games.filter((v) => v.id.toLowerCase().includes(needle)) : games;
    if (!shown.length) {
      versionList.replaceChildren(el('div', { class: 'empty', style: 'padding:34px' }, 'Нет такой версии.'));
      return;
    }
    versionList.replaceChildren(
      ...shown.map((version, index) =>
        el('button', {
          style: 'display:flex;align-items:center;gap:13px;padding:11px 14px;border-radius:10px;'
            + (version.id === minecraft
              ? 'background:rgba(159,134,255,.10);border:1px solid rgba(159,134,255,.3)'
              : 'border:1px solid transparent'),
          onclick: () => { minecraft = version.id; paintVersions(); paintSummary(); void loadLoaderVersions(); },
        },
          el('span', { class: 'mono', style: 'font-size:13.5px' }, version.id),
          el('span', { style: 'font-size:12px;color:var(--dim)' },
            // Короткий месяц: «1 сент. 2026» вместо «1 сентября 2026 г.» - строка перестала
            // переноситься и спорить за место с номером версии.
            new Date(version.releaseTime).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })),
          // Метка «последняя» только у первой строки релизов (и не во время поиска).
          index === 0 && !needle && channel === 'release'
            ? el('span', {
                class: 'mono',
                style: 'margin-left:auto;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;'
                  + 'color:var(--aurora);border:1px solid rgba(80,231,173,.4);border-radius:6px;padding:1px 6px',
              }, 'последняя')
            : null,
        )),
    );
  }

  filterField.addEventListener('input', () => { filter = filterField.value; paintVersions(); });

  function paintLoaders(): void {
    loaderBox.replaceChildren(
      ...LOADERS.map((item) =>
        el('button', {
          class: 'grp',
          style: 'text-align:left;display:flex;flex-direction:column;gap:9px;padding:17px 18px;'
            + (item.id === loader
              ? 'border-color:rgba(159,134,255,.34);background:rgba(159,134,255,.07)'
              : ''),
          onclick: () => { loader = item.id; paintSummary(); void loadLoaderVersions(); paintLoaders(); },
        },
          el('div', { style: 'display:flex;align-items:center;gap:10px' },
            el('span', {
              style: 'width:9px;height:9px;border-radius:50%;background:'
                + (item.id === loader ? 'var(--cosmic);box-shadow:0 0 10px var(--cosmic)' : '#3c3556'),
            }),
            el('b', { style: 'font-family:var(--display);font-weight:500;font-size:15.5px' }, item.name),
          ),
          el('p', { style: 'margin:0;font-size:12.5px;color:var(--muted)' }, item.note),
        )),
    );
  }

  /**
   * Загружает версии загрузчика под выбранную версию игры.
   * Версию выбирает пользователь; рекомендуемая выбрана заранее, чтобы в обычном случае ничего не трогать.
   */
  // Номер запроса: пока шёл медленный ответ, человек мог выбрать другое - тогда старый ответ
  // пришёл бы последним и затёр свежий. Опоздавший ответ просто выбрасываем.
  let loaderTicket = 0;
  async function loadLoaderVersions(): Promise<void> {
    await fillLoaderVersions();
    paintSummary();
  }
  async function fillLoaderVersions(): Promise<void> {
    const ticket = ++loaderTicket;
    versionSelect.replaceChildren(el('option', {}, 'загружаю…'));
    versionHint.textContent = '';
    if (loader === 'vanilla' || !minecraft) {
      loaderVersions = [];
      loaderVersion = '';
      versionSelect.replaceChildren(el('option', {}, 'не нужен'));
      versionSelect.setAttribute('disabled', 'true');
      return;
    }
    versionSelect.removeAttribute('disabled');
    let found: typeof loaderVersions = [];
    try {
      found = await api.loaderVersions(loader, minecraft);
    } catch (error) {
      if (ticket === loaderTicket) toast(error instanceof Error ? error.message : String(error), true);
    }
    if (ticket !== loaderTicket) return;
    loaderVersions = found;
    if (!loaderVersions.length) {
      loaderVersion = '';
      versionSelect.replaceChildren(el('option', {}, `нет сборок под ${minecraft}`));
      versionSelect.setAttribute('disabled', 'true');
      versionHint.textContent = `${loaderName(loader)} под ${minecraft} ещё не вышел.`;
      return;
    }
    loaderVersion = (loaderVersions.find((v) => v.recommended) ?? loaderVersions[0]!).version;
    versionSelect.replaceChildren(
      ...loaderVersions.map((version) =>
        el('option', { value: version.version, selected: version.version === loaderVersion },
          version.version
          + (version.recommended ? ' - рекомендуется' : '')
          + (!version.stable ? ' (бета)' : ''))),
    );
    versionHint.textContent = `${plural(loaderVersions.length, 'сборка', 'сборки', 'сборок')} ${loaderName(loader)} под ${minecraft}`;
  }

  versionSelect.addEventListener('change', () => { loaderVersion = versionSelect.value; paintSummary(); });
  nameField.addEventListener('input', () => { name = nameField.value; paintSummary(); });

  /** Название, если поле пустое: так же назовёт сборку и кнопка «Создать». */
  const fallbackName = (): string => `${minecraft} ${loader === 'vanilla' ? '' : loaderName(loader)}`.trim();

  // Сводка в нижней полосе: что именно создастся. Выбор разбросан по экрану (версия слева,
  // загрузчик справа, название внизу), и перед «Создать» его иначе не окинуть взглядом.
  const summaryTitle = el('b', { class: 'sum-title' });
  const summaryLine = el('div', { class: 'sum-line mono' });
  function paintSummary(): void {
    summaryTitle.textContent = name.trim() || fallbackName() || 'Новая сборка';
    summaryLine.textContent = !minecraft ? 'выбери версию игры'
      : loader === 'vanilla' ? `${minecraft} · без модов`
        : `${minecraft} · ${loaderName(loader)} ${loaderVersion || '…'}`;
  }

  // Кнопку гасим на время создания: двойной клик раньше создавал две одинаковые сборки.
  createButton.addEventListener('click', () => {
    if (createButton.disabled) return;
    createButton.disabled = true;
    void guard(async () => {
    const instance = await api.createInstance({
      name: name.trim() || fallbackName(),
      minecraft,
      loader,
      loaderVersion,
    });
    await ctx.reload();
    ctx.go({ name: 'instance', id: instance.id });
    toast('Сборка создана. Нажми «Играть» - файлы докачаются сами.');
    }, () => { createButton.disabled = false; });
  });

  /** Загружает версии игры для выбранного канала и сразу - версии загрузчика под первую из них. */
  let gamesTicket = 0;
  async function loadGames(): Promise<void> {
    const ticket = ++gamesTicket;
    try {
      const found = await api.gameVersions(channel);
      // Пока грузились снапшоты, человек мог вернуться к релизам.
      if (ticket !== gamesTicket) return;
      games = found;
      minecraft = games[0]?.id ?? '';
      paintVersions();
      await loadLoaderVersions();
    } catch (error) {
      versionList.replaceChildren(el('div', { class: 'err' },
        error instanceof Error ? error.message : String(error)));
    }
  }

  paintLoaders();
  void loadGames();

  const body = el('div', { class: 'body' },
    // Быстрый путь над ручным выбором: тому, кто не знает слов «Fabric» и «загрузчик»,
    // не нужно ничего понимать, чтобы начать играть.
    el('div', { class: 'card start-card', style: 'margin-bottom:22px' },
      el('b', { class: 'start-title' }, 'Не знаешь, что выбрать?'),
      el('p', { class: 'start-note' },
        'Соберём сборку сами: последняя версия Minecraft и проверенный загрузчик модов. '
        + 'Версию и моды потом можно поменять в любой момент.'),
      startActions(ctx),
      el('p', { class: 'start-hint' },
        'Модпак .mrpack или .zip лаунчер распакует сам: версия игры, загрузчик и моды прочитаются из файла.'),
    ),
    el('div', { style: 'display:grid;grid-template-columns:296px 1fr;gap:32px;align-items:start' },
      el('div', {},
        el('p', { class: 'eyebrow' }, 'Версия игры'),
        chipRow,
        el('label', { class: 'field', style: 'margin-bottom:12px' }, icon('search', 15, 1.7), filterField),
        versionList,
      ),
      el('div', {},
        el('p', { class: 'eyebrow' }, 'Загрузчик модов'),
        loaderBox,
        el('p', { class: 'eyebrow', style: 'margin:26px 0 13px' }, 'Версия загрузчика'),
        versionSelect,
        versionHint,
        el('p', { class: 'eyebrow', style: 'margin:26px 0 13px' }, 'Название'),
        el('label', { class: 'field' }, nameField),
      ),
    ),
  );

  paintSummary();
  const footer = el('footer', { class: 'play' },
    el('div', { class: 'play-art tile-art cosmic sum-art' }, icon('plus', 20, 1.8)),
    el('div', { style: 'min-width:0' }, summaryTitle, summaryLine),
    el('div', { style: 'margin-left:auto;display:flex;gap:11px' },
      el('button', { class: 'btn btn-ghost', onclick: () => ctx.go({ name: 'library' }) }, 'Отмена'),
      createButton,
    ),
  );

  return frame({ title: 'Новая сборка', body, footer, back: () => ctx.go({ name: 'library' }) });
}

// ---------------------------------------------------------------- Страница сборки

export function instanceScreen(ctx: Ctx, id: string): HTMLElement {
  const instance = ctx.state.instances.find((i) => i.id === id);
  if (!instance) return libraryScreen(ctx);

  let kind: Kind = 'mod';
  let worlds: World[] = [];
  let world = '';
  let pinned = new Set(instance.pinned ?? []);
  /** Вкладка «Миры» - пятая вкладка, но не пятый Kind: там миры, а не файлы. */
  let showingWorlds = false;
  /** Вкладка «Скриншоты» - тоже не Kind: там картинки из папки screenshots. */
  let showingShots = false;
  /** Мир передаём только для датапаков: для остальных видов главный процесс построил бы путь, который никто не читает. */
  const scope = (): string => (kind === 'datapack' ? world : '');
  /** Опознание по хешу - запрос в сеть, поэтому каждый файл опознаём один раз за экран. */
  const identified = new Map<string, Awaited<ReturnType<typeof api.identifyMod>>>();

  const list = el('div', { class: 'card' }, loadingBox('Читаю папку…'));
  const tabs = el('div', { style: 'flex:1;min-width:0' });
  const worldBar = el('div');
  /** Кнопка «Обновить всё»; создаётся ниже, вместе с телом экрана. */
  let updateAll: HTMLButtonElement | null = null;

  /** Заголовок пустой вкладки - коротко, что именно пусто; подробности идут отдельной строкой. */
  const EMPTY_TITLE: Record<Kind, string> = {
    mod: 'Модов пока нет',
    resourcepack: 'Ресурс-паков пока нет',
    datapack: 'В этом мире нет датапаков',
    shader: 'Шейдеров пока нет',
  };
  const EMPTY: Record<Kind, string> = {
    mod: 'Модов нет. Поставь их на экране «Моды» или просто перетащи .jar в это окно.',
    resourcepack: 'Ресурс-паков нет. Поставь их на экране «Моды» или положи .zip в resourcepacks.',
    datapack: 'В этом мире нет датапаков.',
    shader: 'Шейдеров нет. Поставь их на экране «Моды» или положи .zip в shaderpacks.',
  };

  function paintTabs(counts: Record<string, number> = {}): void {
    tabs.replaceChildren(tabRow(
      [...KINDS, { id: 'world', label: 'Миры' }, { id: 'shots', label: 'Скриншоты' }]
        .map((item) => ({ ...item, count: counts[item.id] })),
      showingShots ? 'shots' : showingWorlds ? 'world' : kind,
      (next) => {
        showingWorlds = next === 'world';
        showingShots = next === 'shots';
        if (!showingWorlds && !showingShots) kind = next as Kind;
        paintTabs(counts);
        paintWorldBar();
        void load();
      },
    ));
    if (updateAll) updateAll.hidden = showingWorlds || showingShots;
  }

  /** Выбор мира - только на вкладке датапаков. */
  function paintWorldBar(): void {
    if (kind !== 'datapack' || showingWorlds || showingShots || !worlds.length) { worldBar.replaceChildren(); return; }
    worldBar.replaceChildren(
      el('div', { style: 'display:flex;align-items:center;gap:9px;margin-bottom:13px;flex-wrap:wrap' },
        el('span', { class: 'eyebrow', style: 'margin:0' }, 'Мир'),
        ...worlds.map((item) =>
          el('button', {
            class: item.folder === world ? 'chip on' : 'chip',
            onclick: () => { world = item.folder; paintWorldBar(); void load(); },
          }, item.name)),
      ),
    );
  }

  /**
   * Опознание файла по хешу - ровно один запрос на файл.
   *
   * Ответ нужен сразу двум местам строки: ячейке версии и названию с картинкой. Раньше запрос
   * был только в ячейке версии, и если бы название спросило отдельно, Modrinth дёргали бы дважды.
   */
  const pending = new Map<string, Promise<Identified | null>>();
  // Строки списка спрашивают по одной, но почти одновременно. Всё, что набралось за один такт,
  // уходит в главный процесс одним вызовом, а тот - одним запросом в Modrinth.
  let queue: { file: string; resolve: (found: Identified | null) => void }[] = [];
  function identifyOnce(file: string): Promise<Identified | null> {
    if (identified.has(file)) return Promise.resolve(identified.get(file) ?? null);
    let job = pending.get(file);
    if (!job) {
      job = new Promise<Identified | null>((resolve) => {
        if (!queue.length) {
          // Вид и мир запоминаем сейчас: к моменту ответа человек мог уйти на другую вкладку.
          const batchKind = kind;
          const batchWorld = scope();
          window.setTimeout(() => {
            const batch = queue;
            queue = [];
            api.identifyMods(id, batch.map((item) => item.file), batchKind, batchWorld)
              .then((found) => {
                for (const item of batch) {
                  identified.set(item.file, found[item.file] ?? null);
                  item.resolve(found[item.file] ?? null);
                }
              })
              .catch(() => { for (const item of batch) item.resolve(null); });
          }, 0);
        }
        queue.push({ file, resolve });
      });
      pending.set(file, job);
    }
    return job;
  }

  /** Ячейка версии: что установлено, и по клику - список других версий. */
  function versionCell(file: ModFile): HTMLElement {
    const button = el('button', { class: 'vbtn' },
      el('span', { class: 'mono', style: 'flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis' },
        identified.get(file.file)?.label ?? '…'),
      icon('chevron', 13, 2),
    );

    if (!identified.has(file.file)) {
      void identifyOnce(file.file).then((found) => {
        const label = button.firstElementChild as HTMLElement;
        // Файл, которого Modrinth не знает: версий предложить нечего, ячейка просто показывает имя.
        label.textContent = found?.label ?? file.file.replace(/\.(jar|zip)(\.disabled)?$/, '');
        if (!found) button.classList.add('flat');
      });
    }

    button.addEventListener('click', () => {
      const found = identified.get(file.file);
      if (!found) { toast('Этот файл не с Modrinth - версию можно сменить только вручную.', true); return; }
      const box = el('div', {}, loadingBox('Читаю версии…'));
      const close = popup(button, () =>
        el('div', {},
          el('div', { class: 'vmenu-head' }, el('span', { class: 'eyebrow', style: 'margin:0' }, 'Версия файла')),
          box,
        ));
      void (async () => {
        let all: ContentVersion[];
        try {
          all = await api.modVersions(id, found.source, found.projectId, kind);
        } catch (error) {
          box.replaceChildren(el('div', { class: 'err' }, error instanceof Error ? error.message : String(error)));
          return;
        }
        fillVersionList(box, all, found.versionId, (version) => void guard(async () => {
          close();
          const next = await api.switchModVersion(id, file.file, version.id, kind, scope());
          identified.delete(file.file);
          toast(`${next} - поставлена версия ${version.label}`);
          await ctx.reload();
          await load();
        }));
      })();
    });

    return button;
  }

  /** Список файлов: переключатель, имя и размер, версия, закрепление, удаление. */
  function paint(files: ModFile[]): void {
    if (!files.length) {
      list.replaceChildren(emptyState('mods', EMPTY_TITLE[kind], EMPTY[kind]));
      return;
    }
    list.replaceChildren(...files.map((file) => {
      const isPinned = pinned.has(file.file);
      const plain = file.file.replace(/\.(jar|zip)(\.disabled)?$/, '');

      // Пока Modrinth не ответил - имя файла и пустой квадрат вместо картинки: строка сразу
      // на месте и не прыгает, когда приходит ответ.
      const art = el('div', { class: 'crow-art' }, el('span', {}, plain.slice(0, 1).toUpperCase()));
      const title = el('b', { class: 'crow-name' }, plain);
      const fileName = el('span', { class: 'crow-file' }, plain);
      void identifyOnce(file.file).then((found) => {
        if (found?.name) title.textContent = found.name;
        if (found?.icon) {
          const image = el('img', { src: found.icon, alt: '', loading: 'lazy', decoding: 'async' });
          image.addEventListener('error', () => image.remove());
          art.replaceChildren(image);
        }
      });

      return el('div', { class: file.enabled ? 'crow' : 'crow off' },
        el('button', {
          class: file.enabled ? 'sw on' : 'sw',
          title: file.enabled ? 'Выключить' : 'Включить',
          onclick: () => void guard(async () => {
            await api.toggleMod(id, file.file, kind, scope());
            await load();
          }),
        }, el('i', {})),
        el('div', { class: 'crow-main' },
          art,
          el('div', { style: 'min-width:0' },
            title,
            el('span', { class: 'crow-meta' }, fileName, ' · ', bytes(file.size)),
          ),
        ),
        versionCell(file),
        el('button', {
          class: isPinned ? 'pin on' : 'pin',
          title: isPinned
            ? 'Версия закреплена - обновления её не трогают'
            : 'Закрепить версию, чтобы обновления её не трогали',
          onclick: () => void guard(async () => {
            const next = await api.pinMod(id, file.file, !isPinned);
            pinned = new Set(next);
            await load();
          }),
        }, icon(isPinned ? 'lock' : 'refresh', 13, 1.8), isPinned ? 'закреплено' : 'обновляется'),
        el('button', {
          class: 'btn btn-danger btn-s', style: 'padding:6px 10px', title: 'Удалить (в Корзину)',
          onclick: () => void guard(async () => {
            await api.removeMod(id, file.file, kind, scope());
            await load();
            toast(`«${file.file.replace(/\.disabled$/, '')}» в Корзине`);
          }),
        }, icon('trash', 15, 1.6)),
      );
    }));
  }

  function paintWorldList(): void {
    if (!worlds.length) {
      list.replaceChildren(emptyState('folder', 'Миров пока нет',
        'Они появятся, когда создашь мир в игре. Отсюда можно будет сделать копию мира в ZIP.'));
      return;
    }
    list.replaceChildren(...worlds.map((item) =>
      el('div', { class: 'crow' },
        // Первая буква названия, как у модов без картинки: пустой квадрат выглядел недогруженным.
        el('div', { class: 'row-ico row-ico-letter', style: 'width:34px;height:34px;border-radius:9px;font-size:14px' },
          item.name.trim().slice(0, 1).toUpperCase()),
        el('div', { style: 'min-width:0' },
          el('b', { style: 'font-family:var(--display);font-weight:500;font-size:14.5px;display:block' }, item.name),
          el('span', { style: 'font-size:12px;color:var(--dim)' },
            `${plural(item.datapacks, 'датапак', 'датапака', 'датапаков')} · ${ago(item.lastPlayed)}`),
        ),
        el('button', {
          class: 'vbtn',
          onclick: () => {
            kind = 'datapack';
            showingWorlds = false;
            world = item.folder;
            paintTabs();
            paintWorldBar();
            void load();
          },
        }, el('span', { style: 'flex:1;text-align:left' }, 'Датапаки мира'), icon('chevron', 13, 2)),
        el('button', {
          class: 'vbtn', title: 'Сохранить копию мира в ZIP',
          onclick: () => void guard(async () => {
            const saved = await api.backupWorld(id, item.folder);
            // null - окно сохранения закрыли: молчим, отменённое действие не новость.
            if (saved) toast(`Мир сохранён · ${bytes(saved.size)}`);
          }),
        }, el('span', { style: 'flex:1;text-align:left' }, 'Бэкап'), icon('download', 13, 2)),
        el('span', {}),
      )));
  }

  /** Скриншоты плиткой: клик открывает картинку, корзина убирает её в корзину Windows. */
  async function paintShots(): Promise<void> {
    const shots = await api.screenshots(id).catch(() => [] as Screenshot[]);
    if (!showingShots) return;
    if (!shots.length) {
      list.replaceChildren(emptyState('info', 'Скриншотов пока нет',
        'В игре их делает клавиша F2. Отсюда их можно открыть или убрать в корзину.'));
      return;
    }
    list.replaceChildren(el('div', { class: 'shots' },
      ...shots.map((shot) =>
        el('figure', { class: 'shot' },
          el('img', {
            src: shot.url, alt: shot.file, loading: 'lazy', title: 'Открыть',
            onclick: () => void guard(() => api.openScreenshot(id, shot.file)),
          }),
          el('figcaption', {},
            el('span', {}, `${ago(shot.at)} · ${bytes(shot.size)}`),
            el('button', {
              class: 'shot-del', title: 'В корзину',
              onclick: () => void guard(async () => {
                await api.trashScreenshot(id, shot.file);
                toast('Скриншот в корзине');
                await paintShots();
                void refreshCounts();
              }),
            }, icon('trash', 14, 1.6)),
          ),
        )),
    ));
  }

  // Номер запроса: пока шёл медленный ответ, человек мог выбрать другое - тогда старый ответ
  // пришёл бы последним и затёр свежий. Опоздавший ответ просто выбрасываем.
  let loadTicket = 0;
  async function load(): Promise<void> {
    const ticket = ++loadTicket;
    if (showingShots) { await paintShots(); return; }
    if (showingWorlds) { paintWorldList(); return; }
    let files: Awaited<ReturnType<typeof api.instanceContent>> = [];
    try {
      files = await api.instanceContent(id, kind, scope());
    } catch {
      files = [];
    }
    if (ticket !== loadTicket) return;
    paint(files);
    void refreshCounts();
  }

  /** Счётчики на вкладках считаются по папкам, так что файл, закинутый руками, тоже учитывается. */
  async function refreshCounts(): Promise<void> {
    const counts: Record<string, number> = {
      world: worlds.length,
      shots: (await api.screenshots(id).catch(() => [])).length,
    };
    await Promise.all(KINDS.map(async (item) => {
      counts[item.id] = (await api.instanceContent(
        id, item.id, item.id === 'datapack' ? world : '',
      ).catch(() => [])).length;
    }));
    paintTabs(counts);
  }

  void api.instanceWorlds(id).then((found) => {
    worlds = found;
    if (!world) world = found[0]?.folder ?? '';
    paintWorldBar();
    void refreshCounts();
    if (showingWorlds) paintWorldList();
  }).catch(() => { /* папки saves ещё нет */ });

  paintTabs();
  void load();

  const updateBox = el('div');

  /** Блок найденных обновлений с кнопкой «Обновить» у каждого мода. */
  function paintUpdates(updates: ModUpdate[]): void {
    if (!updates.length) { updateBox.replaceChildren(); return; }
    updateBox.replaceChildren(
      el('div', { class: 'grp', style: 'margin-bottom:18px;border-color:rgba(80,231,173,.3)' },
        el('p', { class: 'eyebrow', style: 'margin-bottom:12px' },
          plural(updates.length, 'обновление', 'обновления', 'обновлений')),
        ...updates.map((update) => {
          const row = el('div', {
            style: 'display:flex;align-items:center;gap:13px;padding:9px 0',
          },
            el('div', { style: 'min-width:0;flex:1' },
              el('b', { style: 'font-family:var(--display);font-weight:500;font-size:14px' },
                update.name),
              el('div', { class: 'mono', style: 'font-size:11.5px;color:var(--dim)' },
                `${update.current} → ${update.latest}`),
            ),
            el('button', {
              class: 'btn btn-ghost btn-s',
              onclick: (event: Event) => {
                const button = event.currentTarget as HTMLButtonElement;
                void guard(async () => {
                  button.disabled = true;
                  button.textContent = 'Ставлю…';
                  await api.applyModUpdate(id, update);
                  row.remove();
                  // Ушла последняя строка - убираем и заголовок блока.
                  if (!updateBox.querySelector('.mono')) updateBox.replaceChildren();
                  await load();
                  toast(`${update.name} обновлён`);
                }).finally(() => { button.disabled = false; });
              },
            }, 'Обновить'),
          );
          return row;
        }),
      ),
    );
  }

  const job = ctx.progress.get(id);
  const running = ctx.state.running.includes(id);

  // Память этой сборки. Ровно её лаунчер и отдаёт игре (-Xmx), так что крутить надо здесь.
  const memoryShown = el('b', {
    style: 'display:block;font-family:var(--display);font-weight:500;font-size:18px;margin-top:6px',
  }, `${instance.memory} МБ`);
  const memorySlider = el('input', {
    type: 'range', min: 1024, max: 16384, step: 512, value: instance.memory,
    title: 'Сколько памяти отдать игре в этой сборке',
    style: 'width:100%;margin-top:8px;accent-color:#9f86ff',
  }) as HTMLInputElement;
  memorySlider.addEventListener('input', () => { memoryShown.textContent = `${memorySlider.value} МБ`; });
  memorySlider.addEventListener('change', () => void guard(async () => {
    await api.setInstanceMemory(id, Number(memorySlider.value));
    await ctx.reload();
    toast(running ? 'Память сохранена - сработает со следующего запуска' : 'Память сохранена');
  }));
  const memoryTile = el('div', {}, memoryShown, memorySlider);

  /**
   * Окно смены версии игры и загрузчика.
   *
   * Раньше выбор при создании оставался навсегда: собравшему сборку кнопкой «Собрать за меня»
   * оставалось завести вторую сборку и перетащить моды руками. Открывается прямо с карточек
   * «Версия игры» и «Загрузчик модов» - там, где человек эту версию и видит.
   */
  const changeVersion = (): void => {
    if (running) { toast('Сначала закрой игру - версию на ходу не поменять', true); return; }
    const picker = versionPicker({
      minecraft: instance.minecraft,
      loader: instance.loader,
      loaderVersion: instance.loaderVersion,
    });
    modal({
      title: 'Сменить версию',
      note: 'Моды, конфиги и миры останутся на месте - переставится только сама игра. '
        + 'Моды от прежней версии могут не подойти: если игра перестанет запускаться, обнови '
        + 'их на вкладке «Моды» или отключи.',
      content: picker.element,
      confirm: 'Сменить',
      onConfirm: () => void guard(async () => {
        // Списки могли ещё не догрузиться - ждём, иначе уедут пустые значения.
        await picker.ready;
        const choice = picker.value();
        await api.setInstanceVersion(id, choice.minecraft, choice.loader, choice.loaderVersion);
        await ctx.reload();
        toast(choice.loader === 'vanilla'
          ? `Теперь ${choice.minecraft} без модов - игра переставится при запуске`
          : `Теперь ${choice.minecraft} · ${loaderName(choice.loader)} ${choice.loaderVersion}`);
        // Моды остались от прежней версии - разбираем их сразу, не дожидаясь вылета.
        // У чистой сборки без модов разбирать нечего, и лишнее окно ни к чему.
        await offerModFit(ctx, id, choice.minecraft);
      }),
    });
  };

  // «Обновить всё» ищет свежие версии модов, паков и шейдеров. У миров и скриншотов
  // обновлять нечего, поэтому на этих вкладках кнопку прячем (см. paintTabs).
  updateAll = el('button', {
    class: 'btn btn-ghost btn-s',
    onclick: (event: Event) => {
      const button = event.currentTarget as HTMLButtonElement;
      void guard(async () => {
        button.disabled = true;
        button.textContent = 'Проверяю…';
        const updates = await api.checkModUpdates(id);
        paintUpdates(updates);
        toast(updates.length
          ? `${plural(updates.length, 'обновление', 'обновления', 'обновлений')} доступно`
          : 'Всё свежее');
      }).finally(() => {
        button.disabled = false;
        button.replaceChildren(icon('refresh', 14, 1.6), 'Обновить всё');
      });
    },
  }, icon('refresh', 14, 1.6), 'Обновить всё') as HTMLButtonElement;
  updateAll.hidden = showingWorlds || showingShots;

  const body = el('div', { class: 'body' },
    el('div', { style: 'display:grid;grid-template-columns:repeat(4, minmax(0, 1fr));gap:12px;margin-bottom:18px' },
      ...[
        ['ВЕРСИЯ ИГРЫ', instance.minecraft],
        // Загрузчик и его версия - одна мысль, и в одной карточке подпись перестала
        // переноситься на две строки и ломать ряд.
        ['ЗАГРУЗЧИК МОДОВ', instance.loader === 'vanilla'
          ? 'без модов'
          : `${loaderName(instance.loader)} ${instance.loaderVersion}`.trim()],
        ['ПАМЯТЬ', memoryTile],
        ['В ИГРЕ', instance.playSeconds ? playtime(instance.playSeconds) : '-'],
      ].map(([label, value]) => {
        // Две первые карточки - это и есть версия сборки, поэтому они кликабельны:
        // искать смену версии в ряду мелких кнопок внизу никто не станет.
        const editable = label === 'ВЕРСИЯ ИГРЫ' || label === 'ЗАГРУЗЧИК МОДОВ';
        return el(editable ? 'button' : 'div', {
          class: editable ? 'grp grp-act' : 'grp',
          style: 'padding:16px 18px',
          title: editable ? 'Сменить версию игры или загрузчик' : '',
          onclick: editable ? changeVersion : undefined,
        },
          el('span', { style: 'display:block;font-size:11.5px;color:var(--dim)' }, label as string),
          typeof value === 'string'
            ? el('b', {
                style: 'display:block;font-family:var(--display);font-weight:500;font-size:18px;margin-top:6px',
              }, value)
            : value,
          editable ? el('span', { class: 'grp-act-hint' }, 'сменить') : null,
        );
      }),
    ),

    job && !job.done
      ? el('div', { class: 'grp', style: 'margin-bottom:18px' },
          el('div', { style: 'display:flex;gap:12px;align-items:baseline' },
            el('b', { style: 'font-family:var(--display);font-weight:500' }, job.stage),
            el('span', { 'data-speed': id, class: 'mono', style: 'margin-left:auto;font-size:11.5px;color:var(--dim)' },
              `${bytes(job.bytesPerSecond)}/с`),
          ),
          el('div', { class: 'bar', style: 'margin-top:12px' },
            el('i', { 'data-bar': id, style: `width:${job.total ? Math.round((job.progress / job.total) * 100) : 0}%` })),
        )
      : null,

    updateBox,

    // Вкладки стоят прямо над списком, который они переключают. Раньше они были вверху экрана,
    // над карточками, и после нажатия видимая часть экрана не менялась: новый список
    // начинался ниже. Строка прилипает к верху при прокрутке длинного списка модов.
    el('div', { class: 'content-head' },
      tabs,
      el('div', { class: 'content-acts' },
      updateAll,
      el('button', {
        class: 'btn btn-ghost btn-s',
        onclick: () => void guard(() => api.openInstanceFolder(id)),
      }, icon('folder', 14, 1.6), 'Папка'),
      el('button', {
        class: 'btn btn-ghost btn-s',
        onclick: () => ctx.go({ name: 'content' }),
      }, icon('plus', 14, 1.8), 'Добавить'),
      ),
    ),
    worldBar,
    list,

    el('div', { style: 'display:flex;gap:11px;margin-top:22px' },
      el('button', {
        class: 'btn btn-ghost btn-s',
        onclick: () => void guard(async () => {
          const updated = await api.pickCover(id);
          if (!updated) return;
          await ctx.reload();
          toast('Обложка сборки обновлена');
        }),
      }, icon('folder', 14, 1.6), instance.cover ? 'Сменить обложку' : 'Обложка'),
      instance.cover
        ? el('button', {
            class: 'btn btn-ghost btn-s',
            onclick: () => void guard(async () => {
              await api.clearCover(id);
              await ctx.reload();
              toast('Обложка убрана');
            }),
          }, 'Убрать обложку')
        : null,
      // Переименование, копия и экспорт - то, чего в лаунчере не было вовсе: название сборки
      // нельзя было поменять, а поделиться ею - никак.
      el('button', {
        class: 'btn btn-ghost btn-s',
        onclick: () => {
          const field = el('input', { value: instance.name, maxlength: 40 }) as HTMLInputElement;
          modal({
            title: 'Новое название',
            note: 'Меняется только подпись. Папка сборки, миры и моды остаются на месте.',
            content: el('label', { class: 'field', style: 'margin-top:14px' }, field),
            confirm: 'Переименовать',
            onConfirm: () => void guard(async () => {
              await api.renameInstance(id, field.value);
              await ctx.reload();
              toast('Переименовано');
            }),
          });
        },
      }, 'Переименовать'),

      el('button', {
        class: 'btn btn-ghost btn-s',
        title: 'Копия со всеми модами, конфигами и мирами - чтобы эксперименты не трогали оригинал',
        onclick: (event: Event) => {
          const button = event.currentTarget as HTMLButtonElement;
          void guard(async () => {
            button.disabled = true;
            button.textContent = 'Копирую…';
            try {
              const copy = await api.duplicateInstance(id);
              await ctx.reload();
              ctx.go({ name: 'instance', id: copy.id });
              toast(`Готова копия «${copy.name}»`);
            } finally {
              button.disabled = false;
              button.textContent = 'Копия';
            }
          });
        },
      }, 'Копия'),
      el('button', {
        class: 'btn btn-ghost btn-s',
        title: 'Код для друга, отправка в чат или файл .mrpack',
        onclick: () => shareDialog(id, shareTargets()),
      }, icon('external', 14, 1.6), 'Поделиться'),
      el('button', {
        class: 'btn btn-danger btn-s', style: 'margin-left:auto',
        // Раньше клик сносил папку сборки сразу. Один промах мышью - и мира со ста часами нет.
        onclick: () => modal({
          title: `Удалить «${instance.name}»?`,
          note: 'Папка сборки - моды, конфиги, скриншоты и миры - уйдёт в Корзину Windows. '
            + 'Передумаешь - восстанови её оттуда, пока Корзину не очистили.',
          confirm: 'Удалить',
          danger: true,
          onConfirm: () => void guard(async () => {
            await api.removeInstance(id, true);
            await ctx.reload();
            ctx.go({ name: 'library' });
            toast('Сборка удалена - папка в Корзине');
          }),
        }),
      }, icon('trash', 14, 1.6), 'Удалить сборку'),
    ),
  );

  // Файлы можно перетащить прямо в окно: .jar уходят в моды, .zip - в открытую вкладку.
  body.append(el('div', { class: 'drop-hint' },
    icon('download', 30, 1.6),
    el('b', {}, 'Отпусти, чтобы добавить в сборку'),
    el('span', {}, '.jar - в моды, .zip - в открытую вкладку (с «Модов» - в ресурс-паки)'),
  ));
  let dragDepth = 0;
  const carriesFiles = (event: DragEvent): boolean => Boolean(event.dataTransfer?.types.includes('Files'));
  body.addEventListener('dragenter', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    body.classList.add('dropping');
  });
  body.addEventListener('dragover', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  // dragenter/dragleave приходят на каждый вложенный элемент, поэтому считаем глубину, а не флаг.
  body.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) body.classList.remove('dropping');
  });
  body.addEventListener('drop', (event) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    body.classList.remove('dropping');
    const paths = [...(event.dataTransfer?.files ?? [])].map((file) => api.pathForFile(file)).filter(Boolean);
    if (!paths.length) return;
    void guard(async () => {
      const result = await api.importFiles(id, kind, kind === 'datapack' ? world : '', paths);
      if (!result.added.length) {
        toast(`Ничего не добавлено: ${result.skipped.join(', ')} - не .jar/.zip или такой файл уже есть`, true);
        return;
      }
      burst(event.clientX, event.clientY, '#50e7ad');
      toast(`Добавлено: ${result.added.map((item) => item.file).join(', ')}`
        + (result.skipped.length ? ` · пропущено: ${result.skipped.length}` : ''));
      // Показываем вкладку, куда лёг первый файл, чтобы было видно, что он там.
      kind = result.added[0]!.kind;
      showingWorlds = false;
      showingShots = false;
      paintTabs();
      paintWorldBar();
      await load();
    });
  });

  const footer = el('footer', { class: 'play' },
    el('div', { class: `play-art tile-art ${instance.accent}` }),
    el('div', {},
      el('b', { style: 'font-family:var(--display);font-weight:500;font-size:15.5px' }, instance.name),
      el('div', { class: 'mono', style: 'font-size:11.5px;color:var(--dim);margin-top:3px' },
        `${describe(instance)} · ${instance.installed ? 'установлена' : 'не установлена'}`),
    ),
    el('button', {
      class: 'btn btn-main',
      style: 'margin-left:auto;padding:14px 40px;font-size:15px;letter-spacing:.04em',
      disabled: running,
      onclick: (e: Event) => {
        const m = e as MouseEvent;
        const button = e.currentTarget as HTMLButtonElement;
        burst(m.clientX, m.clientY, '#50e7ad');
        scareOnPlay();
        setPlayPending(button, true);
        void guard(async () => {
          if (!(await bugfixOnPlay())) return;
    await api.launchStart(id);
          await ctx.reload();
        }).finally(() => setPlayPending(button, false));
      },
    }, play(), running ? 'ЗАПУЩЕНА' : ctx.text('play.button', 'ИГРАТЬ')),
  );

  return frame({
    title: instance.name,
    sub: describe(instance),
    body,
    footer,
    back: () => ctx.go({ name: 'library' }),
  });
}

// ---------------------------------------------------------------- Контент (поиск и установка)

/**
 * Один экран для всего, что можно поставить: моды, ресурс-паки, датапаки, шейдеры.
 *
 * Вид контента - вкладка, а не отдельная страница: действие всегда одно и то же (найти, выбрать
 * версию, поставить в сборку). Отличаются только папка и то, что датапак ставится в мир, -
 * поэтому выбор мира есть только на вкладке датапаков.
 */
export function contentScreen(ctx: Ctx): HTMLElement {
  const instance = ctx.state.instances.find((i) => i.id === ctx.state.selectedInstance)
    ?? ctx.state.instances[0];

  let kind: Kind = 'mod';
  let source: 'modrinth' | 'curseforge' = 'modrinth';
  let query = '';
  let worlds: World[] = [];
  let world = '';

  const results = el('div', { class: 'list results' });
  const worldBar = el('div');
  const sourceRow = el('div', { class: 'segment' });
  const input = el('input', { placeholder: 'Поиск модов' });
  const countLabel = el('span', { class: 'mono', style: 'margin-left:auto;font-size:11.5px;color:var(--dim)' });

  const tabs = el('div', { style: 'flex:none' });

  function paintTabs(): void {
    tabs.replaceChildren(tabRow(KINDS, kind, (next) => {
      kind = next as Kind;
      input.setAttribute('placeholder', `Поиск ${kindMany(kind)}`);
      paintTabs();
      paintWorlds();
      void run();
    }, countLabel));
  }

  /**
   * Полоса выбора мира - только на вкладке датапаков.
   * Датапак игра читает из папки конкретного мира, поэтому без выбранного мира «Установить» не имеет смысла.
   */
  function paintWorlds(): void {
    if (kind !== 'datapack') { worldBar.replaceChildren(); return; }
    if (!worlds.length) {
      worldBar.replaceChildren(el('div', { class: 'note', style: 'margin-bottom:14px' },
        'Миров пока нет. Создай мир в игре.'));
      return;
    }
    worldBar.replaceChildren(
      el('div', { class: 'note', style: 'display:flex;align-items:center;gap:12px;margin-bottom:14px' },
        icon('folder', 17, 1.8),
        el('span', {}, 'Датапак ставится в выбранный мир.'),
        el('div', { style: 'margin-left:auto;display:flex;gap:8px;flex-wrap:wrap' },
          ...worlds.map((item) =>
            el('button', {
              class: item.folder === world ? 'chip on' : 'chip',
              onclick: () => { world = item.folder; paintWorlds(); },
            }, item.name)),
        ),
      ),
    );
  }

  /** Переключатель Modrinth / CurseForge. */
  function paintSources(): void {
    sourceRow.replaceChildren(
      ...(['modrinth', 'curseforge'] as const).map((id) =>
        el('button', {
          class: id === source ? 'on' : '',
          onclick: () => { source = id; paintSources(); void run(); },
        },
          el('i', {
            style: 'width:7px;height:7px;border-radius:50%;background:'
              + (id === source ? (id === 'modrinth' ? 'var(--aurora)' : 'var(--kawaii)') : 'var(--dim)'),
          }),
          id === 'modrinth' ? 'Modrinth' : 'CurseForge',
        )),
    );
  }

  /** Ставит проект и показывает результат прямо на кнопке («Ставлю…» → «Готово»). */
  function runInstall(button: HTMLButtonElement, hit: ModHit, versionId?: string, label?: string): void {
    if (!instance) return;
    if (kind === 'datapack' && !world) {
      toast('Сначала выбери мир - датапак ставится в мир.', true);
      return;
    }
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Ставлю…';
    void guard(async () => {
      const done = await api.installMod({
        id: instance.id, source: hit.source, projectId: hit.id, kind, world, versionId,
      });
      button.textContent = 'Готово';
      button.classList.add('done');
      toast(`${hit.name} ${label ?? done.version} - в сборке «${instance.name}»`);
    }).finally(() => {
      if (button.textContent === 'Ставлю…') {
        button.disabled = false;
        button.textContent = original;
      }
    });
  }

  /**
   * Список версий проекта - загружается только по клику на стрелку.
   * Иначе страница из 20 результатов делала бы 20 лишних запросов, а лимит запросов Modrinth общий с поиском.
   */
  function openVersions(caret: HTMLButtonElement, main: HTMLButtonElement, hit: ModHit): void {
    if (!instance) return;
    const list = el('div', {}, loadingBox('Читаю версии…'));
    const close = popup(caret, () =>
      el('div', {},
        el('div', { class: 'vmenu-head' },
          el('span', { class: 'eyebrow', style: 'margin:0' }, 'Версия файла'),
        ),
        list,
      ));

    void (async () => {
      let all: ContentVersion[];
      try {
        all = await api.modVersions(instance.id, hit.source, hit.id, kind);
      } catch (error) {
        list.replaceChildren(el('div', { class: 'err' },
          error instanceof Error ? error.message : String(error)));
        return;
      }
      if (!all.length) {
        list.replaceChildren(el('div', { class: 'empty', style: 'padding:26px' }, 'Версий нет.'));
        return;
      }
      fillVersionList(list, all, null, (version) => {
        close();
        runInstall(main, hit, version.id, version.label);
      });
    })();
  }

  let searchTicket = 0;
  /** Сколько результатов уже показано - с этого места «Показать ещё» продолжает поиск. */
  let shown = 0;
  const PAGE = 20;

  /** Поиск и отрисовка результатов. `more` - дописать следующую страницу к уже показанным. */
  async function run(more = false): Promise<void> {
    if (!instance) {
      results.replaceChildren(emptyState('library', 'Сначала нужна сборка',
        'Моды ставятся внутрь сборки, поэтому сперва создай её в «Библиотеке».'));
      countLabel.textContent = '';
      return;
    }
    if (!more) { shown = 0; results.replaceChildren(loadingBox('Ищу…')); }
    const ticket = ++searchTicket;
    let hits: ModHit[];
    try {
      hits = await api.searchMods({
        source, query, minecraft: instance.minecraft, loader: instance.loader, offset: shown, kind,
      });
      // Человек допечатал запрос или сменил вкладку - этот ответ уже никому не нужен.
      if (ticket !== searchTicket) return;
    } catch (error) {
      if (ticket !== searchTicket) return;
      countLabel.textContent = '';
      results.replaceChildren(el('div', { class: 'err' },
        error instanceof Error ? error.message : String(error)));
      return;
    }
    if (!hits.length && !more) {
      countLabel.textContent = `0 ${kindMany(kind)}`;
      results.replaceChildren(emptyState('search', 'Ничего не нашлось',
        'Попробуй другое слово или переключи источник: часть модов есть только на CurseForge.'));
      return;
    }
    shown += hits.length;
    countLabel.textContent = `${shown} ${kindMany(kind)}`;
    results.querySelector('.more-row')?.remove();
    const rows = hits.map((hit) => hitRow(hit, instance));
    if (more) results.append(...rows); else results.replaceChildren(...rows);
    // Полная страница - значит, дальше, скорее всего, есть ещё. Раньше было видно только первые 20.
    if (hits.length >= PAGE) {
      const button = el('button', { class: 'btn btn-ghost' }, 'Показать ещё');
      button.addEventListener('click', () => {
        button.disabled = true;
        button.textContent = 'Ищу…';
        void run(true).finally(() => { if (button.isConnected) { button.disabled = false; button.textContent = 'Показать ещё'; } });
      });
      results.append(el('div', { class: 'more-row' }, button));
    }
  }

  function hitRow(hit: ModHit, instance: NonNullable<typeof ctx.state.instances[number]>): HTMLElement {
    {
      const main = el('button', { class: 'split-main' }, 'Установить');
      const caret = el('button', { class: 'split-caret', title: 'Выбрать версию' },
        icon('chevron', 14, 2));
      main.addEventListener('click', () => runInstall(main, hit));
      caret.addEventListener('click', () => openVersions(caret, main, hit));

      return el('div', {
        class: 'row',
        style: hit.downloadable ? '' : 'border-color:rgba(255,120,189,.26);background:rgba(255,120,189,.035)',
      },
        hit.icon
          ? el('img', { class: 'row-ico', src: hit.icon, alt: '', loading: 'lazy', decoding: 'async' })
          // Без картинки показываем первую букву: пустой квадрат выглядел как сломанная загрузка.
          : el('div', { class: 'row-ico row-ico-letter' }, hit.name.slice(0, 1).toUpperCase()),
        el('div', { style: 'min-width:0;flex:1' },
          el('div', { style: 'display:flex;align-items:baseline;gap:10px;min-width:0' },
            el('b', {}, hit.name),
            el('span', { style: 'font-size:12.5px;color:var(--dim)' }, hit.author),
          ),
          el('p', {}, hit.summary),
          hit.downloadable
            ? el('div', { class: 'row-meta' },
                el('span', {}, `${count(hit.downloads)} загрузок`),
                el('span', {}, instance.minecraft),
                el('span', {}, kind === 'mod' ? loaderName(instance.loader) : kindLabel(kind)),
              )
            : el('div', { style: 'display:flex;align-items:center;gap:9px;margin-top:10px' },
                icon('lock', 15, 1.7),
                el('span', { style: 'font-size:12.5px;color:var(--kawaii)' },
                  ctx.text('curseforge.blocked', 'Автор запретил скачивание вне CurseForge')),
              ),
        ),
        hit.downloadable
          ? el('div', { class: 'split' }, main, caret)
          : el('button', {
              class: 'btn btn-ghost btn-s',
              onclick: () => void guard(() => api.openExternal(hit.pageUrl)),
            }, 'Открыть на сайте', icon('external', 13, 1.8)),
      );
    }
  }

  input.addEventListener('input', () => { query = input.value; });
  input.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter') void run();
  });

  paintTabs();
  paintSources();
  void run();
  if (instance) {
    void api.instanceWorlds(instance.id).then((list) => {
      worlds = list;
      world = list[0]?.folder ?? '';
      paintWorlds();
    }).catch(() => { /* папки saves ещё нет - об этом и так скажет подсказка */ });
  }

  const body = el('div', { class: 'body' },
    el('div', { style: 'display:flex;align-items:center;gap:12px;margin-bottom:14px' },
      el('label', { class: 'field', style: 'flex:1' }, icon('search', 16, 1.7), input),
      sourceRow,
      el('button', { class: 'btn btn-ghost btn-s', onclick: () => void run() }, 'Искать'),
    ),
    worldBar,
    results,
  );

  // Если сборок несколько - выбор сборки прямо в шапке, чтобы было видно, куда ставим,
  // и не надо было ходить в библиотеку. Свой список вместо <select>: в окне без рамки Electron
  // системный список открывается ненадёжно и не красится в тему лаунчера.
  const picker = ctx.state.instances.length > 1 ? instancePicker(ctx, instance?.id) : null;

  return frame({
    title: 'Моды и дополнения',
    sub: instance ? `ставим в «${instance.name}»` : 'нет сборки',
    extra: picker,
    tabs,
    body,
  });
}

// ---------------------------------------------------------------- Загрузки

export function downloadsScreen(ctx: Ctx): HTMLElement {
  const jobs = [...ctx.progress.values()];
  const active = jobs.filter((job) => !job.done);
  const finished = jobs.filter((job) => job.done);

  const body = el('div', { class: 'body' });

  if (!jobs.length) {
    body.append(emptyState('download', 'Пока ничего не качается',
      'Здесь видно прогресс установки игры, загрузчика и модов - вместе со скоростью и остатком.'));
  }

  for (const job of active) {
    const instance = ctx.state.instances.find((i) => i.id === job.instanceId);
    const percent = job.total ? Math.round((job.progress / job.total) * 100) : 0;
    body.append(
      el('div', { class: 'grp', style: 'margin-bottom:14px;border-color:rgba(159,134,255,.3)' },
        el('div', { style: 'display:flex;align-items:center;gap:14px' },
          el('div', {},
            el('b', { style: 'font-family:var(--display);font-weight:500;font-size:17px' },
              instance?.name ?? job.instanceId),
            el('div', { style: 'font-size:13px;color:var(--muted);margin-top:3px' }, job.stage),
          ),
          el('button', {
            class: 'btn btn-danger btn-s', style: 'margin-left:auto',
            onclick: () => void guard(() => api.installCancel(job.instanceId)),
          }, 'Отменить'),
        ),
        el('div', { class: 'bar', style: 'margin-top:18px' }, el('i', { 'data-bar': job.instanceId, style: `width:${percent}%` })),
        el('div', {
          class: 'mono',
          style: 'display:flex;gap:20px;margin-top:11px;font-size:11.5px;color:var(--dim)',
        },
          el('span', { 'data-percent': job.instanceId, style: 'color:var(--cosmic)' }, `${percent}%`),
          el('span', { 'data-bytes': job.instanceId }, progressAmount(job.progress, job.total, job.unit)),
          el('span', { 'data-speed': job.instanceId }, `${bytes(job.bytesPerSecond)}/с`),
        ),
      ),
    );
  }

  if (finished.length) {
    // Раньше «Завершённые» только копились до перезапуска лаунчера, убрать их было нечем.
    body.append(el('div', { style: 'display:flex;align-items:center;gap:12px;margin-top:24px' },
      el('p', { class: 'eyebrow', style: 'margin:0' }, 'Завершённые'),
      el('button', {
        class: 'btn btn-ghost btn-s', style: 'margin-left:auto',
        onclick: () => {
          for (const job of finished) ctx.progress.delete(job.instanceId);
          ctx.go({ name: 'downloads' });
        },
      }, icon('trash', 13, 1.7), 'Очистить'),
    ));
    body.append(el('div', { class: 'card' },
      ...finished.map((job) => {
        const instance = ctx.state.instances.find((i) => i.id === job.instanceId);
        return el('div', { class: 'mrow', style: 'grid-template-columns:32px 1fr 120px' },
          el('span', { style: job.error ? 'color:var(--kawaii)' : 'color:var(--aurora)' },
            icon(job.error ? 'info' : 'check', 16, 2)),
          el('div', {},
            el('b', { style: 'font-family:var(--display);font-weight:500;font-size:14px' },
              instance?.name ?? job.instanceId),
            job.error
              ? el('div', { style: 'font-size:12.5px;color:var(--kawaii)' }, job.error)
              : null,
          ),
          el('span', { class: 'mono', style: 'font-size:11.5px;color:var(--dim)' },
            job.error ? 'ошибка' : 'готово'),
        );
      })));
  }

  return frame({
    title: 'Загрузки',
    sub: plural(active.length, 'активная', 'активные', 'активных'),
    body,
  });
}

// ---------------------------------------------------------------- Аккаунты

/*
 * 3D-превью скина.
 *
 * Фигура собрана из коробок (голова, тело, руки, ноги и второй слой поверх), каждая коробка - шесть
 * граней на CSS-трансформациях. Ни WebGL, ни чужой библиотеки: шесть div-ов с кусками одной картинки
 * дают ровно то же, что и трёхмерный движок, но без новой зависимости.
 *
 * Размеры - в пикселях скина, на экран они переводятся множителем PIXEL.
 */
const PIXEL = 8;

interface SkinBox {
  /** Левый верхний угол развёртки этой коробки. */
  u: number; v: number;
  /** Ширина, высота и глубина в пикселях скина. */
  w: number; h: number; d: number;
  /** Смещение центра коробки от центра фигуры. */
  x: number; y: number;
  /** Левая конечность старого скина 64×32 - зеркало правой, как в самой игре. */
  mirror?: boolean;
  /** Второй слой чуть крупнее основного, иначе грани наложились бы друг на друга и мерцали. */
  puff?: boolean;
}

/**
 * Одна коробка: шесть граней.
 *
 * Развёртка любой части устроена одинаково - сверху крышка и дно, ниже четыре боковые грани
 * в порядке «правая, перёд, левая, зад». Поэтому координаты граней считаются формулой,
 * а не переписываются числами для каждой части.
 */
function skinBox(box: SkinBox, sheet: string, sheetHeight: number): HTMLElement {
  const { u, v, w, h, d } = box;
  const faces: { fw: number; fh: number; ux: number; uy: number; transform: string }[] = [
    { fw: w, fh: d, ux: u + d, uy: v, transform: `rotateX(90deg) translateZ(${(h / 2) * PIXEL}px)` },
    { fw: w, fh: d, ux: u + d + w, uy: v, transform: `rotateX(-90deg) translateZ(${(h / 2) * PIXEL}px)` },
    { fw: d, fh: h, ux: u, uy: v + d, transform: `rotateY(-90deg) translateZ(${(w / 2) * PIXEL}px)` },
    { fw: w, fh: h, ux: u + d, uy: v + d, transform: `translateZ(${(d / 2) * PIXEL}px)` },
    { fw: d, fh: h, ux: u + d + w, uy: v + d, transform: `rotateY(90deg) translateZ(${(w / 2) * PIXEL}px)` },
    { fw: w, fh: h, ux: u + d + w + d, uy: v + d, transform: `rotateY(180deg) translateZ(${(d / 2) * PIXEL}px)` },
  ];

  const element = el('div', {
    class: 'skin3d-box',
    style: `width:${w * PIXEL}px;height:${h * PIXEL}px;`
      + `margin-left:${-(w * PIXEL) / 2}px;margin-top:${-(h * PIXEL) / 2}px;`
      + `transform:translate3d(${box.x * PIXEL}px,${box.y * PIXEL}px,0)`
      + (box.mirror ? ' scaleX(-1)' : '') + (box.puff ? ' scale(1.07)' : ''),
  },
    ...faces.map((face) => el('div', {
      class: 'skin3d-face',
      style: `width:${face.fw * PIXEL}px;height:${face.fh * PIXEL}px;`
        + `margin-left:${-(face.fw * PIXEL) / 2}px;margin-top:${-(face.fh * PIXEL) / 2}px;`
        + `background-image:url("${sheet}");`
        // Растягиваем всю развёртку и сдвигаем её так, чтобы в окошко грани попал нужный кусок.
        + `background-size:${64 * PIXEL}px ${sheetHeight * PIXEL}px;`
        + `background-position:${-face.ux * PIXEL}px ${-face.uy * PIXEL}px;`
        + `transform:${face.transform}`,
    })),
  );
  return element;
}

/**
 * Собирает фигуру по картинке скина. Вращается сама; если потянуть мышью - слушается руки.
 *
 * Высота фигуры 32 пикселя скина, центр - на 16-м, от него и считаются смещения частей.
 */
function skinFigure(dataUrl: string, model: SkinModel, sheetHeight: number): HTMLElement {
  const legacy = sheetHeight === 32;
  const arm = model === 'slim' ? 3 : 4;
  const armX = 4 + arm / 2;

  const boxes: SkinBox[] = [
    { u: 0, v: 0, w: 8, h: 8, d: 8, x: 0, y: -12 },                      // голова
    { u: 16, v: 16, w: 8, h: 12, d: 4, x: 0, y: -2 },                    // тело
    { u: 40, v: 16, w: arm, h: 12, d: 4, x: -armX, y: -2 },              // правая рука
    { u: 0, v: 16, w: 4, h: 12, d: 4, x: -2, y: 10 },                    // правая нога
    legacy
      ? { u: 40, v: 16, w: arm, h: 12, d: 4, x: armX, y: -2, mirror: true }
      : { u: 32, v: 48, w: arm, h: 12, d: 4, x: armX, y: -2 },           // левая рука
    legacy
      ? { u: 0, v: 16, w: 4, h: 12, d: 4, x: 2, y: 10, mirror: true }
      : { u: 16, v: 48, w: 4, h: 12, d: 4, x: 2, y: 10 },                // левая нога
    { u: 32, v: 0, w: 8, h: 8, d: 8, x: 0, y: -12, puff: true },         // шапка
  ];

  // Второй слой на теле и конечностях есть только у новых скинов 64×64.
  if (!legacy) {
    boxes.push(
      { u: 16, v: 32, w: 8, h: 12, d: 4, x: 0, y: -2, puff: true },        // куртка
      { u: 40, v: 32, w: arm, h: 12, d: 4, x: -armX, y: -2, puff: true },  // правый рукав
      { u: 48, v: 48, w: arm, h: 12, d: 4, x: armX, y: -2, puff: true },   // левый рукав
      { u: 0, v: 32, w: 4, h: 12, d: 4, x: -2, y: 10, puff: true },        // правая штанина
      { u: 0, v: 48, w: 4, h: 12, d: 4, x: 2, y: 10, puff: true },         // левая штанина
    );
  }

  const figure = el('div', { class: 'skin3d-figure' },
    ...boxes.map((box) => skinBox(box, dataUrl, sheetHeight)));
  const stage = el('div', { class: 'skin3d', title: 'Потяни мышью, чтобы покрутить' }, figure);

  // Перетаскивание: своя анимация выключается классом, дальше углом правит рука.
  let rotationY = 0;
  let rotationX = -10;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  const apply = () => { figure.style.transform = `rotateX(${rotationX}deg) rotateY(${rotationY}deg)`; };

  stage.addEventListener('pointerdown', (event) => {
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    stage.classList.add('held');
    apply();
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    rotationY += (event.clientX - startX) * 0.6;
    // Наклон ограничен: без предела фигуру можно перевернуть вверх ногами и потерять.
    rotationX = Math.max(-60, Math.min(60, rotationX + (event.clientY - startY) * 0.3));
    startX = event.clientX;
    startY = event.clientY;
    apply();
  });
  const stop = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  };
  stage.addEventListener('pointerup', stop);
  stage.addEventListener('pointercancel', stop);

  return stage;
}

/**
 * Показывает скин в блоке: ждёт загрузку картинки (нужна её высота - 64 у новых, 32 у старых)
 * и ставит на место готовую фигуру.
 */
function showSkin(host: HTMLElement, dataUrl: string, model: SkinModel): void {
  const image = new Image();
  image.onload = () => host.replaceChildren(skinFigure(dataUrl, model, image.height === 32 ? 32 : 64));
  // Битый файл - не повод оставлять пустое место без объяснения.
  image.onerror = () => host.replaceChildren(el('div', { class: 'empty' }, 'Не получилось прочитать картинку скина.'));
  image.src = dataUrl;
}

/** Смена скина выбранного аккаунта. */
function skinPanel(ctx: Ctx): HTMLElement {
  const account = ctx.state.accounts.find((a) => a.id === ctx.state.selectedAccount);
  if (!account) {
    return el('div', { class: 'grp' },
      el('p', { class: 'eyebrow' }, 'Скин'),
      el('div', { class: 'empty' }, 'Выбери аккаунт, чтобы сменить скин.'));
  }

  // Скин офлайн-ника Minecraft сам не покажет - его видели только игроки с модом визуалов,
  // а мод из лаунчера убран. Остаются скины Mojang.
  if (account.kind === 'offline') {
    return el('div', { class: 'grp' },
      el('p', { class: 'eyebrow' }, `Скин · ${account.name}`),
      el('div', { class: 'note' },
        'Скин меняется только у аккаунта с лицензией.'));
  }
  const offline = false;
  // Фигуру пересобираем целиком при смене скина или модели рук: коробок мало, и это дешевле,
  // чем по очереди править шестьдесят граней.
  const stage = el('div', { class: 'skin-figure' });
  const status = el('div', { class: 'note', style: 'margin-top:14px' }, 'Загружаю текущий скин…');
  let model: SkinModel = 'classic';
  let picked: SkinFile | null = null;
  let shown: string | null = null;

  const show = (dataUrl: string) => { shown = dataUrl; showSkin(stage, dataUrl, model); };

  const modelButtons = (['classic', 'slim'] as const).map((id) => el('button', {
    class: 'btn btn-ghost btn-s',
    onclick: () => { model = id; paintModel(); if (shown) showSkin(stage, shown, model); },
  }, id === 'classic' ? 'Широкие руки' : 'Тонкие руки'));
  const paintModel = () => modelButtons.forEach((button, i) => {
    button.className = (i === 0) === (model === 'classic') ? 'btn btn-s' : 'btn btn-ghost btn-s';
  });
  paintModel();

  const applyButton = el('button', { class: 'btn btn-main', disabled: true }, 'Установить скин') as HTMLButtonElement;
  applyButton.addEventListener('click', () => void guard(async () => {
    if (!picked) return;
    applyButton.disabled = true;
    status.textContent = offline ? 'Загружаю на сайт…' : 'Загружаю в Mojang…';
    await api.applySkin(account.id, model, picked.png);
    forgetFace(account.id);
    picked = null;
    status.textContent = offline
      ? 'Готово. В игре скин появится в течение пары минут - мод перепроверяет ники сам.'
      : 'Готово. Скин обновится в игре после перезахода на сервер.';
    toast('Скин установлен');
  }).finally(() => { applyButton.disabled = !picked; }));

  const pickButton = el('button', {
    class: 'btn btn-ghost',
    onclick: () => void guard(async () => {
      const file = await api.pickSkin();
      if (!file) return;
      picked = file;
      show('data:image/png;base64,' + file.png);
      status.textContent = `Выбран ${file.name}${file.height === 32 ? ' (старый формат 64×32)' : ''}. `
        + 'Проверь модель рук и жми «Установить».';
      applyButton.disabled = false;
    }),
  }, icon('folder', 14, 1.7), 'Выбрать PNG');

  const resetButton = offline
    ? el('button', {
        class: 'btn btn-danger btn-s',
        onclick: () => void guard(async () => {
          await api.resetSkin(account.id);
          forgetFace(account.id);
          stage.replaceChildren();
          shown = null;
          status.textContent = 'Скин убран, в игре снова стандартный.';
        }),
      }, 'Убрать скин')
    : null;

  void (async () => {
    const skin = await api.currentSkin(account.id).catch(() => null);
    if (picked) return; // пока грузилось, уже выбрали новый файл
    if (!skin) { status.textContent = 'Своего скина пока нет.'; return; }
    model = skin.model;
    paintModel();
    show(skin.dataUrl);
    status.textContent = 'Сейчас стоит этот скин.';
  })();

  const where = el('p', { class: 'skin-note' },
    'Скин загрузится в профиль Mojang - его увидят все и на любых серверах.');

  return el('div', { class: 'grp skin-panel' },
    el('div', { class: 'skin-stage' }, stage),
    el('div', { style: 'min-width:0' },
      el('p', { class: 'eyebrow' }, `Скин · ${account.name}`),
      where,
      // Две равные половинки вместо кнопок разной ширины, переносившихся лесенкой.
      el('div', { class: 'skin-seg' }, ...modelButtons),
      el('div', { class: 'skin-acts' }, pickButton, applyButton, resetButton),
      status,
    ),
  );
}

export function accountsScreen(ctx: Ctx): HTMLElement {
  const nickField = el('input', { placeholder: 'Ник', maxlength: 16 });
  const microsoftBox = el('div');
  const addOfflineButton = el('button', {
    class: 'btn btn-ghost', style: 'width:100%;margin-top:14px',
    onclick: () => void guard(async () => {
      if (isDevName(nickField.value)) { devPrank(); return; }
      await api.addOffline(nickField.value);
      nickField.value = '';
      await ctx.reload();
    }),
  }, 'Добавить офлайн-аккаунт') as HTMLButtonElement;

  const body = el('div', { class: 'body' },
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:start;max-width:1100px' },

      el('div', {},
        el('p', { class: 'eyebrow' }, 'Сохранённые'),
        ctx.state.accounts.length
          ? el('div', { style: 'display:flex;flex-direction:column;gap:10px' },
              ...ctx.state.accounts.map((account) =>
                el('div', {
                  class: 'grp',
                  style: 'display:flex;align-items:center;gap:13px;padding:13px 15px;'
                    + (account.id === ctx.state.selectedAccount
                      ? 'border-color:rgba(159,134,255,.3);background:rgba(159,134,255,.08)' : ''),
                },
                  accountFace(account),
                  el('div', { style: 'min-width:0' },
                    el('b', { style: 'font-family:var(--display);font-weight:500;font-size:14.5px' },
                      account.name),
                    el('div', { class: 'mono', style: 'font-size:11px;color:var(--dim)' },
                      account.kind === 'microsoft' ? 'Microsoft' : 'Офлайн'),
                  ),
                  el('div', { style: 'margin-left:auto;display:flex;gap:8px' },
                    account.id === ctx.state.selectedAccount
                      ? el('span', { style: 'color:var(--aurora)' }, icon('check', 18, 2))
                      : el('button', {
                          class: 'btn btn-ghost btn-s',
                          onclick: () => void guard(async () => {
                            await api.selectAccount(account.id);
                            await ctx.reload();
                          }),
                        }, 'Выбрать'),
                    el('button', {
                      class: 'btn btn-danger btn-s', title: 'Убрать аккаунт',
                      // Тоже со спросом: у лицензии после этого придётся заново проходить вход
                      // через Microsoft, а офлайн-ник легко написать с опечаткой.
                      onclick: () => modal({
                        title: `Убрать аккаунт «${account.name}»?`,
                        note: account.kind === 'microsoft'
                          ? 'Войти можно будет снова через Microsoft. Покупка и скин у Mojang останутся на месте.'
                          : 'Это только запись в лаунчере - миры и сборки не трогаются.',
                        confirm: 'Убрать',
                        danger: true,
                        onConfirm: () => void guard(async () => {
                          await api.removeAccount(account.id);
                          await ctx.reload();
                        }),
                      }),
                    }, icon('trash', 14, 1.6)),
                  ),
                )))
          : emptyState('lock', 'Аккаунтов пока нет',
              'Добавь офлайн-ник или войди через Microsoft - без аккаунта игра не запустится.'),
        // Скин - под списком аккаунтов, а не отдельной полосой внизу: он про выбранный аккаунт,
        // и раньше под единственным аккаунтом зияла пустая половина экрана.
        el('div', { style: 'margin-top:24px' }, skinPanel(ctx)),
      ),

      el('div', { class: 'grp' },
        el('b', { style: 'font-family:var(--display);font-weight:500;font-size:16px' },
          'Лицензия Minecraft'),
        el('p', { style: 'color:var(--muted);font-size:14px;margin:10px 0 0' },
          'Откроется окно Microsoft - почта, пароль и подтверждение вводятся там. '
          + 'Лаунчер пароль не видит и не хранит.'),
        el('button', {
          class: 'btn btn-main', style: 'width:100%;margin-top:18px',
          onclick: (event: Event) => {
            const button = event.currentTarget as HTMLButtonElement;
            void guard(async () => {
              button.disabled = true;
              microsoftBox.replaceChildren(
                el('div', { class: 'note', style: 'margin-top:14px' }, 'Окно входа открыто…'));
              const account = await api.signInMicrosoft();
              await ctx.reload();
              toast(`Вошли как ${account.name}`);
            }).finally(() => {
              button.disabled = false;
              microsoftBox.replaceChildren();
            });
          },
        }, 'Войти через Microsoft'),
        microsoftBox,

        el('div', { style: 'height:1px;background:var(--line-soft);margin:24px 0' }),

        el('b', { style: 'font-family:var(--display);font-weight:500;font-size:16px' },
          'Офлайн-аккаунт'),
        el('label', { class: 'field', style: 'margin-top:14px' }, nickField),
        el('div', { class: 'err', style: 'margin-top:14px' },
          ctx.text('offline.warning',
            'Серверы с проверкой лицензии такой аккаунт не пустят, а скин будет стандартный.')),
        addOfflineButton,
      ),
    ),
  );

  // Enter в поле ника добавляет аккаунт, как в остальных формах лаунчера.
  nickField.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'Enter' && !(event as KeyboardEvent).isComposing) addOfflineButton.click();
  });

  return frame({ title: 'Аккаунты', body, back: () => ctx.go({ name: 'library' }) });
}

// ---------------------------------------------------------------- Логи

/**
 * Живая лента лога, пока открыт экран логов (иначе null).
 *
 * Новые строки нельзя выводить полной перерисовкой: она сбивала бы прокрутку и выделение текста.
 * Поэтому экран регистрируется здесь, и app.ts дописывает строки по одной через pushLogLine.
 */
let liveLog: { append(line: GameLog): void } | null = null;

export function pushLogLine(line: GameLog): void {
  liveLog?.append(line);
}

export function detachLog(): void {
  liveLog = null;
}

const LEVEL_COLOR: Record<GameLog['level'], string> = {
  out: 'var(--muted)',
  err: '#ff8095',
  status: 'var(--cosmic)',
};

export function logsScreen(ctx: Ctx): HTMLElement {
  let query = '';
  let errorsOnly = false;
  let follow = true;

  const view = el('div', {
    class: 'logview mono',
    // Прокручивается сам лог, а не .body: панель инструментов остаётся на месте.
    style: 'flex:1;min-height:0;overflow:auto;padding:14px 16px;border-radius:var(--r);'
      + 'background:var(--ink-2);border:1px solid var(--line-soft);font-size:12.5px;line-height:1.6',
  });
  // Лог моноширинный, а подсказка - обычным шрифтом.
  const empty = el('div', { style: 'font-family:Inter,system-ui,sans-serif' },
    emptyState('logs', 'Логов пока нет',
      'Они появятся, когда запустишь игру, и останутся здесь, даже если она вылетит.'));
  const counter = el('span', { class: 'sub' });

  const matches = (line: GameLog): boolean => {
    if (errorsOnly && line.level !== 'err') return false;
    if (!query) return true;
    return line.line.toLowerCase().includes(query);
  };

  const row = (line: GameLog): HTMLElement =>
    el('div', {
      style: `white-space:pre-wrap;word-break:break-word;color:${LEVEL_COLOR[line.level]}`
        + (line.level === 'err' ? ';font-weight:500' : ''),
    }, line.line);

  // Ближе 40px к низу - значит, пользователь смотрит конец лога. Прокрутил вверх - лог перестаёт
  // прыгать вниз; вернулся вниз - снова следит.
  const atBottom = () => view.scrollHeight - view.scrollTop - view.clientHeight < 40;
  const stick = () => { if (follow) view.scrollTop = view.scrollHeight; };

  const repaint = (): void => {
    const shown = ctx.logs.filter(matches);
    counter.textContent = shown.length === ctx.logs.length
      ? plural(ctx.logs.length, 'строка', 'строки', 'строк')
      : `${shown.length} из ${ctx.logs.length}`;
    view.replaceChildren(...(shown.length ? shown.map(row) : [empty]));
    stick();
  };

  liveLog = {
    append(line) {
      const wasAtBottom = atBottom();
      counter.textContent = plural(ctx.logs.length, 'строка', 'строки', 'строк');
      if (!matches(line)) return;
      if (view.firstChild === empty) view.replaceChildren();
      view.append(row(line));
      // Обрезаем так же, как буфер в app.ts (LOG_LIMIT), чтобы DOM не рос бесконечно.
      while (view.childElementCount > 2000) view.firstElementChild?.remove();
      if (follow && wasAtBottom) view.scrollTop = view.scrollHeight;
    },
  };

  view.addEventListener('scroll', () => {
    // Прокрутка вверх сама выключает «Следить за концом» - не надо помнить про кнопку.
    if (follow && !atBottom()) { follow = false; followSwitch.classList.remove('on'); }
  });

  const search = el('input', { placeholder: 'Поиск по логу', type: 'search' }) as HTMLInputElement;
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); repaint(); });

  const toggle = (label: string, on: boolean, onchange: (next: boolean) => void): HTMLElement => {
    const button = el('button', { class: 'chip' + (on ? ' on' : '') }, label);
    button.addEventListener('click', () => {
      const next = !button.classList.contains('on');
      button.classList.toggle('on', next);
      onchange(next);
    });
    return button;
  };

  const followSwitch = toggle('Следить за концом', true, (next) => {
    follow = next;
    stick();
  });

  const asText = (): string => ctx.logs.filter(matches).map((l) => l.line).join('\r\n');

  const tools = el('div', {
    style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px;flex:none',
  },
    el('div', { class: 'field', style: 'flex:1;min-width:220px' }, search),
    toggle('Только ошибки', false, (next) => { errorsOnly = next; repaint(); }),
    followSwitch,
    el('button', {
      class: 'btn btn-ghost btn-s',
      onclick: () => void guard(async () => {
        const text = asText();
        if (!text) { toast('Копировать нечего.', true); return; }
        await api.copyText(text);
        toast('Скопировано');
      }),
    }, icon('copy', 14, 1.7), 'Копировать'),
    el('button', {
      class: 'btn btn-ghost btn-s',
      onclick: () => void guard(async () => {
        const text = asText();
        if (!text) { toast('Сохранять нечего.', true); return; }
        const path = await api.saveLog(text);
        if (path) toast('Сохранено');
      }),
    }, icon('download', 14, 1.7), 'Сохранить в файл'),
    el('button', {
      class: 'btn btn-ghost btn-s',
      onclick: () => { ctx.logs.length = 0; repaint(); },
    }, icon('trash', 14, 1.7), 'Очистить'),
  );

  repaint();

  const body = el('div', {
    class: 'body',
    style: 'display:flex;flex-direction:column;min-height:0;overflow:hidden',
  }, tools, view);

  return frame({ title: 'Логи', sub: '', extra: counter, body });
}

// ---------------------------------------------------------------- Настройки

export function settingsScreen(ctx: Ctx): HTMLElement {
  const settings = ctx.state.settings;
  // Крутилка лежит внутри: класс .loading иначе остался бы на блоке и после загрузки.
  const javaBox = el('div', {}, loadingBox('Ищу Java…'));
  const dataBox = el('div', {}, loadingBox('Считаю размер…'));

  void (async () => {
    try {
      const info = await api.dataInfo();
      dataBox.className = 'note';
      dataBox.replaceChildren(
        el('div', { class: 'mono', style: 'font-size:12px;word-break:break-all;color:var(--text)' },
          info.path),
        el('div', { style: 'font-size:12.5px;color:var(--dim);margin-top:6px' },
          `Занято ${bytes(info.size)}`),
      );
    } catch (error) {
      dataBox.textContent = error instanceof Error ? error.message : String(error);
    }
  })();

  void (async () => {
    let installs: JavaInfo[] = [];
    try { installs = await api.javaInstalls(); } catch { installs = []; }
    javaBox.className = installs.length ? 'java-list' : '';
    const javaRow = (title: string, sub: string, path: string): HTMLElement => {
      const on = path === settings.javaPath;
      return el('div', {
        style: 'display:flex;align-items:center;gap:13px;padding:11px 14px;border-radius:10px;'
          + (on ? 'background:rgba(159,134,255,.08);border:1px solid rgba(159,134,255,.28)'
            : 'border:1px solid transparent'),
      },
        el('div', { style: 'min-width:0' },
          el('b', { style: 'font-family:var(--display);font-weight:500;font-size:14.5px' }, title),
          el('div', { class: path ? 'mono' : '', style: 'font-size:11.5px;color:var(--dim);margin-top:2px;word-break:break-all' }, sub),
        ),
        el('button', {
          class: 'btn btn-ghost btn-s', style: 'margin-left:auto;flex:none',
          disabled: on ? true : undefined,
          onclick: () => void guard(async () => {
            await api.saveSettings({ javaPath: path });
            await ctx.reload();
          }),
        }, on ? 'Выбрана' : 'Выбрать'),
      );
    };
    // «Автоматически» - лучший выбор почти всегда: лаунчер сам берёт Java под версию игры
    // (1.20.5+ - 21, 1.17-1.20.4 - 17, старее - 8). Выбранная руками Java, если она старее
    // нужной, всё равно будет пропущена - иначе игра бы не запустилась.
    if (installs.length) {
      javaBox.replaceChildren(
        javaRow('Автоматически', 'Под каждую версию игры - подходящая Java. Нет нужной - лаунчер скачает её сам', ''),
        ...installs.map((java) => javaRow(`Java ${java.majorVersion}`, java.path, java.path)),
      );
      return;
    }
    javaBox.replaceChildren(
      ...(installs.length
        ? installs.map((java) =>
            el('div', {
              style: 'display:flex;align-items:center;gap:13px;padding:11px 14px;border-radius:10px;'
                + (java.path === settings.javaPath
                  ? 'background:rgba(159,134,255,.08);border:1px solid rgba(159,134,255,.28)'
                  : 'border:1px solid transparent'),
            },
              el('div', { style: 'min-width:0' },
                el('b', { style: 'font-family:var(--display);font-weight:500;font-size:14.5px' },
                  `Java ${java.majorVersion}`),
                el('div', { class: 'mono', style: 'font-size:11.5px;color:var(--dim);margin-top:2px' },
                  java.path),
              ),
              el('button', {
                class: 'btn btn-ghost btn-s', style: 'margin-left:auto',
                onclick: () => void guard(async () => {
                  await api.saveSettings({ javaPath: java.path });
                  await ctx.reload();
                }),
              }, java.path === settings.javaPath ? 'Выбрана' : 'Выбрать'),
            ))
        : [el('div', { class: 'note' },
            'Java не найдена. Лаунчер скачает её сам при первом запуске.')]),
    );
  })();

  const memoryValue = el('b', {
    style: 'font-family:var(--display);font-weight:500;font-size:26px;letter-spacing:-.02em',
  }, String(settings.memory));

  const memory = el('input', {
    type: 'range', min: 1024, max: 16384, step: 512, value: settings.memory,
    style: 'width:100%;accent-color:#9f86ff',
  });
  // Подсказка про оперативку: ползунок раньше доходил до 16 ГБ на любом компьютере, и на 8 ГБ ОЗУ
  // отданные игре 12 ГБ означали подвисающую систему вместо прироста FPS.
  const memoryWarn = el('div', { class: 'note', style: 'display:none;margin-top:8px' });
  let systemMb = 0;
  const checkMemory = (): void => {
    const value = Number(memory.value);
    if (!systemMb || value <= systemMb * 0.7) { memoryWarn.style.display = 'none'; return; }
    memoryWarn.style.display = '';
    memoryWarn.textContent = `Это почти вся память компьютера (${Math.round(systemMb / 1024)} ГБ). `
      + 'Windows и браузеру не хватит места, и всё начнёт подтормаживать. Обычно игре хватает 4-6 ГБ, сборке с сотней модов - 6-8 ГБ.';
  };
  void api.systemMemory().then((mb) => {
    systemMb = mb;
    // Оставляем системе хотя бы 2 ГБ, шаг ползунка - 512 МБ.
    const cap = Math.max(2048, Math.floor((mb - 2048) / 512) * 512);
    memory.max = String(Math.min(16384, cap));
    checkMemory();
  }).catch(() => { /* не узнали - оставим прежний предел */ });
  memory.addEventListener('input', () => { memoryValue.textContent = memory.value; checkMemory(); });
  memory.addEventListener('change', () => void guard(async () => {
    await api.saveSettings({ memory: Number(memory.value) });
    await ctx.reload();
    toast(`Всем сборкам: ${memory.value} МБ`);
  }));

  /** Числовое поле, которое сохраняется, когда с него уходит фокус или нажат Enter. */
  function numberField(label: string, key: 'width' | 'height', min: number, max: number): HTMLElement {
    const input = el('input', { type: 'number', min, max, step: 1, value: settings[key] }) as HTMLInputElement;
    const save = (): void => void guard(async () => {
      const value = Math.min(max, Math.max(min, Math.round(Number(input.value) || settings[key])));
      input.value = String(value);
      if (value === settings[key]) return;
      await api.saveSettings({ [key]: value });
      settings[key] = value;
      toast('Сохранено - применится при следующем запуске игры');
    });
    input.addEventListener('change', save);
    input.addEventListener('keydown', (event) => { if ((event as KeyboardEvent).key === 'Enter') input.blur(); });
    return el('div', {}, el('label', { class: 'set-label' }, label), el('label', { class: 'field' }, input));
  }

  const DEFAULT_JVM = '-XX:+UseG1GC -XX:MaxGCPauseMillis=50 -Dfile.encoding=UTF-8';
  const jvmInput = el('input', { class: 'mono', value: settings.jvmArgs, spellcheck: 'false' }) as HTMLInputElement;
  const saveJvm = (): void => void guard(async () => {
    const value = jvmInput.value.trim().replace(/\s+/g, ' ');
    if (value === settings.jvmArgs) return;
    await api.saveSettings({ jvmArgs: value });
    settings.jvmArgs = value;
    toast('Сохранено - применится при следующем запуске игры');
  });
  jvmInput.addEventListener('change', saveJvm);
  jvmInput.addEventListener('keydown', (event) => { if ((event as KeyboardEvent).key === 'Enter') jvmInput.blur(); });
  const jvmField = el('div', { style: 'display:flex;gap:9px;align-items:center' },
    el('label', { class: 'field', style: 'flex:1' }, jvmInput),
    el('button', {
      class: 'btn btn-ghost btn-s',
      onclick: () => { jvmInput.value = DEFAULT_JVM; saveJvm(); },
    }, 'По умолчанию'),
  );

  function toggle(
    label: string, note: string,
    key: 'hideDuringGame' | 'showSnapshots' | 'minimizeToTray' | 'liteMode' | 'discordStatus',
  ): HTMLElement {
    return el('div', {
      style: 'display:flex;align-items:center;gap:16px;padding:13px 0;border-bottom:1px solid var(--line-soft)',
    },
      el('div', {},
        el('b', { style: 'font-family:var(--display);font-weight:500;font-size:14.5px;display:block' }, label),
        el('span', { style: 'font-size:12.5px;color:var(--dim)' }, note),
      ),
      el('button', {
        class: settings[key] ? 'sw on' : 'sw',
        style: 'margin-left:auto',
        onclick: () => void guard(async () => {
          await api.saveSettings({ [key]: !settings[key] });
          await ctx.reload();
        }),
      }, el('i', {})),
    );
  }

  const content = ctx.state.content;

  // Голос: микрофон, динамики, шумоподавление и проверка микрофона.
  const voiceBox = el('div', {}, loadingBox('Ищу микрофоны…'));
  let micTestHandle: { level: () => number; stop: () => void } | null = null;
  let micTimer = 0;
  const stopMicTest = (): void => {
    micTestHandle?.stop();
    micTestHandle = null;
    window.clearInterval(micTimer);
  };
  void (async () => {
    let devices: VoiceDevices;
    try {
      devices = await listDevices();
    } catch {
      voiceBox.className = 'err';
      voiceBox.textContent = 'Не получилось получить список устройств.';
      return;
    }
    const current = voiceSettings();
    const select = (items: MediaDeviceInfo[], value: string, empty: string, onPick: (id: string) => void): HTMLElement => {
      const node = el('select', {},
        el('option', { value: '' }, 'Как в Windows'),
        ...items.map((d, i) => el('option', { value: d.deviceId }, d.label || `${empty} ${i + 1}`)));
      node.value = items.some((d) => d.deviceId === value) ? value : '';
      node.addEventListener('change', () => onPick(node.value));
      return el('label', { class: 'field' }, node);
    };
    const meterBar = el('i', {});
    const testButton = el('button', { class: 'btn btn-ghost btn-s' }, icon('mic', 14, 1.8), 'Проверить микрофон');
    testButton.addEventListener('click', () => void guard(async () => {
      if (micTestHandle) { stopMicTest(); meterBar.style.width = '0'; testButton.lastChild!.textContent = 'Проверить микрофон'; return; }
      micTestHandle = await micTest();
      testButton.lastChild!.textContent = 'Хватит';
      micTimer = window.setInterval(() => {
        // Ушли с экрана настроек - микрофон отпускаем.
        if (!voiceBox.isConnected) { stopMicTest(); return; }
        meterBar.style.width = `${Math.min(100, Math.round((micTestHandle?.level() ?? 0) * 400))}%`;
      }, 80);
    }));
    voiceBox.className = '';
    voiceBox.replaceChildren(
      el('div', { class: 'voice-grid' },
        el('div', {}, el('label', { class: 'set-label' }, 'Микрофон'),
          select(devices.inputs, current.input, 'Микрофон', (id) => void guard(async () => {
            await setInput(id);
            toast('Микрофон выбран');
          }))),
        current.canPickOutput
          ? el('div', {}, el('label', { class: 'set-label' }, 'Динамики или наушники'),
              select(devices.outputs, current.output, 'Динамики', (id) => { setOutput(id); toast('Звук звонков пойдёт сюда'); }))
          : null,
      ),
      el('div', { style: 'display:flex;align-items:center;gap:12px;margin-top:14px' },
        testButton,
        el('div', { class: 'voice-meter', style: 'flex:1;margin:0' }, meterBar),
      ),
      el('div', {
        style: 'display:flex;align-items:center;gap:16px;padding:13px 0 0;margin-top:12px;border-top:1px solid var(--line-soft)',
      },
        el('div', {},
          el('b', { style: 'font-family:var(--display);font-weight:500;font-size:14.5px;display:block' }, 'Шумоподавление'),
          el('span', { style: 'font-size:12.5px;color:var(--dim)' }, 'Убирает клавиатуру и фон'),
        ),
        (() => {
          const node = el('select', {},
            el('option', { value: 'rnnoise' }, 'Нейросеть RNNoise'),
            el('option', { value: 'gtcrn' }, 'Нейросеть GTCRN, сильнее'),
            el('option', { value: 'off' }, 'Выключено')) as HTMLSelectElement;
          node.value = current.noise;
          node.addEventListener('change', () => void guard(async () => {
            const restart = Boolean(micTestHandle);
            if (restart) stopMicTest();
            await setNoise(node.value as NoiseMode);
            if (restart) testButton.click();
          }));
          return el('label', { class: 'field', style: 'margin-left:auto;min-width:230px' }, node);
        })(),
      ),
      el('div', {
        style: 'display:flex;align-items:center;gap:16px;padding:13px 0 0;margin-top:12px;border-top:1px solid var(--line-soft)',
      },
        el('b', { style: 'font-family:var(--display);font-weight:500;font-size:14.5px' }, 'Звук сообщений'),
        (() => {
          const sw = el('button', { class: chatSound.on ? 'sw on' : 'sw', style: 'margin-left:auto' }, el('i', {}));
          sw.addEventListener('click', () => { chatSound.on = !chatSound.on; sw.classList.toggle('on', chatSound.on); });
          return sw;
        })(),
      ),
      el('div', { class: 'note', style: 'margin-top:12px' }, 'Ctrl+Shift+M - микрофон в игре.'),
    );
  })();

  // Выбор темы: те же карточки, что на первом запуске. Тема включается сразу, без перезапуска.
  const currentTheme = themeOf(settings.theme).id;
  const themeCards = el('div', { class: 'theme-grid' },
    ...THEMES.map((theme) => el('button', {
      class: theme.id === currentTheme ? 'theme-card on' : 'theme-card',
      style: `--acc:${theme.accent}`,
      onclick: () => void guard(async () => {
        if (theme.id === themeOf(ctx.state.settings.theme).id) return;
        await api.saveSettings({ theme: theme.id });
        applyTheme(theme.id);
        await ctx.reload();
      }),
    },
      el('span', { class: 'theme-shot' }, el('img', { src: `./themes/${theme.id}.jpg`, alt: '' })),
      el('b', {}, theme.name),
      el('span', { class: 'theme-note' }, theme.note),
    )),
  );

  const body = el('div', { class: 'body' },
    el('div', { style: 'display:flex;flex-direction:column;gap:16px;max-width:940px' },

      el('div', { class: 'grp' },
        el('p', { class: 'eyebrow' }, 'Внешний вид'),
        themeCards,
      ),

      el('div', { class: 'grp' },
        el('p', { class: 'eyebrow' }, 'Голос'),
        voiceBox,
      ),

      el('div', { class: 'grp' },
        el('p', { class: 'eyebrow' }, 'Java'),
        javaNudge(),
        javaBox,
      ),

      el('div', { class: 'grp' },
        el('p', { class: 'eyebrow' }, 'Память'),
        el('div', { style: 'display:flex;align-items:baseline;gap:12px' },
          memoryValue,
          el('span', { class: 'mono', style: 'font-size:12.5px;color:var(--muted)' }, 'МБ игре'),
        ),
        el('div', { style: 'margin:18px 0 8px' }, memory),
        el('div', { class: 'note' }, 'Для всех сборок.'),
        memoryWarn,
        // Подсказка приходит с сайта и бывает пустой - пустая рамка выглядела как поле,
        // в которое забыли что-то написать.
        ctx.text('memory.hint', '') ? el('div', { class: 'note' }, ctx.text('memory.hint', '')) : null,
      ),

      el('div', { class: 'grp' },
        el('p', { class: 'eyebrow' }, 'Окно игры и Java'),
        el('div', { class: 'set-grid' },
          numberField('Ширина окна', 'width', 640, 7680),
          numberField('Высота окна', 'height', 480, 4320),
        ),
        el('label', { class: 'set-label' }, 'Аргументы Java'),
        jvmField,
        el('div', { class: 'note', style: 'margin-top:10px' },
          'Для опытных.'),
      ),

      el('div', { class: 'grp' },
        el('p', { class: 'eyebrow' }, 'Поведение'),
        toggle('Прятать лаунчер на время игры', 'Вернётся, когда игра закроется', 'hideDuringGame'),
        toggle('Прятать в трей по крестику', 'Выйти - правой кнопкой по значку', 'minimizeToTray'),
        toggle('Показывать снапшоты', 'Тестовые версии игры', 'showSnapshots'),
        toggle('Лёгкий режим', 'Без размытия и анимации', 'liteMode'),
        toggle('Статус в Discord', 'Во что играешь и где', 'discordStatus'),
      ),

      el('div', { class: 'grp' },
        el('p', { class: 'eyebrow' }, 'Праздники'),
        el('div', { style: 'display:flex;align-items:center;gap:16px' },
          el('div', {},
            el('b', { style: 'font-family:var(--display);font-weight:500;font-size:14.5px;display:block' }, 'Праздничные эффекты'),
            el('span', { style: 'font-size:12.5px;color:var(--dim)' }, 'Снег, листья, конфетти и прочее по датам'),
          ),
          (() => {
            const sw = el('button', { class: seasonsSetting.on ? 'sw on' : 'sw', style: 'margin-left:auto' }, el('i', {}));
            sw.addEventListener('click', () => { seasonsSetting.on = !seasonsSetting.on; sw.classList.toggle('on', seasonsSetting.on); });
            return sw;
          })(),
        ),
      ),

      el('div', { class: 'grp' },
        el('p', { class: 'eyebrow' }, 'Папка лаунчера'),
        el('p', { style: 'color:var(--muted);font-size:13.5px;margin:0 0 14px' },
          'Здесь лежат версии игры, библиотеки, ассеты, моды и миры. Можно перенести на другой '
          + 'диск - файлы переедут вместе с настройкой, ничего заново качать не придётся.'),
        dataBox,
        el('div', { style: 'display:flex;gap:9px;margin-top:14px' },
          el('button', {
            class: 'btn btn-ghost btn-s',
            onclick: () => void guard(() => api.openRoot()),
          }, icon('folder', 14, 1.7), 'Открыть'),
          el('button', {
            class: 'btn btn-ghost btn-s',
            onclick: (event: Event) => {
              const button = event.currentTarget as HTMLButtonElement;
              void guard(async () => {
                const picked = await api.pickDataFolder();
                if (!picked) return;
                // Перенос - это минуты копирования и перезапуск лаунчера. Раньше он начинался
                // сразу после выбора папки, без единого вопроса.
                modal({
                  title: 'Перенести папку лаунчера?',
                  note: `Все версии игры, моды и миры переедут в ${picked}. Это может занять несколько минут, `
                    + 'после чего лаунчер перезапустится. Игру на это время лучше закрыть.',
                  confirm: 'Перенести',
                  onConfirm: () => void guard(async () => {
                    button.disabled = true;
                    toast('Переношу файлы. Лаунчер сам перезапустится.');
                    await api.moveData(picked);
                  }, () => { button.disabled = false; }),
                });
              });
            },
          }, 'Перенести в другую папку'),
        ),
      ),

      el('div', { class: 'grp' },
        el('p', { class: 'eyebrow' }, 'Содержимое с сайта'),
        el('div', { style: 'display:flex;align-items:center;gap:14px' },
          el('div', {},
            el('b', { style: 'font-family:var(--display);font-weight:500;font-size:14.5px;display:block' },
              content.source === 'network' ? 'Загружено с сайта'
                : content.source === 'cache' ? 'Показано из кэша' : 'Встроенные тексты'),
            el('span', { class: 'mono', style: 'font-size:11.5px;color:var(--dim)' },
              `ревизия ${content.rev} · новостей ${content.news.length} · строк ${Object.keys(content.strings).length}`),
          ),
          el('button', {
            class: 'btn btn-ghost btn-s', style: 'margin-left:auto',
            onclick: () => void guard(async () => {
              await api.refreshContent();
              toast('Обновлено');
            }),
          }, icon('refresh', 14, 1.8), 'Обновить'),
        ),
      ),

      el('div', { class: 'grp' },
        el('p', { class: 'eyebrow' }, 'О лаунчере'),
        el('div', { style: 'display:flex;align-items:center;gap:14px' },
          el('div', {},
            el('b', { style: 'font-family:var(--display);font-weight:500;font-size:14.5px;display:block' },
              'Power Launcher'),
            el('span', { class: 'mono', style: 'font-size:11.5px;color:var(--dim)' }, `версия ${ctx.state.version}`),
          ),
          el('button', {
            class: 'btn btn-ghost btn-s', style: 'margin-left:auto',
            onclick: () => showWhatsNew(ctx.state.version),
          }, icon('sparkle', 14, 1.8), 'Что нового'),
          // Посмотреть первый запуск ещё раз: аккаунты и сборки он не трогает, только снова
          // проведёт через знакомство и выбор темы.
          el('button', {
            class: 'btn btn-ghost btn-s',
            onclick: () => void guard(async () => {
              await api.saveSettings({ onboarded: false });
              await ctx.reload();
              ctx.go({ name: 'library' });
            }),
          }, icon('refresh', 14, 1.8), 'Первый запуск заново'),
        ),
      ),

    ),
  );

  return frame({ title: 'Настройки', body });
}
