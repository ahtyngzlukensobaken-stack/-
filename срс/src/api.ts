

export interface Account {
  id: string; name: string; uuid: string; kind: 'microsoft' | 'offline'; expiresAt?: number;
}

export type SkinModel = 'classic' | 'slim';

export interface SkinFile { name: string; png: string; width: number; height: number; }

export interface Instance {
  id: string; name: string; minecraft: string;
  loader: 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge';
  loaderVersion: string; versionId: string;
  accent: 'cosmic' | 'kawaii' | 'aurora';
  memory: number; javaPath?: string; installed: boolean;
  lastPlayed: number; createdAt: number;
  pinned?: string[];
  playSeconds?: number;
  
  cover?: string;
  
  coverUrl?: string;
}


export type Kind = 'mod' | 'resourcepack' | 'datapack' | 'shader';

export interface ContentVersion {
  id: string; label: string; channel: 'release' | 'beta' | 'alpha';
  fits: boolean; note: string; date: string; downloads: number;
}

export interface World {
  folder: string; name: string; datapacks: number; lastPlayed: number;
}

export interface Identified {
  source: 'modrinth' | 'curseforge'; projectId: string; versionId: string; label: string;
  
  name?: string; icon?: string;
}

export interface ModUpdate {
  file: string; name: string; current: string; latest: string; url: string; filename: string; sha1?: string;
}

export interface Settings {
  javaPath: string; memory: number; hideDuringGame: boolean; showSnapshots: boolean;
  checkModUpdates: boolean; minimizeToTray: boolean; jvmArgs: string; msClientId: string;
  contentUrl: string; dataRoot: string; width: number; height: number; liteMode: boolean; discordStatus: boolean;
  seenVersion: string;
  theme: string;
  onboarded: boolean;
}

export interface NewsItem {
  slug: string; title: string; body: string; tag: string;
  accent: 'cosmic' | 'kawaii' | 'aurora'; link: string; pinned: number; at: number;
}

export interface Content {
  rev: number; news: NewsItem[]; strings: Record<string, string>;
  source: 'network' | 'cache' | 'builtin'; fetchedAt: number;
}


export interface State {
  accounts: Account[]; selectedAccount: string | null;
  instances: Instance[]; selectedInstance: string | null;
  settings: Settings; content: Content; running: string[];
  
  version: string;
  
  devBuild: boolean;
}


export interface MojangNews { id: string; title: string; text: string; image: string; link: string; date: string; }
export interface MojangFeed { versions: Record<string, string>; news: MojangNews[]; fetchedAt: number; }


export interface Friend {
  uuid: string; name: string; online: boolean;
  
  licensed: boolean;
  status: '' | 'launcher' | 'menu' | 'world' | 'server';
  build: string; minecraft: string; server: string; seenAt: number; unread: number;
  
  dnd?: boolean;
}
export interface PendingFriend { uuid: string; name: string; licensed: boolean; at: number; avatar?: string; }
export interface ChatMessage { id: number; from: string; to: string; body: string; at: number; read?: boolean; replyTo?: number | null; edited?: boolean; deleted?: boolean; reactions?: Record<string, string[]>; }
export interface GroupMember { uuid: string; name: string; licensed: boolean; avatar?: string; }
export interface Group { id: number; name: string; owner: string; members: GroupMember[]; unread: number; }
export interface GroupMessage { id: number; group: number; from: string; body: string; at: number; replyTo?: number | null; edited?: boolean; deleted?: boolean; reactions?: Record<string, string[]>; }
export type SocialMode = '' | 'dnd' | 'invisible';

export interface Favorite { id: string; url: string; gif: boolean; src: string; at: number; }

export interface SharedPreview { code: string; name: string; minecraft: string; loader: string; loaderVersion: string; files: number; }
export interface SocialSnapshot {
  enabled: boolean; online: boolean;
  me: { uuid: string; name: string; licensed?: boolean; mode?: SocialMode; avatar?: string } | null;
  site?: string;
  friends: Friend[]; incoming: PendingFriend[]; outgoing: PendingFriend[]; groups: Group[]; error: string | null;
  accountId?: string | null;
}

export interface CabinetBuild {
  id: number; version: string; channel: string; filename: string;
  notes: string | null; created_at: number;
}
export interface CabinetStatus {
  loggedIn: boolean; email?: string; nickname?: string; approved?: boolean; builds?: CabinetBuild[];
}

export interface GameVersion { id: string; type: string; releaseTime: string; }
export interface LoaderVersion { version: string; stable: boolean; recommended: boolean; note?: string; }
export interface JavaInfo { path: string; version: string; majorVersion: number; }
export interface ModFile { file: string; size: number; enabled: boolean; }
export interface ImportedPack { instance: Instance; installed: number; failed: string[]; }

