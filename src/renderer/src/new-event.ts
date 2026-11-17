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
