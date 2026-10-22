import { safeStorage } from 'electron';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_ROOT } from './paths.js';


const SECRET_FIELDS = ['accessToken', 'refreshToken'] as const;
const PREFIX = 'enc:v1:';

function encryptSecrets(accounts: Account[]): Account[] {
  if (!safeStorage.isEncryptionAvailable()) {
    return accounts.map(({ accessToken, refreshToken, ...rest }) => rest);
  }
  return accounts.map((account) => {
    const copy: Account = { ...account };
    for (const field of SECRET_FIELDS) {
      const value = copy[field];
      if (value && !value.startsWith(PREFIX)) {
        copy[field] = PREFIX + safeStorage.encryptString(value).toString('base64');
      }
    }
    return copy;
  });
}

function decryptSecrets(accounts: Account[]): Account[] {
  return accounts.map((account) => {
    const copy: Account = { ...account };
    for (const field of SECRET_FIELDS) {
      const value = copy[field];
      if (!value?.startsWith(PREFIX)) continue;
      try {
        copy[field] = safeStorage.decryptString(Buffer.from(value.slice(PREFIX.length), 'base64'));
      } catch {
        
        
        delete copy[field];
      }
    }
    return copy;
  });
}

export interface Account {
  id: string;
  name: string;
  uuid: string;
  kind: 'microsoft' | 'offline';
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface Instance {
  id: string;
  name: string;
  minecraft: string;
  
  loader: 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge';
  loaderVersion: string;
  
  versionId: string;
  accent: 'cosmic' | 'kawaii' | 'aurora';
  memory: number;
  javaPath?: string;
  installed: boolean;
  lastPlayed: number;
  createdAt: number;
  
  pinned?: string[];
  
  playSeconds?: number;
  
  cover?: string;
  
  source?: string;
}

export interface Settings {
  javaPath: string;
  memory: number;
  
  hideDuringGame: boolean;
  showSnapshots: boolean;
  checkModUpdates: boolean;
  
  minimizeToTray: boolean;
  jvmArgs: string;
  
  msClientId: string;
  contentUrl: string;
  
  dataRoot: string;
  width: number;
  height: number;
  
  liteMode: boolean;
  
  discordStatus: boolean;
  
  seenVersion: string;
  
  theme: string;
  
  onboarded: boolean;
}


interface Cabinet {
  email: string;
  session: string;
}


export interface Social {
  accountId: string;
  uuid: string;
  name: string;
  token: string;
}

interface Data {
  accounts: Account[];
  selectedAccount: string | null;
  instances: Instance[];
  selectedInstance: string | null;
  settings: Settings;
  cabinet: Cabinet | null;
  social: Social | null;
}


export const MS_CLIENT_ID = '';

export const DEFAULT_SETTINGS: Settings = {
  javaPath: '',
  memory: 4096,
  hideDuringGame: true,
  showSnapshots: false,
  checkModUpdates: true,
  minimizeToTray: false,
  jvmArgs: '-XX:+UseG1GC -XX:MaxGCPauseMillis=50 -Dfile.encoding=UTF-8',
  msClientId: MS_CLIENT_ID,
  contentUrl: 'REDACTED_ENDPOINT',
  dataRoot: '',
  width: 1600,
  height: 900,
  liteMode: false,
  discordStatus: true,
  seenVersion: '',
  
  theme: 'power',
  onboarded: false,
};


function fillBlanks(saved: Settings & { curseforgeKey?: string; closeOnLaunch?: boolean }): Settings {
  
  
  const { curseforgeKey: _dropped, closeOnLaunch: _old, ...settings } = saved;
  return {
    ...settings,
    msClientId: settings.msClientId.trim() || MS_CLIENT_ID,
    contentUrl: settings.contentUrl.trim() || DEFAULT_SETTINGS.contentUrl,
  };
}


function encryptCabinet(cabinet: Cabinet | null): Cabinet | null {
  if (!cabinet || cabinet.session.startsWith(PREFIX)) return cabinet;
  if (!safeStorage.isEncryptionAvailable()) return null;
  return { ...cabinet, session: PREFIX + safeStorage.encryptString(cabinet.session).toString('base64') };
}

function decryptCabinet(cabinet: Cabinet | null): Cabinet | null {
  if (!cabinet?.session?.startsWith(PREFIX)) return cabinet;
  try {
    const raw = Buffer.from(cabinet.session.slice(PREFIX.length), 'base64');
    return { ...cabinet, session: safeStorage.decryptString(raw) };
  } catch {
    return null;
  }
}


function encryptSocial(social: Social | null): Social | null {
  if (!social || social.token.startsWith(PREFIX)) return social;
  if (!safeStorage.isEncryptionAvailable()) return null;
  return { ...social, token: PREFIX + safeStorage.encryptString(social.token).toString('base64') };
}

function decryptSocial(social: Social | null): Social | null {
  if (!social?.token?.startsWith(PREFIX)) return social;
  try {
    return { ...social, token: safeStorage.decryptString(Buffer.from(social.token.slice(PREFIX.length), 'base64')) };
  } catch {
    return null;
  }
}

const FILE = () => join(CONFIG_ROOT, 'launcher.json');

let cache: Data | null = null;


export function load(): Data {
  if (cache) return cache;
  try {
    const raw = JSON.parse(readFileSync(FILE(), 'utf8')) as Partial<Data>;
    cache = {
      accounts: decryptSecrets(raw.accounts ?? []),
      selectedAccount: raw.selectedAccount ?? null,
      instances: raw.instances ?? [],
      selectedInstance: raw.selectedInstance ?? null,
      
      
      settings: fillBlanks({ ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) }),
      
      cabinet: null,
      social: decryptSocial(raw.social ?? null),
    };
  } catch {
    cache = {
      accounts: [], selectedAccount: null, instances: [], selectedInstance: null,
      settings: { ...DEFAULT_SETTINGS }, cabinet: null, social: null,
    };
  }
  return cache;
}


function save(next?: Data): Data {
  const data = next ?? load();
  cache = data;
  const tmp = FILE() + '.tmp';
  
  const onDisk = {
    ...data,
    accounts: encryptSecrets(data.accounts),
    cabinet: encryptCabinet(data.cabinet),
    social: encryptSocial(data.social),
  };
  writeFileSync(tmp, JSON.stringify(onDisk, null, 2), 'utf8');
  renameSync(tmp, FILE());
  return data;
}


export function update(fn: (data: Data) => void): Data {
  const data = load();
  fn(data);
  return save(data);
}
