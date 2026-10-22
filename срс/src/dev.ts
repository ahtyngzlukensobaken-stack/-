import { api } from './api.js';
import type { Ctx } from './app.js';
import { PUZZLES, openBugfix } from './bugfix.js';
import { frame } from './frame.js';
import { devPrank } from './prank.js';
import { SEASONS, previewSeason, showScreamer, stopPreview } from './seasons.js';
import { guard } from './screens.js';
import { ago, el, toast } from './ui.js';
import { showWhatsNew } from './whatsnew.js';




type Row = Record<string, any>;

const row = (...children: (Node | string | null)[]): HTMLElement =>
  el('div', { class: 'dev-row' }, ...children);
const btn = (label: string, onclick: () => void, cls = 'btn btn-ghost btn-s'): HTMLButtonElement =>
  el('button', { class: cls, onclick }, label);
const when = (seconds: number | null | undefined): string => (seconds ? ago(seconds) : '-');

export function devScreen(ctx: Ctx): HTMLElement {
  const year = new Date().getFullYear();

  const seasons = el('div', { class: 'dev-chips' },
    ...SEASONS.map((season) => btn(season.name, () => previewSeason(season.id, 3_600_000), 'dev-chip')),
  );

  const local = el('div', { class: 'grp' },
    el('p', { class: 'eyebrow' }, 'Праздники'),
    el('p', { class: 'dev-note' }, 'Показ держится час или до «Убрать».'),
    seasons,
    row(
      btn('Убрать показ', () => stopPreview()),
      btn('Скример', () => showScreamer()),
      btn('Сбросить «уже напугали» и «уже чинил»', () => {
        for (const key of [`pv-scare-${year}`, `pv-bugfix-${year}`, 'pv-bugfix-intro']) localStorage.removeItem(key);
        toast('Сброшено: на «Играть» снова сработает');
      }),
    ),
    el('p', { class: 'eyebrow', style: 'margin-top:16px' }, 'Срочный фикс!'),
    el('div', { class: 'dev-chips' },
      ...PUZZLES.map((puzzle, index) => btn(puzzle.file, () => void openBugfix(index).then((won) => toast(won ? 'Починил' : 'Не починил')), 'dev-chip')),
    ),
    el('p', { class: 'eyebrow', style: 'margin-top:16px' }, 'Окна'),
    row(
      btn('Что нового', () => showWhatsNew(ctx.state.version)),
      btn('Пранк с ником разработчика', () => devPrank()),
    ),
  );

  const admin = el('div', { class: 'grp' }, el('p', { class: 'eyebrow' }, 'Админка сайта'));
  void drawAdmin(admin);

  return frame({
    title: 'Дев',
    sub: 'Только в Power Launcher Dev',
    body: el('div', { class: 'body' },
      el('div', { style: 'display:flex;flex-direction:column;gap:16px;max-width:1100px' }, local, admin),
    ),
  });
}

// ---------------------------------------------------------------- админка

const TABS = [
  ['events', 'Всем игрокам'],
  ['downloads', 'Скачивания'],
  ['applications', 'Заявки'],
  ['accounts', 'Аккаунты'],
  ['licenses', 'Лицензии'],
  ['news', 'Новости'],
  ['strings', 'Тексты'],
] as const;
type Tab = typeof TABS[number][0];
let tab: Tab = 'events';

async function drawAdmin(box: HTMLElement): Promise<void> {
  const head = box.firstElementChild!;
  if (!(await api.devHasToken())) {
    const field = el('input', { class: 'input', type: 'password', placeholder: 'Админ-ключ (ADMIN_TOKEN)', style: 'flex:1' }) as HTMLInputElement;
    const save = (): void => void guard(async () => {
      await api.devSetToken(field.value);
      field.value = '';
      toast('Ключ сохранён');
      box.replaceChildren(head);
      await drawAdmin(box);
    });
    field.addEventListener('keydown', (event) => { if (event.key === 'Enter') save(); });
    box.replaceChildren(head,
      el('p', { class: 'dev-note' }, 'Ключ проверится на сайте и сохранится зашифрованным в Windows. Нужен один раз.'),
      row(field, btn('Сохранить', save, 'btn btn-main btn-s')),
    );
    return;
  }

  const content = el('div', { class: 'dev-admin' });
  const tabs = el('div', { class: 'dev-tabs' });
  const paintTabs = (): void => {
    tabs.replaceChildren(
      ...TABS.map(([id, label]) => el('button', { class: id === tab ? 'on' : '', onclick: () => { tab = id; paintTabs(); void open(); } }, label)),
      el('span', { style: 'flex:1' }),
      btn('Обновить', () => void open()),
      btn('Забыть ключ', () => void guard(async () => {
        await api.devClearToken();
        box.replaceChildren(head);
        await drawAdmin(box);
      })),
    );
  };
  const open = async (): Promise<void> => {
    content.replaceChildren(el('p', { class: 'dev-note' }, 'Гружу...'));
    try {
      content.replaceChildren(await PANELS[tab](() => void open()));
    } catch (error) {
      content.replaceChildren(el('p', { class: 'dev-note bad' }, error instanceof Error ? error.message : String(error)));
    }
  };
  paintTabs();
  box.replaceChildren(head, tabs, content);
  await open();
}

