import { api, type Instance, type NewsItem } from './api.js';
import type { Ctx } from './app.js';
import { frame } from './frame.js';
import {
  accountFace, describe, guard, importPackButton, instancePicker, migrateButton, startActions, startFrom,
} from './screens.js';
import { instanceArt, themeOf } from './themes.js';
import { ago, el, icon, play, playtime } from './ui.js';




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

function playButton(ctx: Ctx, instance: Instance, cls: string, label = 'Играть'): HTMLElement {
  const running = ctx.state.running.includes(instance.id);
  return el('button', {
    class: cls, disabled: running,
    onclick: (event: Event) => { event.stopPropagation(); startFrom(event, ctx, instance.id); },
  }, play(15), running ? 'ЗАПУЩЕНА' : label);
}


function status(ctx: Ctx, instance: Instance): HTMLElement {
  if (ctx.state.running.includes(instance.id)) return el('span', { class: 'home-status live' }, el('i'), 'Идёт игра');
  const job = ctx.progress.get(instance.id);
  if (job && !job.done && !job.error) {
    const percent = job.total ? Math.round((job.progress / job.total) * 100) : 0;
    return el('span', { class: 'home-status load' }, el('i'), `${job.stage} · `, el('span', { 'data-percent': instance.id }, `${percent}%`));
  }
  return instance.installed
    ? el('span', { class: 'home-status ok' }, el('i'), 'Всё скачано, можно играть')
    : el('span', { class: 'home-status wait' }, el('i'), 'Скачается при первом запуске');
}

function art(instance: Pick<Instance, 'id' | 'accent' | 'coverUrl'>, cls: string, small = false): HTMLElement {
  return el('img', { class: cls, src: instanceArt(instance, small), alt: '', draggable: 'false' });
}

function searchButton(ctx: Ctx): HTMLElement {
  return el('button', { class: 'home-search', onclick: () => ctx.go({ name: 'content' }) },
    icon('search', 16, 1.8), 'Найти мод или сборку');
}

function newsCard(ctx: Ctx, item: NewsItem | undefined, cls: string): HTMLElement | null {
  if (!item) return null;
  return el('div', {
    class: `${cls}${item.link ? ' home-link' : ''}`,
    onclick: item.link ? () => void guard(() => api.openExternal(item.link)) : undefined,
  },
    el('div', { class: 'home-news-art' },
      art({ id: `news:${item.slug}`, accent: item.accent || 'cosmic' }, 'home-art'),
      el('em', {}, (item.tag || 'новое').toUpperCase()),
    ),
    el('div', { class: 'home-news-text' },
      el('b', {}, item.title),
      item.body ? el('p', {}, item.body) : null,
    ),
  );
}

/** Сборок ещё нет: та же карточка, что в пустой библиотеке. */
function emptyStart(ctx: Ctx): HTMLElement {
  return el('div', { class: 'card start-card' },
    el('b', { class: 'start-title' }, 'Сборок пока нет'),
    el('p', { class: 'start-note' },
      ctx.text('library.empty',
        'Сборка - это отдельная игра со своими модами и мирами. Можно собрать за тебя: '
        + 'возьмём последнюю версию Minecraft и загрузчик модов, ничего выбирать не придётся.')),
    startActions(ctx, el('button', { class: 'btn btn-ghost', onclick: () => ctx.go({ name: 'new' }) },
      icon('settings', 15, 1.7), 'Выбрать версию самому')),
  );
}

function nickOf(ctx: Ctx): string {
  return ctx.state.accounts.find((a) => a.id === ctx.state.selectedAccount)?.name ?? 'игрок';
}

// ---------------------------------------------------------------- «Тихая»

