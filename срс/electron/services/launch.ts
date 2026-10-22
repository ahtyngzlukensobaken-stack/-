import { launch, createMinecraftProcessWatcher, MinecraftFolder } from '@xmcl/core';
import { resolveJava, type JavaInfo } from '@xmcl/installer';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, delimiter, dirname, join } from 'node:path';
import { forLaunch } from './accounts.js';
import { downloadJava, managedJavaExe, wantedMajor } from './java.js';
import { analyze, type CrashReport } from './crash.js';
import { ensureLibraries, installInstance, isInstalled, report as reportProgress } from './install.js';
import { instanceDir, sharedDir } from './paths.js';
import { get, patch } from './instances.js';
import { load } from './store.js';
import * as presence from './presence.js';
import { redact } from './guards.js';




export class NeedsRepairError extends Error {
  constructor(public readonly versionId: string) {
    super(`Файлы сборки не найдены (${versionId}).`);
  }
}

interface LogLine {
  instanceId: string;
  line: string;
  level: 'out' | 'err' | 'status';
}

type LogListener = (line: LogLine) => void;
const logListeners = new Set<LogListener>();
type CrashListener = (report: CrashReport & { instanceId: string }) => void;
const crashListeners = new Set<CrashListener>();
/** Запущенные игры по id сборки. */
const active = new Map<string, { pid: number }>();
/** Хвост вывода игры по сборке - после выхода процесса это единственное, по чему можно понять вылет.
 *  Ограничен, чтобы бесконечный лог не съел память. */
const tails = new Map<string, string[]>();
const TAIL_LINES = 400;
// Сборки, которые сейчас запускаются. До старта процесса проходят секунды (установка, проверка
// библиотек), и второй клик в это время раньше запускал всё повторно по тем же файлам.
const starting = new Set<string>();

export function onLog(listener: LogListener): () => void {
  logListeners.add(listener);
  return () => logListeners.delete(listener);
}

type ExitListener = (event: { instanceId: string; code: number }) => void;
const exitListeners = new Set<ExitListener>();

/** Игра закрылась (сама или с вылетом). main.ts по этому событию возвращает спрятанное окно. */
export function onExit(listener: ExitListener): () => void {
  exitListeners.add(listener);
  return () => exitListeners.delete(listener);
}

export function onCrash(listener: CrashListener): () => void {
  crashListeners.add(listener);
  return () => crashListeners.delete(listener);
}

/** Дописывает кусок вывода в хвост для разбора вылета. */
function capture(instanceId: string, chunk: string): void {
  const lines = tails.get(instanceId) ?? [];
  lines.push(...chunk.split(/\r?\n/));
  if (lines.length > TAIL_LINES) lines.splice(0, lines.length - TAIL_LINES);
  tails.set(instanceId, lines);
}

function log(instanceId: string, line: string, level: LogLine['level'] = 'out'): void {
  for (const listener of logListeners) listener({ instanceId, line, level });
}

export function isRunning(instanceId: string): boolean {
  return active.has(instanceId);
}

/** Запущена или запускается хоть одна игра. */
export function anyRunning(): boolean {
  return active.size > 0 || starting.size > 0;
}

/** Где может лежать java: JAVA_HOME, PATH и стандартные папки установщиков JDK в Windows. */
function candidateJavaPaths(): string[] {
  const found = new Set<string>();
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';

  // Java, скачанная самим лаунчером, - первый кандидат: она заведомо той версии, что нужна игре.
  for (const major of [21, 17, 8]) found.add(managedJavaExe(major));

  if (process.env.JAVA_HOME) found.add(join(process.env.JAVA_HOME, 'bin', exe));
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    if (entry) found.add(join(entry, exe));
  }
  // Сюда JDK кладут популярные установщики. Проверить дёшево, а пользователю не надо искать файл руками.
  if (process.platform === 'win32') {
    for (const base of ['C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium',
      join(process.env.USERPROFILE ?? '', '.jdks')]) {
      try {
        for (const dir of readdirSync(base)) found.add(join(base, dir, 'bin', exe));
      } catch { /* такой папки нет */ }
    }
  }
  return [...found].filter((path) => existsSync(path));
}

