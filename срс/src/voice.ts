import { api } from './api.js';
import { denoise, NOISE_MODES, type NoiseMode } from './denoise.js';



export type VoiceRoom = string;

interface Peer {
  uuid: string;
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  
  gain: GainNode | null;
  
  pending: RTCIceCandidateInit[];
  
  offerer: boolean;
  level: () => number;
  speaking: boolean;
  state: 'connecting' | 'connected' | 'lost';
  restartTimer: number | null;
}

interface Call {
  room: VoiceRoom;
  stream: MediaStream;
  peers: Map<string, Peer>;
  startedAt: number;
  
  waiting: boolean;
  waitTimer: number | null;
  myLevel: () => number;
  meSpeaking: boolean;
  
  outgoing: boolean;
  answered: boolean;
}

export interface VoiceView {
  room: VoiceRoom | null;
  waiting: boolean;
  muted: boolean;
  deafened: boolean;
  startedAt: number;
  peers: { uuid: string; speaking: boolean; state: Peer['state']; volume: number }[];
  meSpeaking: boolean;
  
  ringing: { room: VoiceRoom; from: string } | null;
  
  rooms: Map<VoiceRoom, string[]>;
  joining: boolean;
}

const RING_TIMEOUT = 45_000;

const BITRATE = 40_000;
const SAVED_KEY = 'pv-voice';

let call: Call | null = null;
let joining = false;
let ringing: { room: VoiceRoom; from: string; timer: number } | null = null;
const rooms = new Map<VoiceRoom, string[]>();
const listeners = new Set<() => void>();
let meterTimer: number | null = null;
let ringtone: { stop: () => void } | null = null;
let audioContext: AudioContext | null = null;
let nameOf: (uuid: string) => string = () => 'Друг';

let sendRecord: (uuid: string, text: string) => void = (uuid, text) => { void api.socialSend(uuid, text).catch(() => undefined); };

interface Saved {
  muted: boolean;
  deafened: boolean;
  volumes: Record<string, number>;
  
  input: string;
  output: string;
  
  noise: NoiseMode;
}
const saved: Saved = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '{}') as Partial<Omit<Saved, 'noise'>> & { noise?: unknown };
    
    const noise: NoiseMode = raw.noise === false ? 'off'
      : NOISE_MODES.includes(raw.noise as NoiseMode) ? raw.noise as NoiseMode : 'rnnoise';
    return {
      muted: Boolean(raw.muted), deafened: false, volumes: raw.volumes ?? {},
      input: raw.input ?? '', output: raw.output ?? '', noise,
    };
  } catch {
    return { muted: false, deafened: false, volumes: {}, input: '', output: '', noise: 'rnnoise' };
  }
})();
function save(): void {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify({
      muted: saved.muted, volumes: saved.volumes, input: saved.input, output: saved.output, noise: saved.noise,
    }));
  } catch {  }
}


let master: GainNode | null = null;

export function onVoiceChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed(): void {
  for (const listener of [...listeners]) listener();
}

export function voiceView(): VoiceView {
  return {
    room: call?.room ?? null,
    waiting: call?.waiting ?? false,
    muted: saved.muted,
    deafened: saved.deafened,
    startedAt: call?.startedAt ?? 0,
    peers: call ? [...call.peers.values()].map((p) => ({ uuid: p.uuid, speaking: p.speaking, state: p.state, volume: saved.volumes[p.uuid] ?? 1 })) : [],
    meSpeaking: call?.meSpeaking ?? false,
    ringing: ringing ? { room: ringing.room, from: ringing.from } : null,
    rooms,
    joining,
  };
}

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };

function context(): AudioContext {
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContext({ latencyHint: 'interactive' });
    master = null;
    applyOutput();
  }
  if (audioContext.state === 'suspended') void audioContext.resume();
  return audioContext;
}

function masterGain(): GainNode {
  const ctx = context();
  if (!master) {
    master = ctx.createGain();
    master.gain.value = saved.deafened ? 0 : 1;
    master.connect(ctx.destination);
  }
  return master;
}


