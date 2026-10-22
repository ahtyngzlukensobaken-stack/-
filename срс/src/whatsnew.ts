import { el, icon } from './ui.js';


interface Release { version: string; items: { icon: string; title: string; text: string }[] }

export const RELEASES: Release[] = [
  {
    version: '1.11.0',
    items: [
      { icon: 'check', title: 'Пофикшены мелкие баги', text: 'Ну, почти все.' },
    ],
  },
  {
    version: '1.10.1',
    items: [
      { icon: 'sparkle', title: 'Праздники стали красивее', text: 'Гирлянда на Новый год, туман и летучие мыши на Хэллоуин, залпы конфетти. Жёлтые надписи убраны.' },
    ],
  },
  {
    version: '1.10.0',
    items: [
      { icon: 'sparkle', title: 'Праздники', text: 'Снег, тыквы, конфетти и прочее по датам. Посмотреть - в настройках.' },
      { icon: 'bolt', title: 'Ctrl+1...6', text: 'Быстро между экранами.' },
    ],
  },
  {
    version: '1.9.0',
    items: [
      { icon: 'image', title: 'Картинки и гифки в чате', text: 'Кнопкой, Ctrl+V или перетащить в чат.' },
      { icon: 'star', title: 'Избранное', text: 'Правая кнопка по картинке - «В избранное».' },
      { icon: 'smile', title: 'Смайлики', text: 'И больше реакций: «+» в меню сообщения.' },
    ],
  },
  {
    version: '1.8.3',
    items: [
      { icon: 'check', title: 'Пофикшены мелкие баги', text: '' },
    ],
  },
  {
    version: '1.8.0',
    items: [
      { icon: 'chat', title: 'Чат как в Телеграме', text: 'Ответы, правка, удаление, реакции и «печатает…». Правая кнопка по сообщению.' },
      { icon: 'moon', title: 'Не беспокоить и невидимка', text: 'На экране «Друзья», справа сверху.' },
      { icon: 'user', title: 'Свои аватарки', text: 'Клик по своему лицу на экране «Друзья».' },
    ],
  },
  {
    version: '1.7.3',
    items: [
      { icon: 'sparkle', title: 'Мне лень писать, посмотрите сами)', text: '' },
    ],
  },
  {
    version: '1.7.2',
    items: [
      { icon: 'check', title: 'Пофикшены мелкие баги', text: '' },
    ],
  },
  {
    version: '1.7.1',
    items: [
      { icon: 'mic', title: 'Шумоподавление нейросетью',
        text: 'Клавиатура, вентилятор и фон глушатся нейросетью RNNoise. В «Настройки» → «Голос» можно выбрать модель посильнее, GTCRN, или выключить совсем.' },
      { icon: 'phone', title: 'Панель звонка двигается',
        text: 'Тащи её мышкой куда удобно, место запомнится. Двойной клик по пустому месту панели вернёт её вниз по центру.' },
    ],
  },
  {
    version: '1.7.0',
    items: [
      { icon: 'bolt', title: 'Теперь это Power Launcher',
        text: 'Лаунчер больше не ставит мод Power Visual сам. Кому нужен мод - качает его на сайте и кладёт в сборку, как любой другой.' },
      { icon: 'external', title: 'Сборки по коду',
        text: '«Поделиться» на странице сборки даёт код из 8 символов. Отправь его другу в чат одной кнопкой, а он нажмёт «Установить» на карточке или введёт код в «Библиотека» → «По коду».' },
      { icon: 'mic', title: 'Выбор микрофона и наушников',
        text: 'В настройках появился раздел «Голос»: микрофон, устройство вывода, проверка микрофона и шумоподавление.' },
      { icon: 'headphones', title: 'Громкость каждого от 0 до 200%',
        text: 'Правый клик по лицу собеседника в звонке: громкого можно приглушить, тихого сделать громче.' },
    ],
  },
  {
    version: '1.6.0',
    items: [
      { icon: 'phone', title: 'Голосовые звонки',
        text: 'Кнопка с трубкой в переписке с другом. Звук чистый: шумоподавление и эхоподавление, а твой IP собеседник не узнает - звонок идёт через сервер Cloudflare.' },
      { icon: 'group', title: 'Группы',
        text: 'Общий чат на компанию друзей и голосовой канал в каждой группе, до 8 человек одновременно. Создать: «+» у раздела «Группы» в списке друзей.' },
      { icon: 'mic', title: 'Микрофон поверх игры',
        text: 'Ctrl+Shift+M выключает и включает микрофон прямо в игре. Громкость каждого собеседника - по клику на его лицо в панели звонка.' },
    ],
  },
  {
    version: '1.5.2',
    items: [
      { icon: 'bolt', title: 'Друзья без задержек',
        text: 'Сообщения, заявки и статусы друзей приходят сразу, как только что-то случилось, а не раз в 20 секунд. И сайт почти не нагружается.' },
    ],
  },
  {
    version: '1.5.1',
    items: [
      { icon: 'friends', title: 'Друзья без лицензии',
        text: 'Друзья и чат теперь и для офлайн-аккаунтов: ник закрепляется за компьютером, и при смене ника друзья и переписка остаются.' },
      { icon: 'check', title: 'Вход с лицензией починен',
        text: 'В 1.5.0 друзья с лицензией не включались. У лицензии в списке теперь галочка «подтверждён Mojang».' },
      { icon: 'info', title: 'Новости Minecraft по-русски',
        text: 'Заголовки и описания новостей Mojang переведены на русский.' },
      { icon: 'user', title: 'Статус в Discord выключается',
        text: 'Переключатель в «Настройках»: лаунчер перестанет показывать в Discord, во что ты играешь.' },
    ],
  },
  {
    version: '1.5.0',
    items: [
      { icon: 'friends', title: 'Друзья и чат',
        text: 'Видно, кто из друзей в сети и во что играет. Можно переписываться и заходить к другу на сервер кнопкой «Зайти».' },
      { icon: 'sparkle', title: 'Тема «Power»',
        text: 'Обложки сборок из твоих скриншотов и картинок версий Minecraft, 3D-скин и друзья справа.' },
      { icon: 'bolt', title: 'Сервер в Discord',
        text: 'С модом голосового чата статус больше не пишет «на сервере voice» вместо настоящего адреса.' },
    ],
  },
  {
    version: '1.4.0',
    items: [
      { icon: 'sparkle', title: 'Четыре темы',
        text: '«Космос», «Тихая», «Светлая» и «Игровая» с пиксельным пейзажем. Меняются в «Настройках».' },
      { icon: 'home', title: 'Экран «Играть»',
        text: 'В новых темах лаунчер открывается на главной: последняя сборка и большая кнопка.' },
      { icon: 'user', title: 'Знакомство',
        text: 'Новый первый запуск: вход, приветствие по нику и выбор темы за полминуты.' },
      { icon: 'moon', title: 'Больше не пропадает',
        text: 'Перезапуск Discord во время игры больше не роняет лаунчер, и он снова открывается после игры.' },
    ],
  },
  {
    version: '1.3.5',
    items: [
      { icon: 'library', title: 'Удобная страница сборки',
        text: 'Вкладки «Моды», «Миры» и остальные стоят прямо над списком и не уезжают при прокрутке.' },
      { icon: 'plus', title: 'Новая сборка нагляднее',
        text: 'Внизу видно, что именно создастся, а быстрые варианты собраны в одну аккуратную карточку.' },
      { icon: 'user', title: 'Аккаунты на одном экране',
        text: 'Скин теперь рядом со списком аккаунтов, а офлайн-ник добавляется по Enter.' },
    ],
  },
  {
    version: '1.3.4',
    items: [
      { icon: 'bolt', title: 'Лаунчер летает',
        text: 'Фон больше не грузит видеокарту. Для слабых ПК есть «Лёгкий режим» в настройках.' },
      { icon: 'moon', title: 'Не мешает играть',
        text: 'Во время игры лаунчер ждёт в трее и сам открывается, когда закроешь игру.' },
      { icon: 'java', title: 'Java сама собой',
        text: 'Старая Java? Лаунчер подскажет и скачает свежую одной кнопкой.' },
      { icon: 'mods', title: 'Моды в 15 раз быстрее',
        text: '400 модов узнаются за пару секунд. Удалённое уходит в Корзину.' },
      { icon: 'alert', title: 'Понятные ошибки',
        text: 'Ошибки по-человечески и с кнопкой «Копировать». Окно вылета подсказывает, что делать.' },
      { icon: 'user', title: 'Твоё лицо и «Сейчас»',
        text: 'В меню лицо твоего скина и карточка: сколько играешь или сколько осталось скачать.' },
    ],
  },
];