function quietHome(ctx: Ctx): HTMLElement {
  const { hero, others } = heroOf(ctx);
  const body = el('div', { class: 'body home home-quiet' });
  if (!hero) {
    body.append(emptyStart(ctx));
  } else {
    body.append(
      el('div', { class: 'home-hero' },
        el('div', { class: 'home-hero-art', onclick: () => openInstance(ctx, hero.id) },
          art(hero, 'home-art kb'),
          el('em', {}, hero.lastPlayed ? 'Последняя сборка' : 'Выбранная сборка'),
        ),
        el('div', { class: 'home-hero-info' },
          status(ctx, hero),
          el('b', { class: 'home-name' }, hero.name),
          el('span', { class: 'home-meta' }, `Minecraft ${describe(hero)}`),
          el('div', { class: 'home-facts' },
            el('div', {}, el('span', {}, 'Играл'), hero.lastPlayed ? ago(hero.lastPlayed) : 'ещё нет'),
            el('div', {}, el('span', {}, 'Всего в игре'), hero.playSeconds ? playtime(hero.playSeconds) : '0 мин'),
            el('div', {}, el('span', {}, 'Память'), `${(hero.memory / 1024).toFixed(hero.memory % 1024 ? 1 : 0)} ГБ`),
          ),
          el('div', { class: 'home-acts' },
            playButton(ctx, hero, 'btn btn-main home-play'),
            el('button', { class: 'home-sq', title: 'Моды сборки', onclick: () => openInstance(ctx, hero.id) }, icon('mods', 19, 1.7)),
            el('button', { class: 'home-sq', title: 'Папка сборки', onclick: () => void guard(() => api.openInstanceFolder(hero.id)) }, icon('folder', 19, 1.7)),
            el('button', { class: 'home-sq', title: 'Новая сборка', onclick: () => ctx.go({ name: 'new' }) }, icon('plus', 19, 1.7)),
          ),
        ),
      ),
      el('div', { class: 'home-cols' },
        el('div', { class: 'home-box' },
          el('div', { class: 'home-box-head' },
            el('b', {}, 'Другие сборки'),
            el('button', { class: 'home-more', onclick: () => ctx.go({ name: 'library' }) }, 'Все сборки'),
          ),
          others.length
            ? el('div', { class: 'home-rows' }, ...others.slice(0, 4).map((instance) =>
                el('div', { class: 'home-row', onclick: () => openInstance(ctx, instance.id) },
                  art(instance, 'home-row-art', true),
                  el('div', { class: 'home-row-text' },
                    el('b', {}, instance.name),
                    el('span', {}, `${describe(instance)} · ${ago(instance.lastPlayed)}`),
                  ),
                  playButton(ctx, instance, 'home-mini'),
                )))
            : el('div', { class: 'home-empty' },
                el('p', {}, 'Других сборок пока нет.'),
                el('button', { class: 'btn btn-ghost btn-s', onclick: () => ctx.go({ name: 'new' }) }, icon('plus', 14, 1.8), 'Новая сборка'),
              ),
        ),
        newsCard(ctx, ctx.state.content.news[0], 'home-box home-news')
          ?? el('div', { class: 'home-box home-news' },
            el('div', { class: 'home-news-text' }, el('b', {}, 'Новостей пока нет'), el('p', {}, 'Здесь появятся новости лаунчера.'))),
      ),
    );
  }
  return frame({ title: `Привет, ${nickOf(ctx)}`, sub: 'Продолжим там, где остановились?', extra: searchButton(ctx), body });
}

// ---------------------------------------------------------------- «Светлая»

