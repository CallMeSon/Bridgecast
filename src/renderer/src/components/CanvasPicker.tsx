import { useEffect, useId, useRef, useState } from 'react'
import { CheckIcon, WarningCircleIcon } from '@phosphor-icons/react'
import {
  CANVAS_CHANGE_LIVE,
  CANVAS_INVALID,
  CANVAS_NO_HDMI,
  CANVAS_PRESETS,
  displayCanvas,
  sanitizeCanvas,
  type Canvas
} from '../../../shared/canvas'
import type { DisplayInfo } from '../../../shared/displays'
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
  /** Why the option cannot be used; stays focusable so the reason can be read. */
  unavailable?: string
  canvas: Canvas | null
}

/**
 * Canvas size choice: Use default, the presets, Custom width and height, and
 * Match HDMI display. A radio group: the checked row carries a check mark and
 * weight, not colour. Arrow keys only move focus (Space or Enter chooses),
 * because choosing can ask to confirm a change of what the audience sees.
 * Custom sizes apply on Enter, or when focus leaves both fields.
 */
export function CanvasPicker({
  value,
  allowDefault,
  hdmiDisplay,
  onChange
}: PickerProps): React.JSX.Element {
  const id = useId()
  const group = useRef<HTMLDivElement>(null)
  const widthInput = useRef<HTMLInputElement>(null)
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
      unavailable: match ? undefined : CANVAS_NO_HDMI,
      canvas: match
    },
    { key: 'custom', label: 'Custom', canvas: null }
  ]

  // Exactly one row is checked: default, then a preset, then the display's size, else custom.
  const checked =
    value === null
      ? allowDefault
        ? 'default'
        : null
      : (options.find(
          (o) =>
            o.key !== 'custom' && o.key !== 'default' && o.key !== 'match' && same(o.canvas, value)
        )?.key ?? (match && same(match, value) ? 'match' : 'custom'))

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
    if (o.unavailable) return
    if (o.key === 'custom') {
      widthInput.current?.focus()
      widthInput.current?.select()
      return
    }
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

  const onGroupKey = (e: React.KeyboardEvent): void => {
    const rows = [...group.current!.querySelectorAll<HTMLElement>('[role=radio]')]
    const at = rows.indexOf(document.activeElement as HTMLElement)
    const to =
      e.key === 'ArrowDown' || e.key === 'ArrowRight'
        ? (at + 1) % rows.length
        : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
          ? (at - 1 + rows.length) % rows.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? rows.length - 1
              : -1
    if (to < 0 || at < 0) return
    e.preventDefault()
    e.stopPropagation()
    rows[to].focus()
  }

  const tabStop = options.some((o) => o.key === checked) ? checked : options[0].key
  const errorId = `${id}-error`
  const noteId = `${id}-note`

  return (
    <div className="canvas-picker" data-testid="canvas-picker">
      <div
        ref={group}
        className="canvas-opts"
        role="radiogroup"
        aria-label="Canvas size"
        onKeyDown={onGroupKey}
      >
        {options.map((o) => (
          <button
            key={o.key}
            className="canvas-opt"
            role="radio"
            aria-checked={o.key === checked}
            aria-disabled={o.unavailable ? true : undefined}
            tabIndex={o.key === tabStop ? 0 : -1}
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

      <div className="canvas-custom" role="group" aria-label="Custom size">
        {(
          [
            ['Width', w, setW, widthInput],
            ['Height', h, setH, undefined]
          ] as const
        ).map(([label, text, set, ref], i) => (
          <div className="field" key={label}>
            <label htmlFor={`${id}-${i}`}>{label}</label>
            <input
              id={`${id}-${i}`}
              ref={ref}
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
                if (!e.currentTarget.closest('.canvas-custom')?.contains(e.relatedTarget)) commit()
              }}
            />
          </div>
        ))}
        <span className="px" aria-hidden="true">
          px
        </span>
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
  /** Saves the canvas; a rejection is shown under the picker. */
  apply(c: Canvas | null): Promise<void>
}

/**
 * A CanvasPicker plus what every canvas change needs: the confirm while the
 * output shows something, and the error from a rejected save. Cancel leaves
 * everything as it was. Shared by the output popover and the event dialog.
 */
export function CanvasSetting({ confirm, apply, ...picker }: SettingProps): React.JSX.Element {
  const [pending, setPending] = useState<{ canvas: Canvas | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Bumped on Cancel so the picker forgets what was typed.
  const [reset, setReset] = useState(0)
  const cancel = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const asked = useRef(false)

  // Focus goes to Cancel while asking, and back to the picker afterwards: the
  // button that had it is gone, and focus must not fall back to the window.
  useEffect(() => {
    if (pending) {
      asked.current = true
      cancel.current?.focus()
    } else if (asked.current) {
      asked.current = false
      box.current?.querySelector<HTMLElement>('[role=radio][tabindex="0"]')?.focus()
    }
  }, [pending, reset])

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
            <strong>{CANVAS_CHANGE_LIVE}</strong>
            <span>
              New canvas:{' '}
              <span className="num">{pending.canvas ? size(pending.canvas) : 'default'}</span>
            </span>
          </p>
          <span className="actions">
            <button
              className="btn sm danger"
              data-testid="canvas-confirm-yes"
              onClick={() => {
                const c = pending.canvas
                setPending(null)
                void run(c)
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
