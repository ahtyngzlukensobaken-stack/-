import { api, type Instance, type MojangFeed, type MojangNews, type NewsItem } from './api.js';
import type { Ctx } from './app.js';
import { windowButtons } from './frame.js';
import { describe, guard, startFrom } from './screens.js';
import { skin3d } from './skin3d.js';
import { face, friendsList, socialState } from './social.js';
import { instanceArt } from './themes.js';
import { ago, el, icon, play, playtime, plural } from './ui.js';



let feed: MojangFeed | null = null;
let feedLoading: Promise<MojangFeed> | null = null;

const shots = new Map<string, { url: string; all: Array<{ url: string; file: string }>; at: number }>();

function loadFeed(): Promise<MojangFeed> {
  feedLoading ??= api.mojangFeed()
    .then((next) => (feed = next))
    .catch(() => (feed = { versions: {}, news: [], fetchedAt: 0 }));
  return feedLoading;
}

async function shotsOf(id: string): Promise<{ url: string; all: Array<{ url: string; file: string }> }> {
  const cached = shots.get(id);
  if (cached && Date.now() - cached.at < 60_000) return cached;
  const list = await api.screenshots(id).catch(() => []);
  const entry = { url: list[0]?.url ?? '', all: list.slice(0, 3).map(({ url, file }) => ({ url, file })), at: Date.now() };
  shots.set(id, entry);
  return entry;
}


function versionImage(minecraft: string): string {
  const versions = feed?.versions ?? {};
  if (versions[minecraft]) return versions[minecraft]!;
  const branch = minecraft.split('.').slice(0, 2).join('.');
  const near = Object.keys(versions).find((v) => v === branch || v.startsWith(`${branch}.`));
  return near ? versions[near]! : '';
}

/** Обложка сразу (то, что известно) и подмена на лучшую, когда найдётся. */
function cover(instance: Instance, cls: string): HTMLImageElement {
  const quick = instance.coverUrl
    || shots.get(instance.id)?.url
    || (feed ? versionImage(instance.minecraft) : '')
    || instanceArt(instance);
  const img = el('img', { class: cls, src: quick, alt: '', draggable: 'false' });
  if (!quick.startsWith('data:')) img.classList.add('photo');
  if (!instance.coverUrl) {
    void Promise.all([shotsOf(instance.id), loadFeed()]).then(([found]) => {
      const best = found.url || versionImage(instance.minecraft);
      if (best && img.src !== best) { img.src = best; img.classList.add('photo'); }
    });
  }
  return img;
}

function heroOf(ctx: Ctx): { hero: Instance | undefined; others: Instance[] } {
  const { instances, selectedInstance } = ctx.state;
  const recent = [...instances].sort((a, b) => (b.lastPlayed - a.lastPlayed) || (b.createdAt - a.createdAt));
  const hero = instances.find((i) => i.id === selectedInstance) ?? recent[0];
  return { hero, others: recent.filter((i) => i !== hero) };
}

function openInstance(ctx: Ctx, id: string): void {
  void guard(async () => {
    await api.selectInstance(id);
    await ctx.reload();
    ctx.go({ name: 'instance', id });
  });
}

/** Друзья, которые прямо сейчас играют в сборку с таким же именем. */
function friendsIn(instance: Instance) {
  return socialState().friends.filter((f) => f.online && f.build === instance.name && f.status && f.status !== 'launcher');
}

/** Плашка «Stepan_cat и Lera_mc сейчас здесь». Сама обновляется, когда меняются статусы друзей. */
function hereChip(instance: Instance): HTMLElement {
  const node = el('div', { class: 'pw-here' });
  const paint = (): void => {
    const here = friendsIn(instance);
    node.hidden = !here.length;
    if (!here.length) return;
    const names = here.slice(0, 2).map((f) => f.name);
    node.replaceChildren(
      el('span', { class: 'pw-faces' }, ...here.slice(0, 3).map((f) => face(f.uuid, f.name, 'pw-face'))),
      el('span', {}, names.join(' и '), here.length > 2 ? ` и ещё ${here.length - 2}` : '', ' сейчас здесь'),
    );
  };
  paint();
  // Перерисовка главной случается часто и так, а статусы друзей меняются раз в 20 секунд.
  const timer = window.setInterval(() => { if (!node.isConnected) window.clearInterval(timer); else paint(); }, 5000);
  return node;
}

function playButton(ctx: Ctx, instance: Instance): HTMLElement {
  const running = ctx.state.running.includes(instance.id);
  const job = ctx.progress.get(instance.id);
  const loading = job && !job.done && !job.error;
  return el('button', {
    class: 'pw-play', disabled: running,
    onclick: (event: Event) => { event.stopPropagation(); startFrom(event, ctx, instance.id); },
  },
    play(18),
    el('span', {}, running ? 'ЗАПУЩЕНА' : 'ИГРАТЬ',
      el('small', {}, running ? 'игра идёт' : loading ? 'качается' : instance.installed ? 'всё скачано' : 'скачается при запуске')),
  );
}

