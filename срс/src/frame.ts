import { api } from './api.js';
import { el, icon } from './ui.js';




export function windowButtons(): HTMLElement {
  return el('div', { class: 'win' },
    el('button', { onclick: () => void api.minimize(), title: 'Свернуть' }, icon('min', 12, 1.2)),
    el('button', { onclick: () => void api.maximize(), title: 'Развернуть' }, icon('max', 12, 1.2)),
    el('button', { class: 'x', onclick: () => void api.close(), title: 'Закрыть' }, icon('close', 12, 1.2)),
  );
}

interface FrameParts {
  title: string;
  sub?: string | null;
  
  extra?: HTMLElement | null;
  tabs?: HTMLElement | null;
  body: HTMLElement;
  footer?: HTMLElement | null;
  
  back?: () => void;
}

export function frame(parts: FrameParts): HTMLElement {
  return el('main', { class: 'main' },
    el('header', { class: 'top' },
      parts.back
        ? el('button', { class: 'btn btn-ghost btn-s', onclick: parts.back }, icon('back', 14, 1.9))
        : null,
      el('h1', {}, parts.title),
      parts.sub ? el('span', { class: 'sub' }, parts.sub) : null,
      parts.extra ?? null,
      windowButtons(),
    ),
    parts.tabs ?? null,
    parts.body,
    parts.footer ?? null,
  );
}
