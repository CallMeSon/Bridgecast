import type { UpdateStatus } from '../../shared/update'

export interface UpdateView {
  chip: { label: string } | null
  banner: {
    title: string
    detail: string
    primary: { label: string; action: 'download' | 'install' | 'retry' } | null
    primaryDisabledReason: string | null
    showSkip: boolean
    showLater: boolean
  } | null
  progress: number | null
}

const ON_AIR_REASON = 'Something is on air. Take it off air or wait until the show ends.'

function versionOf(status: UpdateStatus): string | null {
  return status.kind === 'idle' || status.kind === 'checking' ? null : status.version
}

/**
 * One view model for the header chip, the banner and the About block. Nothing here
 * touches the network or the DOM: the chip stays once a version has been dismissed,
 * but its banner is shown at most once per version.
 */
export function updateView(
  status: UpdateStatus,
  onAir: boolean,
  bannerDismissedFor: string | null
): UpdateView {
  const version = versionOf(status)
  const chip = version ? { label: `Update ${version}` } : null
  if (!version || version === bannerDismissedFor) return { chip, banner: null, progress: null }

  let banner: UpdateView['banner'] = null
  let progress: number | null = null
  switch (status.kind) {
    case 'idle':
    case 'checking':
      break
    case 'available':
      banner = {
        title: `Bridgecast ${version} is available`,
        detail: 'A newer version is ready. It is only downloaded and installed when you ask.',
        primary: { label: 'Download', action: 'download' },
        primaryDisabledReason: null,
        showSkip: true,
        showLater: true
      }
      break
    case 'downloading':
      progress = status.percent
      banner = {
        title: `Downloading Bridgecast ${version}`,
        detail: 'You can keep running the show while the update downloads.',
        primary: null,
        primaryDisabledReason: null,
        showSkip: false,
        showLater: false
      }
      break
    case 'ready': {
      const reason = onAir ? ON_AIR_REASON : null
      banner = {
        title: `Bridgecast ${version} is ready to install`,
        detail: reason
          ? 'The update is downloaded. Install it once nothing is on air.'
          : 'The update is downloaded. Restart to install it.',
        primary: { label: 'Restart and install', action: 'install' },
        primaryDisabledReason: reason,
        showSkip: false,
        showLater: true
      }
      break
    }
    case 'error':
      banner = {
        title: `Could not download Bridgecast ${version}`,
        detail: status.message,
        primary: { label: 'Try again', action: 'retry' },
        primaryDisabledReason: null,
        showSkip: false,
        showLater: true
      }
      break
  }
  return { chip, banner, progress }
}

/** True when a key event comes from an update button or its container. */
export function isUpdateKeyTarget(el: Element | null): boolean {
  return !!el?.closest?.('[data-update-ui]')
}
