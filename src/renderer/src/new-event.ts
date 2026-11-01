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