function newer(a: string, b: string): boolean {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}


export function unseenReleases(seen: string, current: string): Release[] {
  return RELEASES.filter((r) => (!seen || newer(r.version, seen)) && !newer(r.version, current));
}


export function showWhatsNew(version: string, releases = unseenReleases('', version)): void {
  const items = releases.flatMap((release) => release.items);
  if (!items.length) return;
  document.querySelector('.wn-backdrop')?.remove();

  const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape' || event.key === 'Enter') close(); };
  const close = (): void => { document.removeEventListener('keydown', onKey); backdrop.remove(); };
  document.addEventListener('keydown', onKey);

  const backdrop = el('div', {
    class: 'crash-backdrop wn-backdrop',
    onclick: (event: Event) => { if (event.target === backdrop) close(); },
  },
    el('div', { class: 'crash-card wn-card' },
      el('div', { class: 'wn-head' },
        el('div', { class: 'wn-badge' }, icon('sparkle', 26, 1.7)),
        el('div', {},
          el('p', { class: 'eyebrow' }, `Версия ${version}`),
          el('h2', { class: 'wn-title' }, 'Что нового'),
        ),
      ),
      // Три новинки и меньше - одной колонкой: две колонки с пустой клеткой смотрятся недоделанно.
      el('div', { class: items.length <= 3 ? 'wn-grid wn-one' : 'wn-grid' },
        // Карточки появляются по очереди: номер карточки уходит в CSS-переменную --i,
        // из неё считается задержка анимации.
        ...items.map((item, index) => el('div', { class: 'wn-item', style: `--i:${index}` },
          el('div', { class: 'wn-ico' }, icon(item.icon, 18, 1.8)),
          el('div', { style: 'min-width:0' },
            el('b', {}, item.title),
            item.text ? el('p', {}, item.text) : null,
          ),
        )),
      ),
      el('div', { class: 'wn-foot' },
        el('span', {}, 'Это окно можно открыть снова в «Настройках».'),
        el('button', { class: 'btn btn-main', onclick: close }, 'Поехали!'),
      ),
    ),
  );
  document.body.append(backdrop);
}
