import type { PptImportFormat } from '../../../shared/settings'
import { Segmented } from './Segmented'

const OPTIONS: readonly { value: PptImportFormat; label: string }[] = [
  { value: 'odp', label: 'LibreOffice (.odp)' },
  { value: 'original', label: 'As imported' }
]

/**
 * Linux only. What the working copy of an imported PowerPoint file is: converted to a LibreOffice
 * presentation, or the PowerPoint file as it was. The imported file itself is never changed.
 */
export function ImportFormat({
  value,
  onChange
}: {
  value: PptImportFormat
  onChange(v: PptImportFormat): void
}): React.JSX.Element {
  return (
    <div className="import-format" data-testid="import-format">
      <span className="import-format-label" id="import-format-label">
        Save imported PowerPoint files as
      </span>
      <Segmented<PptImportFormat>
        label="Save imported PowerPoint files as"
        value={value}
        options={OPTIONS}
        testId="import-format-seg"
        onChange={onChange}
      />
      <p>The file you import is never changed. This applies to the next import.</p>
    </div>
  )
}
