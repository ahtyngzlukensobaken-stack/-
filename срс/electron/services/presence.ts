const noPresenceClient = (): any => new Proxy({}, { get: () => () => undefined });
import { Client, type SetActivity } from '@xhayper/discord-rpc';
import { load } from './store.js';




const CLIENT_ID = '';

let client: Client | null = null;
let ready = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

const wanted = (): boolean => load().settings.discordStatus !== false;

function scheduleReconnect(): void {
  if (reconnectTimer || !wanted()) return;
  
  reconnectTimer = setTimeout(() => { reconnectTimer = null; void connect(); }, 20_000);
}

async function connect(): Promise<void> {
  if (client || !wanted()) return;
  const next = noPresenceClient();
  
  
  client = next;
  next.on('ready', () => {
    ready = true;
    
    
    void setIdle();
  });
  next.on('disconnected', () => {
    ready = false;
    client = null;
    scheduleReconnect();
  });
  try {
    await next.login();
    
    
    
    
    const socket = (next.transport as unknown as { socket?: NodeJS.EventEmitter }).socket;
    socket?.on('error', () => {  });
  } catch {
    
    client = null;
    scheduleReconnect();
  }
}


export function init(): void {
  void connect();
}


export async function setEnabled(on: boolean): Promise<void> {
  if (on) { void connect(); return; }
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  const current = client;
  client = null;
  ready = false;
  if (!current) return;
  current.removeAllListeners('disconnected');
  try {
    await current.user?.clearActivity();
    await current.destroy();
  } catch {
    
  }
}

export async function setActivity(activity: SetActivity): Promise<void> {
  if (!ready || !client?.user || !wanted()) return;
  try {
    await client.user.setActivity({ instance: true, ...activity });
  } catch {
    
  }
}

const bootedAt = Date.now();


export async function setIdle(): Promise<void> {
  await setActivity({
    details: 'В лаунчере',
    largeImageKey: 'logo',
    largeImageText: 'Power Launcher',
    startTimestamp: bootedAt,
  });
}