/**
 * javaw.exe из той же папки, что и найденная java.exe.
 *
 * java.exe - консольная программа: Windows открывает ей чёрное окно, и туда сыплется лог Fabric
 * ещё до окна игры. javaw.exe - та же Java без консоли, ею запускают игру все нормальные лаунчеры.
 * Искать и проверять версию по-прежнему удобнее через java.exe, поэтому меняем путь только при запуске.
 */
function windowlessJava(path: string): string {
  if (process.platform !== 'win32' || basename(path).toLowerCase() !== 'java.exe') return path;
  const javaw = join(dirname(path), 'javaw.exe');
  return existsSync(javaw) ? javaw : path;
}

let javaCache: { at: number; list: JavaInfo[] } | null = null;

/** Забыть найденные Java: после скачивания новой список нужно собрать заново. */
export function forgetJava(): void {
  javaCache = null;
}

/** Все найденные Java, новые первыми. Кэш на 5 минут: запуск java -version не бесплатный. */
export async function javaInstalls(): Promise<JavaInfo[]> {
  if (javaCache && Date.now() - javaCache.at < 5 * 60_000) return javaCache.list;
  const results = await Promise.all(candidateJavaPaths().map((path) => resolveJava(path).catch(() => undefined)));

  const seen = new Set<string>();
  const list: JavaInfo[] = [];
  for (const info of results) {
    if (!info || seen.has(info.path)) continue;
    seen.add(info.path);
    list.push(info);
  }
  list.sort((a, b) => b.majorVersion - a.majorVersion);
  javaCache = { at: Date.now(), list };
  return list;
}

/**
 * Подходящая Java из найденных: ровно нужной версии, иначе новее.
 *
 * Порог берётся из того же `wantedMajor`, что и при скачивании. Раньше здесь была своя копия
 * формулы, и две копии рано или поздно разошлись бы - лаунчер искал бы одну Java, а качал другую.
 */
function pickJava(installs: JavaInfo[], minecraft: string): JavaInfo | undefined {
  const wanted = wantedMajor(minecraft);
  return installs.find((java) => java.majorVersion === wanted)
    ?? installs.find((java) => java.majorVersion >= wanted)
    ?? installs[0];
}

/** Понимает ли версия игры --quickPlayMultiplayer: 1.20 и новее, снапшоты 23w14a+ и версии по годам (26.1). */
function quickPlay(minecraft: string): boolean {
  const snapshot = /^(\d{2})w(\d{2})[a-z]$/.exec(minecraft);
  if (snapshot) return Number(snapshot[1]) * 100 + Number(snapshot[2]) >= 2314;
  const [major = 0, minor = 0] = minecraft.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  return major > 1 || (major === 1 && minor >= 20);
}

/** Запускает сборку. `joinServer` - сразу зайти на сервер (ссылка «Присоединиться» из Discord). */
export async function start(instanceId: string, joinServer?: { ip: string; port?: number }): Promise<{ pid: number }> {
  const instance = get(instanceId);
  if (!instance) throw new Error('Сборка не найдена.');
  if (active.has(instanceId)) throw new Error('Эта сборка уже запущена.');
  if (starting.has(instanceId)) throw new Error('Эта сборка уже запускается.');
  starting.add(instanceId);
  try {
    return await run(instanceId, joinServer);
  } finally {
    starting.delete(instanceId);
  }
}

