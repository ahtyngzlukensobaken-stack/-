import { MinecraftFolder, Version } from '@xmcl/core';
import {
  getVersionList,
  getFabricLoaderArtifact,
  installFabric,
  installForge,
  installNeoForged,
  installQuiltVersion,
  installLibraries,
  installTask,
} from '@xmcl/installer';
import type { Task } from '@xmcl/task';
import { createDefaultRetryHandler, resolveAgent } from '@xmcl/file-transfer';
import { Agent } from 'undici';
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { sharedDir } from './paths.js';
import type { Instance } from './store.js';




export const dispatcher = new Agent({
  connect: { timeout: 60_000 },
  connections: 8,
  headersTimeout: 60_000,
  bodyTimeout: 120_000,
});


export const downloadAgent = resolveAgent({ dispatcher, retryHandler: createDefaultRetryHandler(5) });

export interface InstallProgress {
  instanceId: string;
  stage: string;
  progress: number;
  total: number;
  bytesPerSecond: number;
  done: boolean;
  error?: string;
  
  unit?: 'bytes' | 'files';
}

type Listener = (progress: InstallProgress) => void;

const listeners = new Set<Listener>();

const running = new Map<string, Task<unknown>>();

export function onProgress(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(progress: InstallProgress): void {
  for (const listener of listeners) listener(progress);
}


export function report(progress: InstallProgress): void {
  emit(progress);
}


export function busy(): boolean {
  return running.size > 0;
}


export function isInstalled(versionId: string): boolean {
  return existsSync(MinecraftFolder.from(sharedDir()).getVersionJson(versionId));
}

export function cancel(instanceId: string): boolean {
  const task = running.get(instanceId);
  if (!task) return false;
  task.cancel(0);
  return true;
}


function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  
  const leaves: Error[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (leaves.length >= 400 || depth > 6) return;
    const nested = (node as { errors?: unknown[] })?.errors;
    if (Array.isArray(nested) && nested.length) {
      for (const child of nested) walk(child, depth + 1);
    } else if (node instanceof Error) {
      leaves.push(node);
    }
  };
  walk(error, 0);

  if (!leaves.length) return error.message;

  
  const kinds = new Map<string, number>();
  for (const leaf of leaves) {
    const code = (leaf as { code?: string; status?: number }).code
      ?? (leaf as { status?: number }).status;
    const key = code ? `${leaf.message} [${code}]` : leaf.message;
    kinds.set(key, (kinds.get(key) ?? 0) + 1);
  }

  const top = [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([text, times]) => (times > 1 ? `${text} ×${times}` : text));
  const total = leaves.length;
  return `Не скачалось файлов: ${total}. Причина: ${top.join(' | ')}`;
}

/** Идущие проверки библиотек по версии - чтобы два запуска не качали одно и то же одновременно. */
const libraryChecks = new Map<string, Promise<void>>();

/**
 * Файл правда целый или только нужного размера?
 *
 * Оборванная загрузка может оставить файл полного размера с «дырами» внутри - Java потом не может
 * его распаковать, и игра падает с "Could not find or load main class". Оглавление zip лежит в самом
 * конце файла, поэтому jar без записи конца центрального каталога - битый, его надо перекачать.
 */
function intact(path: string, expected: number): boolean {
  if (!existsSync(path)) return false;
  const size = statSync(path).size;
  if (size === 0 || (expected > 0 && size !== expected)) return false;
  if (!path.endsWith('.jar') && !path.endsWith('.zip')) return true;

  // Запись занимает 22 байта плюс комментарий до 64 КБ - хватает прочитать хвост.
  const length = Math.min(size, 66_000);
  const tail = Buffer.alloc(length);
  const handle = openSync(path, 'r');
  try {
    readSync(handle, tail, 0, length, size - length);
  } finally {
    closeSync(handle);
  }
  return tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) !== -1;
}

/**
 * Проверяет, что все библиотеки версии на месте, и докачивает недостающие.
 *
 * Вызывается перед каждым запуском, а не только после установки: когда всё на месте, это дёшево,
 * а установку с «дырами» чинит молча. Иначе это тупик - сборка с флагом «установлена» сама
 * не переустанавливается.
 */
