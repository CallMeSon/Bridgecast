/** Quietest level the meter shows (dBFS); below it the bar rests empty. */
export const METER_FLOOR_DB = -60

/** Root-mean-square of a block of samples (0 for an empty block). */
export function rms(samples: ArrayLike<number>): number {
  let sum = 0
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
  return samples.length ? Math.sqrt(sum / samples.length) : 0
}

/** Linear level (0–1) → bar fill (0–1) on a dB scale from METER_FLOOR_DB to 0. */
export function meterFill(level: number): number {
  if (!(level > 0)) return 0
  const db = 20 * Math.log10(level)
  return Math.min(1, Math.max(0, 1 - db / METER_FLOOR_DB))
}

/** The bar jumps up at once and falls back at `fall` per call, so a short sound stays visible. */
export function meterStep(prev: number, next: number, fall = 0.06): number {
  return next >= prev ? next : Math.max(next, prev - fall)
}
