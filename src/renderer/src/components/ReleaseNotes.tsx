import type { ReleaseNotesLine } from '../../../shared/update'

/** Plain release-note lines, shared by the update banner and the Settings > About block. */
export function ReleaseNotes({ lines }: { lines: ReleaseNotesLine[] }): React.JSX.Element {
  return (
    <div className="update-notes">
      {lines.map((line, i) => (
        <span key={i} className="update-notes-line" data-kind={line.kind}>
          {line.text}
        </span>
      ))}
    </div>
  )
}
