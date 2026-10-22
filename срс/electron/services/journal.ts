import { appendFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_ROOT } from './paths.js';



const FILE = () => join(CONFIG_ROOT, 'launcher-log.txt');

const LIMIT = 512 * 1024;

export function journal(message: string, error?: unknown): void {
  const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : error !== undefined ? String(error) : '';
  const line = `[${new Date().toISOString()}] ${message}${detail ? `: ${detail}` : ''}\n`;
  try {
    try {
      if (statSync(FILE()).size > LIMIT) renameSync(FILE(), `${FILE()}.old`);
    } catch {
      // Файла ещё нет - это нормально.
    }
    appendFileSync(FILE(), line, 'utf8');
  } catch {
    // Журнал - помощник для разбора проблем. Не записался - лаунчер всё равно должен работать.
  }
}

export const journalPath = FILE;
