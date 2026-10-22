import { api, type SharedPreview } from './api.js';
import type { Ctx } from './app.js';
import { el, icon, loadingBox, modal, plural, toast } from './ui.js';



let ctx: Ctx | null = null;


export function initShare(app: Ctx): void {
  ctx = app;
}


export const packMessage = (name: string, code: string): string => `Сборка «${name}» · код ${code}`;
const PACK_MESSAGE = /^Сборка «(.{1,64})» · код ([A-HJKMNP-Z2-9]{8})$/;

export function parsePackMessage(text: string): { name: string; code: string } | null {
  const match = PACK_MESSAGE.exec(text);
  return match ? { name: match[1]!, code: match[2]! } : null;
}

const LOADER_NAMES: Record<string, string> = { vanilla: 'без модов', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };

function describe(pack: SharedPreview): string {
  return `Minecraft ${pack.minecraft} · ${LOADER_NAMES[pack.loader] ?? pack.loader} · `
    + plural(pack.files, 'файл', 'файла', 'файлов');
}

/**
 * Окно «Поделиться»: код для друга, отправка в чат друзьям и группам, и прежний файл .mrpack.
 * friends - кому можно отправить: друзья и группы из социального модуля.
 */
export function shareDialog(
  id: string,
  targets: { key: string; name: string; send: (text: string) => Promise<unknown> }[],
): void {
  const box = el('div', { style: 'margin-top:14px' }, loadingBox('Собираю описание сборки…'));
  modal({
    title: 'Поделиться сборкой',
    note: 'Моды, ресурспаки и шейдеры. Миры и настройки не передаются.',
    wide: true,
    content: (close) => {
      void (async () => {
        let shared: { code: string; linked: number; skipped: string[] };
        try {
          shared = await api.sharePack(id);
        } catch (error) {
          box.replaceChildren(el('div', { class: 'err' }, error instanceof Error ? error.message : String(error)),
            fileButton(id, close));
          return;
        }
        const instanceName = ctx?.state.instances.find((i) => i.id === id)?.name ?? 'Сборка';
        const text = packMessage(instanceName.slice(0, 64), shared.code);
        const copy = el('button', { class: 'btn btn-ghost btn-s' }, icon('copy', 14, 1.7), 'Скопировать');
        copy.addEventListener('click', () => {
          void navigator.clipboard.writeText(shared.code).then(() => toast('Код скопирован'), () => toast('Не вышло скопировать', true));
        });
        const sendRows = targets.map((t) => {
          const button = el('button', { class: 'btn btn-ghost btn-s' }, icon('send', 13, 1.8), 'Отправить');
          button.addEventListener('click', () => {
            button.disabled = true;
            void t.send(text).then(() => {
              button.replaceChildren(icon('check', 13, 2.2), 'Отправлено');
            }, (error: unknown) => {
              button.disabled = false;
              toast(error instanceof Error ? error.message : String(error), true);
            });
          });
          return el('div', { class: 'share-to' }, el('b', {}, t.name), button);
        });
        box.replaceChildren(...[
          el('div', { class: 'share-code' },
            el('span', { class: 'share-code-text' }, shared.code.slice(0, 4), el('i', {}), shared.code.slice(4)),
            copy),
          el('p', { class: 'modal-note', style: 'margin-top:10px' },
            plural(shared.linked, 'файл', 'файла', 'файлов')),
          shared.skipped.length
            ? el('div', { class: 'note', style: 'margin-top:10px' },
                `Не передадутся (их нет на Modrinth): ${shared.skipped.slice(0, 6).join(', ')}`
                + (shared.skipped.length > 6 ? ` и ещё ${shared.skipped.length - 6}` : '')
                + '. Их другу придётся поставить самому, или сохрани сборку файлом.')
            : null,
          targets.length
            ? el('div', { class: 'share-list' }, el('p', { class: 'eyebrow', style: 'margin:16px 0 8px' }, 'Отправить в чат'), ...sendRows)
            : null,
          fileButton(id, close),
        ].filter((node): node is HTMLElement => Boolean(node)));
      })();
      return box;
    },
  });
}

function fileButton(id: string, close: () => void): HTMLElement {
  return el('button', {
    class: 'btn btn-ghost btn-s', style: 'margin-top:14px',
    title: 'Файл .mrpack откроет любой лаунчер, понимающий Modrinth. В нём и моды не с Modrinth, и настройки',
    onclick: () => {
      close();
      void api.exportPack(id).then((saved) => {
        if (saved) toast(`Файл готов: ${saved.linked} модов ссылкой, ${saved.packed} внутри архива`);
      }, (error: unknown) => toast(error instanceof Error ? error.message : String(error), true));
    },
  }, icon('download', 14, 1.7), 'Сохранить файлом .mrpack');
}

/** Окно «Сборка по коду»: ввести код (или он уже есть из чата), посмотреть, что за сборка, поставить. */
export function codeImportDialog(prefill = ''): void {
  const input = el('input', { placeholder: 'Например K7F3QX2M', maxlength: 12, spellcheck: 'false', value: prefill, class: 'mono' }) as HTMLInputElement;
  const info = el('div', { style: 'margin-top:12px' });
  let preview: SharedPreview | null = null;
  const look = async (): Promise<void> => {
    preview = null;
    const code = input.value.trim();
    if (code.replace(/[^A-Za-z0-9]/g, '').length !== 8) { info.replaceChildren(); return; }
    info.replaceChildren(loadingBox('Ищу сборку…'));
    try {
      preview = await api.previewShared(code);
      info.replaceChildren(el('div', { class: 'share-preview' },
        el('b', {}, preview.name), el('span', {}, describe(preview))));
    } catch (error) {
      info.replaceChildren(el('div', { class: 'err' }, error instanceof Error ? error.message : String(error)));
    }
  };
  input.addEventListener('input', () => void look());
  if (prefill) void look();
  modal({
    title: 'Сборка по коду',
    note: 'Код из 8 символов от друга.',
    content: el('div', {}, el('label', { class: 'field', style: 'margin-top:14px' }, input), info),
    confirm: 'Установить',
    onConfirm: () => void installShared(input.value.trim()),
  });
}

async function installShared(code: string): Promise<void> {
  if (!ctx) return;
  toast('Ставлю сборку… Прогресс - на её странице.');
  try {
    const result = await api.importShared(code);
    await ctx.reload();
    ctx.go({ name: 'instance', id: result.instance.id });
    if (result.failed.length) {
      toast(`Поставлено ${result.installed}, не вышло ${result.failed.length}: ${result.failed[0]}`, true);
    } else {
      toast(`Сборка «${result.instance.name}» готова - жми «Играть»`);
    }
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), true);
  }
}

/** Кнопка «По коду» рядом с «Импорт модпака». */
export function codeImportButton(): HTMLElement {
  return el('button', { class: 'btn btn-ghost', onclick: () => codeImportDialog() }, icon('download', 15, 1.7), 'По коду');
}

/** Карточка сборки в переписке: название, код и кнопка «Установить». */
export function packCard(name: string, code: string, mine: boolean): HTMLElement {
  return el('div', { class: `pack-card${mine ? ' mine' : ''}` },
    el('span', { class: 'pack-card-ico' }, icon('mods', 18, 1.7)),
    el('div', { class: 'pack-card-text' }, el('b', {}, name), el('span', { class: 'mono' }, `код ${code}`)),
    mine ? null : el('button', { class: 'fr-join', onclick: () => codeImportDialog(code) }, 'Установить'),
  );
}