export function ensureLibraries(versionId: string): Promise<void> {
  // Две проверки сразу пишут один jar через два дескриптора и получают файл неправильной длины -
  // так появлялась ошибка "ASM not detected on the classpath" при всех библиотеках на диске.
  // Поэтому одна проверка на версию, общая для всех, кто её ждёт.
  const inFlight = libraryChecks.get(versionId);
  if (inFlight) return inFlight;

  const check = (async () => {
    const folder = MinecraftFolder.from(sharedDir());
    const resolved = await Version.parse(folder, versionId);

    // Смотрим только на отсутствующие и обрезанные файлы. installLibraries сверяет все ~150 файлов
    // с сервером, а на медленной сети это минуты с надписью «Проверяю библиотеки…» перед каждым запуском.
    const missing = resolved.libraries.filter(
      (library) => !intact(folder.getLibraryByPath(library.download.path), library.download.size),
    );
    if (!missing.length) return;

    await installLibraries({ ...resolved, libraries: missing }, {
      agent: downloadAgent,
      librariesDownloadConcurrency: 8,
    });
  })().finally(() => libraryChecks.delete(versionId));

  libraryChecks.set(versionId, check);
  return check;
}

/**
 * Качает игру и выбранный загрузчик в ОБЩУЮ папку и возвращает id версии, которую надо запускать.
 *
 * Всё складывается в одно место специально: вторая сборка на той же версии и загрузчике найдёт
 * файлы готовыми и установится за секунды. Папка самой сборки остаётся маленькой.
 */
