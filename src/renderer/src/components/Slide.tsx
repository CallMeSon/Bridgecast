interface ImageProps {
  src: string
  alt: string
  fade?: boolean
  lazy?: boolean
}

export function SlideImage({ src, alt, fade, lazy }: ImageProps): React.JSX.Element {
  return (
    <div className={fade ? 'slide fade-in' : 'slide'}>
      <img
        src={src}
        alt={alt}
        draggable={false}
        decoding="async"
        loading={lazy ? 'lazy' : 'eager'}
      />
    </div>
  )
}

export function EndCard({ title, sub }: { title: string; sub?: string }): React.JSX.Element {
  return (
    <div className="slide end">
      {/* A child of the container, so its cqw sizes follow the card. */}
      <div className="end-body">
        <div className="t">{title}</div>
        {sub && <div>{sub}</div>}
      </div>
    </div>
  )
}
