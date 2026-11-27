import { useState } from 'react'
import {
  CaretDownIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  WarningCircleIcon
} from '@phosphor-icons/react'
import type { ReleaseNotesLine } from '../../../shared/update'
import type { UpdateView } from '../update-ui'
import { ReleaseNotes } from './ReleaseNotes'

/**
 * One banner per update version, shown under the header. It never takes focus:
 * a clicker's Space still runs Program's Next (the global key guard handles it).
 */
export function UpdateBanner({
  view,
  notes,
  onAction,
  onLater,
  onSkip
}: {
  view: UpdateView
  notes: ReleaseNotesLine[]
  onAction(): void
  onLater(): void
  onSkip(): void
}): React.JSX.Element | null {
  const [showNotes, setShowNotes] = useState(false)
  const banner = view.banner
  if (!banner) return null
  const Icon =
    view.progress !== null
      ? DownloadSimpleIcon
      : banner.primary?.action === 'retry'
        ? WarningCircleIcon
        : CheckCircleIcon
  return (
    <div className="update-banner" role="status" data-testid="update-banner" data-update-ui>
      <Icon className="ph" size={20} aria-hidden="true" />
      <div className="update-copy">
        <strong className="update-title">{banner.title}</strong>
        <span className="update-detail">{banner.detail}</span>
        {banner.primaryDisabledReason && (
          <span className="update-reason" data-testid="update-on-air-reason">
            {banner.primaryDisabledReason}
          </span>
        )}
        {notes.length > 0 && (
          <div className="update-more">
            <button
              type="button"
              className="update-notes-toggle"
              aria-expanded={showNotes}
              onClick={() => setShowNotes((v) => !v)}
            >
              <CaretDownIcon size={12} aria-hidden="true" />
              What&apos;s new
            </button>
            {showNotes && <ReleaseNotes lines={notes} />}
          </div>
        )}
      </div>
      {view.progress !== null && (
        <div
          className="update-progress"
          role="progressbar"
          aria-label="Download progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.max(0, Math.min(100, Math.round(view.progress)))}
        >
          <span style={{ width: `${Math.max(0, Math.min(100, view.progress))}%` }} />
        </div>
      )}
      <div className="update-actions">
        {banner.primary && (
          <button
            type="button"
            className="btn sm primary"
            data-testid="update-primary"
            disabled={!!banner.primaryDisabledReason}
            title={banner.primaryDisabledReason ?? undefined}
            onClick={onAction}
          >
            {banner.primary.label}
          </button>
        )}
        {banner.showLater && (
          <button
            type="button"
            className="btn sm"
            data-testid="update-later"
            title="Hide this banner. The update stays ready and installs when you close Bridgecast with nothing on air."
            onClick={onLater}
          >
            Later
          </button>
        )}
        {banner.showSkip && (
          <button
            type="button"
            className="btn sm"
            data-testid="update-skip"
            title="Never install this version. Check for updates in Settings brings it back."
            onClick={onSkip}
          >
            Skip this version
          </button>
        )}
      </div>
    </div>
  )
}
