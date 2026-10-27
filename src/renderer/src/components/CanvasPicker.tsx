import { useEffect, useId, useRef, useState } from 'react'
import { CheckIcon, WarningCircleIcon } from '@phosphor-icons/react'
import {
  CANVAS_CHANGE_LIVE,
  CANVAS_DISPLAY_TOO_LARGE,
  CANVAS_INVALID,
  CANVAS_NO_HDMI,
  CANVAS_PRESETS,
  canvasLabel,
  displayCanvas,
  sanitizeCanvas,
  type Canvas
} from '../../../shared/canvas'
import type { DisplayInfo } from '../../../shared/displays'
import { OMT_RECEIVERS_CONFIRM } from '../../../shared/omt'
import { errorMessage } from '../model'

interface PickerProps {
  /** The canvas in force; null = "Use default" (an event without an override). */
  value: Canvas | null
  /** Offer "Use default" (events only; the machine default always has a size). */
  allowDefault: boolean
  /** The HDMI target display, or null when none is connected. */
  hdmiDisplay: DisplayInfo | null
  onChange(c: Canvas | null): void
}

const PRESET_NAMES: Record<string, string> = {
  '1920x1080': 'Full HD',
  '3840x2160': '4K UHD',
  '1280x720': 'HD'
}

const same = (a: Canvas | null, b: Canvas | null): boolean =>
  a === b || (!!a && !!b && a.width === b.width && a.height === b.height)

const size = (c: Canvas): string => `${c.width}×${c.height}`

interface Option {
  key: string
  label: string
  /** Numbers on the right, set in mono. */
  meta?: string
  /** Why the option cannot be used; shown in the row, which is disabled. */
  unavailable?: string
  canvas: Canvas | null
}

/**
 * Canvas size choice: Use default, the presets and Match HDMI display as
 * pressed-state buttons (each is a Tab stop; Enter or Space chooses, which can
 * ask to confirm a change of what the audience sees), plus a Width and Height
 * pair for a custom size. The chosen button carries a check mark and weight,
 * not colour; when the canvas is none of them, the pair is labelled "current".
 * Custom sizes apply on Enter, or when focus leaves both fields.
 */
export function CanvasPicker({
  value,
  allowDefault,
  hdmiDisplay,
  onChange
}: PickerProps): React.JSX.Element {
  const id = useId()
  const match = displayCanvas(hdmiDisplay)

  const options: Option[] = [
    ...(allowDefault ? [{ key: 'default', label: 'Use default', canvas: null }] : []),
    ...CANVAS_PRESETS.map((c) => ({
      key: `p${c.width}x${c.height}`,
      label: PRESET_NAMES[`${c.width}x${c.height}`] ?? 'Preset',
      meta: size(c),
      canvas: c
    })),
    {
      key: 'match',
      label: 'Match HDMI display',
      meta: match ? size(match) : undefined,
      // A connected display can still be over the pixel budget.
      unavailable: match ? undefined : hdmiDisplay ? CANVAS_DISPLAY_TOO_LARGE : CANVAS_NO_HDMI,
      canvas: match
    }
  ]

  // Exactly one thing is current: default, then a preset, then the display's size, else custom.
  const checked =
    value === null
      ? allowDefault
        ? 'default'
        : null
      : (options.find((o) => o.key !== 'default' && o.key !== 'match' && same(o.canvas, value))
          ?.key ?? (match && same(match, value) ? 'match' : 'custom'))

  const baseW = value ? String(value.width) : ''
  const baseH = value ? String(value.height) : ''
  const [base, setBase] = useState(`${baseW}x${baseH}`)
  const [w, setW] = useState(baseW)
  const [h, setH] = useState(baseH)
  const [invalid, setInvalid] = useState(false)
  const [rounded, setRounded] = useState<Canvas | null>(null)
  // The applied value changed (here or elsewhere): the fields show it, the error goes.
  if (base !== `${baseW}x${baseH}`) {
    setBase(`${baseW}x${baseH}`)
    setW(baseW)
    setH(baseH)
    setInvalid(false)
  }

  const choose = (o: Option): void => {
    if (!same(o.canvas, value)) onChange(o.canvas)
  }

  const commit = (): void => {
    if (w === baseW && h === baseH) return
    const c = sanitizeCanvas({ width: Number(w), height: Number(h) })
    if (!c) {
      setInvalid(true)
      setRounded(null)
      return
    }
    setInvalid(false)
    setW(String(c.width))
    setH(String(c.height))
    setRounded(c.width !== Number(w) || c.height !== Number(h) ? c : null)
    if (!same(c, value)) onChange(c)
  }

  const errorId = `${id}-error`
  const noteId = `${id}-note`

  return (
    <div className="canvas-picker" data-testid="canvas-picker">
      <div className="canvas-opts" role="group" aria-label="Canvas size">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            className="canvas-opt"
            aria-pressed={o.key === checked}
            disabled={!!o.unavailable}
            data-testid={`canvas-opt-${o.key}`}
            onClick={() => choose(o)}
          >
            <CheckIcon
              className="chk"
              size={16}
              style={{ visibility: o.key === checked ? 'visible' : 'hidden' }}
            />
            <span className="nm">{o.label}</span>
            {o.meta && <span className="meta">{o.meta}</span>}
            {o.unavailable && <span className="sub">{o.unavailable}</span>}
          </button>
        ))}
      </div>

      <div className="canvas-custom" role="group" aria-labelledby={`${id}-custom`}>
        <div className="canvas-custom-head" id={`${id}-custom`}>
          <CheckIcon
            className="chk"
            size={16}
            style={{ visibility: checked === 'custom' ? 'visible' : 'hidden' }}
          />
          <span className={checked === 'custom' ? 'on' : undefined}>
            Custom size{checked === 'custom' ? ' (current)' : ''}
          </span>
        </div>
        <div className="canvas-custom-row">
          {(
            [
              ['Width', w, setW],
              ['Height', h, setH]
            ] as const
          ).map(([label, text, set], i) => (
            <div className="field" key={label}>
              <label htmlFor={`${id}-${i}`}>{label}</label>
              <input
                id={`${id}-${i}`}
                className="text-input num"
                type="number"
                inputMode="numeric"
                value={text}
                placeholder={i === 0 ? '1920' : '1080'}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? errorId : rounded ? noteId : undefined}
                data-testid={`canvas-${label.toLowerCase()}`}
                onChange={(e) => {
                  set(e.target.value)
                  setRounded(null)
                  setInvalid(false)
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  commit()
                }}
                // Tabbing from Width to Height is not "done": apply once focus leaves both.
                onBlur={(e) => {
                  if (!e.currentTarget.closest('.canvas-custom-row')?.contains(e.relatedTarget))
                    commit()
                }}
              />
            </div>
          ))}
          <span className="px" aria-hidden="true">
            px
          </span>
        </div>
      </div>
      {invalid && (
        <p id={errorId} className="pop-error" role="alert" data-testid="canvas-invalid">
          {CANVAS_INVALID}
        </p>
      )}
      {rounded && !invalid && (
        <p id={noteId} className="hint" role="status" data-testid="canvas-rounded">
          Sizes are rounded down to even numbers: {size(rounded)}.
        </p>
      )}
    </div>
  )
}

