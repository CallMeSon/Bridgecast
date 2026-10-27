/** Sound level of one deck: integer volume 0–100 and a mute flag. */
export interface DeckAudio {
  volume: number
  muted: boolean
}

export const DEFAULT_DECK_AUDIO: Readonly<DeckAudio> = Object.freeze({ volume: 100, muted: false })

/**
 * Any value → an integer 0–100. Numbers are rounded and clamped; anything
 * else (missing field in an older file, garbage) gives `fallback`.
 */
export function sanitizeVolume(raw: unknown, fallback = 100): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.min(100, Math.max(0, Math.round(raw)))
}

/** Any parsed JSON → valid DeckAudio; a deck saved before levels existed gets the defaults. */
export function sanitizeDeckAudio(raw: unknown): DeckAudio {
  const a =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  return {
    volume: sanitizeVolume(a.volume, DEFAULT_DECK_AUDIO.volume),
    muted: typeof a.muted === 'boolean' ? a.muted : DEFAULT_DECK_AUDIO.muted
  }
}

/**
 * Gain (0–1) to apply to a deck's sound: 0 when the deck or the master is
 * muted, else deck volume times master volume.
 */
export function effectiveGain(
  deck: DeckAudio,
  master: { masterVolume: number; muted: boolean }
): number {
  if (deck.muted || master.muted) return 0
  return (deck.volume / 100) * (master.masterVolume / 100)
}