export interface FoundInstance {
  path: string; launcher: string; name: string; minecraft: string;
  loader: Instance['loader']; loaderVersion: string;
  mods: number; worlds: number;
  
  size: number; worldsSize: number;
  
  already: boolean;
  problem?: string;
}
export interface Adopted { instance: Instance; carried: string[]; }

export interface ModFit {
  file: string; name: string; state: 'ok' | 'update' | 'missing' | 'unknown';
  current?: string; latest?: string; url?: string; filename?: string; sha1?: string;
}
export interface ImportResult { added: { kind: Kind; file: string }[]; skipped: string[]; }
export interface Screenshot { file: string; url: string; size: number; at: number; }
export interface ModHit {
  source: 'modrinth' | 'curseforge'; id: string; slug: string; name: string; author: string;
  summary: string; downloads: number; icon: string; pageUrl: string; downloadable: boolean;
}
export interface InstallProgress {
  instanceId: string; stage: string; progress: number; total: number;
  bytesPerSecond: number; done: boolean; error?: string; unit?: 'bytes' | 'files';
}
export interface GameLog { instanceId: string; line: string; level: 'out' | 'err' | 'status'; }
export interface CrashAutofix { kind: 'update' | 'disable'; label: string; nameHints: string[]; }
export interface GameCrash {
  instanceId: string; title: string; summary: string; details: string; autofixes: CrashAutofix[];
  
  reportPath?: string;
  
  steps: string[];
}
type LauncherUpdate =
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'progress'; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error' }
  | { status: 'none' };


interface Bridge {
  call(channel: string, payload?: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }>;
  pathForFile(file: File): string;
  on(event: 'install-progress' | 'game-log' | 'game-crash' | 'content-updated' | 'launcher-update' | 'java-progress' | 'social' | 'voice' | 'voice-key', handler: (data: any) => void): () => void;
}

const bridge = (window as unknown as { pv: Bridge }).pv;


async function call<T>(channel: string, payload?: unknown): Promise<T> {
  const result = await bridge.call(channel, payload);
  if (!result.ok) throw new Error(result.error ?? 'Что-то пошло не так.');
  return result.data as T;
}