async function run(instanceId: string, joinServer?: { ip: string; port?: number }): Promise<{ pid: number }> {
  const instance = get(instanceId);
  if (!instance) throw new Error('Сборка не найдена.');

  const account = await forLaunch();
  if (!account) throw new Error('Сначала добавь аккаунт.');

  const settings = load().settings;

  // 1. Файлы игры: ставим, если сборка новая; если файлов нет - просим main.ts спросить пользователя.
  if (!instance.installed) {
    log(instanceId, 'Ставлю файлы игры…', 'status');
    const versionId = await installInstance(instance);
    patch(instanceId, { installed: true, versionId });
  } else if (!isInstalled(instance.versionId)) {
    // Флаг говорит «установлена», а на диске пусто (перенос, удаление). Отдельная ошибка, чтобы
    // пользователя спросили до перекачки, а не показали ему голый ENOENT из ensureLibraries.
    throw new NeedsRepairError(instance.versionId);
  }

  // 2. Java: выбранная в сборке, потом выбранная в настройках, иначе подходящая по версии игры.
  const installs = await javaInstalls();
  const needed = wantedMajor(instance.minecraft);
  // Путь, выбранный руками в сборке, уважаем как есть: человек знает, что делает.
  let javaPath = instance.javaPath
    ? installs.find((j) => j.path === instance.javaPath)?.path
    : undefined;
  // Java из «Настроек». Раньше выбор там сохранялся, но запуск его не читал вовсе - кнопка
  // «Выбрать» ничего не меняла. Берём её, только если она не старее нужной: общая Java 17,
  // выбранная когда-то для 1.18, иначе уронила бы каждую сборку на 1.21.
  const chosen = settings.javaPath ? installs.find((j) => j.path === settings.javaPath) : undefined;
  if (!javaPath && chosen) {
    if (chosen.majorVersion >= needed) javaPath = chosen.path;
    else log(instanceId, `Java ${chosen.majorVersion} из настроек слишком старая для ${instance.minecraft} - беру подходящую`, 'status');
  }
  if (!javaPath) {
    const picked = pickJava(installs, instance.minecraft);
    // Java старее нужной не годится: игра упадёт с UnsupportedClassVersionError уже после запуска,
    // и человек увидит непонятную ошибку вместо честного «сейчас скачаю нужную версию».
    if (picked && picked.majorVersion >= needed) javaPath = picked.path;
  }
  if (!javaPath) {
    // Ничего подходящего в системе нет - берём официальную сборку Mojang в папку лаунчера.
    javaPath = await downloadJava(
      needed,
      (text) => log(instanceId, text, 'status'),
      (done, total) => reportProgress({
        instanceId, stage: `Скачиваю Java ${needed}`, progress: done, total,
        bytesPerSecond: 0, done: false, unit: 'files',
      }),
    );
    // Полосу надо закрыть явно: интерфейс ждёт события с done, иначе она останется висеть.
    reportProgress({
      instanceId, stage: `Java ${needed} готова`, progress: 1, total: 1,
      bytesPerSecond: 0, done: true, unit: 'files',
    });
    javaCache = null;
  }

  // Установка выше могла поменять versionId - берём свежую запись.
  const fresh = get(instanceId);
  const versionId = fresh?.versionId ?? instance.versionId;

  // 4. Библиотеки. Недокачанная библиотека - это «Missing N libraries» до открытия окна.
  // Если всё на месте, проверка стоит один обход папки.
  log(instanceId, 'Проверяю библиотеки…', 'status');
  await ensureLibraries(versionId);

  // 5. Сам запуск.
  const gameJava = windowlessJava(javaPath);
  const process_ = await launch({
    gamePath: instanceDir(instanceId),
    resourcePath: MinecraftFolder.from(sharedDir()).root,
    javaPath: gameJava,
    // Если javaw.exe рядом не нашлось, прячем консоль хотя бы так. Для javaw.exe этот флаг не ставим:
    // он касается первого показа окна, и окно ошибки Fabric могло бы открыться невидимым.
    extraExecOption: gameJava === javaPath && process.platform === 'win32' ? { windowsHide: true } : undefined,
    version: versionId,
    minMemory: Math.min(1024, instance.memory),
    maxMemory: instance.memory,
    gameProfile: { name: account.name, id: account.uuid },
    // У офлайн-аккаунта нет сессии, и ванильный клиент это спокойно принимает: он просто не зайдёт
    // на сервер с проверкой лицензии. Пустой токен и делает запуск офлайновым.
    accessToken: account.accessToken ?? '',
    userType: 'mojang',
    launcherName: 'PowerLauncher',
    launcherBrand: 'PowerLauncher',
    extraJVMArgs: settings.jvmArgs.split(/\s+/).filter(Boolean),
    resolution: { width: settings.width, height: settings.height },
    // С 1.20 игра молча игнорирует --server/--port, и «Зайти» просто открывал главное меню.
    // Там работает только --quickPlayMultiplayer, а версии до 1.20 его не знают.
    ...(joinServer
      ? quickPlay(instance.minecraft)
        ? { quickPlayMultiplayer: `${joinServer.ip}:${joinServer.port ?? 25565}` }
        : { server: joinServer }
      : {}),
  });

  const pid = process_.pid ?? 0;
  active.set(instanceId, { pid });
  // Пока в логе нет строки про мир или сервер, игрок в главном меню.
  activities.set(instanceId, { instanceId, minecraft: instance.minecraft, activity: { kind: 'menu' } });
  notifyActivity();
  tails.delete(instanceId);
  patch(instanceId, { lastPlayed: Math.floor(Date.now() / 1000) });

  void presence.setActivity({
    details: 'Power Launcher',
    state: joinServer ? `Заходит на сервер ${joinServer.ip}` : 'В главном меню',
    largeImageKey: 'logo',
    largeImageText: `Minecraft ${instance.minecraft}`,
    smallImageKey: 'menu',
    smallImageText: 'В главном меню',
    startTimestamp: Date.now(),
  });

  // Лог игры уходит в интерфейс, в «Сохранить лог» и в окно вылета. Токен Minecraft туда попасть
  // не должен, даже если его напечатает какой-нибудь мод или старая версия игры.
  const secrets = [account.accessToken];
  process_.stdout?.on('data', (chunk: Buffer) => {
    const text = redact(chunk.toString('utf8').trimEnd(), secrets);
    capture(instanceId, text);
    log(instanceId, text);
    updateActivityFromLog(instanceId, instance.minecraft, text);
  });
  process_.stderr?.on('data', (chunk: Buffer) => {
    const text = redact(chunk.toString('utf8').trimEnd(), secrets);
    capture(instanceId, text);
    log(instanceId, text, 'err');
  });

  const watcher = createMinecraftProcessWatcher(process_);
  watcher.on('error', (error: unknown) => {
    log(instanceId, String(error), 'err');
  });
  const startedAt = Date.now();
  process_.on('exit', (code) => {
    active.delete(instanceId);
    activities.delete(instanceId);
    notifyActivity();
    // Время в игре: сборку могли удалить, пока игра шла, - тогда просто некуда записывать.
    const played = Math.floor((Date.now() - startedAt) / 1000);
    const current = get(instanceId);
    if (current && played > 0) patch(instanceId, { playSeconds: (current.playSeconds ?? 0) + played });
    // Интерфейс ловит эту строку («Игра закрылась») и обновляет кнопку «Играть».
    log(instanceId, `Игра закрылась, код ${code ?? 0}`, 'status');
    void presence.setIdle();
    if (code) {
      // Отчёт игры пишется в момент падения, поэтому читаем его уже после выхода процесса.
      // Раньше окно показывалось только при опознанной причине, и при любом другом вылете
      // лаунчер молчал: игра пропадала с экрана без единого слова.
      const found = latestCrashFile(instanceId, startedAt);
      const file = found && { ...found, text: redact(found.text, secrets) };
      const report = analyze((tails.get(instanceId) ?? []).join('\n'), file, code);
      for (const listener of crashListeners) listener({ ...report, instanceId });
    }
    for (const listener of exitListeners) listener({ instanceId, code: code ?? 0 });
  });

  return { pid };
}

