import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';



const JUNK = new Set([
  '', '0', 'none', 'n/a', 'na', 'default string', 'to be filled by o.e.m.', 'system serial number',
  'base board serial number', 'not applicable', 'not specified', '00000000-0000-0000-0000-000000000000',
  'ffffffff-ffff-ffff-ffff-ffffffffffff', '03000200-0400-0500-0006-000700080009',
]);

const usable = (value: string): boolean => {
  const clean = value.trim().toLowerCase();
  return !JUNK.has(clean) && !/^(.)\1*$/.test(clean.replace(/-/g, ''));
};

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true, timeout: 15_000 }, (error, stdout) => (error ? reject(error) : resolve(stdout)));
  });
}

let cached: Promise<string> | null = null;


export function hwid(): Promise<string> {
  cached ??= compute().catch((error: unknown) => {
    cached = null;
    throw error;
  });
  return cached;
}

async function compute(): Promise<string> {
  let board: string[] = [];
  try {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '$p=(Get-CimInstance Win32_ComputerSystemProduct).UUID; $b=(Get-CimInstance Win32_BaseBoard).SerialNumber; "$p|$b"']);
    board = out.trim().split('|').map((part) => part.trim());
  } catch {
    throw new Error('Не получилось прочитать данные компьютера. Попробуй ещё раз.');
  }
  let parts = board.filter(usable);
  if (!parts.length) {
    const out = await run('reg.exe', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'])
      .catch(() => '');
    const guid = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{36})/.exec(out)?.[1] ?? '';
    if (!usable(guid)) throw new Error('Не получилось определить компьютер: производитель не заполнил его номер.');
    parts = ['guid:' + guid];
  }
  return createHash('sha256').update('power-visual-social|' + parts.map((p) => p.toLowerCase()).join('|')).digest('hex');
}