function applyOutput(): void {
  const ctx = audioContext as SinkContext | null;
  if (!ctx?.setSinkId) return;
  void ctx.setSinkId(saved.output || '').catch(() => {
    
    void ctx.setSinkId?.('').catch(() => undefined);
  });
}


function meter(stream: MediaStream): () => number {
  try {
    const ctx = context();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    return () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) { const x = (v - 128) / 128; sum += x * x; }
      return Math.sqrt(sum / data.length);
    };
  } catch {
    return () => 0;
  }
}

function startMeters(): void {
  if (meterTimer) return;
  
  meterTimer = window.setInterval(() => {
    if (!call) return;
    let dirty = false;
    const me = !saved.muted && call.myLevel() > 0.02;
    if (me !== call.meSpeaking) { call.meSpeaking = me; dirty = true; }
    for (const peer of call.peers.values()) {
      const on = peer.level() > 0.02;
      if (on !== peer.speaking) { peer.speaking = on; dirty = true; }
    }
    if (dirty) changed();
  }, 150);
}

function stopMeters(): void {
  if (meterTimer) window.clearInterval(meterTimer);
  meterTimer = null;
}


function tuneSdp(sdp: string): string {
  const match = /a=rtpmap:(\d+) opus\/48000/i.exec(sdp);
  if (!match) return sdp;
  const pt = match[1];
  const want = { useinbandfec: '1', usedtx: '1', stereo: '0', maxaveragebitrate: String(BITRATE) };
  const line = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  if (line.test(sdp)) {
    return sdp.replace(line, (_all, params: string) => {
      const map = new Map(params.split(';').map((p) => p.trim()).filter(Boolean).map((p) => p.split('=') as [string, string]));
      for (const [k, v] of Object.entries(want)) map.set(k, v);
      return `a=fmtp:${pt} ${[...map].map(([k, v]) => `${k}=${v}`).join(';')}`;
    });
  }
  return sdp.replace(match[0], `${match[0]}\r\na=fmtp:${pt} ${Object.entries(want).map(([k, v]) => `${k}=${v}`).join(';')}`);
}

async function capBitrate(pc: RTCPeerConnection): Promise<void> {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== 'audio') continue;
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    const encoding = params.encodings[0]!;
    encoding.maxBitrate = BITRATE;
    encoding.priority = 'high';
    encoding.networkPriority = 'high';
    await sender.setParameters(params).catch(() => undefined);
  }
}


function plain(description: RTCSessionDescription | null): RTCSessionDescriptionInit | null {
  return description ? { type: description.type, sdp: description.sdp } : null;
}

function signal(to: string, data: unknown): void {
  void api.voiceSend({ t: 'signal', to, data }).catch(() => undefined);
}

let iceCache: RTCIceServer[] | null = null;

async function makePeer(uuid: string, offerer: boolean): Promise<Peer> {
  if (!call) throw new Error('no call');
  const iceServers = iceCache ?? (iceCache = await api.voiceIce());
  
  const relay = !(globalThis as { __pvVoiceTest?: boolean }).__pvVoiceTest;
  const pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: relay ? 'relay' : 'all', bundlePolicy: 'max-bundle' });
  
  
  const audio = new Audio();
  audio.autoplay = true;
  audio.muted = true;
  const peer: Peer = { uuid, pc, audio, gain: null, pending: [], offerer, level: () => 0, speaking: false, state: 'connecting', restartTimer: null };

  for (const track of call.stream.getAudioTracks()) pc.addTrack(track, call.stream);
  pc.addEventListener('track', (event) => {
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    audio.srcObject = stream;
    void audio.play().catch(() => undefined);
    try {
      const ctx = context();
      peer.gain?.disconnect();
      const gain = ctx.createGain();
      gain.gain.value = saved.volumes[uuid] ?? 1;
      ctx.createMediaStreamSource(stream).connect(gain);
      gain.connect(masterGain());
      peer.gain = gain;
    } catch {
      
      audio.muted = saved.deafened;
    }
    peer.level = meter(stream);
  });
  pc.addEventListener('icecandidate', (event) => {
    if (event.candidate) signal(uuid, { candidate: event.candidate.toJSON() });
  });
  pc.addEventListener('connectionstatechange', () => {
    const s = pc.connectionState;
    if (s === 'connected') {
      peer.state = 'connected';
      if (peer.restartTimer) { window.clearTimeout(peer.restartTimer); peer.restartTimer = null; }
      void capBitrate(pc);
    } else if (s === 'disconnected' || s === 'failed') {
      peer.state = 'lost';
      
      if (peer.offerer && !peer.restartTimer) {
        peer.restartTimer = window.setTimeout(() => {
          peer.restartTimer = null;
          if (pc.connectionState === 'connected' || call?.peers.get(uuid) !== peer) return;
          void offer(peer, true);
        }, s === 'failed' ? 0 : 3000);
      }
    }
    changed();
  });
  return peer;
}