function hero(ctx: Ctx, instance: Instance): HTMLElement {
  const loader = describe(instance).split(' · ').slice(1).join(' · ');
  const meta = [
    instance.playSeconds ? `${playtime(instance.playSeconds)} в игре` : 'ещё не запускалась',
    instance.lastPlayed ? `играл ${ago(instance.lastPlayed)}` : '',
  ].filter(Boolean).join(' · ');
  const thumbs = el('div', { class: 'pw-shots' });
  void shotsOf(instance.id).then((found) => {
    // Самый свежий скриншот уже стоит обложкой - рядом показываем следующие.
    const extra = instance.coverUrl ? found.all : found.all.slice(1);
    if (!extra.length) return;
    thumbs.replaceChildren(
      el('span', {}, 'Скриншоты'),
      ...extra.slice(0, 2).map((shot) => el('img', {
        src: shot.url, alt: '', draggable: 'false', title: 'Открыть',
        onclick: () => void guard(() => api.openScreenshot(instance.id, shot.file)),
      })),
    );
  });

  return el('section', { class: 'pw-hero' },
    cover(instance, 'pw-hero-art'),
    hereChip(instance),
    el('div', { class: 'pw-hero-in' },
      el('div', { class: 'pw-chips' },
        el('span', { class: 'pw-chip acc' }, instance.lastPlayed ? 'Последняя сборка' : 'Выбранная сборка'),
        loader ? el('span', { class: 'pw-chip' }, loader) : null,
        el('span', { class: 'pw-chip' }, `Minecraft ${instance.minecraft}`),
      ),
      el('h1', { class: 'pw-name', onclick: () => openInstance(ctx, instance.id) }, instance.name),
      el('div', { class: 'pw-meta' }, meta),
      el('div', { class: 'pw-acts' },
        playButton(ctx, instance),
        el('button', { class: 'pw-sq', title: 'Моды сборки', onclick: () => openInstance(ctx, instance.id) }, icon('mods', 20, 1.7)),
        el('button', { class: 'pw-sq', title: 'Папка сборки', onclick: () => void guard(() => api.openInstanceFolder(instance.id)) }, icon('folder', 20, 1.7)),
        el('button', { class: 'pw-sq', title: 'Друзья', onclick: () => ctx.go({ name: 'friends' }) }, icon('addUser', 20, 1.7)),
      ),
    ),
    thumbs,
  );
}

function buildCard(ctx: Ctx, instance: Instance): HTMLElement {
  const here = friendsIn(instance);
  const job = ctx.progress.get(instance.id);
  const loading = job && !job.done && !job.error;
  const line = ctx.state.running.includes(instance.id) ? 'идёт игра'
    : loading ? `${job.stage.toLowerCase()} · ${job.total ? Math.round((job.progress / job.total) * 100) : 0}%`
      : [describe(instance).split(' · ')[1]?.split(' ')[0] ?? '', instance.minecraft, instance.lastPlayed ? ago(instance.lastPlayed) : 'новая']
        .filter(Boolean).join(' · ');
  return el('div', { class: 'pw-card', onclick: () => openInstance(ctx, instance.id) },
    el('div', { class: 'pw-cv' }, cover(instance, 'pw-cv-art')),
    el('button', {
      class: 'pw-go', title: 'Играть', disabled: ctx.state.running.includes(instance.id),
      onclick: (event: Event) => { event.stopPropagation(); startFrom(event, ctx, instance.id); },
    }, play(14)),
    el('div', { class: 'pw-tx' },
      el('b', { title: instance.name }, instance.name),
      el('span', {}, line),
      here.length
        ? el('div', { class: 'pw-fr' }, ...here.slice(0, 3).map((f) => face(f.uuid, f.name, 'pw-face s')),
            here.length === 1 ? `${here[0]!.name} играет` : `${plural(here.length, 'друг', 'друга', 'друзей')} играют`)
        : null,
    ),
  );
}

function mojangCard(item: MojangNews): HTMLElement {
  return el('div', { class: 'pw-news', onclick: () => void guard(() => api.openExternal(item.link)) },
    el('img', { src: item.image, alt: '', draggable: 'false' }),
    el('div', {},
      el('em', { class: 'mc' }, 'MINECRAFT'),
      el('b', {}, item.title),
      el('p', {}, item.text),
    ),
  );
}