function lightHome(ctx: Ctx): HTMLElement {
  const { hero, others } = heroOf(ctx);
  const body = el('div', { class: 'body home home-light' });
  if (!hero) {
    body.append(emptyStart(ctx));
  } else {
    body.append(
      el('div', { class: 'home-cont' },
        el('div', { class: 'home-cont-art', onclick: () => openInstance(ctx, hero.id) }, art(hero, 'home-art kb')),
        el('div', { class: 'home-cont-text' },
          el('span', { class: 'home-label' }, hero.lastPlayed ? 'Продолжить' : 'Твоя сборка'),
          el('b', {}, hero.name),
          el('span', {}, `Minecraft ${describe(hero)}${hero.lastPlayed ? ` · играл ${ago(hero.lastPlayed)}` : ''}`),
          status(ctx, hero),
        ),
        el('div', { class: 'home-stats' },
          el('div', {}, hero.playSeconds ? playtime(hero.playSeconds) : '0 мин', el('small', {}, 'в игре')),
          el('div', {}, `${(hero.memory / 1024).toFixed(hero.memory % 1024 ? 1 : 0)} ГБ`, el('small', {}, 'памяти')),
        ),
        playButton(ctx, hero, 'btn btn-main home-play'),
      ),
      el('div', { class: 'home-lh' },
        el('b', {}, 'Мои сборки'),
        el('button', { class: 'home-more', onclick: () => ctx.go({ name: 'library' }) }, 'Все сборки'),
      ),
      el('div', { class: 'home-cards' },
        ...others.slice(0, 3).map((instance) =>
          el('div', { class: 'home-card', onclick: () => openInstance(ctx, instance.id) },
            el('div', { class: 'home-card-art' }, art(instance, 'home-art')),
            el('div', { class: 'home-card-body' },
              el('div', { style: 'min-width:0' }, el('b', {}, instance.name), el('span', {}, describe(instance))),
              playButton(ctx, instance, 'home-go', ''),
            ),
          )),
        el('button', { class: 'home-new', onclick: () => ctx.go({ name: 'new' }) },
          el('i', {}, icon('plus', 24, 1.8)), 'Новая сборка', el('span', {}, 'Соберём за тебя за минуту')),
      ),
      el('div', { class: 'home-quick' },
        el('button', { class: 'home-q', onclick: () => ctx.go({ name: 'content' }) },
          el('i', { class: 'q1' }, icon('search', 19, 1.8)), el('div', {}, el('b', {}, 'Найти моды'), el('span', {}, 'Modrinth и CurseForge'))),
        el('button', { class: 'home-q', onclick: () => (importPackButton(ctx) as HTMLButtonElement).click() },
          el('i', { class: 'q2' }, icon('download', 19, 1.8)), el('div', {}, el('b', {}, 'Модпак из файла'), el('span', {}, '.mrpack или .zip'))),
        el('button', { class: 'home-q', onclick: () => (migrateButton(ctx) as HTMLButtonElement).click() },
          el('i', { class: 'q3' }, icon('copy', 19, 1.8)), el('div', {}, el('b', {}, 'Перенести сборки'), el('span', {}, 'из другого лаунчера'))),
        newsCard(ctx, ctx.state.content.news[0], 'home-newsb'),
      ),
    );
  }
  return frame({
    title: `Привет, ${nickOf(ctx)}! Во что играем?`,
    sub: 'Выбери сборку и жми «Играть». Всё нужное лаунчер скачает сам.',
    extra: searchButton(ctx),
    body,
  });
}

// ---------------------------------------------------------------- «Игровая»

function gameHome(ctx: Ctx): HTMLElement {
  const { hero } = heroOf(ctx);
  const account = ctx.state.accounts.find((a) => a.id === ctx.state.selectedAccount);
  if (!hero) return el('main', { class: 'main home-game' }, el('div', { class: 'body home-game-empty' }, emptyStart(ctx)));
  const news = ctx.state.content.news[0];
  return el('main', { class: 'main home-game' },
    newsCard(ctx, news, 'home-gnews'),
    el('div', { class: 'home-title' },
      el('em', {}, hero.lastPlayed ? 'ПОСЛЕДНЯЯ СБОРКА' : 'ТВОЯ СБОРКА'),
      el('b', {}, hero.name),
      el('div', { class: 'home-chips' },
        el('span', {}, `Minecraft ${hero.minecraft}`),
        // describe() даёт «1.21.11 · Fabric 0.19.5»: версия игры уже в соседней плашке, берём хвост.
        el('span', {}, describe(hero).split(' · ').slice(1).join(' · ')),
        el('span', {}, hero.lastPlayed ? `Играл ${ago(hero.lastPlayed)}` : 'Ещё не запускалась'),
      ),
    ),
    el('div', { class: 'home-bar' },
      el('button', { class: 'home-who', onclick: () => ctx.go({ name: 'accounts' }) },
        accountFace(account),
        el('div', {}, el('b', {}, account?.name ?? 'Нет аккаунта'),
          el('span', {}, `${account?.kind === 'microsoft' ? 'Лицензия' : 'Офлайн-аккаунт'} · сменить`)),
      ),
      el('div', { class: 'home-pick' }, art(hero, 'home-pick-art', true), instancePicker(ctx, hero.id)),
      playButton(ctx, hero, 'home-bigplay', 'ИГРАТЬ'),
      el('button', { class: 'home-gear', title: 'Настройки сборки', onclick: () => openInstance(ctx, hero.id) }, icon('settings', 21, 1.7)),
    ),
  );
}

export function homeScreen(ctx: Ctx): HTMLElement {
  const theme = themeOf(ctx.state.settings.theme).id;
  if (theme === 'light') return lightHome(ctx);
  if (theme === 'game') return gameHome(ctx);
  return quietHome(ctx);
}