async function offer(peer: Peer, restart = false): Promise<void> {
  try {
    const description = await peer.pc.createOffer({ iceRestart: restart, offerToReceiveAudio: true });
    description.sdp = tuneSdp(description.sdp ?? '');
    await peer.pc.setLocalDescription(description);
    signal(peer.uuid, { sdp: plain(peer.pc.localDescription) });
  } catch {  }
}

function dropPeer(uuid: string): void {
  const peer = call?.peers.get(uuid);
  if (!peer) return;
  if (peer.restartTimer) window.clearTimeout(peer.restartTimer);
  try { peer.pc.close(); } catch {  }
  peer.audio.srcObject = null;
  peer.gain?.disconnect();
  call?.peers.delete(uuid);
}

async function onSignal(from: string, data: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }): Promise<void> {
  if (!call) return;
  let peer = call.peers.get(from);
  if (data.sdp?.type === 'offer') {
    
    if (!peer || peer.offerer) {
      dropPeer(from);
      peer = await makePeer(from, false);
      if (!call) return;
      call.peers.set(from, peer);
    }
    await peer.pc.setRemoteDescription({ type: 'offer', sdp: tuneSdp(data.sdp.sdp ?? '') });
    const answer = await peer.pc.createAnswer();
    answer.sdp = tuneSdp(answer.sdp ?? '');
    await peer.pc.setLocalDescription(answer);
    signal(from, { sdp: plain(peer.pc.localDescription) });
    for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => undefined);
    changed();
  } else if (data.sdp?.type === 'answer' && peer) {
    await peer.pc.setRemoteDescription({ type: 'answer', sdp: tuneSdp(data.sdp.sdp ?? '') }).catch(() => undefined);
    for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => undefined);
  } else if (data.candidate && peer) {
    if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => undefined);
    else peer.pending.push(data.candidate);
  }
}


const releases = new WeakMap<MediaStream, () => void>();

function dropMicrophone(stream: MediaStream): void {
  const release = releases.get(stream);
  if (release) release();
  else for (const track of stream.getTracks()) track.stop();
}

async function microphone(): Promise<MediaStream> {
  const { stream, release } = await denoise(await rawMicrophone(), saved.noise);
  releases.set(stream, release);
  return stream;
}

async function rawMicrophone(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        
        deviceId: saved.input ? { ideal: saved.input } : undefined,
        echoCancellation: true,
        
        noiseSuppression: false,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: 48000,
      },
      video: false,
    });
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === 'NotFoundError') throw new Error('Микрофон не найден. Подключи его и попробуй снова.');
    if (name === 'NotAllowedError') {
      throw new Error('Windows не даёт доступ к микрофону. Параметры → Конфиденциальность → Микрофон: разреши доступ классическим приложениям.');
    }
    if (name === 'NotReadableError') throw new Error('Микрофон занят другой программой или выключен в Windows.');
    throw new Error('Не получилось включить микрофон.');
  }
}


