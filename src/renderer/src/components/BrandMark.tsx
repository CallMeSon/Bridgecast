/** The Bridgecast mark: two arches and a dot. Arches follow the text colour; the dot is always brand orange. */
export function BrandMark({ size = 28 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 7 64 64"
      aria-hidden="true"
      focusable="false"
    >
      <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round">
        <path d="M8 50a24 24 0 0 1 48 0" />
        <path d="M18 50a14 14 0 0 1 28 0" />
      </g>
      <circle cx="32" cy="50" r="5" fill="var(--brand-signal)" />
    </svg>
  )
}
