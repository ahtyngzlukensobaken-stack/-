import { el, icon, modal } from './ui.js';



const DEV = 'drpowerx';


export const isDevName = (name: string): boolean => name.trim().toLowerCase() === DEV;


export function devBadge(name: string, licensed: boolean | undefined): HTMLElement | null {
  return licensed && isDevName(name)
    ? el('i', { class: 'dev-badge', title: 'Создатель Power Launcher' }, icon('sparkle', 10, 2), el('span', { class: 'dev-label' }, 'Разработчик'))
    : null;
}

export function devPrank(): void {
  modal({
    title: 'Успешно! Ты теперь разработчик!',
    note: 'Аккаунт разработчика Power Launcher подключён. Смотри, что тебе теперь доступно:',
    content: (close) => {
      const box = el('div', {});
      const perks = [
        'Панель разработчика с доступом ко всем серверам',
        'Бесконечные алмазы в любой сборке',
        'Режим бога без команд',
        'Золотая галочка в списке друзей',
      ];
      const next = el('button', { class: 'btn btn-main', style: 'margin-top:16px;width:100%' }, 'Далее');
      next.addEventListener('click', () => {
        box.replaceChildren(
          el('div', { class: 'prank-video' },
            el('iframe', {
              src: 'REDACTED_ENDPOINT',
              allow: 'autoplay; encrypted-media',
              referrerpolicy: 'strict-origin-when-cross-origin',
              title: 'Секретная панель',
            })),
          el('button', { class: 'btn btn-ghost', style: 'margin-top:14px;width:100%', onclick: close }, 'Ладно, понял'),
        );
      });
      box.append(
        el('div', { class: 'prank-perks' },
          ...perks.map((perk) => el('div', {}, icon('check', 13, 2.4), perk))),
        next,
      );
      return box;
    },
  });
}
