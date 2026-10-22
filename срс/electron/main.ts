const redactedOpenExternal = async (..._args: unknown[]): Promise<void> => {};
const redactedUpdater = new Proxy({}, { get: () => () => Promise.resolve(undefined) });
import './early.js';
import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, Notification, shell, Tray } from 'electron';
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allowPermission, isAppUrl, LOCKED_SETTINGS } from './services/guards.js';
import { checkUpdate, compareVersions, fetchSignature } from './services/updatesig.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { totalmem } from 'node:os';
import { downloadJava } from './services/java.js';


const NEWEST_JAVA = 21;
import * as accounts from './services/accounts.js';
import * as backup from './services/backup.js';
import * as content from './services/content.js';
import * as install from './services/install.js';
import * as instances from './services/instances.js';
import * as migrate from './services/migrate.js';
import * as mojang from './services/mojang.js';
import { exportPack, importPack, importShared, previewShared, sharePack } from './services/mrpack.js';
import * as launch from './services/launch.js';
import * as mods from './services/mods.js';
import * as presence from './services/presence.js';
import * as skins from './services/skins.js';
import * as social from './services/social.js';
import * as favorites from './services/favorites.js';
import * as devtools from './services/devbuild.js';
import * as versions from './services/versions.js';
import { applyStoredDataRoot, dataSize, moveDataRoot } from './services/datadir.js';
import { CONFIG_ROOT, dataDir, ensureDirs, instanceDir } from './services/paths.js';
import { load, update, DEFAULT_SETTINGS } from './services/store.js';
import { journal } from './services/journal.js';



const here = dirname(fileURLToPath(import.meta.url));
const dev = process.env.PV_DEV === '1';
const JOIN_PROTOCOL = 'powervisual';


process.on('uncaughtException', (error) => journal('Необработанная ошибка', error));
process.on('unhandledRejection', (reason) => journal('Необработанный отказ промиса', reason));

let window_: BrowserWindow | null = null;
let tray: Tray | null = null;

let quitting = false;

let hiddenForGame = false;


let lastBadge = 0;

function send(channel: string, payload: unknown): void {
  if (window_ && !window_.isDestroyed()) window_.webContents.send(channel, payload);
}

function showWindow(): void {
  if (!window_ || window_.isDestroyed()) { createWindow(); return; }
  if (!window_.isVisible()) window_.show();
  if (window_.isMinimized()) window_.restore();
  window_.focus();
}


async function toTrash(path: string): Promise<void> {
  try {
    await shell.trashItem(path);
  } catch {
    throw new Error('Не получилось убрать в Корзину: файл занят. Закрой игру и окно проводника с этой папкой и попробуй снова.');
  }
}


function hideForGame(): void {
  if (!load().settings.hideDuringGame || !window_ || window_.isDestroyed()) return;
  hiddenForGame = true;
  applyTray();
  window_.hide();
  journal('Окно спрятано на время игры');
}


const MUTE_KEY = 'CommandOrControl+Shift+M';
function setVoiceActive(on: boolean): void {
  if (window_ && !window_.isDestroyed()) window_.webContents.setBackgroundThrottling(!on);
  if (on && !globalShortcut.isRegistered(MUTE_KEY)) {
    globalShortcut.register(MUTE_KEY, () => send('voice-key', { action: 'mute' }));
  } else if (!on && globalShortcut.isRegistered(MUTE_KEY)) {
    globalShortcut.unregister(MUTE_KEY);
  }
}


function returnAfterGame(): void {
  if (launch.anyRunning()) return;
  if (hiddenForGame) {
    hiddenForGame = false;
    journal('Игра закрылась, возвращаю окно');
    showWindow();
    
    applyTray();
  }
  
  if (pendingUpdate) askToInstallUpdate(pendingUpdate);
}


function applyTray(): void {
  
  const wanted = load().settings.minimizeToTray || hiddenForGame;
  if (!wanted) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (tray) return;

  const image = nativeImage.createFromPath(join(here, '../../build/icon-32.png'));
  tray = new Tray(image.isEmpty() ? nativeImage.createEmpty() : image);
  tray.setToolTip('Power Launcher');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть лаунчер', click: () => showWindow() },
    { type: 'separator' },
    
    { label: 'Выйти', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => showWindow());
}



function clampMemory(value: number): number {
  const mb = Math.round(Number(value) / 512) * 512;
  return Math.min(32768, Math.max(1024, Number.isFinite(mb) ? mb : 4096));
}

