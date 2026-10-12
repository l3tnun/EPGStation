import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'

import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import FormControlLabel from '@mui/material/FormControlLabel'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { HTMLAttributes } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import { AppSelect } from '@/shared/AppSelect'
import type { RecordedApiRepository, RecordedListItem } from '../recordedApi'
import {
  buildAddEncodeRequestBody,
  readAddEncodeSetting,
  resolveAddEncodeParentDirectory,
  writeAddEncodeSetting,
} from '../recordedRequests'
import styles from '../RecordedPage.module.css'
import { recordedId, videoFileId } from '../lib/recordedFormat'
import { RecordedPlainDialog } from './RecordedPlainDialog'
import { openSnackbar } from '../lib/recordedSnackbar'
import { getBrowserStorage } from '../lib/recordedBrowser'
import { EMPTY_STRING_LIST } from '../lib/emptyList'

export function AddEncodeDialog({
  item,
  open,
  encodeModes,
  recordedDirectories = EMPTY_STRING_LIST,
  apiRepository,
  onClose,
  onSnackbar,
}: {
  item: RecordedListItem
  open: boolean
  encodeModes: readonly string[]
  recordedDirectories?: readonly string[]
  apiRepository: RecordedApiRepository
  onClose: () => void
  onSnackbar: (snackbar: ShellSnackbarState) => void
}) {
  const files = useMemo(() => item.videoFiles ?? [], [item.videoFiles])
  const storage = getBrowserStorage()
  const storedSetting = storage === undefined ? undefined : readAddEncodeSetting(storage)
  const [sourceVideoFileId, setSourceVideoFileId] = useState('')
  const [mode, setMode] = useState('')
  const [parentDirectory, setParentDirectory] = useState('')
  const [directory, setDirectory] = useState('')
  const [isSaveSameDirectory, setSaveSameDirectory] = useState(false)
  const [removeOriginal, setRemoveOriginal] = useState(false)

  const latestInputs = useRef({ encodeModes, files, recordedDirectories, storage })
  useEffect(() => {
    latestInputs.current = { encodeModes, files, recordedDirectories, storage }
  })

  useEffect(() => {
    if (!open) return
    const inputs = latestInputs.current
    const setting = inputs.storage === undefined ? undefined : readAddEncodeSetting(inputs.storage)
    // Dialog open restores adjacent storage and source defaults; later re-renders of the parent
    // must not reset what the user has edited, so only the open transition runs this.
    setSourceVideoFileId(String(inputs.files[0]?.id ?? ''))
    setMode(setting?.encodeMode ?? inputs.encodeModes[0] ?? '')
    setParentDirectory(
      resolveAddEncodeParentDirectory({
        storedParentDirectory: setting?.parentDirectory,
        recordedDirectories: inputs.recordedDirectories,
      }),
    )
    setDirectory('')
    setSaveSameDirectory(setting?.isSaveSameDirectory ?? false)
    setRemoveOriginal(setting?.removeOriginal ?? false)
  }, [open])

  const closeAndSave = () => {
    if (storage !== undefined) {
      writeAddEncodeSetting(storage, {
        encodeMode: mode === '' ? null : mode,
        parentDirectory: parentDirectory === '' ? null : parentDirectory,
        isSaveSameDirectory,
        removeOriginal,
      })
    }
    onClose()
  }
  const add = async () => {
    const itemId = recordedId(item)
    const fileId = Number(sourceVideoFileId)
    if (
      itemId === undefined ||
      !Number.isInteger(fileId) ||
      mode === '' ||
      (!isSaveSameDirectory && parentDirectory === '')
    ) {
      closeAndSave()
      openSnackbar(onSnackbar, 'エンコード追加に失敗しました', 'error')
      return
    }
    const body = buildAddEncodeRequestBody({
      recordedId: itemId,
      sourceVideoFileId: fileId,
      mode,
      removeOriginal,
      isSaveSameDirectory,
      parentDir: parentDirectory,
      directory,
    })
    closeAndSave()
    const result = await apiRepository.addEncode(body)
    openSnackbar(
      onSnackbar,
      result.ok ? 'エンコード追加' : 'エンコード追加に失敗しました',
      result.ok ? 'success' : 'error',
    )
  }
  const dialogPaperAttributes = {
    'data-recorded-add-encode-dialog': 'legacy',
    className: styles.addEncodePaper,
  } as HTMLAttributes<HTMLDivElement>

  return (
    <RecordedPlainDialog
      open={open}
      ariaLabel="エンコード追加"
      maxWidth={500}
      paperAttributes={dialogPaperAttributes}
      onClose={closeAndSave}
    >
      <DialogContent className={styles.addEncodeContent}>
        <div className={styles.addEncodeTitle}>{item.name ?? ''}</div>
        <div className={styles.addEncodeRow}>
          <label className={`${styles.addEncodeField} ${styles.addEncodeSourceField}`}>
            <span>source</span>
            <AppSelect
              ariaLabel="source"
              controlHeight={32}
              inputProps={{ 'data-recorded-add-encode-field': 'source' }}
              displayProps={{ 'data-recorded-add-encode-field': 'source' }}
              value={sourceVideoFileId}
              options={files.flatMap((file) => {
                const id = videoFileId(file)
                return id === undefined ? [] : [{ label: file.name ?? `#${id}`, value: String(id) }]
              })}
              onChange={setSourceVideoFileId}
            />
          </label>
          <label className={`${styles.addEncodeField} ${styles.addEncodePresetField}`}>
            <span>preset</span>
            <AppSelect
              ariaLabel="preset"
              controlHeight={32}
              inputProps={{ 'data-recorded-add-encode-field': 'preset' }}
              displayProps={{ 'data-recorded-add-encode-field': 'preset' }}
              value={mode}
              options={(encodeModes.length === 0
                ? storedSetting?.encodeMode === null
                  ? []
                  : [storedSetting?.encodeMode]
                : encodeModes
              )
                .filter((value): value is string => typeof value === 'string')
                .map((value) => ({ label: value, value }))}
              onChange={setMode}
            />
          </label>
        </div>
        <div className={`${styles.addEncodeRow} ${styles.addEncodeDirectoryRow}`}>
          <label className={`${styles.addEncodeField} ${styles.addEncodeSourceField}`}>
            <span>recorded</span>
            <AppSelect
              ariaLabel="recorded"
              controlHeight={32}
              inputProps={{ 'data-recorded-add-encode-field': 'parent' }}
              displayProps={{ 'data-recorded-add-encode-field': 'parent' }}
              disabled={isSaveSameDirectory || recordedDirectories.length === 0}
              showEmptyOptionLabel
              value={parentDirectory}
              options={[
                ...(recordedDirectories.length === 0 ? [{ label: 'recorded', value: '' }] : []),
                ...recordedDirectories.map((directoryName) => ({
                  label: directoryName,
                  value: directoryName,
                })),
              ]}
              onChange={setParentDirectory}
            />
          </label>
          <label
            className={`${styles.addEncodeField} ${styles.addEncodePresetField} ${styles.addEncodeDirectoryField}`}
          >
            <span>sub directory</span>
            <input
              data-recorded-add-encode-field="directory"
              aria-label="sub directory"
              placeholder="sub directory"
              disabled={isSaveSameDirectory}
              value={directory}
              onChange={(event) => setDirectory(event.target.value)}
            />
            {directory === '' || isSaveSameDirectory ? null : (
              <button
                aria-label="sub directoryをクリア"
                className={styles.addEncodeClearButton}
                type="button"
                onClick={() => setDirectory('')}
              >
                <span aria-hidden="true">×</span>
              </button>
            )}
          </label>
        </div>
        <FormControlLabel
          control={
            <Checkbox
              checked={isSaveSameDirectory}
              onChange={(event) => setSaveSameDirectory(event.target.checked)}
            />
          }
          label="元ファイルと同じ場所に保存する"
        />
        <FormControlLabel
          control={
            <Checkbox
              checked={removeOriginal}
              onChange={(event) => setRemoveOriginal(event.target.checked)}
            />
          }
          label="元ファイルを削除する"
        />
      </DialogContent>
      <DialogActions className={styles.addEncodeActions}>
        <Button onClick={closeAndSave}>キャンセル</Button>
        <Button onClick={add}>追加</Button>
      </DialogActions>
    </RecordedPlainDialog>
  )
}
