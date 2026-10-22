import { GtcrnWorkletNode, RnnoiseWorkletNode } from '@sapphi-red/web-noise-suppressor';
import rnnoiseWorklet from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?raw';
import gtcrnWorklet from '@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?raw';
import rnnoiseWasm from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?inline';
import gtcrnWasm from '@sapphi-red/web-noise-suppressor/gtcrn.wasm?inline';



export type NoiseMode = 'off' | 'rnnoise' | 'gtcrn';
export const NOISE_MODES: NoiseMode[] = ['rnnoise', 'gtcrn', 'off'];

let micContext: AudioContext | null = null;
const loaded = new Set<NoiseMode>();

function bytes(dataUrl: string): ArrayBuffer {
  const text = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out.buffer;
}

function stopAll(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}


export async function denoise(raw: MediaStream, mode: NoiseMode): Promise<{ stream: MediaStream; release: () => void }> {
  if (mode === 'off') return { stream: raw, release: () => stopAll(raw) };
  try {
    
    if (!micContext || micContext.state === 'closed') {
      micContext = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      loaded.clear();
    }
    const ctx = micContext;
    if (ctx.state === 'suspended') await ctx.resume();
    if (!loaded.has(mode)) {
      const url = URL.createObjectURL(new Blob([mode === 'gtcrn' ? gtcrnWorklet : rnnoiseWorklet], { type: 'text/javascript' }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      loaded.add(mode);
    }
    
    const node = mode === 'gtcrn'
      ? new GtcrnWorkletNode(ctx, { maxChannels: 1, wasmBinary: bytes(gtcrnWasm) })
      : new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: bytes(rnnoiseWasm) });
    const source = ctx.createMediaStreamSource(raw);
    const destination = ctx.createMediaStreamDestination();
    destination.channelCount = 1;
    source.connect(node).connect(destination);
    return {
      stream: destination.stream,
      release: () => {
        source.disconnect();
        node.disconnect();
        node.destroy();
        stopAll(destination.stream);
        stopAll(raw);
      },
    };
  } catch (error) {
    console.warn('шумоподавление не включилось', error);
    return { stream: raw, release: () => stopAll(raw) };
  }
}
