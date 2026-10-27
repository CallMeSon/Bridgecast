import { WarningCircleIcon } from '@phosphor-icons/react'
import { captureWarningText, type WebCaptureWarning } from '../../../shared/web'

/**
 * An output cannot capture the live web page and shows its snapshot instead
 * (spec 6). Persistent while it lasts; ink, weight and an icon, never red.
 */
export function CaptureWarning({
  warnings
}: {
  warnings: WebCaptureWarning[]
}): React.JSX.Element | null {
  if (warnings.length === 0) return null
  const outputs = [...new Set(warnings.map((w) => w.output))].sort()
  return (
    <div className="action-error" role="alert" data-testid="capture-warning">
      <WarningCircleIcon className="ph" size={20} />
      <div className="txt">
        {outputs.map((o) => (
          <strong key={o}>{captureWarningText(o)}</strong>
        ))}
      </div>
    </div>
  )
}