export async function joinVoice(room: VoiceRoom): Promise<void> {
  if (call?.room === room || joining) return;
  joining = true;
  changed();
  try {
    if (call) leaveVoice();
    
    iceCache = await api.voiceIce();
    const stream = await microphone();
    for (const track of stream.getAudioTracks()) track.enabled = !saved.muted;
    const outgoing = room.startsWith('dm:') && ringing?.room !== room && !(rooms.get(room)?.length);
    call = {
      outgoing,
      answered: false,
      room,
      stream,
      peers: new Map(),
      startedAt: Date.now(),
      waiting: room.startsWith('dm:'),
      waitTimer: null,
      myLevel: meter(stream),
      meSpeaking: false,
    };
    if (ringing?.room === room) stopRinging();
    if (call.waiting) {
      
      ringtone = tone('outgoing');
      call.waitTimer = window.setTimeout(() => {
        if (call?.room === room && call.waiting) { leaveVoice(); notice('Друг не ответил.'); }
      }, RING_TIMEOUT);
    }
    await api.voiceSend({ t: 'voice-join', room });
    void api.voiceActive(true);
    startMeters();
  } catch (error) {
    if (call) leaveVoice();
    throw error;
  } finally {
    joining = false;
    changed();
  }
}

export function leaveVoice(): void {
  if (!call) return;
  endLocal();
  void api.voiceSend({ t: 'voice-leave' }).catch(() => undefined);
}


function endLocal(): void {
  if (!call) return;
  const was = call;
  call = null;
  if (was.waitTimer) window.clearTimeout(was.waitTimer);
  stopTone();
  for (const peer of was.peers.values()) {
    if (peer.restartTimer) window.clearTimeout(peer.restartTimer);
    try { peer.pc.close(); } catch {  }
    peer.audio.srcObject = null;
    peer.gain?.disconnect();
  }
  dropMicrophone(was.stream);
  stopMeters();
  recordCall(was);
  void api.voiceActive(false);
  if (!ringing) beep('end');
  changed();
}

export function toggleMute(): void {
  saved.muted = !saved.muted;
  
  if (!saved.muted && saved.deafened) setDeafened(false);
  if (call) for (const track of call.stream.getAudioTracks()) track.enabled = !saved.muted;
  save();
  beep(saved.muted ? 'off' : 'on');
  changed();
}

function setDeafened(on: boolean): void {
  saved.deafened = on;
  if (master) master.gain.value = on ? 0 : 1;
  if (call) for (const peer of call.peers.values()) if (!peer.gain) peer.audio.muted = on;
}


export function toggleDeafen(): void {
  setDeafened(!saved.deafened);
  if (saved.deafened && !saved.muted) {
    saved.muted = true;
    if (call) for (const track of call.stream.getAudioTracks()) track.enabled = false;
  }
  save();
  beep(saved.deafened ? 'off' : 'on');
  changed();
}


export function setPeerVolume(uuid: string, volume: number): void {
  const value = Math.max(0, Math.min(2, volume));
  saved.volumes[uuid] = value;
  const peer = call?.peers.get(uuid);
  if (peer?.gain) peer.gain.gain.setTargetAtTime(value, peer.gain.context.currentTime, 0.02);
  else if (peer) peer.audio.volume = Math.min(1, value);
  save();
}



export interface VoiceDevices { inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }


export async function listDevices(): Promise<VoiceDevices> {
  let devices = await navigator.mediaDevices.enumerateDevices();
  if (devices.some((d) => d.kind === 'audioinput' && !d.label)) {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of probe.getTracks()) track.stop();
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {  }
  }
  const real = (d: MediaDeviceInfo) => d.deviceId !== 'default' && d.deviceId !== 'communications';
  return {
    inputs: devices.filter((d) => d.kind === 'audioinput' && real(d)),
    outputs: devices.filter((d) => d.kind === 'audiooutput' && real(d)),
  };
}

export function voiceSettings(): { input: string; output: string; noise: NoiseMode; canPickOutput: boolean } {
  return {
    input: saved.input,
    output: saved.output,
    noise: saved.noise,
    canPickOutput: typeof (AudioContext.prototype as SinkContext).setSinkId === 'function',
  };
}


export async function setInput(deviceId: string): Promise<void> {
  saved.input = deviceId;
  save();
  await reopenMicrophone();
}

export async function setNoise(mode: NoiseMode): Promise<void> {
  saved.noise = mode;
  save();
  await reopenMicrophone();
}