export const api = {
  state: () => call<State>('state'),
  refreshContent: () => call<Content>('content.refresh'),

  
  addOffline: (name: string) => call<Account>('accounts.addOffline', { name }),
  removeAccount: (id: string) => call<void>('accounts.remove', { id }),
  selectAccount: (id: string) => call<void>('accounts.select', { id }),
  signInMicrosoft: () => call<Account>('accounts.signInMicrosoft'),

  
  pickSkin: () => call<SkinFile | null>('skins.pick'),
  applySkin: (id: string, model: SkinModel, png: string) => call<void>('skins.apply', { id, model, png }),
  resetSkin: (id: string) => call<void>('skins.reset', { id }),
  currentSkin: (id: string) => call<{ model: SkinModel; dataUrl: string } | null>('skins.current', { id }),

  
  gameVersions: (channel: 'release' | 'snapshot' | 'old') =>
    call<GameVersion[]>('versions.game', { channel }),
  loaderVersions: (loader: string, minecraft: string) =>
    call<LoaderVersion[]>('versions.loader', { loader, minecraft }),

  
  createInstance: (input: {
    name: string; minecraft: string; loader: string; loaderVersion: string;
  }) => call<Instance>('instances.create', input),
  removeInstance: (id: string, deleteFiles: boolean) =>
    call<void>('instances.remove', { id, deleteFiles }),
  selectInstance: (id: string) => call<void>('instances.select', { id }),
  renameInstance: (id: string, name: string) => call<Instance>('instances.rename', { id, name }),
  
  checkModFit: (id: string) => call<ModFit[]>('mods.checkFit', { id }),
  
  applyModFit: (id: string, report: ModFit[]) =>
    call<{ updated: string[]; disabled: string[]; failed: string[] }>('mods.applyFit', { id, report }),
  
  setInstanceVersion: (
    id: string, minecraft: string, loader: Instance['loader'], loaderVersion: string,
  ) => call<Instance>('instances.setVersion', { id, minecraft, loader, loaderVersion }),
  duplicateInstance: (id: string) => call<Instance>('instances.duplicate', { id }),
  
  exportPack: (id: string) =>
    call<{ path: string; linked: number; packed: number } | null>('instances.exportPack', { id }),
  setInstanceMemory: (id: string, memory: number) =>
    call<Instance | null>('instances.setMemory', { id, memory }),
  instanceContent: (id: string, kind: Kind, world = '') =>
    call<ModFile[]>('instances.content', { id, kind, world }),
  instanceWorlds: (id: string) => call<World[]>('instances.worlds', { id }),
  
  backupWorld: (id: string, folder: string) =>
    call<{ path: string; files: number; size: number } | null>('instances.backupWorld', { id, folder }),
  openInstanceFolder: (id: string) => call<string>('instances.openFolder', { id }),
  
  importPack: () => call<ImportedPack | null>('instances.importPack'),
  
  sharePack: (id: string) => call<{ code: string; linked: number; skipped: string[] }>('instances.share', { id }),
  previewShared: (code: string) => call<SharedPreview>('instances.previewShared', { code }),
  importShared: (code: string) => call<ImportedPack>('instances.importShared', { code }),
  
  scanOther: () => call<FoundInstance[]>('instances.scanOther'),
  
  adopt: (found: FoundInstance, withWorlds: boolean) =>
    call<Adopted>('instances.adopt', { found, withWorlds }),
  importFiles: (id: string, kind: Kind, world: string, paths: string[]) =>
    call<ImportResult>('instances.importFiles', { id, kind, world, paths }),
  
  pickCover: (id: string) => call<Instance | null>('instances.pickCover', { id }),
  clearCover: (id: string) => call<void>('instances.clearCover', { id }),
  screenshots: (id: string) => call<Screenshot[]>('instances.screenshots', { id }),
  openScreenshot: (id: string, file: string) => call<string>('instances.openScreenshot', { id, file }),
  trashScreenshot: (id: string, file: string) => call<void>('instances.trashScreenshot', { id, file }),
  
  pathForFile: (file: File) => bridge.pathForFile(file),

  
  dataInfo: () => call<{ path: string; size: number }>('data.info'),
  pickDataFolder: () => call<string | null>('data.pick'),
  moveData: (path: string) => call<{ from: string; to: string; moved: string[] }>('data.move', { path }),

  
  checkModUpdates: (id: string) => call<ModUpdate[]>('mods.checkUpdates', { id }),
  applyModUpdate: (id: string, update: ModUpdate) =>
    call<string>('mods.applyUpdate', { id, update }),

  
  copyText: (text: string) => call<void>('clipboard.write', { text }),
  saveLog: (text: string) => call<string | null>('logs.save', { text }),

  
  installCancel: (id: string) => call<boolean>('install.cancel', { id }),

  launchStart: (id: string) => call<{ pid: number }>('launch.start', { id }),
  devHasToken: () => call<boolean>('dev.hasToken'),
  devSetToken: (token: string) => call<void>('dev.setToken', { token }),
  devClearToken: () => call<void>('dev.clearToken'),
  devCall: <T = any>(path: string, body?: unknown) => call<T>('dev.call', { path, body }),
  javaInstalls: () => call<JavaInfo[]>('launch.java'),
  systemMemory: () => call<number>('system.memory'),
  newestJava: () => call<number>('java.newest'),
  downloadJava: () => call<{ major: number; path: string }>('java.download'),
  onJavaProgress: (handler: (p: { done: number; total: number }) => void) => bridge.on('java-progress', handler),

  
  searchMods: (q: {
    source: 'modrinth' | 'curseforge'; query: string; minecraft: string; loader: string;
    offset: number; kind?: Kind;
  }) => call<ModHit[]>('mods.search', q),
  modVersions: (id: string, source: 'modrinth' | 'curseforge', projectId: string, kind: Kind) =>
    call<ContentVersion[]>('mods.versions', { id, source, projectId, kind }),
  installMod: (request: {
    id: string; source: 'modrinth' | 'curseforge'; projectId: string;
    kind?: Kind; world?: string; versionId?: string;
  }) => call<{ file: string; version: string }>('mods.install', request),
  toggleMod: (id: string, file: string, kind: Kind = 'mod', world = '') =>
    call<string>('mods.toggle', { id, file, kind, world }),
  removeMod: (id: string, file: string, kind: Kind = 'mod', world = '') =>
    call<void>('mods.remove', { id, file, kind, world }),
  pinMod: (id: string, file: string, pinned: boolean) =>
    call<string[]>('mods.pin', { id, file, pinned }),
  identifyMod: (id: string, file: string, kind: Kind = 'mod', world = '') =>
    call<Identified | null>('mods.identify', { id, file, kind, world }),
  identifyMods: (id: string, files: string[], kind: Kind = 'mod', world = '') =>
    call<Record<string, Identified | null>>('mods.identifyMany', { id, files, kind, world }),
  switchModVersion: (id: string, file: string, versionId: string, kind: Kind = 'mod', world = '') =>
    call<string>('mods.switchVersion', { id, file, versionId, kind, world }),

  
  saveSettings: (changes: Partial<Settings>) => call<Settings>('settings.save', changes),


  
  openExternal: (url: string) => call<void>('shell.open', { url }),
  setBadge: (count: number, image: string) => call<void>('app.badge', { count, image }),
  openRoot: () => call<string>('shell.openRoot'),

  
  minimize: () => call<void>('window.minimize'),
  maximize: () => call<void>('window.maximize'),
  close: () => call<void>('window.close'),

  
  mojangFeed: () => call<MojangFeed>('mojang.feed'),

  
  socialState: () => call<SocialSnapshot>('social.state'),
  socialEnable: (accountId?: string) => call<SocialSnapshot>('social.enable', { accountId }),
  socialDisable: () => call<void>('social.disable'),
  socialAdd: (name: string, uuid?: string) => call<{ result: string; name: string; candidates?: { uuid: string; name: string; licensed: boolean }[] }>('social.add', { name, uuid }),
  socialAccept: (uuid: string) => call<void>('social.accept', { uuid }),
  socialRemove: (uuid: string) => call<void>('social.remove', { uuid }),
  socialHistory: (uuid: string, before?: number) =>
    call<{ messages: ChatMessage[]; more: boolean }>('social.history', { uuid, before }),
  socialSend: (uuid: string, text: string, replyTo?: number) => call<ChatMessage>('social.send', { uuid, text, replyTo }),
  
  messageChange: (group: boolean, id: number, change: { body?: string; remove?: boolean; emoji?: string }) =>
    call<ChatMessage | GroupMessage>('social.change', { group, id, ...change }),
  socialMode: (mode: SocialMode) => call<void>('social.mode', { mode }),
  socialAvatar: (image: string) => call<void>('social.avatar', { image }),
  socialMedia: (image: string) => call<string>('social.media', { image }),
  favList: () => call<Favorite[]>('fav.list'),
  favAdd: (url: string) => call<Favorite[]>('fav.add', { url }),
  favRemove: (id: string) => call<Favorite[]>('fav.remove', { id }),
  favPayload: (id: string) => call<{ url: string; data?: string }>('fav.payload', { id }),
  socialRead: (uuid: string) => call<void>('social.read', { uuid }),
  socialFast: (on: boolean) => call<void>('social.fast', { on }),
  socialJoin: (uuid: string) => call<void>('social.join', { uuid }),
  onSocial: (handler: (e: { snapshot: SocialSnapshot; messages: ChatMessage[]; groupMessages: GroupMessage[]; reads?: { by: string; upTo: number }[] }) => void) => bridge.on('social', handler),
  groupCreate: (name: string, members: string[]) => call<number>('social.group.create', { name, members }),
  groupAdd: (group: number, uuid: string) => call<void>('social.group.add', { group, uuid }),
  groupKick: (group: number, uuid: string) => call<void>('social.group.kick', { group, uuid }),
  groupLeave: (group: number) => call<void>('social.group.leave', { group }),
  groupRename: (group: number, name: string) => call<void>('social.group.rename', { group, name }),
  groupHistory: (group: number, before?: number) =>
    call<{ messages: GroupMessage[]; more: boolean }>('social.group.history', { group, before }),
  groupSend: (group: number, text: string, replyTo?: number) => call<GroupMessage>('social.group.send', { group, text, replyTo }),
  groupRead: (group: number) => call<void>('social.group.read', { group }),
  voiceIce: () => call<RTCIceServer[]>('voice.ice'),
  voiceSend: (message: Record<string, unknown>) => call<void>('voice.send', message),
  voiceActive: (on: boolean) => call<void>('voice.active', { on }),
  voiceNotify: (title: string, body: string) => call<void>('voice.notify', { title, body }),
  onVoice: (handler: (message: any) => void) => bridge.on('voice', handler),
  onVoiceKey: (handler: (e: { action: string }) => void) => bridge.on('voice-key', handler),

  
  onInstallProgress: (handler: (p: InstallProgress) => void) => bridge.on('install-progress', handler),
  onGameLog: (handler: (l: GameLog) => void) => bridge.on('game-log', handler),
  onGameCrash: (handler: (c: GameCrash) => void) => bridge.on('game-crash', handler),
  onContent: (handler: (c: Content) => void) => bridge.on('content-updated', handler),
  onLauncherUpdate: (handler: (u: LauncherUpdate) => void) => bridge.on('launcher-update', handler),

  
  crashAutofixDisable: (id: string, nameHints: string[]) =>
    call<string | null>('crash.autofixDisable', { id, nameHints }),
  showCrashReport: (path: string) => call<void>('crash.showReport', { path }),
  crashAutofixUpdate: (id: string, nameHints: string[]) =>
    call<{ file: string; filename: string; from: string; to: string } | null>('crash.autofixUpdate', { id, nameHints }),
};
