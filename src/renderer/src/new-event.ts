import { CANVAS_INVALID, CANVAS_PRESETS, sanitizeCanvas, type Canvas } from '../../shared/canvas'

/** Longest event name the New event dialog accepts (same cap the tab bar field had). */
export const EVENT_NAME_MAX = 60

export type EventNameCheck = { ok: true; name: string } | { ok: false; error: string }

/** Trims and checks a typed event name. Characters are counted as the person sees them. */
export function checkEventName(raw: string, existing: readonly string[] = []): EventNameCheck {
  const name = raw.trim()
  if (!name) return { ok: false, error: 'Type a name for the event.' }
  if ([...name].length > EVENT_NAME_MAX) {
    return { ok: false, error: `Use ${EVENT_NAME_MAX} characters or fewer.` }
  }
  const lower = name.toLocaleLowerCase()
  if (existing.some((e) => e.trim().toLocaleLowerCase() === lower)) {
    return { ok: false, error: 'An event with this name already exists. Pick another name.' }
  }
  return { ok: true, name }
}

/** What the New event dialog needs to know about a picked file. */
export interface DeckFileLike {
  name: string
  size: number
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Adds picked or dropped files to the dialog's list: only PPTX, PPT and PDF are kept, a file
 * already listed (same name and size) is not added twice, and the list stays in natural name
 * order ("2 Opening" before "10 Closing"). `skipped` counts the files that cannot be imported.
 */
export function addDeckFiles<T extends DeckFileLike>(
  current: readonly T[],
  added: readonly T[]
): { files: T[]; skipped: number } {
  const files = [...current]
  let skipped = 0
  for (const f of added) {
    if (!/\.(pptx?|pdf)$/i.test(f.name)) {
      skipped++
      continue
    }
    if (files.some((x) => x.name === f.name && x.size === f.size)) continue
    files.push(f)
  }
  files.sort((a, b) => byName.compare(a.name, b.name))
  return { files, skipped }
}

const PRESET_NAMES: Record<string, string> = {
  '1920x1080': 'Full HD',
  '3840x2160': '4K UHD',
  '1280x720': 'HD'
}

const size = (c: Canvas): string => `${c.width}×${c.height}`

/** One entry of the New event dialog's Canvas list. */
export interface CanvasChoice {
  /** `default`, `match`, `custom`, or a preset as `WIDTHxHEIGHT`. */
  value: string
  label: string
  disabled?: boolean
}

/**
 * The Canvas list of the New event dialog: the machine default first (the event then follows
 * it), the presets, the HDMI display's own size and Custom. `display` is the HDMI target's
 * canvas, or null when no display is connected (or it is too large).
 */
export function canvasChoices(machine: Canvas | null, display: Canvas | null): CanvasChoice[] {
  return [
    { value: 'default', label: machine ? `Default (${size(machine)})` : 'Default' },
    ...CANVAS_PRESETS.map((c) => ({
      value: `${c.width}x${c.height}`,
      label: `${PRESET_NAMES[`${c.width}x${c.height}`] ?? 'Preset'} (${size(c)})`
    })),
    display
      ? { value: 'match', label: `Match HDMI display (${size(display)})` }
      : { value: 'match', label: 'Match HDMI display (not connected)', disabled: true },
    { value: 'custom', label: 'Custom size' }
  ]
}

export type CanvasChoiceResult = { ok: true; canvas: Canvas | null } | { ok: false; error: string }

/**
 * The canvas a choice stands for; null = follow the machine default. A custom size is rounded
 * down to even sides and checked like every other canvas.
 */
export function canvasOfChoice(
  choice: string,
  custom: { width: string; height: string },
  display: Canvas | null
): CanvasChoiceResult {
  if (choice === 'default') return { ok: true, canvas: null }
  const raw =
    choice === 'match'
      ? display
      : choice === 'custom'
        ? { width: Number(custom.width), height: Number(custom.height) }
        : (CANVAS_PRESETS.find((c) => `${c.width}x${c.height}` === choice) ?? null)
  const canvas = sanitizeCanvas(raw)
  return canvas ? { ok: true, canvas } : { ok: false, error: CANVAS_INVALID }
}