export function setOutput(deviceId: string): void {
  saved.output = deviceId;
  save();
  applyOutput();
}

async function reopenMicrophone(): Promise<void> {
  if (!call) return;
  const was = call;
  const stream = await microphone();
  if (call !== was) { dropMicrophone(stream); return; }
  const track = stream.getAudioTracks()[0] ?? null;
  if (track) track.enabled = !saved.muted;
  for (const peer of call.peers.values()) {
    for (const sender of peer.pc.getSenders()) {
      if (sender.track?.kind === 'audio' || (!sender.track && track)) await sender.replaceTrack(track).catch(() => undefined);
    }
  }
  dropMicrophone(call.stream);
  call.stream = stream;
  call.myLevel = meter(stream);
}


export async function micTest(): Promise<{ level: () => number; stop: () => void }> {
  const stream = await microphone();
  const level = meter(stream);
  return { level, stop: () => dropMicrophone(stream) };
}

export function declineRing(): void {
  if (!ringing) return;
  void api.voiceSend({ t: 'voice-decline', room: ringing.room }).catch(() => undefined);
  stopRinging();
}

function stopRinging(): void {
  if (!ringing) return;
  window.clearTimeout(ringing.timer);
  ringing = null;
  stopTone();
  if (!call && !joining) void api.voiceActive(false);
  changed();
}




function tone(kind: 'incoming' | 'outgoing'): { stop: () => void } {
  stopTone();
  const ctx = context();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  const notes = kind === 'incoming' ? [659, 784] : [440];
  const oscillators = notes.map((f) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(gain); o.start(); return o; });
  const volume = kind === 'incoming' ? 0.12 : 0.05;
  let on = false;
  const pattern = kind === 'incoming' ? [400, 200, 400, 1600] : [1000, 3000];
  let i = 0;
  let timer = 0;
  const step = (): void => {
    on = i % 2 === 0;
    gain.gain.setTargetAtTime(on ? volume : 0, ctx.currentTime, 0.015);
    timer = window.setTimeout(step, pattern[i % pattern.length]);
    i++;
  };
  step();
  const handle = {
    stop: () => {
      window.clearTimeout(timer);
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      window.setTimeout(() => { for (const o of oscillators) o.stop(); gain.disconnect(); }, 150);
    },
  };
  ringtone = handle;
  return handle;
}

function stopTone(): void {
  ringtone?.stop();
  ringtone = null;
}


function beep(kind: 'join' | 'leave' | 'on' | 'off' | 'end'): void {
  try {
    const ctx = context();
    const freqs = { join: [520, 780], leave: [780, 520], on: [600, 900], off: [900, 600], end: [600, 400] }[kind];
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freqs[0]!, t);
    o.frequency.setValueAtTime(freqs[1]!, t + 0.12);
    o.connect(gain);
    o.start(t);
    o.stop(t + 0.3);
  } catch {  }
}

let noticeHandler: (text: string) => void = () => undefined;
function notice(text: string): void {
  noticeHandler(text);
}




export function initVoice(options: {
  names: (uuid: string) => string;
  toast: (text: string, bad?: boolean) => void;
  record?: (uuid: string, text: string) => void;
}): void {
  nameOf = options.names;
  if (options.record) sendRecord = options.record;
  noticeHandler = (text) => options.toast(text);
  api.onVoiceKey(({ action }) => { if (action === 'mute' && call) toggleMute(); });
  api.onVoice((message: Record<string, any>) => {
    void handle(message).catch(() => undefined);
  });
  
  window.addEventListener('beforeunload', () => { if (call) leaveVoice(); });
}

