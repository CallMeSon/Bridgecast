import { WarningCircleIcon } from '@phosphor-icons/react'
import { captureWarningText, type WebCaptureWarning } from '../../../shared/web'

/**
 * An output cannot capture the live web page or slide show and shows its still
 * instead (spec 6). Persistent while it lasts; ink, weight and an icon, never red.
 */
export function CaptureWarning({
  warnings,
  extra = []
}: {
  warnings: WebCaptureWarning[]
  /** Other web page warnings (a page window smaller than the canvas). */
  extra?: string[]
}): React.JSX.Element | null {
  if (warnings.length === 0 && extra.length === 0) return null
  const texts = [
    ...new Set(
      warnings
        .slice()
        .sort((a, b) => a.output.localeCompare(b.output))
        .map((w) => captureWarningText(w.output, w.kind === 'slides' ? 'slides' : 'web'))
    )
  ]
  return (
    <div className="action-error" role="alert" data-testid="capture-warning">
      <WarningCircleIcon className="ph" size={20} />
      <div className="txt">
        {texts.map((t) => (
          <strong key={t}>{t}</strong>
        ))}
        {[...new Set(extra)].map((t) => (
          <strong key={t}>{t}</strong>
        ))}
      </div>
    </div>
  )
}