interface SettingProps extends Omit<PickerProps, 'onChange'> {
  /** The show is visible to the audience: ask before changing (see needsCanvasConfirm). */
  confirm: boolean
  /** OMT receivers are connected: the change also resets their picture, so ask even when nothing is on air. */
  omtReceivers?: boolean
  /** The machine canvas that "Use default" applies; shown in the confirm. */
  defaultCanvas?: Canvas | null
  /** Saves the canvas; a rejection is shown under the picker. */
  apply(c: Canvas | null): Promise<void>
}

/**
 * A CanvasPicker plus what every canvas change needs: the confirm while the
 * output shows something, and the error from a rejected save. Cancel leaves
 * everything as it was. Shared by the output popover and the event dialog.
 */
export function CanvasSetting({
  confirm: onAir,
  omtReceivers = false,
  defaultCanvas,
  apply,
  ...picker
}: SettingProps): React.JSX.Element {
  const confirm = onAir || omtReceivers
  const [pending, setPending] = useState<{ canvas: Canvas | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Bumped on Cancel so the picker forgets what was typed.
  const [reset, setReset] = useState(0)
  // Counts confirmed changes that finished (saved or failed).
  const [settled, setSettled] = useState(0)
  const cancel = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)

  /** The current choice (or the first control): where focus belongs after the question. */
  const focusPicker = (): void => {
    const root = box.current
    const to =
      root?.querySelector<HTMLElement>('.canvas-opt[aria-pressed="true"]') ??
      root?.querySelector<HTMLElement>('.canvas-custom input') ??
      root?.querySelector<HTMLElement>('.canvas-opt:not(:disabled)')
    to?.focus()
  }

  // Asking: focus the safe answer (Cancel).
  useEffect(() => {
    if (pending) cancel.current?.focus()
  }, [pending])
  // Cancel or Esc: the picker was rebuilt, focus returns to it.
  useEffect(() => {
    if (reset > 0) focusPicker()
  }, [reset])
  // After Change canvas: the button that had focus is gone. `settled` only
  // moves once the save is over, so by now the picker shows the new canvas
  // (its option is the pressed one, which a screen reader reads); on an error
  // it still shows the old one and the error is announced by its alert.
  useEffect(() => {
    if (settled > 0) focusPicker()
  }, [settled])

  const run = async (c: Canvas | null): Promise<void> => {
    setError(null)
    try {
      await apply(c)
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const dismiss = (): void => {
    setPending(null)
    setReset((n) => n + 1)
  }

  return (
    <div className="canvas-setting" ref={box}>
      {/* inert while asking: the question is the only thing to answer. */}
      <div inert={pending !== null}>
        <CanvasPicker
          key={reset}
          {...picker}
          onChange={(c) => {
            if (confirm) setPending({ canvas: c })
            else void run(c)
          }}
        />
      </div>
      {pending && (
        <div
          className="canvas-confirm"
          role="group"
          aria-label="Confirm canvas change"
          data-no-shortcuts
          data-testid="canvas-confirm"
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return
            e.stopPropagation()
            dismiss()
          }}
        >
          <WarningCircleIcon className="ph" size={20} />
          <p>
            {onAir && <strong>{CANVAS_CHANGE_LIVE}</strong>}
            {omtReceivers && (
              <strong data-testid="canvas-confirm-omt">{OMT_RECEIVERS_CONFIRM}</strong>
            )}
            <span>
              New canvas:{' '}
              <span className="num">
                {pending.canvas
                  ? size(pending.canvas)
                  : defaultCanvas
                    ? canvasLabel({ ...defaultCanvas, origin: 'default' })
                    : 'default'}
              </span>
            </span>
          </p>
          <span className="actions">
            <button
              className="btn sm danger"
              data-testid="canvas-confirm-yes"
              onClick={() => {
                const c = pending.canvas
                setPending(null)
                void run(c).then(() => setSettled((n) => n + 1))
              }}
            >
              Change canvas
            </button>
            <button ref={cancel} className="btn sm" onClick={dismiss}>
              Cancel
            </button>
          </span>
        </div>
      )}
      {error && (
        <p className="pop-error" role="alert" data-testid="canvas-error">
          {error}
        </p>
      )}
    </div>
  )
}
