import type { DeckFit } from '../../../shared/canvas'

/** Names and hints of the display modes, for the deck menu and the Deck settings section. */
export const FIT_NAMES: Record<DeckFit, { name: string; hint: string }> = {
  fit: { name: 'Fit', hint: 'Whole slide, black bars where the shapes differ' },
  fill: { name: 'Fill', hint: 'Fills the canvas, edges may be cropped' },
  stretch: { name: 'Stretch', hint: 'Fills the canvas, the picture is distorted' }
}