const table = (heads: string[], rows: HTMLElement[][]): HTMLElement =>
  rows.length
    ? el('table', { class: 'dev-table' },
      el('thead', {}, el('tr', {}, ...heads.map((h) => el('th', {}, h)))),
      el('tbody', {}, ...rows.map((cells) => el('tr', {}, ...cells.map((c) => el('td', {}, c))))))
    : el('p', { class: 'dev-note' }, 'Пусто.');
const text = (value: unknown, cls = ''): HTMLElement => el('span', { class: cls }, value === null || value === undefined || value === '' ? '-' : String(value));
const act = (label: string, run: () => Promise<unknown>, reload: () => void, confirmText = ''): HTMLButtonElement =>
  btn(label, () => {
    if (confirmText && !window.confirm(confirmText)) return;
    void guard(async () => { await run(); reload(); });
  });

const PANELS: Record<Tab, (reload: () => void) => Promise<HTMLElement>> = {
  // Тексты event.* читают все лаунчеры (seasons.ts, applyRemote) и подхватывают за 10 минут.
  // Выключаем пустым значением, а не удалением: удаление не меняет версию текстов на сайте,
  // и лаунчеры его бы не заметили.
  async events(reload) {
    const data = await api.devCall('/api/admin/launcher/strings');
    const value = (key: string): string => (data.strings as Row[]).find((s) => s.key === key)?.value ?? '';
    const put = (key: string, v: string, done: string): void => void guard(async () => {
      await api.devCall('/api/admin/launcher/strings', { key, value: v, note: 'экран «Дев»' });
      toast(done);
      reload();
    });
    const season = value('event.season');
    const pick = el('select', { class: 'input' },
      ...SEASONS.map((s) => el('option', { value: s.id, selected: s.id === season }, s.name))) as HTMLSelectElement;
    const wave = (key: string): string => {
      const at = Number(value(key));
      return at ? `запущен ${new Date(at).toLocaleString('ru-RU')}` : 'выключен';
    };
    return el('div', {},
      el('p', { class: 'dev-note' }, 'Доходит до всех лаунчеров за 10 минут или при запуске.'),
      el('p', { class: 'eyebrow', style: 'margin-top:6px' }, 'Праздник у всех'),
      el('p', { class: 'dev-note' }, season ? `Сейчас у всех: ${SEASONS.find((s) => s.id === season)?.name ?? season}` : 'Сейчас по календарю.'),
      row(pick,
        btn('Включить всем', () => put('event.season', pick.value, 'Праздник включён всем'), 'btn btn-main btn-s'),
        season ? btn('Вернуть календарь', () => put('event.season', '', 'Снова по календарю')) : null),
      el('p', { class: 'eyebrow', style: 'margin-top:16px' }, 'Скример'),
      el('p', { class: 'dev-note' }, `Каждому, у кого лаунчер уже стоит, один раз на следующее «Играть». Новичкам не приходит, сама гаснет через двое суток. Сейчас: ${wave('event.scare')}.`),
      row(btn('Напугать всех', () => {
        if (window.confirm('Каждый игрок при следующем «Играть» увидит скример. Точно?')) put('event.scare', String(Date.now()), 'Скример запущен');
      }, 'btn btn-main btn-s'), value('event.scare') ? btn('Отменить', () => put('event.scare', '', 'Отменено')) : null),
      el('p', { class: 'eyebrow', style: 'margin-top:16px' }, 'Срочный фикс!'),
      el('p', { class: 'dev-note' }, `Каждому, у кого лаунчер уже стоит, один раз на следующее «Играть», игра запустится только если починит. Новичкам не приходит, гаснет через двое суток. Сейчас: ${wave('event.bugfix')}.`),
      row(btn('Всем чинить баги', () => {
        if (window.confirm('Каждый игрок при следующем «Играть» получит «Срочный фикс!». Точно?')) put('event.bugfix', String(Date.now()), 'Фикс запущен');
      }, 'btn btn-main btn-s'), value('event.bugfix') ? btn('Отменить', () => put('event.bugfix', '', 'Отменено')) : null),
    );
  },

  // Нажатия «Скачать» на сайте по дням (по Москве). Автообновления сюда не входят.
  // «Людей» - разные адреса за день: один человек с двух устройств посчитается дважды.
  async downloads() {
    const data = await api.devCall('/api/admin/launcher/downloads');
    const total = data.total as Row;
    const days = data.days as Row[];
    const today = days.find((d) => d.day === data.today);
    return el('div', {},
      el('p', { class: 'dev-note' }, `Всего: ${total.uniques} человек, ${total.clicks} нажатий. Сегодня: ${today?.uniques ?? 0} человек, ${today?.clicks ?? 0} нажатий.`),
      el('p', { class: 'dev-note' }, 'Считаются только нажатия «Скачать» на сайте, автообновления сюда не входят.'),
      table(['День', 'Людей', 'Нажатий'], days.map((d) => [text(d.day), text(d.uniques), text(d.clicks)])),
    );
  },

  async applications(reload) {
    const data = await api.devCall('/api/admin/applications');
    const counts = data.counts as Row;
    const list = data.applications as Row[];
    return el('div', {},
      el('p', { class: 'dev-note' }, `Ждут: ${counts.pending ?? 0} · одобрено: ${counts.approved ?? 0} · отклонено: ${counts.rejected ?? 0}`),
      table(['Кто', 'Почта', 'Заявка', 'Когда', 'Статус', ''], list.map((a) => [
        text(a.nickname),
        text(a.email, 'mono'),
        el('div', { class: 'dev-wrap' }, ...Object.entries(a)
          .filter(([key, value]) => !['id', 'account_id', 'status', 'email', 'nickname', 'created_at', 'decided_at', 'account_created', 'license_id', 'key_label', 'admin_note'].includes(key) && value)
          .map(([key, value]) => el('div', {}, el('b', {}, `${key}: `), String(value)))),
        text(when(a.created_at)),
        text(a.status === 'pending' ? 'ждёт' : a.status === 'approved' ? 'одобрена' : 'отклонена', `dev-st ${a.status}`),
        a.status === 'pending'
          ? el('div', { class: 'dev-acts' },
            act('Одобрить', () => api.devCall('/api/admin/applications/decide', { id: a.id, approve: true }), reload),
            act('Отклонить', () => api.devCall('/api/admin/applications/decide', { id: a.id, approve: false }), reload))
          : act('Вернуть в ожидание', () => api.devCall('/api/admin/applications/reopen', { id: a.id }), reload),
      ])),
    );
  },

  async accounts(reload) {
    const data = await api.devCall('/api/admin/accounts');
    return table(['Ник', 'Почта', 'Создан', 'Был', 'Ключ', ''], (data.accounts as Row[]).map((a) => [
      text(a.nickname),
      text(a.email, 'mono'),
      text(when(a.created_at)),
      text(when(a.last_login)),
      text(a.key_label, 'mono'),
      a.banned_at
        ? act('Разбанить', () => api.devCall('/api/admin/accounts/ban', { id: a.id, ban: false }), reload)
        : act('Забанить', () => api.devCall('/api/admin/accounts/ban', { id: a.id, ban: true }), reload, `Забанить ${a.email}?`),
    ]));
  },

  async licenses(reload) {
    const data = await api.devCall('/api/admin/licenses');
    const count = el('input', { class: 'input', type: 'number', value: '1', min: '1', max: '50', style: 'width:80px' }) as HTMLInputElement;
    const days = el('input', { class: 'input', type: 'number', value: '0', min: '0', style: 'width:90px', title: '0 - бессрочно' }) as HTMLInputElement;
    const devices = el('input', { class: 'input', type: 'number', value: '2', min: '1', max: '10', style: 'width:80px' }) as HTMLInputElement;
    const note = el('input', { class: 'input', placeholder: 'Заметка', style: 'flex:1' }) as HTMLInputElement;
    const made = el('div', {});
    const create = btn('Выпустить', () => void guard(async () => {
      const result = await api.devCall('/api/admin/licenses', { count: Number(count.value), days: Number(days.value), deviceLimit: Number(devices.value), note: note.value });
      const keys = (result.keys as string[]).join('\n');
      // Ключи видны только сейчас: сайт хранит лишь их хэш.
      made.replaceChildren(el('div', { class: 'dev-keys' },
        el('pre', { class: 'mono' }, keys),
        btn('Копировать', () => { void navigator.clipboard.writeText(keys); toast('Скопировано'); }),
        el('p', { class: 'dev-note' }, 'Ключи показываются один раз. Сохрани их сейчас.'),
      ));
    }), 'btn btn-main btn-s');
    return el('div', {},
      row(el('span', { class: 'dev-note' }, 'Сколько'), count, el('span', { class: 'dev-note' }, 'Дней (0 - навсегда)'), days,
        el('span', { class: 'dev-note' }, 'Устройств'), devices, note, create),
      made,
      table(['Ключ', 'Заметка', 'План', 'Устройства', 'Истекает', 'Создан', ''], (data.licenses as Row[]).map((l) => [
        text(l.key_label, 'mono'),
        text(l.note),
        text(l.plan),
        text(`${l.devices} / ${l.device_limit}`),
        text(l.expires_at ? new Date(l.expires_at * 1000).toLocaleDateString('ru-RU') : 'никогда'),
        text(when(l.created_at)),
        l.revoked_at
          ? act('Вернуть', () => api.devCall('/api/admin/revoke', { id: l.id, revoke: false }), reload)
          : act('Отозвать', () => api.devCall('/api/admin/revoke', { id: l.id, revoke: true }), reload, `Отозвать ключ ${l.key_label}?`),
      ])),
    );
  },

  async news(reload) {
    const data = await api.devCall('/api/admin/launcher/news');
    const field = (placeholder: string, value = '', area = false): HTMLInputElement | HTMLTextAreaElement =>
      area
        ? el('textarea', { class: 'input', placeholder, rows: '4', style: 'width:100%;resize:vertical' }, value) as HTMLTextAreaElement
        : el('input', { class: 'input', placeholder, value, style: 'flex:1' }) as HTMLInputElement;
    const slug = field('slug (латиницей, например update-1-11)');
    const title = field('Заголовок');
    const body = field('Текст', '', true);
    const tag = field('Метка (Обновление, Событие...)');
    const link = field('Ссылка (необязательно)');
    const accent = el('select', { class: 'input' }, ...['cosmic', 'kawaii', 'aurora'].map((a) => el('option', { value: a }, a))) as HTMLSelectElement;
    const pinned = el('input', { type: 'checkbox' }) as HTMLInputElement;
    const published = el('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
    const fill = (n: Row): void => {
      slug.value = n.slug; title.value = n.title; body.value = n.body ?? ''; tag.value = n.tag ?? ''; link.value = n.link ?? '';
      accent.value = n.accent ?? 'cosmic'; pinned.checked = !!n.pinned; published.checked = !!n.published;
      slug.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    const save = btn('Сохранить новость', () => void guard(async () => {
      await api.devCall('/api/admin/launcher/news', {
        slug: slug.value, title: title.value, body: body.value, tag: tag.value, link: link.value,
        accent: accent.value, pinned: pinned.checked, published: published.checked,
      });
      toast('Новость сохранена');
      reload();
    }), 'btn btn-main btn-s');
    return el('div', {},
      el('div', { class: 'dev-form' },
        row(slug, tag), title, body, row(link, accent,
          el('label', { class: 'dev-check' }, pinned, 'Закрепить'),
          el('label', { class: 'dev-check' }, published, 'Опубликовать'), save),
        el('p', { class: 'dev-note' }, 'Тот же slug - правка существующей новости.'),
      ),
      table(['Заголовок', 'Метка', 'Когда', 'Статус', ''], (data.news as Row[]).map((n) => [
        el('div', {}, el('b', {}, n.title), el('div', { class: 'dev-note mono' }, n.slug)),
        text(n.tag),
        text(when(n.at)),
        text(`${n.published ? 'видна' : 'скрыта'}${n.pinned ? ', закреплена' : ''}`),
        el('div', { class: 'dev-acts' },
          btn('Править', () => fill(n)),
          act('Удалить', () => api.devCall('/api/admin/launcher/news/delete', { slug: n.slug }), reload, `Удалить «${n.title}»?`)),
      ])),
    );
  },

  async strings(reload) {
    const data = await api.devCall('/api/admin/launcher/strings');
    const key = el('input', { class: 'input', placeholder: 'Ключ', style: 'width:260px' }) as HTMLInputElement;
    const value = el('input', { class: 'input', placeholder: 'Текст', style: 'flex:1' }) as HTMLInputElement;
    const add = btn('Сохранить', () => void guard(async () => {
      await api.devCall('/api/admin/launcher/strings', { key: key.value, value: value.value });
      toast('Сохранено');
      reload();
    }), 'btn btn-main btn-s');
    return el('div', {},
      row(key, value, add),
      el('p', { class: 'dev-note' }, 'Эти тексты лаунчер берёт с сайта вместо своих (ctx.text). Правка - Enter в поле.'),
      table(['Ключ', 'Текст', 'Изменён', ''], (data.strings as Row[]).map((s) => {
        const input = el('input', { class: 'input', value: s.value ?? '', style: 'width:100%' }) as HTMLInputElement;
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') void guard(async () => { await api.devCall('/api/admin/launcher/strings', { key: s.key, value: input.value, note: s.note ?? '' }); toast('Сохранено'); });
        });
        return [
          text(s.key, 'mono'),
          input,
          text(when(s.updated_at)),
          act('Удалить', () => api.devCall('/api/admin/launcher/strings/delete', { key: s.key }), reload, `Удалить ${s.key}?`),
        ];
      })),
    );
  },
};

export const devNavItem = { id: 'dev', label: 'Дев', icon: 'bolt' };
