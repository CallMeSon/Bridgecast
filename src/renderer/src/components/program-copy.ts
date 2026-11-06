import type { ProgramState } from '../../../shared/program'
import type { DeckMeta } from '../../../shared/types'
import type { tally } from '../model'

/** The card on the monitor while nothing is on air: what is missing, or what Next does. */
export function standbyCard(
  deck: DeckMeta | null,
  index: number,
  emptyHint: string
): { title: string; sub?: string } {
  if (!deck || (deck.source !== 'web' && deck.slides.length === 0)) {
    return { title: 'No slides yet', sub: emptyHint }
  }
  if (deck.source === 'web') {
    return { title: 'Standby', sub: 'Press Space to put this page on air.' }
  }
  return { title: 'Standby', sub: `Press Space to put slide ${index + 1} on air.` }
}

/** One sentence: what the audience sees right now. */
export function audienceNote(
  state: ProgramState,
  t: ReturnType<typeof tally>,
  isWeb: boolean
): string {
  const n = (state.shown?.index ?? 0) + 1
  switch (t) {
    case 'live':
      return isWeb ? 'Audience sees the web page' : `Audience sees slide ${n}`
    case 'frozen':
      return isWeb ? 'Audience sees the web page, held' : `Audience sees slide ${n}, held`
    case 'black':
      return 'Audience sees black'
    case 'kv':
      return 'Audience sees the key visual'
    default:
      return 'Audience sees the standby card'
  }
}
