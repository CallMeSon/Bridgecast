import { PlayIcon } from '@phosphor-icons/react'

interface ImageProps {
  src: string
  alt: string
  lazy?: boolean
  /** Video slide: shows the play mark in the bottom-left corner. */
  video?: boolean
}

/** Play glyph on a video slide's card (bottom-left). */
export function VideoMark(): React.JSX.Element {
  return (
    <span className="vmark" role="img" aria-label="Video slide">
      <PlayIcon size={12} weight="fill" aria-hidden="true" />
    </span>
  )
}

export function SlideImage({ src, alt, lazy, video }: ImageProps): React.JSX.Element {
  return (
    <div className="slide">
      <img
        src={src}
        alt={alt}
        draggable={false}
        decoding="async"
        loading={lazy ? 'lazy' : 'eager'}
      />
      {video && <VideoMark />}
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
