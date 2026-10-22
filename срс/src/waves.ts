


export const WAVE_TTL = 2 * 24 * 3600_000;


export function waveApplies(wave: string, firstSeen: number, now: number, seen: string | null): boolean {
  const started = Number(wave);
  if (!wave || !Number.isFinite(started) || started <= 0) return false;
  if (started < firstSeen) return false;
  if (started > now + 3600_000 || now - started > WAVE_TTL) return false;
  return seen !== wave;
}
