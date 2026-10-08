import Button from '@mui/material/Button'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import { useEffect, useMemo } from 'react'
import type { HTMLAttributes } from 'react'
import { resolveURLSchemeTemplate } from '@/shared/settings'
import type { SettingsConsumerValue } from '@/shared/settings'
import type { RecordedListItem } from '../recordedApi'
import {
  buildVideoDownloadUrl,
  buildVideoPlaylistUrl,
  buildVideoUrlSchemeHandoffUrl,
  formatRecordedFileSize,
  linkifyRecordedExtendedText,
} from '../recordedRequests'
import styles from '../RecordedPage.module.css'
import { getBrowserOrigin } from '../lib/recordedBrowser'
import { RecordedPlainDialog } from './RecordedPlainDialog'
import { videoFileId } from '../lib/recordedFormat'

export function RecordedExtendedText({ text }: { text?: string }) {
  const tokens = useMemo(() => linkifyRecordedExtendedText(text), [text])

  if (tokens.length === 0) {
    return null
  }

  return (
    <p className={styles.itemDescription}>
      {tokens.map((token, index) => {
        if (token.type === 'text') {
          return <span key={`${index}-text`}>{token.text}</span>
        }

        return (
          <a key={`${index}-link`} href={token.href} target="_blank" rel="noopener noreferrer">
            {token.text}
          </a>
        )
      })}
    </p>
  )
}

export function RecordedDownloadDialog({
  open,
  item,
  settings,
  recordedDownloadUrlScheme,
  onClose,
}: {
  open: boolean
  item: RecordedListItem
  settings: SettingsConsumerValue
  recordedDownloadUrlScheme?: string | null
  onClose: () => void
}) {
  const files = item.videoFiles ?? []
  const dialogPaperAttributes = {
    'data-recorded-download-dialog': 'legacy',
    className: styles.downloadPaper,
  } as HTMLAttributes<HTMLDivElement>

  useEffect(() => {
    if (!open) {
      return
    }

    const closeOnBackdropClick = (event: globalThis.MouseEvent) => {
      if (!(event.target instanceof Element)) {
        return
      }
      if (event.target.closest('.MuiBackdrop-root') !== null) {
        onClose()
      }
    }

    document.addEventListener('click', closeOnBackdropClick, true)

    return () => {
      document.removeEventListener('click', closeOnBackdropClick, true)
    }
  }, [onClose, open])

  return (
    <RecordedPlainDialog
      open={open}
      ariaLabel="録画ダウンロード"
      maxWidth={500}
      paperAttributes={dialogPaperAttributes}
      onClose={onClose}
    >
      <DialogContent className={styles.downloadContent}>
        <div className={styles.downloadTitle}>{item.name ?? ''}</div>
        <div className={styles.downloadSectionLabel}>video files</div>
        <div className={styles.downloadActionRow}>
          {files.map((file) => {
            const id = videoFileId(file)
            if (id === undefined) return undefined
            const downloadUrlScheme = resolveURLSchemeTemplate(
              settings.recordedDownloadURLScheme,
              recordedDownloadUrlScheme ?? '',
            )
            const urlScheme = buildVideoUrlSchemeHandoffUrl({
              shouldUseUrlScheme: settings.shouldUseRecordedDownloadURLScheme,
              urlScheme: downloadUrlScheme,
              videoFileId: id,
              filename: file.filename ?? file.name,
              mode: 'download',
              origin: getBrowserOrigin(),
            })
            const href = urlScheme ?? buildVideoDownloadUrl({ videoFileId: id })

            return (
              <a key={id} className={styles.downloadButton} href={href}>
                {file.name ?? `#${id}`} ({formatRecordedFileSize(file.size)})
              </a>
            )
          })}
        </div>
        <div className={styles.downloadSectionLabel}>play lists</div>
        <div className={styles.downloadActionRow}>
          {files.map((file) => {
            const id = videoFileId(file)
            if (id === undefined) return undefined

            return (
              <a
                key={id}
                className={styles.downloadButton}
                href={buildVideoPlaylistUrl({ videoFileId: id })}
              >
                {file.name ?? `#${id}`}
              </a>
            )
          })}
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>閉じる</Button>
      </DialogActions>
    </RecordedPlainDialog>
  )
}