export async function installInstance(instance: Instance): Promise<string> {
  const folder = MinecraftFolder.from(sharedDir());

  const report = (stage: string, progress: number, total: number, bytesPerSecond: number, unit: 'bytes' | 'files' = 'bytes') =>
    emit({ instanceId: instance.id, stage, progress, total, bytesPerSecond, done: false, unit });

  try {
    report('Список версий', 0, 0, 0);
    const list = await getVersionList();
    const meta = list.versions.find((v) => v.id === instance.minecraft);
    if (!meta) throw new Error(`Версия ${instance.minecraft} не найдена в манифесте Mojang.`);

    // Байты считаем сами: задача отдаёт прогресс в своих единицах,
    // а скорость в МБ/с должна считаться по реально скачанным байтам.
    let bytes = 0;
    let windowBytes = 0;
    let windowStart = Date.now();
    let speed = 0;
    // onUpdate вызывается на каждый скачанный кусок - тысячи раз в секунду на ~3000 файлов ассетов.
    // Раньше каждый вызов шёл через IPC и перерисовывал окно: интерфейс дёргался и не принимал клики.
    // Прогресс-бару достаточно обновляться несколько раз в секунду.
    let lastReport = 0;
    // task.total - это итог ТЕКУЩЕЙ подзадачи (индекс ассетов, ассеты, библиотеки...), а не общий,
    // и при смене подзадачи он сбрасывается. Если брать максимум, знаменатель застревает на самой
    // большой подзадаче - отсюда было «100%, 430 из 430 МБ», пока библиотеки ещё качались.
    // Поэтому ловим смену подзадачи (итог уменьшился) и прибавляем итог завершённой к базе.
    let stageBase = 0;
    let lastStageTotal = 0;

    // Максимум два прохода. Один оборванный файл из ~3000 валит всю установку, а второй проход
    // почти бесплатный: всё, что уже скачано, пропускается.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const task = installTask(meta, folder, {
        // По умолчанию параллельных загрузок так много, что домашний роутер начинает
        // отказывать в соединениях - и медленная загрузка становится упавшей.
        assetsDownloadConcurrency: 8,
        librariesDownloadConcurrency: 8,
        agent: downloadAgent,
      });
      running.set(instance.id, task);
      // Уже скачанные файлы проверяются по хешу без вызова onUpdate. Когда почти всё на месте,
      // бар раньше висел на «0 Б из 0 Б» всё время проверки и выглядел как зависание.
      // onStart/onSucceed вызываются для каждого файла в любом случае, поэтому считаем их
      // и показываем «проверено N из M».
      let sawBytes = false;
      let checkedTotal = 0;
      let checkedDone = 0;
      let lastCheckReport = 0;
      const reportChecking = () => {
        if (sawBytes) return;
        const now = Date.now();
        if (now - lastCheckReport < 120) return;
        lastCheckReport = now;
        report(`Проверяю файлы игры ${instance.minecraft}…`, checkedDone, checkedTotal, 0, 'files');
      };
      try {
        await task.startAndWait({
          onStart() {
            checkedTotal += 1;
            reportChecking();
          },
          onSucceed() {
            checkedDone += 1;
            reportChecking();
          },
          onUpdate(_child, chunkSize) {
            // Берём только положительный прирост. Повторно скачиваемый файл заново присылает
            // куски, а перезапуск подзадачи может дать отрицательное значение - отсюда были
            // отрицательные МБ/с и бар, который шёл назад.
            if (chunkSize > 0) {
              sawBytes = true;
              bytes += chunkSize;
              windowBytes += chunkSize;
            }
            // Скорость пересчитываем раз в полсекунды.
            const elapsed = Date.now() - windowStart;
            if (elapsed >= 500) {
              speed = Math.max(0, Math.round((windowBytes / elapsed) * 1000));
              windowBytes = 0;
              windowStart = Date.now();
            }
            const now = Date.now();
            if (now - lastReport < 120) return;
            lastReport = now;

            const label = attempt === 1 ? '' : ' (докачиваю)';
            // task.progress тоже обнуляется на каждой подзадаче, поэтому в числителе наш счётчик байтов.
            if (task.total < lastStageTotal) stageBase += lastStageTotal;
            lastStageTotal = task.total;
            const total = stageBase + lastStageTotal || bytes;
            // Всё равно ограничиваем: bytes может ненадолго обогнать итог только что начавшейся подзадачи.
            report(`Файлы игры ${instance.minecraft}${label}`, Math.min(bytes, total), total, speed);
          },
        });
        break;
      } catch (error) {
        // Отмену нажал пользователь - это не сбой сети, повторять нельзя.
        if (attempt === 2 || task.isCancelled) throw error;
        report(`Файлы игры ${instance.minecraft} - повтор`, 0, 0, 0);
      }
    }
    running.delete(instance.id);

    if (instance.loader === 'vanilla') {
      emit({ instanceId: instance.id, stage: 'Готово', progress: 1, total: 1, bytesPerSecond: 0, done: true });
      return instance.minecraft;
    }

    report(`Загрузчик ${instance.loader} ${instance.loaderVersion}`, 0, 0, 0);
    let versionId: string;

    // Раньше загрузчики ставились без таймаута: зависшее соединение с maven Fabric или сервером Forge
    // вешало установку навсегда. Теперь у них те же dispatcher/agent с таймаутами, что и выше.
    switch (instance.loader) {
      case 'fabric': {
        const artifact = await getFabricLoaderArtifact(instance.minecraft, instance.loaderVersion, { dispatcher });
        versionId = await installFabric(artifact, folder);
        break;
      }
      case 'quilt':
        versionId = await installQuiltVersion({
          minecraftVersion: instance.minecraft,
          version: instance.loaderVersion,
          minecraft: folder,
          dispatcher,
        });
        break;
      case 'forge':
        versionId = await installForge(
          { mcversion: instance.minecraft, version: instance.loaderVersion },
          folder,
          { agent: downloadAgent },
        );
        break;
      default:
        versionId = await installNeoForged('neoforge', instance.loaderVersion, folder, { agent: downloadAgent });
        break;
    }

    // Установщики загрузчиков пишут только json версии. Библиотеки из него (jar самого Fabric,
    // intermediary, ASM) никто не качает, кроме этого вызова. Без него игра «установлена»,
    // но не запускается с "Missing N libraries".
    report(`Библиотеки ${instance.loader}`, 0, 0, 0);
    const resolved = await Version.parse(folder, versionId);
    await installLibraries(resolved, { agent: downloadAgent, librariesDownloadConcurrency: 8 });

    emit({ instanceId: instance.id, stage: 'Готово', progress: 1, total: 1, bytesPerSecond: 0, done: true });
    return versionId;
  } catch (error) {
    running.delete(instance.id);
    const message = describe(error);
    emit({ instanceId: instance.id, stage: 'Ошибка', progress: 0, total: 0, bytesPerSecond: 0, done: true, error: message });
    // Бросаем понятный текст, а не исходную ошибку: вызывающий код (например, запуск) покажет его
    // пользователю как есть, а исходная ошибка - это стена стектрейсов.
    throw new Error(message, { cause: error });
  }
}
