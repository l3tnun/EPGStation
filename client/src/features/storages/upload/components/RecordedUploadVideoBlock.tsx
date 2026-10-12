import { ClearableTextField } from '@/shared/ClearableTextField'
import type {
  RecordedUploadFormState,
  RecordedUploadVideoFileType,
} from '../../../recorded/recordedRequests'
import styles from '../RecordedUploadPage.module.css'
import { nullableString } from '../lib/uploadFormat'
import { UploadSelect } from './UploadSelect'

export function RecordedUploadVideoBlock({
  index,
  block,
  recordedDirectories,
  fileInputGeneration,
  onChange,
}: {
  index: number
  block: RecordedUploadFormState['videoBlocks'][number]
  recordedDirectories: readonly string[]
  fileInputGeneration: number
  onChange: (block: RecordedUploadFormState['videoBlocks'][number]) => void
}) {
  const suffix = index + 1

  return (
    <div
      className={styles.formRow}
      data-testid={`recorded-upload-video-block-${index}`}
      data-video-block-index={index}
    >
      <div className={styles.rowTitle}>ビデオファイル{suffix}</div>
      <div className={styles.rowContent}>
        <div className={styles.videoBlock}>
          <ClearableTextField
            variant="standard"
            className={styles.shortField}
            label="name"
            value={block.viewName ?? ''}
            onClear={() => onChange({ ...block, viewName: null })}
            onChange={(event) =>
              onChange({ ...block, viewName: nullableString(event.target.value) })
            }
          />
          <UploadSelect
            className={styles.shortField}
            label="file type"
            value={block.fileType ?? ''}
            options={[
              { value: '', label: 'file type', hidden: true },
              { value: 'ts', label: 'ts' },
              { value: 'encoded', label: 'encoded' },
            ]}
            onChange={(value) =>
              onChange({
                ...block,
                fileType: value === '' ? undefined : (value as RecordedUploadVideoFileType),
              })
            }
          />
          <UploadSelect
            className={styles.shortField}
            label="directory"
            value={block.parentDirectoryName}
            options={
              recordedDirectories.length === 0
                ? [{ value: '', label: 'directory', hidden: true }]
                : recordedDirectories.map((directory) => ({ value: directory, label: directory }))
            }
            onChange={(value) => onChange({ ...block, parentDirectoryName: value })}
          />
          <ClearableTextField
            variant="standard"
            label="sub directory"
            value={block.subDirectory ?? ''}
            onClear={() => onChange({ ...block, subDirectory: null })}
            onChange={(event) =>
              onChange({ ...block, subDirectory: nullableString(event.target.value) })
            }
          />
          <label className={styles.fileField} data-has-file={block.file !== null}>
            <input
              key={`file-${fileInputGeneration}-${block.id}`}
              aria-label="video file"
              type="file"
              onChange={(event) => {
                const input = event.target as HTMLInputElement
                onChange({ ...block, file: input.files?.[0] ?? null })
              }}
            />
            <span className={styles.fileFieldLine}>
              <span className={styles.fileIcon} aria-hidden="true">
                {'\u{F03E2}'}
              </span>
              <span aria-live="polite">{block.file?.name ?? ''}</span>
              <span className={styles.filePlaceholder}>video file</span>
            </span>
          </label>
        </div>
      </div>
    </div>
  )
}
