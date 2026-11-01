import {
  ArrowRightIcon,
  EyeSlashIcon,
  ImageIcon,
  SnowflakeIcon,
  BroadcastIcon
} from '@phosphor-icons/react'

export type StatusKind = 'live' | 'frozen' | 'black' | 'kv' | 'next' | 'standby'

const WORD: Record<StatusKind, string> = {
  live: 'LIVE',
  frozen: 'FROZEN',
  black: 'BLACK',
  kv: 'KV',
  next: 'NEXT',
  standby: 'STANDBY'
}

function icon(kind: StatusKind, px: number): React.JSX.Element | null {
  switch (kind) {
    case 'live':
      return <BroadcastIcon size={px} weight="bold" aria-hidden="true" />
    case 'frozen':
      return <SnowflakeIcon size={px} aria-hidden="true" />
    case 'black':
      return <EyeSlashIcon size={px} aria-hidden="true" />
    case 'kv':
      return <ImageIcon size={px} aria-hidden="true" />
    case 'next':
      return <ArrowRightIcon size={px} weight="bold" aria-hidden="true" />
    case 'standby':
      return null
  }
}

/**
 * The one state tag. `icon` shows only the symbol (Program head); the word stays in the
 * DOM, visually hidden, so the tag is still named and its text is still the word.
 * `word` shows icon and word; LIVE is the word alone (mock). NEXT and STANDBY always show
 * their word.
 */
export function StatusTag({
  kind,
  size = 'md',
  variant = 'word',
  ...rest
}: {
  kind: StatusKind
  size?: 'md' | 'sm'
  variant?: 'icon' | 'word'
  'data-testid'?: string
}): React.JSX.Element {
  const iconOnly = variant === 'icon' && kind !== 'next' && kind !== 'standby'
  const px = size === 'sm' ? 12 : 14
  return (
    <span
      className="stag"
      data-kind={kind}
      data-size={size}
      data-icon-only={iconOnly || undefined}
      title={iconOnly ? WORD[kind] : undefined}
      {...rest}
    >
      {kind === 'live' && !iconOnly ? null : icon(kind, px)}
      <span className={iconOnly ? 'visually-hidden' : undefined}>{WORD[kind]}</span>
    </span>
  )
}