const handlers: Record<string, (payload: any) => unknown> = {
  
  'state': () => {
    const data = load();
    return {
      accounts: data.accounts.map(({ accessToken, refreshToken, ...rest }) => rest),
      selectedAccount: data.selectedAccount,
      instances: instances.list(),
      selectedInstance: data.selectedInstance,
      settings: data.settings,
      content: content.get(),
      running: instances.list().filter((i) => launch.isRunning(i.id)).map((i) => i.id),
      version: app.getVersion(),
      devBuild: devtools.devBuild,
    };
  },


  
  'dev.hasToken': () => devtools.hasToken(),
  'dev.setToken': async (payload: { token: string }) => {
    await devtools.setToken(payload.token);
    
    if (app.isPackaged) void redactedUpdater.checkForUpdates().catch(() => {});
  },
  'dev.clearToken': () => { devtools.clearToken(); },
  'dev.call': (payload: { path: string; body?: unknown }) => devtools.call(payload.path, payload.body),

  
  'content.refresh': async () => {
    const fresh = await content.refresh();
    send('content-updated', fresh);
    return fresh;
  },

  
  'accounts.addOffline': (payload: { name: string }) => accounts.addOffline(payload.name),
  'accounts.remove': (payload: { id: string }) => { accounts.remove(payload.id); },
  'accounts.select': (payload: { id: string }) => { accounts.select(payload.id); },
  'accounts.signInMicrosoft': async () => {
    const account = await accounts.signInMicrosoft(window_);
    
    const { accessToken, refreshToken, ...safe } = account;
    return safe;
  },

  
  'skins.pick': () => skins.pick(window_),
  'skins.apply': (payload: { id: string; model: skins.SkinModel; png: string }) =>
    skins.apply(payload.id, payload.model, payload.png),
  'skins.reset': (payload: { id: string }) => skins.reset(payload.id),
  'skins.current': (payload: { id: string }) => skins.current(payload.id),

  
  'versions.game': (payload: { channel: versions.Channel }) => versions.gameVersions(payload.channel),
  'versions.loader': (payload: { loader: versions.Loader; minecraft: string }) =>
    versions.loaderVersions(payload.loader, payload.minecraft),

  
  'instances.create': (payload: instances.NewInstance) => {
    const instance = instances.create(payload);
    
    
    void mods.installEssentials(instance.id, (line) => send('game-log', { instanceId: instance.id, line, level: 'status' }))
      .catch(() => {});
    return instance;
  },
  
  
  'instances.remove': async (payload: { id: string; deleteFiles: boolean }) => {
    if (!instances.get(payload.id)) throw new Error('Такой сборки больше нет.');
    if (launch.isRunning(payload.id)) throw new Error('Сначала закрой игру - сборку на ходу не удалить.');
    const dir = instanceDir(payload.id);
    if (payload.deleteFiles && existsSync(dir)) await toTrash(dir);
    instances.remove(payload.id);
  },
  'instances.select': (payload: { id: string }) => { instances.select(payload.id); },
  'instances.rename': (payload: { id: string; name: string }) => instances.rename(payload.id, payload.name),
  'instances.duplicate': (payload: { id: string }) => instances.duplicate(payload.id),

  
  'instances.exportPack': async (payload: { id: string }) => {
    const instance = instances.get(payload.id);
    if (!instance) throw new Error('Такой сборки больше нет.');
    
    const safe = instance.name.replace(/[\/:*?"<>|]/g, '-').trim() || 'сборка';
    const result = await dialog.showSaveDialog(window_!, {
      title: 'Куда сохранить модпак',
      defaultPath: `${safe}.mrpack`,
      filters: [{ name: 'Модпак Modrinth', extensions: ['mrpack'] }],
    });
    if (result.canceled || !result.filePath) return null;
    return exportPack(payload.id, result.filePath);
  },
  'instances.setMemory': (payload: { id: string; memory: number }) =>
    instances.patch(payload.id, { memory: clampMemory(payload.memory) }),
  'instances.content': (payload: { id: string; kind: instances.Kind; world?: string }) =>
    instances.files(payload.id, payload.kind, payload.world ?? ''),
  'instances.worlds': (payload: { id: string }) => instances.worlds(payload.id),
  /**
   * Мир в ZIP. Спрашиваем, куда положить: бэкап нужен как раз для того, чтобы унести его
   * из папки лаунчера - на флешку, в облако, куда угодно.
   */
  'instances.backupWorld': async (payload: { id: string; folder: string }) => {
    // Игру не закрываем и не просим закрыть - только честно предупреждаем: часть мира
    // может быть ещё в памяти игры, и в архив попадёт состояние на момент последнего сохранения.
    if (launch.isRunning(payload.id)) {
      const warn = await dialog.showMessageBox(window_!, {
        type: 'warning',
        buttons: ['Всё равно сохранить', 'Отмена'],
        defaultId: 0,
        cancelId: 1,
        title: 'Игра запущена',
        message: 'Мир сейчас открыт в игре. В архив попадёт последнее сохранение - свежие '
          + 'постройки могут не войти. Продолжить?',
      });
      if (warn.response !== 0) return null;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(window_!, {
      title: 'Куда сохранить мир',
      defaultPath: `${payload.folder}-${stamp}.zip`,
      filters: [{ name: 'Архив ZIP', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return null;
    return backup.backupWorld(payload.id, payload.folder, result.filePath);
  },
  'instances.openFolder': (payload: { id: string }) => {
    // Папка появляется только после установки, а на несуществующий путь Windows показывает
    // своё окно «расположение недоступно». Поэтому просто создаём её.
    const dir = instanceDir(payload.id);
    mkdirSync(join(dir, 'mods'), { recursive: true });
    return shell.openPath(dir);
  },
  'instances.importFiles': (payload: { id: string; kind: instances.Kind; world?: string; paths: string[] }) =>
    instances.importFiles(payload.id, payload.kind, payload.world ?? '',
      Array.isArray(payload.paths) ? payload.paths.map(String) : []),
  // ---- обложка сборки
  'instances.pickCover': async (payload: { id: string }) => {
    const result = await dialog.showOpenDialog(window_!, {
      title: 'Выбери картинку для обложки',
      properties: ['openFile'],
      filters: [{ name: 'Картинка', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    });
    const file = result.canceled ? null : result.filePaths[0] ?? null;
    return file ? instances.setCover(payload.id, file) : null;
  },
  'instances.clearCover': (payload: { id: string }) => { instances.clearCover(payload.id); },

  // Импорт модпака: диалог выбора файла и распаковка. Файл выбирает человек через системное
  // окно - путь не приходит из интерфейса, подсунуть чужой файл со стороны нельзя.
  // ---- обмен сборками по коду (services/mrpack.ts, сайт - src/packs.js)
  'instances.share': (payload: { id: string }) => sharePack(String(payload.id)),
  'instances.previewShared': (payload: { code: string }) => previewShared(String(payload.code ?? '')),
  'instances.importShared': async (payload: { code: string }) => {
    const imported = await importShared(String(payload.code ?? ''));
    return imported;
  },
  'instances.importPack': async () => {
    const result = await dialog.showOpenDialog(window_!, {
      title: 'Выбери модпак',
      properties: ['openFile'],
      filters: [{ name: 'Модпак', extensions: ['mrpack', 'zip'] }],
    });
    const file = result.canceled ? null : result.filePaths[0] ?? null;
    if (!file) return null;
    const imported = await importPack(file);
    return { instance: imported.instance, installed: imported.installed, failed: imported.failed };
  },

  // Подгонка модов под версию игры сборки: что подойдёт, что обновить, что выключить.
  'mods.checkFit': (payload: { id: string }) => mods.checkFit(payload.id),
  'mods.applyFit': (payload: { id: string; report: mods.ModFit[] }) =>
    mods.applyFit(payload.id, payload.report),

  'instances.setVersion': (payload: {
    id: string; minecraft: string;
    loader: 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'; loaderVersion: string;
  }) => instances.setVersion(payload.id, payload),

  // Перенос из чужих лаунчеров: поиск ничего не меняет на диске, перенос - только копирует.
  'instances.scanOther': () => migrate.scan(),
  // Что переносить, берём из своего же поиска, а не из присланного: иначе интерфейс мог бы
  // попросить скопировать в сборку любую папку диска.
  'instances.adopt': async (payload: { found: migrate.FoundInstance; withWorlds: boolean }) => {
    const found = (await migrate.scan()).find((one) => one.path === payload?.found?.path);
    if (!found) throw new Error('Эта сборка больше не находится. Обнови поиск.');
    return migrate.adopt(found, Boolean(payload.withWorlds));
  },

  'instances.screenshots': (payload: { id: string }) => instances.screenshots(payload.id),
  'instances.openScreenshot': (payload: { id: string; file: string }) =>
    shell.openPath(instances.screenshotPath(payload.id, payload.file)),
  // В корзину, а не насовсем: скриншот, удалённый случайным кликом, должно быть можно вернуть.
  'instances.trashScreenshot': (payload: { id: string; file: string }) =>
    shell.trashItem(instances.screenshotPath(payload.id, payload.file)),

  // ---- установка и запуск
  'install.cancel': (payload: { id: string }) => install.cancel(payload.id),

  'launch.start': async (payload: { id: string }) => {
    let result;
    try {
      result = await launch.start(payload.id);
    } catch (error) {
      if (!(error instanceof launch.NeedsRepairError)) throw error;
      // Флаг «установлена» соврал - файлов нет. Спрашиваем перед докачкой: моды, миры и настройки
      // она не трогает (качается только недостающее), но это всё равно загрузка, которую игрок не заказывал.
      const choice = await dialog.showMessageBox(window_!, {
        type: 'warning',
        buttons: ['Переустановить', 'Отмена'],
        defaultId: 0,
        cancelId: 1,
        title: 'Файлы сборки повреждены',
        message: `Не найдены файлы игры (${error.versionId}). Докачать только недостающее? `
          + 'Моды, миры и настройки сборки не затронутся.',
      });
      if (choice.response !== 0) throw new Error('Запуск отменён.');
      instances.patch(payload.id, { installed: false });
      result = await launch.start(payload.id);
    }
    hideForGame();
    return result;
  },
  'launch.java': () => launch.javaInstalls(),
  // Самая свежая Java на компьютере (вместе со скачанными лаунчером). 0 - Java нет вовсе.
  'java.newest': async () => Math.max(0, ...(await launch.javaInstalls()).map((j) => j.majorVersion)),
  // Скачать свежую Java по кнопке, не дожидаясь запуска игры. Ставится в папку лаунчера,
  // в систему ничего не прописывается. Прогресс - событием java-progress.
  'java.download': async () => {
    const path = await downloadJava(
      NEWEST_JAVA,
      () => { /* стадии показывает сама кнопка */ },
      (done, total) => send('java-progress', { done, total }),
    );
    launch.forgetJava();
    return { major: NEWEST_JAVA, path };
  },
  // Сколько оперативки у компьютера - чтобы ползунок памяти не предлагал больше, чем есть.
  'system.memory': () => Math.round(totalmem() / 1048576),

  // ---- кнопки в окне вылета
  'crash.autofixDisable': (payload: { id: string; nameHints: string[] }) =>
    mods.autofixDisable(payload.id, payload.nameHints),
  'crash.autofixUpdate': (payload: { id: string; nameHints: string[] }) =>
    mods.autofixUpdate(payload.id, payload.nameHints),
  /**
   * Показывает файл отчёта в проводнике.
   *
   * Именно показывает, а не открывает: открыть - значит запустить файл системой, а путь приходит
   * из отчёта. Проводник с выделенным файлом безопаснее и при этом понятнее - видно, где он лежит.
   */
  'crash.showReport': (payload: { path: string }) => {
    if (!payload.path) return;
    shell.showItemInFolder(payload.path);
  },

  // ---- моды и прочий контент
  'mods.search': (payload: mods.SearchQuery) => mods.search(payload),
  'mods.versions': (payload: {
    id: string; source: mods.Source; projectId: string; kind?: mods.Kind;
  }) => mods.versions(payload.id, payload.source, payload.projectId, payload.kind),
  'mods.install': (payload: Omit<mods.InstallRequest, 'instanceId'> & { id: string }) =>
    mods.install({ ...payload, instanceId: payload.id }),
  'mods.checkUpdates': (payload: { id: string }) => mods.checkUpdates(payload.id),
  'mods.applyUpdate': (payload: { id: string; update: mods.ModUpdate }) =>
    mods.applyUpdate(payload.id, payload.update),
  'mods.toggle': (payload: { id: string; file: string; kind?: mods.Kind; world?: string }) =>
    mods.toggle(payload.id, payload.file, payload.kind, payload.world ?? ''),
  'mods.remove': async (payload: { id: string; file: string; kind?: mods.Kind; world?: string }) => {
    const path = mods.contentFile(payload.id, payload.file, payload.kind, payload.world ?? '');
    if (existsSync(path)) await toTrash(path);
  },
  'mods.pin': (payload: { id: string; file: string; pinned: boolean }) =>
    mods.setPinned(payload.id, payload.file, payload.pinned),
  'mods.identify': (payload: { id: string; file: string; kind?: mods.Kind; world?: string }) =>
    mods.identify(payload.id, payload.file, payload.kind, payload.world ?? ''),
  'mods.identifyMany': (payload: { id: string; files: string[]; kind?: mods.Kind; world?: string }) =>
    mods.identifyMany(payload.id, payload.files, payload.kind, payload.world ?? ''),
  'mods.switchVersion': (payload: {
    id: string; file: string; versionId: string; kind?: mods.Kind; world?: string;
  }) => mods.switchVersion(payload.id, payload.file, payload.versionId, payload.kind, payload.world ?? ''),

  // ---- настройки
  'settings.save': (payload: Partial<typeof DEFAULT_SETTINGS>) => {
    update((data) => {
      // Берём только известные настройки нужного типа: опечатка в интерфейсе иначе записала бы
      // в конфиг строку вместо числа, и запуск упал бы на «ширине окна» "1600px".
      const clean: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(payload ?? {})) {
        // Адрес сайта, id приложения Microsoft и папку данных интерфейс не меняет (см. guards.ts).
        if (LOCKED_SETTINGS.has(key)) continue;
        const sample = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
        if (sample !== undefined && typeof value === typeof sample) clean[key] = value;
      }
      if (typeof clean.width === 'number') clean.width = Math.min(7680, Math.max(640, Math.round(clean.width)));
      if (typeof clean.height === 'number') clean.height = Math.min(4320, Math.max(480, Math.round(clean.height)));
      data.settings = { ...data.settings, ...clean };
      // Игра берёт память из самой сборки. Общий ползунок - это «поставить всем сразу»,
      // иначе он менял только значение для будущих сборок, и игра дальше шла с прежними 4 ГБ.
      if (payload.memory !== undefined) {
        const memory = clampMemory(payload.memory);
        data.settings.memory = memory;
        for (const instance of data.instances) instance.memory = memory;
      }
    });
    if (typeof payload?.discordStatus === 'boolean') void presence.setEnabled(payload.discordStatus);
    // Значок трея появляется и исчезает сразу по переключателю, а не после перезапуска.
    applyTray();
    return load().settings;
  },

  // ---- мелочи для экрана логов
  'clipboard.write': (payload: { text: string }) => {
    // Буфер обмена Electron, а не navigator.clipboard: интерфейс открыт с file:, это не
    // «безопасный контекст», и браузерный API там недоступен.
    clipboard.writeText(payload.text);
  },

  'logs.save': async (payload: { text: string }) => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const result = await dialog.showSaveDialog(window_!, {
      title: 'Сохранить лог',
      defaultPath: `powerlauncher-${stamp}.log`,
      filters: [{ name: 'Лог', extensions: ['log', 'txt'] }],
    });
    if (result.canceled || !result.filePath) return null;
    writeFileSync(result.filePath, payload.text, 'utf8');
    return result.filePath;
  },

  // ---- открытие ссылок и папок
  // Число непрочитанных на иконке в панели задач. Картинку рисует интерфейс (canvas), здесь только ставим.
  'app.badge': (payload: { count: number; image: string }) => {
    if (!window_ || window_.isDestroyed()) return;
    const count = Math.max(0, Math.floor(Number(payload.count) || 0));
    const image = count && typeof payload.image === 'string' && payload.image.startsWith('data:image/png;base64,')
      ? nativeImage.createFromDataURL(payload.image) : null;
    window_.setOverlayIcon(image, count ? `Непрочитанных: ${count}` : '');
    // Новое пришло, а окно не в фокусе - кнопка в панели задач мигает, пока не откроют.
    if (count > lastBadge && !window_.isFocused()) window_.flashFrame(true);
    lastBadge = count;
  },
  'shell.open': (payload: { url: string }) => {
    // Отдаём системе только http(s): file: или команда оболочки открылись бы с правами пользователя.
    if (!/^https?:\/\//i.test(payload.url)) throw new Error('Ссылка должна быть http(s).');
    return redactedOpenExternal(payload.url);
  },
  'shell.openRoot': () => shell.openPath(dataDir()),

  // ---- папка данных
  'data.info': async () => ({ path: dataDir(), size: await dataSize() }),

  'data.pick': async () => {
    const result = await dialog.showOpenDialog(window_!, {
      title: 'Куда перенести файлы лаунчера',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  },

  'data.move': async (payload: { path: string }) => {
    if (launch.anyRunning()) throw new Error('Сначала закрой игру - её файлы сейчас заняты.');
    if (install.busy()) throw new Error('Идёт установка. Дождись её конца или отмени.');
    const result = await moveDataRoot(payload.path);
    // Перезапускаемся, а не правим все открытые пути: установщик, логи и список модов держат пути,
    // собранные заранее, и чистый старт - надёжный способ подхватить новую папку.
    //
    // Через setImmediate: app.exit() не ждёт ответа на IPC, и без задержки интерфейс не получал
    // ответ - перенос проходил, а в окне запрос «зависал» в момент закрытия.
    setImmediate(() => { quitting = true; app.relaunch(); app.exit(0); });
    return result;
  },

  // ---- картинки версий и новости Minecraft (services/mojang.ts)
  'mojang.feed': () => mojang.get(),

  // ---- друзья и чат (services/social.ts)
  'social.state': () => social.current(),
  'social.enable': (payload?: { accountId?: string }) => social.enable(payload?.accountId || undefined),
  'social.disable': () => social.disable(),
  'social.add': (payload: { name: string; uuid?: string }) => social.addFriend(String(payload.name ?? ''), payload.uuid ? String(payload.uuid) : undefined),
  'social.accept': (payload: { uuid: string }) => social.accept(String(payload.uuid)),
  'social.remove': (payload: { uuid: string }) => social.remove(String(payload.uuid)),
  'social.history': (payload: { uuid: string; before?: number }) => social.history(String(payload.uuid), payload.before),
  'social.send': (payload: { uuid: string; text: string; replyTo?: number }) =>
    social.send(String(payload.uuid), String(payload.text ?? ''), Number(payload.replyTo) > 0 ? Number(payload.replyTo) : undefined),
  'social.change': (payload: { group: boolean; id: number; body?: string; remove?: boolean; emoji?: string }) =>
    social.changeMessage(Boolean(payload.group), Number(payload.id), {
      body: typeof payload.body === 'string' ? payload.body : undefined,
      remove: Boolean(payload.remove),
      emoji: typeof payload.emoji === 'string' ? payload.emoji : undefined,
    }),
  'social.mode': (payload: { mode: string }) =>
    social.setMode((['', 'dnd', 'invisible'].includes(payload.mode) ? payload.mode : '') as social.Mode),
  'social.read': (payload: { uuid: string }) => social.markRead(String(payload.uuid)),
  'social.avatar': (payload: { image: string }) => social.setAvatar(String(payload.image ?? '')),
  'social.media': (payload: { image: string }) => social.uploadMedia(String(payload.image ?? '')),
  'fav.list': () => favorites.list(),
  'fav.add': (payload: { url: string }) => favorites.add(String(payload.url ?? '')),
  'fav.remove': (payload: { id: string }) => favorites.remove(String(payload.id ?? '')),
  'fav.payload': (payload: { id: string }) => favorites.payload(String(payload.id ?? '')),
  'social.fast': (payload: { on: boolean }) => { social.setFast(Boolean(payload.on)); },
  // «Зайти» к другу: тот же сервер и та же версия игры, что у него сейчас.
  'social.join': async (payload: { uuid: string }) => {
    const friend = social.current().friends.find((f) => f.uuid === payload.uuid);
    if (!friend?.online || friend.status !== 'server' || !friend.server) throw new Error('Друг сейчас не на сервере.');
    await joinServer(friend.server, friend.minecraft, friend.build);
  },

  // ---- группы
  'social.group.create': (payload: { name: string; members: string[] }) =>
    social.groupCreate(String(payload.name ?? ''), Array.isArray(payload.members) ? payload.members.map(String) : []),
  'social.group.add': (payload: { group: number; uuid: string }) => social.groupAdd(Number(payload.group), String(payload.uuid)),
  'social.group.kick': (payload: { group: number; uuid: string }) => social.groupKick(Number(payload.group), String(payload.uuid)),
  'social.group.leave': (payload: { group: number }) => social.groupLeave(Number(payload.group)),
  'social.group.rename': (payload: { group: number; name: string }) => social.groupRename(Number(payload.group), String(payload.name ?? '')),
  'social.group.history': (payload: { group: number; before?: number }) => social.groupHistory(Number(payload.group), payload.before),
  'social.group.send': (payload: { group: number; text: string; replyTo?: number }) =>
    social.groupSend(Number(payload.group), String(payload.text ?? ''), Number(payload.replyTo) > 0 ? Number(payload.replyTo) : undefined),
  'social.group.read': (payload: { group: number }) => social.groupRead(Number(payload.group)),

  // ---- звонки: сам звук и WebRTC - в интерфейсе (src/voice.ts), здесь только связь с сайтом
  'voice.ice': () => social.iceServers(),
  'voice.send': (payload: Record<string, unknown>) => {
    if (!social.voiceSend(payload ?? {})) throw new Error('Нет связи с сервером друзей. Подожди пару секунд.');
  },
  'voice.active': (payload: { on: boolean }) => setVoiceActive(Boolean(payload?.on)),
  'voice.notify': (payload: { title: string; body: string }) => {
    // Окно спрятано (идёт игра) или свёрнуто: о звонке говорим системным уведомлением.
    if (window_?.isVisible() && window_.isFocused()) return;
    if (!Notification.isSupported()) return;
    const note = new Notification({ title: String(payload?.title ?? ''), body: String(payload?.body ?? ''), silent: true });
    note.on('click', () => showWindow());
    note.show();
  },

  // ---- кнопки окна (рамки нет, кнопки нарисованы в интерфейсе)
  'window.minimize': () => { window_?.minimize(); },
  'window.maximize': () => { if (window_?.isMaximized()) window_.unmaximize(); else window_?.maximize(); },
  'window.close': () => { window_?.close(); },
};

/**
 * Автообновление лаунчера с сайта.
 *
 * Воркер сайта всегда отдаёт по этому адресу ровно один, последний `latest.yml` и установщик -
 * истории версий на сервере нет, поэтому проверка всегда приходит к текущему релизу.
 */
function setupAutoUpdate(): void {
  // Дев-сборка обновляется из своей закрытой папки: без админ-ключа сайт её не отдаст.
  // Для проверки обновлений без сайта дев-сборке можно дать локальный адрес (PV_TEST_UPDATE_FEED,
  // только REDACTED_ENDPOINT) - подпись при этом проверяется так же, а админ-ключ туда не уходит.
  const testFeed = devtools.devBuild && /^http:\/\/127\.0\.0\.1:\d{2,5}(\/[\w./-]*)?$/.test(process.env.PV_TEST_UPDATE_FEED ?? '')
    ? process.env.PV_TEST_UPDATE_FEED!.replace(/\/+$/, '')
    : null;
  const feed = testFeed ?? (devtools.devBuild
    ? 'REDACTED_ENDPOINT'
    : 'REDACTED_ENDPOINT');
  const feedHeaders: Record<string, string> = devtools.devBuild && !testFeed ? { 'x-admin-token': devtools.adminToken() } : {};
  if (testFeed) journal(`Обновления проверяются с тестового адреса ${testFeed}`);
  redactedUpdater.setFeedURL({ provider: 'generic', url: feed });
  if (devtools.devBuild && !testFeed) redactedUpdater.requestHeaders = feedHeaders;
  redactedUpdater.autoDownload = true;
  // Ставить при выходе можно только то, у чего проверена подпись (см. update-downloaded ниже).
  redactedUpdater.autoInstallOnAppQuit = false;

  // «Обновлений нет» - молча. Но если обновление нашлось и качается, показываем прогресс,
  // иначе медленная загрузка выглядит как зависший лаунчер.
  redactedUpdater.on('checking-for-update', () => send('launcher-update', { status: 'checking' }));
  redactedUpdater.on('update-available', (info) => send('launcher-update', { status: 'available', version: info.version }));
  redactedUpdater.on('update-not-available', () => send('launcher-update', { status: 'none' }));
  redactedUpdater.on('download-progress', (progress) =>
    send('launcher-update', { status: 'progress', percent: Math.round(progress.percent) }));

  redactedUpdater.on('update-downloaded', async (info) => {
    // Подпись и сам файл проверяем до любого вопроса об установке (services/updatesig.ts).
    // Нет подписи, сайт недоступен, подпись или файл не сходятся, откат - не ставим, и никакого
    // «поставлю без проверки» на этот случай нет.
    const verdict = await checkUpdate({
      info,
      downloadedFile: info.downloadedFile,
      signature: await fetchSignature(feed, feedHeaders),
      currentVersion: app.getVersion(),
      channel: devtools.devBuild ? 'dev' : 'stable',
      floor: readUpdateFloor(),
    });
    if (!verdict.ok) {
      journal(`Обновление ${info.version} отклонено: ${verdict.reason}`);
      send('launcher-update', { status: 'error' });
      return;
    }
    journal(`Обновление ${info.version} скачано, подпись и файл проверены`);
    writeUpdateFloor(verdict.manifest.minVersion);
    verifiedUpdate = info.version;
    redactedUpdater.autoInstallOnAppQuit = true;
    // Интерфейсу - чтобы убрать тост «Скачиваю… 100%», иначе он висел до перезапуска.
    send('launcher-update', { status: 'downloaded', version: info.version });
    // Пока идёт игра, окно спрятано - вопрос о перезапуске зададим, когда она закроется.
    // Да и перезапуск посреди игры никому не нужен.
    if (hiddenForGame || launch.anyRunning()) { pendingUpdate = info.version; return; }
    askToInstallUpdate(info.version);
  });

  // Сбой сети или недоступный сайт - не повод беспокоить пользователя: текущая версия работает.
  // Но тост загрузки надо убрать, иначе он так и висит с последним процентом.
  redactedUpdater.on('error', (error) => {
    console.error('[auto-update]', error);
    send('launcher-update', { status: 'error' });
  });

  // В режиме разработки (не собранный exe) не проверяем.
  if (app.isPackaged && (!devtools.devBuild || devtools.hasToken() || testFeed)) {
    void redactedUpdater.checkForUpdates().catch(() => {});
    // Лаунчер неделями живёт в трее, а до 1.11.4 обновления проверялись только при запуске - кто
    // не перезапускал, не обновлялся никогда. Теперь ещё раз в 3 часа, пока скачанное не проверено.
    setInterval(() => {
      if (!verifiedUpdate) void redactedUpdater.checkForUpdates().catch(() => {});
    }, 3 * 3600_000);
  }
}

/** Скачанное обновление, о котором ещё не спросили: скачалось, пока шла игра. */
let pendingUpdate: string | null = null;
/** Версия, у которой проверена подпись. Ставить можно только её. */
let verifiedUpdate: string | null = null;

/**
 * Порог «не ниже этой версии» из последнего проверенного манифеста (minVersion). Хранится рядом
 * с launcher.json отдельным файлом: интерфейс его не меняет, а только растёт.
 */
const FLOOR_FILE = () => join(CONFIG_ROOT, 'update-floor.json');
function readUpdateFloor(): string {
  try {
    const value = String(JSON.parse(readFileSync(FLOOR_FILE(), 'utf8')).floor ?? '');
    return compareVersions(value, value) === 0 ? value : '';
  } catch {
    return '';
  }
}
function writeUpdateFloor(version: string): void {
  const now = readUpdateFloor();
  if (now && (compareVersions(version, now) ?? -1) <= 0) return;
  try { writeFileSync(FLOOR_FILE(), JSON.stringify({ floor: version }), 'utf8'); } catch { /* не записали - порог останется прежним */ }
}

function askToInstallUpdate(version: string): void {
  pendingUpdate = null;
  void dialog.showMessageBox(window_!, {
    type: 'info',
    buttons: ['Перезапустить', 'Позже'],
    defaultId: 0,
    title: 'Обновление готово',
    message: `Скачано обновление лаунчера до ${version}. Перезапустить сейчас, чтобы установить?`,
  }).then((result) => {
    // Без этого флага крестик-в-трей перехватил бы закрытие окна, и установка обновления
    // осталась бы ждать выхода, которого не будет.
    if (result.response === 0 && verifiedUpdate === version) { quitting = true; redactedUpdater.quitAndInstall(); }
  });
}

/**
 * Ссылка `powervisual:
 *
 * В ссылке есть только версия Minecraft, какая именно сборка «та же» - узнать нельзя. Поэтому берём
 * первую сборку с этой версией и спрашиваем перед запуском, а не угадываем молча.
 */
async function handleJoinLink(raw: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return;
  }
  if (url.protocol !== `${JOIN_PROTOCOL}:` || url.hostname !== 'join') return;

  const ip = url.searchParams.get('ip');
  const minecraft = url.searchParams.get('mc');
  if (!ip) return;
  try {
    await joinServer(ip, minecraft ?? '');
  } catch (error) {
    void dialog.showMessageBox(window_!, {
      type: 'error',
      title: 'Не удалось запустить',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Зайти на сервер: из ссылки Discord или кнопкой «Зайти» у друга.
 *
 * Какая из сборок «та же», что у друга, точно не узнать. Сначала ищем сборку с тем же именем и
 * версией игры (так бывает, когда сборку друг прислал), потом любую с той же версией. И всегда
 * спрашиваем перед запуском, а не угадываем молча.
 */
async function joinServer(ip: string, minecraft: string, preferBuild?: string): Promise<void> {
  const [host = ip, portText] = ip.split(':');
  const port = portText ? Number(portText) : undefined;
  // Ссылку может открыть любой сайт, а статус друга приходит с сервера, поэтому в игру уходит
  // только похожее на адрес сервера.
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host)) throw new Error('Странный адрес сервера.');
  if (port !== undefined && !(Number.isInteger(port) && port >= 1 && port <= 65535)) throw new Error('Странный порт сервера.');
  if (minecraft && !/^[\w.-]{1,32}$/.test(minecraft)) throw new Error('Странная версия игры.');

  const candidates = instances.list().filter((i) => !minecraft || i.minecraft === minecraft);
  const instance = candidates.find((i) => preferBuild && i.name === preferBuild) ?? candidates[0];
  if (!instance) {
    void dialog.showMessageBox(window_!, {
      type: 'info',
      title: 'Нет подходящей сборки',
      message: minecraft
        ? `Чтобы зайти на этот сервер, нужна сборка на Minecraft ${minecraft}. Создай такую и попробуй снова.`
        : 'Не нашлось ни одной сборки, чтобы зайти на сервер.',
    });
    return;
  }

  const choice = await dialog.showMessageBox(window_!, {
    type: 'question',
    buttons: ['Присоединиться', 'Отмена'],
    defaultId: 0,
    cancelId: 1,
    title: 'Присоединиться к серверу?',
    message: `Зайти на ${ip} через сборку «${instance.name}»?`,
  });
  if (choice.response !== 0) return;

  await launch.start(instance.id, { ip: host, port });
  hideForGame();
}

/** Ищет ссылку powervisual:// среди аргументов командной строки. */
function findJoinLink(argv: string[]): string | undefined {
  return argv.find((arg) => arg.startsWith(`${JOIN_PROTOCOL}:
}


const INDEX_URL = pathToFileURL(join(here, '../renderer/index.html')).href;
const DEV_ORIGIN = dev ? 'REDACTED_ENDPOINT' : null;
const fromApp = (url: string): boolean => isAppUrl(url, INDEX_URL, DEV_ORIGIN);


function lockDown(win: BrowserWindow): void {
  const contents = win.webContents;
  contents.on('will-navigate', (event, url) => { if (!fromApp(url)) event.preventDefault(); });
  contents.on('will-redirect', (event, url) => {
    
    if ((event as unknown as { isMainFrame?: boolean }).isMainFrame !== false && !fromApp(url)) event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\
    return { action: 'deny' };
  });
  const session = contents.session;
  session.setPermissionRequestHandler((wc, permission, callback, details) => {
    const origin = details.requestingUrl ?? wc.getURL();
    const media = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
    callback(allowPermission(permission, fromApp(origin) && details.isMainFrame !== false, media));
  });
  session.setPermissionCheckHandler((_wc, permission, origin, details) =>
    allowPermission(permission, fromApp(details.requestingUrl ?? origin) && details.isMainFrame !== false,
      details.mediaType ? [details.mediaType] : []));
}

function createWindow(): void {
  window_ = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    frame: false,
    backgroundColor: '#07060f',
    
    icon: join(here, '../../build/icon.png'),
    webPreferences: {
      preload: join(here, '../../electron/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  lockDown(window_);

  
  window_.once('ready-to-show', () => window_?.show());

  
  
  
  
  window_.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['REDACTED_ENDPOINT'] },
    (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, Referer: 'REDACTED_ENDPOINT' } });
    },
  );
  window_.webContents.on('render-process-gone', (_event, details) => {
    journal(`Интерфейс упал: ${details.reason}, код ${details.exitCode}`);
    if (details.reason !== 'clean-exit' && window_ && !window_.isDestroyed()) window_.webContents.reload();
  });

  // При включённом трее крестик прячет окно, а не закрывает лаунчер. Само окно остаётся живым:
  // пересоздавать его пришлось бы вместе с перезагрузкой интерфейса, и открывался бы он из трея
  // с заметной задержкой и потерянным экраном.
  window_.on('close', (event) => {
    if (quitting) return;
    if (load().settings.minimizeToTray) {
      event.preventDefault();
      window_?.hide();
      return;
    }
    // Игра идёт, а трей выключен: крестик закрыл бы лаунчер молча. Игра при этом продолжит
    // работать, но лаунчер перестанет видеть её: не будет окна с причиной вылета, логов и
    // статуса в Discord. Спрашиваем, и по умолчанию предлагаем просто спрятать окно.
    if (!launch.anyRunning()) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(window_!, {
      type: 'question',
      buttons: ['Спрятать в трей', 'Закрыть лаунчер', 'Отмена'],
      defaultId: 0,
      cancelId: 2,
      title: 'Игра ещё идёт',
      message: 'Игра ещё запущена.',
      detail: 'Если закрыть лаунчер, игра продолжит работать, но лаунчер не покажет причину вылета, '
        + 'а логи и статус в Discord пропадут. Можно просто спрятать его в трей до конца игры.',
    });
    if (choice === 0) {
      hiddenForGame = true;
      applyTray();
      window_?.hide();
    } else if (choice === 1) {
      quitting = true;
      app.quit();
    }
  });

  if (dev) {
    void window_.loadURL('REDACTED_ENDPOINT');
  } else {
    void window_.loadFile(join(here, '../renderer/index.html'));
  }
}

// Ссылка powervisual:// запускает лаунчер через систему. Если он уже открыт, без блокировки
// запустилась бы вторая копия. С блокировкой система передаёт ссылку уже открытому через 'second-instance'.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // Дев-сборка ссылки powervisual:// себе не забирает: их открывает обычный лаунчер.
  if (devtools.devBuild && app.isPackaged) {
    // ничего
  } else if (process.platform === 'win32') {
    // Несобранный лаунчер (`npm run dev`/`start`) запускается через общий electron.exe, и Windows
    // нужно передать путь к проекту. Собранному exe аргументы не нужны - он сам и есть программа.
    if (dev || !app.isPackaged) app.setAsDefaultProtocolClient(JOIN_PROTOCOL, process.execPath, [join(here, '..', '..')]);
    else app.setAsDefaultProtocolClient(JOIN_PROTOCOL);
  } else {
    app.setAsDefaultProtocolClient(JOIN_PROTOCOL);
  }

  app.on('second-instance', (_event, argv) => {
    // Лаунчер может быть спрятан в трей - тогда одного focus() мало, окно нужно показать.
    showWindow();
    const link = findJoinLink(argv);
    if (link) void handleJoinLink(link);
  });

  // В macOS ссылка приходит этим событием, а не через argv.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    void handleJoinLink(url);
  });
}

app.whenReady().then(async () => {
  // Порядок важен: сохранённая папка данных должна быть применена до создания папок,
  // иначе после переноса пустые папки появились бы на старом месте.
  applyStoredDataRoot();
  ensureDirs();
  content.boot();

  ipcMain.handle('pv', async (event, channel: string, payload: unknown) => {
    // Отвечаем только своему окну и только главному фрейму со своим адресом: фрейм YouTube или
    // чужая страница, если бы она как-то попала в окно, моста не получат.
    const frame = event.senderFrame;
    if (!window_ || event.sender !== window_.webContents || !frame || frame !== event.sender.mainFrame || !fromApp(frame.url)) {
      journal(`Отклонён вызов ${String(channel).slice(0, 60)} не от интерфейса лаунчера`);
      throw new Error('Отказано.');
    }
    const handler = typeof channel === 'string' && Object.hasOwn(handlers, channel) ? handlers[channel] : undefined;
    if (!handler) throw new Error(`Неизвестный канал: ${channel}`);
    try {
      return { ok: true, data: await handler(payload) };
    } catch (error) {
      // Ошибку передаём как данные: исключение дошло бы до интерфейса как невнятное
      // "Error invoking remote method" с настоящим текстом где-то внутри.
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // События из сервисов пробрасываем в интерфейс.
  install.onProgress((progress) => send('install-progress', progress));
  launch.onLog((line) => send('game-log', line));
  launch.onCrash((report) => send('game-crash', report));
  launch.onExit(() => returnAfterGame());

  createWindow();
  applyTray();
  setupAutoUpdate();
  presence.init();
  social.onUpdate((snapshot, messages, groupMessages, reads) => send('social', { snapshot, messages, groupMessages, reads }));
  social.onVoice((message) => send('voice', message));
  social.boot();

  // Не ждём: окно сразу рисуется из кэша, а свежие тексты придут через 'content-updated'.
  void content.refresh().then((fresh) => send('content-updated', fresh));
  // Лаунчер неделями живёт в трее: новости и события «всем» (event.* в текстах) подтягиваем раз в 10 минут.
  // Шлём, только если на сайте что-то поменялось: перерисовка сбросила бы набранный текст.
  setInterval(() => {
    const before = content.get().rev;
    void content.refresh().then((fresh) => { if (fresh.rev !== before) send('content-updated', fresh); }).catch(() => {});
  }, 600_000);

  // Лаунчер мог быть запущен самой ссылкой (холодный старт), а не получить её через 'second-instance'.
  const link = findJoinLink(process.argv);
  if (link) void handleJoinLink(link);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/**
 * Перед выходом говорим сайту «не в сети», иначе друзья видели бы нас онлайн ещё минуту.
 * Выход придерживаем максимум на полторы секунды (см. social.bye), потом выходим снова.
 */
let saidBye = false;
app.on('before-quit', (event) => {
  if (saidBye) return;
  saidBye = true;
  journal(`Выход из лаунчера${launch.anyRunning() ? ', игра ещё идёт' : ''}`);
  if (!load().social) return;
  event.preventDefault();
  void social.bye().finally(() => app.quit());
});
