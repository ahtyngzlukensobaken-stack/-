import { fetchJavaRuntimeManifest, installJavaRuntimeTask, resolveJava } from '@xmcl/installer';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { downloadAgent } from './install.js';
import { javaDir } from './paths.js';




export function wantedMajor(minecraft: string): number {
  const match = /^1\.(\d+)/.exec(minecraft.trim());
  if (!match) return 21;
  const minor = Number(match[1]);
  return minor >= 20 ? 21 : minor >= 17 ? 17 : 8;
}


function target(major: number): string {
  if (major >= 21) return 'java-runtime-delta';
  if (major >= 17) return 'java-runtime-gamma';
  return 'jre-legacy';
}


function runtimeDir(major: number): string {
  return join(javaDir(), target(major));
}

export function managedJavaExe(major: number): string {
  return join(runtimeDir(major), 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
}


export async function managedJava(major: number): Promise<string | null> {
  const exe = managedJavaExe(major);
  if (!existsSync(exe)) return null;
  
  const info = await resolveJava(exe).catch(() => undefined);
  return info ? exe : null;
}


export async function downloadJava(
  major: number,
  onStage: (text: string) => void,
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  const already = await managedJava(major);
  if (already) return already;

  onStage(`Скачиваю Java ${major} - она нужна этой версии игры…`);
  // downloadAgent уже несёт в себе наш dispatcher с поднятым таймаутом - второй раз его
  // передавать не нужно, иначе он же и перезапишет сам себя.
  const manifest = await fetchJavaRuntimeManifest({
    target: target(major),
    ...downloadAgent,
  });

  const task = installJavaRuntimeTask({
    destination: runtimeDir(major),
    manifest,
    ...downloadAgent,
  });

  let lastShown = 0;
  await task.startAndWait({
    onUpdate() {
      // Полосу двигаем на каждом событии - она для того и нужна, чтобы было видно движение.
      onProgress?.(task.progress, task.total);
      // А в лог пишем не чаще раза в полторы секунды, иначе он захлебнётся строками о каждом файле.
      const now = Date.now();
      if (now - lastShown < 1500) return;
      lastShown = now;
      const percent = task.total ? Math.round((task.progress / task.total) * 100) : 0;
      onStage(`Скачиваю Java ${major}: ${percent}%`);
    },
    onFailed() { /* ошибку бросит startAndWait, отдельный обработчик не нужен */ },
  });

  const exe = await managedJava(major);
  if (!exe) throw new Error('Java скачалась, но запустить её не удалось. Попробуй ещё раз или укажи свою Java в настройках.');
  onStage(`Java ${major} готова.`);
  return exe;
}