function ourCard(item: NewsItem): HTMLElement {
  return el('div', {
    class: `pw-news${item.link ? '' : ' still'}`,
    onclick: item.link ? () => void guard(() => api.openExternal(item.link)) : undefined,
  },
    el('img', { src: instanceArt({ id: `news:${item.slug}`, accent: item.accent || 'cosmic' }), alt: '', draggable: 'false' }),
    el('div', {},
      el('em', { class: 'pv' }, 'POWER LAUNCHER'),
      el('b', {}, item.title),
      item.body ? el('p', {}, item.body) : null,
    ),
  );
}

/** Две новости: свежая от Mojang и наша. Нет одной - вторая карточка тоже от Mojang. */
function news(ctx: Ctx): HTMLElement {
  const box = el('section', { class: 'pw-newsrow' });
  const paint = (): void => {
    const ours = ctx.state.content.news[0];
    const theirs = feed?.news ?? [];
    const cards = [theirs[0] ? mojangCard(theirs[0]) : null, ours ? ourCard(ours) : theirs[1] ? mojangCard(theirs[1]) : null]
      .filter((card): card is HTMLElement => Boolean(card));
    box.replaceChildren(...cards);
  };
  paint();
  if (!feed) void loadFeed().then(paint);
  return box;
}

function topBar(ctx: Ctx, now: HTMLElement | null): HTMLElement {
  const unread = socialState().friends.reduce((sum, f) => sum + f.unread, 0) + socialState().incoming.length;
  return el('div', { class: 'pw-top' },
    el('button', { class: 'pw-search', onclick: () => ctx.go({ name: 'content' }) }, icon('search', 16, 1.9), 'Найти мод или сборку'),
    el('div', { class: 'pw-now' }, now),
    el('button', { class: 'pw-ib', title: 'Друзья и сообщения', onclick: () => ctx.go({ name: 'friends' }) },
      icon('chat', 18, 1.9), el('span', { class: 'pw-badge', 'data-social-badge': '', hidden: !unread }, String(unread))),
  );
}

/** Главная темы «Power». `now` - карточка «Сейчас» из app.ts (идёт игра или загрузка). */
export function powerHome(ctx: Ctx, now: HTMLElement | null): HTMLElement {
  const { hero: main, others } = heroOf(ctx);
  if (!feed) void loadFeed();
  const view = el('main', { class: 'main pw-main' }, topBar(ctx, now));
  if (!main) {
    view.append(el('section', { class: 'pw-empty' },
      el('b', {}, 'Сборок пока нет'),
      el('p', {}, 'Сборка - это отдельная игра со своими модами и мирами. Создай первую, это минута.'),
      el('button', { class: 'pw-play', onclick: () => ctx.go({ name: 'new' }) }, icon('plus', 18, 2), el('span', {}, 'НОВАЯ СБОРКА')),
    ));
    return view;
  }
  view.append(
    hero(ctx, main),
    el('div', { class: 'pw-head' },
      el('b', {}, 'Твои сборки'),
      el('button', { class: 'pw-more', onclick: () => ctx.go({ name: 'library' }) }, 'Все сборки'),
    ),
    el('section', { class: 'pw-builds' },
      ...others.slice(0, 4).map((instance) => buildCard(ctx, instance)),
      el('button', { class: 'pw-new', onclick: () => ctx.go({ name: 'new' }) }, el('i', {}, icon('plus', 22, 1.8)), 'Новая'),
    ),
    news(ctx),
  );
  return view;
}

/** Правая колонка «Power»: кнопки окна, игрок со скином и друзья. */
export function powerSide(ctx: Ctx): HTMLElement {
  const account = ctx.state.accounts.find((a) => a.id === ctx.state.selectedAccount);
  const me = socialState();
  const sub = account?.kind === 'microsoft'
    ? (me.enabled && me.online ? 'Лицензия · в сети' : 'Лицензия')
    : 'Офлайн-аккаунт';
  return el('aside', { class: 'pw-side' },
    windowButtons(),
    el('div', { class: 'pw-me' },
      account ? skin3d(account.id) : null,
      el('div', { class: 'pw-who' },
        el('b', {}, account?.name ?? 'Нет аккаунта'),
        el('span', { class: me.enabled && me.online ? 'on' : '' }, sub),
        el('div', { class: 'pw-me-btns' },
          el('button', { class: 'acc', onclick: () => ctx.go({ name: 'accounts' }) }, 'Скин'),
          el('button', { onclick: () => ctx.go({ name: 'accounts' }) }, 'Аккаунты'),
        ),
      ),
    ),
    friendsList({ compact: true }),
    el('p', { class: 'pw-note' }, 'Новости и картинки версий - из открытой ленты Minecraft. Не официальный продукт Minecraft.'),
  );
}