/**
 * Самый свежий файл отчёта игры, написанный после запуска.
 *
 * Сверяем со временем старта: в папке лежат отчёты о прошлых вылетах, и без проверки
 * лаунчер уверенно показал бы позавчерашнюю ошибку вместо сегодняшней. Пять секунд запаса -
 * на расхождение часов файловой системы и таймера процесса.
 */
function latestCrashFile(instanceId: string, since: number): { path: string; text: string } | null {
  const dir = join(instanceDir(instanceId), 'crash-reports');
  try {
    const found = readdirSync(dir)
      .filter((name) => name.startsWith('crash-') && name.endsWith('.txt'))
      .map((name) => {
        const path = join(dir, name);
        return { path, at: statSync(path).mtimeMs };
      })
      .filter((item) => item.at >= since - 5_000)
      .sort((a, b) => b.at - a.at)[0];
    if (!found) return null;
    return { path: found.path, text: readFileSync(found.path, 'utf8') };
  } catch {
    // Папки нет - игра ни разу не падала так, чтобы успеть написать отчёт.
    return null;
  }
}

/** Чем занят игрок в игре. Это читают статус в Discord и список друзей (social.ts). */
export type GameActivity =
  | { kind: 'menu' }
  | { kind: 'world'; world: string }
  | { kind: 'server'; host: string; port: number };

export interface ActivityInfo {
  instanceId: string;
  minecraft: string;
  activity: GameActivity;
}

type ActivityListener = (current: ActivityInfo | null) => void;
const activityListeners = new Set<ActivityListener>();
/** Последнее известное занятие по каждой запущенной сборке. */
const activities = new Map<string, ActivityInfo>();

