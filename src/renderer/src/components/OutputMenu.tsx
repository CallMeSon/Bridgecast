import { BroadcastIcon, MonitorIcon, WarningIcon } from '@phosphor-icons/react'
import { canvasLabel } from '../../../shared/canvas'
import type { ProgramState } from '../../../shared/program'
import { ndiBadge, netShortText, omtBadge } from '../../../shared/omt'
import { hdmiBadge } from '../model'
import type { OutputSettingsState } from './useOutputSettings'

/**
 * The full status (`OMT · 2 receivers`) from 1600 px up; under it the short word (`OMT 2`, CSS
 * `.ind-full` / `.ind-short`). The full text stays in the page, visually hidden, for readers.
 */
function NetText({ full, short }: { full: string; short: string }): React.JSX.Element {
  return (
    <>
      <span className="ind-full">{full}</span>
      <span className="ind-short" aria-hidden="true">
        {short}
      </span>
    </>
  )
}

/**
 * Header output status: HDMI (ok only while its window shows on the second display), OMT,
 * NDI and the canvas now in force. The settings themselves live in the Controls tab of the
 * right panel; pressing this goes there.
 */
export function OutputMenu({
  program,
  out,
  onOpen
}: {
  program: ProgramState
  out: OutputSettingsState
  onOpen(): void
}): React.JSX.Element {
  const { hdmi, displays } = out
  if (!hdmi) {
    return (
      <div className="output-menu">
        <span className="output-btn" data-tone="off">
          <MonitorIcon size={16} />
          <span>HDMI</span>
        </span>
      </div>
    )
  }

  const badge = hdmiBadge(out.status, hdmi)
  // The screen the output window is on: shown only while it really is showing.
  const target = badge.tone === 'ok' ? displays.find((d) => d.id === hdmi.displayId) : undefined
  const omtTone = omtBadge(out.omtStatus)
  const ndiTone = ndiBadge(out.ndiStatus)
  const StatusIcon = badge.tone === 'warn' || badge.tone === 'error' ? WarningIcon : MonitorIcon

  return (
    <div className="output-menu">
      <button
        className="output-btn"
        data-testid="output-status"
        title="Output settings"
        onClick={onOpen}
      >
        <span className="ind" data-testid="hdmi-status" data-tone={badge.tone}>
          <StatusIcon size={16} />
          <span>{badge.text}</span>
        </span>
        <span
          className="ind"
          data-testid="omt-status"
          data-tone={omtTone.tone}
          title={omtTone.text}
          aria-label={omtTone.text}
        >
          {omtTone.tone === 'error' ? <WarningIcon size={16} /> : <BroadcastIcon size={16} />}
          <NetText full={omtTone.text} short={netShortText('OMT', out.omtStatus)} />
        </span>
        <span
          className="ind"
          data-testid="ndi-status"
          data-tone={ndiTone.tone}
          title={ndiTone.text}
          aria-label={ndiTone.text}
        >
          {ndiTone.tone === 'error' ? <WarningIcon size={16} /> : <BroadcastIcon size={16} />}
          <NetText full={ndiTone.text} short={netShortText('NDI', out.ndiStatus)} />
        </span>
        <span
          className="canvas-tag"
          data-testid="canvas-badge"
          title={`Canvas ${canvasLabel(program.canvas)}`}
        >
          {canvasLabel(program.canvas)}
        </span>
        {target && (
          <span className="res" title={`${target.label}, ${target.width}x${target.height}`}>
            {target.label}, {target.width}x{target.height}
          </span>
        )}
      </button>
    </div>
  )
}