async function handle(m: Record<string, any>): Promise<void> {
  switch (m.t) {
    case 'hub-open':
      
      if (call) await api.voiceSend({ t: 'voice-join', room: call.room }).catch(() => undefined);
      return;
    case 'voice-peers': {
      if (!call || m.room !== call.room) return;
      const peers: string[] = m.peers ?? [];
      
      for (const uuid of [...call.peers.keys()]) if (!peers.includes(uuid)) dropPeer(uuid);
      for (const uuid of peers) {
        dropPeer(uuid);
        const peer = await makePeer(uuid, true);
        if (!call) return;
        call.peers.set(uuid, peer);
        await offer(peer);
      }
      if (peers.length && call.waiting) answered();
      changed();
      return;
    }
    case 'voice-joined': {
      if (!call || m.room !== call.room) return;
      
      dropPeer(m.uuid);
      if (call.waiting) answered();
      else beep('join');
      changed();
      return;
    }
    case 'voice-left': {
      if (!call || m.room !== call.room) return;
      dropPeer(m.uuid);
      if (call.room.startsWith('dm:')) {
        leaveVoice();
        notice(`${nameOf(m.uuid)} завершил звонок.`);
      } else {
        beep('leave');
      }
      changed();
      return;
    }
    case 'voice-kicked':
      if (call && (!m.room || m.room === call.room)) {
        // Хаб уже вывел нас из канала - voice-leave не шлём, просто гасим всё у себя.
        endLocal();
        notice('Звонок продолжился на другом компьютере или тебя убрали из группы.');
      }
      return;
    case 'voice-declined':
      if (call && m.room === call.room && call.waiting) {
        leaveVoice();
        notice(m.reason === 'dnd'
          ? `У ${nameOf(String(m.room).slice(3))} «Не беспокоить».`
          : `${nameOf(String(m.room).slice(3))} сейчас не может ответить.`);
      }
      return;
    case 'voice-error':
      if (call && (m.room === call.room || !m.room)) leaveVoice();
      notice(String(m.message ?? 'Звонок не удался.'));
      return;
    case 'ring': {
      if (call?.room === m.room) return;
      if (ringing) window.clearTimeout(ringing.timer);
      ringing = {
        room: m.room,
        from: m.from,
        timer: window.setTimeout(() => stopRinging(), RING_TIMEOUT),
      };
      // Во время звонка не трезвоним поверх разговора - только показываем.
      if (!call) {
        // Окно может быть спрятано на время игры: без этого мелодия «заикалась» бы.
        void api.voiceActive(true);
        tone('incoming');
      }
      void api.voiceNotify('Входящий звонок', `${nameOf(m.from)} звонит тебе в Power Launcher`);
      changed();
      return;
    }
    case 'ring-cancel':
      if (ringing?.room === m.room) {
        stopRinging();
        notice(`Пропущенный звонок: ${nameOf(m.room.slice(3))}`);
      }
      return;
    case 'voice-room':
      if (Array.isArray(m.members) && m.members.length) rooms.set(m.room, m.members);
      else rooms.delete(m.room);
      changed();
      return;
    case 'signal':
      if (call && typeof m.from === 'string') await onSignal(m.from, m.data ?? {});
      return;
  }
}

/*
 * Запись о личном звонке в переписке. Пишет звонивший, обычным сообщением: так её видят
 * оба и на любом компьютере, а старые лаунчеры показывают просто текст.
 */
const CALL_MESSAGE = /^📞 Звонок(?: · (?:(\d+):)?(\d{1,2}):(\d{2})| без ответа)$/;

export function parseCallMessage(text: string): { answered: boolean; seconds: number } | null {
  const match = CALL_MESSAGE.exec(text);
  if (!match) return null;
  if (match[3] === undefined) return { answered: false, seconds: 0 };
  return { answered: true, seconds: Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]) };
}

function recordCall(was: Call): void {
  if (!was.outgoing || !was.room.startsWith('dm:')) return;
  let text = '📞 Звонок без ответа';
  if (was.answered) {
    const total = Math.max(1, Math.round((Date.now() - was.startedAt) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    text = `📞 Звонок · ${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${s}`;
  }
  sendRecord(was.room.slice(3), text);
}

/** Собеседник ответил: гудки прекращаются, время звонка пошло. */
function answered(): void {
  if (!call) return;
  call.waiting = false;
  call.answered = true;
  call.startedAt = Date.now();
  if (call.waitTimer) window.clearTimeout(call.waitTimer);
  call.waitTimer = null;
  stopTone();
  beep('join');
}