function notifyActivity(): void {
  const current = currentActivity();
  for (const listener of activityListeners) listener(current);
}

export function onActivity(listener: ActivityListener): () => void {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

/** Что сейчас делает игрок: первая запущенная игра. null - игра не запущена. */
export function currentActivity(): ActivityInfo | null {
  return activities.values().next().value ?? null;
}

/*
 * Строка самой игры, а не мода.
 *
 * Игра печатает «[Render thread/INFO]: Connecting to alterprac.com, 25565», а моды пишут
 * похожее от себя: «[voicechat] Connecting to voice chat server: '…'»,
 * «Connecting to Essential Connection Manager…». Раньше подходила любая строка с «Connecting to»,
 * и с голосовым чатом сервером становилось слово «voice». Поэтому строка должна идти сразу после
 * «]: » (без метки мода в скобках) и заканчиваться портом через запятую - так пишет только игра.
 * CDATA[ - на случай, если лог придёт в XML-виде, как у официального лаунчера.
 */
const VANILLA = String.raw`(?:\]: |CDATA\[)`;
const SERVER_LINE = new RegExp(String.raw`${VANILLA}Connecting to ([A-Za-z0-9.\-]{1,253}|\[[0-9a-fA-F:]+\]), (\d{1,5})(?=\s*(?:$|\]\]>))`, 'm');
const WORLD_LINE = /Preparing level "([^"]+)"/;
// «[voicechat] Disconnecting…» и «[EMI] Disconnecting…» - тоже от модов, по ним сервер не покидали.
const LEAVE_LINE = new RegExp(String.raw`${VANILLA}(?:Stopping singleplayer server|Disconnecting)`, 'm');

/** Разбирает кусок вывода игры. null - в нём нет ничего про мир или сервер. */
export function parseActivity(text: string): GameActivity | null {
  const world = text.match(WORLD_LINE);
  if (world?.[1]) return { kind: 'world', world: world[1] };
  const server = text.match(SERVER_LINE);
  if (server?.[1]) {
    const port = Number(server[2]);
    if (port >= 1 && port <= 65535) return { kind: 'server', host: server[1], port };
  }
  if (LEAVE_LINE.test(text)) return { kind: 'menu' };
  return null;
}

/** Адрес для показа и ссылки: стандартный порт 25565 не пишем. */
export function serverAddress(activity: { host: string; port: number }): string {
  return activity.port === 25565 ? activity.host : `${activity.host}:${activity.port}`;
}

/**
 * Обновляет занятие игрока по строкам лога игры.
 *
 * Отдельного способа узнать «зашёл в мир / на сервер» нет, а эти строки печатает ванильный код,
 * через который проходят все загрузчики (Fabric, Forge и т.д.).
 */
function updateActivityFromLog(instanceId: string, minecraft: string, text: string): void {
  const activity = parseActivity(text);
  if (activity) setGameActivity(instanceId, minecraft, activity);
}

function setGameActivity(instanceId: string, minecraft: string, activity: GameActivity): void {
  activities.set(instanceId, { instanceId, minecraft, activity });
  notifyActivity();

  if (activity.kind === 'world') {
    void presence.setActivity({
      details: `Одиночная игра: ${activity.world}`,
      state: 'Пока без друзей',
      largeImageKey: 'logo',
      largeImageText: `Minecraft ${minecraft}`,
      smallImageKey: 'world',
      smallImageText: 'Одиночная игра',
      startTimestamp: Date.now(),
    });
    return;
  }

  if (activity.kind === 'server') {
    const address = serverAddress(activity);
    void presence.setActivity({
      details: `На сервере ${address}`,
      state: `Minecraft ${minecraft}`,
      largeImageKey: 'logo',
      largeImageText: `Minecraft ${minecraft}`,
      smallImageKey: 'server',
      smallImageText: address,
      startTimestamp: Date.now(),
      buttons: [{
        label: 'Присоединиться',
        url: `powervisual:
      }],
    });
    return;
  }

  
  void presence.setActivity({
    details: 'Power Launcher',
    state: 'В главном меню',
    largeImageKey: 'logo',
    largeImageText: `Minecraft ${minecraft}`,
    smallImageKey: 'menu',
    smallImageText: 'В главном меню',
    startTimestamp: Date.now(),
  });
}
