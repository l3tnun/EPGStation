import Button from '@mui/material/Button'

import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import { useEffect, useMemo, useState } from 'react'
import type { HTMLAttributes } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import type { LiveStreamConfig } from '@/app/serverApi'
import { AppSelect } from '@/shared/AppSelect'
import type { RecordedListItem } from '../recordedApi'
import {
  buildRecordedStreamingRoute,
  readRecordedSelectStreamSetting,
  normalizeRecordedSelectStreamSetting,
  resolveRecordedStreamCandidates,
  writeRecordedSelectStreamSetting,
} from '../recordedRequests'
import type {
  RecordedHandoffVideoFile,
  RecordedSelectStreamSetting,
  RecordedStreamCandidate,
} from '../recordedRequests'
import styles from '../RecordedPage.module.css'

import { RecordedPlainDialog } from './RecordedPlainDialog'
import { openSnackbar } from '../lib/recordedSnackbar'
import { getBrowserStorage } from '../lib/recordedBrowser'

function findRecordedStreamCandidate(
  candidates: readonly RecordedStreamCandidate[],
  type: RecordedSelectStreamSetting['type'],
): RecordedStreamCandidate | undefined {
  return candidates.find((candidate) => candidate.type === type)
}

export function RecordedStreamSelectDialog({
  open,
  item,
  file,
  streamConfig,
  onClose,
  onNavigate,
  onSnackbar,
}: {
  open: boolean
  item: RecordedListItem
  file: RecordedHandoffVideoFile | null
  streamConfig?: LiveStreamConfig
  onClose: () => void
  onNavigate: (path: string) => void
  onSnackbar: (snackbar: ShellSnackbarState) => void
}) {
  const storage = getBrowserStorage()
  const candidates = useMemo(
    () =>
      resolveRecordedStreamCandidates({
        streamConfig,
        fileType: file?.type,
      }),
    [file?.type, streamConfig],
  )
  const [selection, setSelection] = useState<RecordedSelectStreamSetting | null>(null)
  const currentCandidate =
    selection === null ? undefined : findRecordedStreamCandidate(candidates, selection.type)
  // The mode select only lists modes of the current candidate, so a mode change always refers to
  // that candidate's type; the fallback only matters while no candidate exists.
  const modeSelectType = currentCandidate?.type ?? 'WebM'

  useEffect(() => {
    if (!open) {
      return
    }

    const normalized = normalizeRecordedSelectStreamSetting({
      saved: readRecordedSelectStreamSetting(storage),
      candidates,
    })
    const hasCandidate = findRecordedStreamCandidate(candidates, normalized.type) !== undefined

    // Dialog open restores the adjacent saved stream setting against current candidates.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelection(hasCandidate ? normalized : null)
  }, [candidates, open, storage])

  const closeAndSave = () => {
    if (selection !== null) {
      writeRecordedSelectStreamSetting(storage, selection)
    }
    onClose()
  }
  const watch = () => {
    const route = buildRecordedStreamingRoute({
      recordedId: item.id,
      videoFileId: file?.id,
      fileType: file?.type,
      selection,
    })

    if (!route.ok) {
      openSnackbar(onSnackbar, route.message, 'error')
      return
    }

    closeAndSave()
    onNavigate(route.to)
  }
  const dialogPaperAttributes = {
    'data-recorded-stream-select-dialog': 'legacy',
    className: styles.streamSelectPaper,
  } as HTMLAttributes<HTMLDivElement>

  return (
    <RecordedPlainDialog
      open={open}
      ariaLabel="ストリーム選択"
      maxWidth={400}
      paperAttributes={dialogPaperAttributes}
      onClose={closeAndSave}
    >
      <DialogContent className={styles.streamSelectContent}>
        <div className={styles.streamSelectTitle}>{file?.name ?? item.name ?? ''}</div>
        <div className={styles.streamSelectFields}>
          <label className={`${styles.legacySelectField} ${styles.streamTypeField}`}>
            <AppSelect
              ariaLabel="配信方式"
              controlHeight={32}
              inputProps={{ 'data-recorded-stream-select-field': 'type' }}
              displayProps={{ 'data-recorded-stream-select-field': 'type' }}
              value={selection?.type ?? ''}
              options={candidates.map((candidate) => ({
                label: candidate.type,
                value: candidate.type,
              }))}
              onChange={(value) => {
                setSelection({ type: value as RecordedSelectStreamSetting['type'], mode: 0 })
              }}
            />
          </label>
          <label className={styles.legacySelectField}>
            <AppSelect
              ariaLabel="画質"
              controlHeight={32}
              inputProps={{ 'data-recorded-stream-select-field': 'mode' }}
              displayProps={{ 'data-recorded-stream-select-field': 'mode' }}
              value={selection?.mode ?? ''}
              options={(currentCandidate?.modes ?? []).map((mode, index) => ({
                label: mode,
                value: index,
              }))}
              onChange={(value) => {
                setSelection({ type: modeSelectType, mode: Number(value) })
              }}
            />
          </label>
        </div>
      </DialogContent>
      <DialogActions className={styles.streamSelectActions}>
        <Button onClick={closeAndSave}>キャンセル</Button>
        <Button onClick={watch}>視聴</Button>
      </DialogActions>
    </RecordedPlainDialog>
  )
}
