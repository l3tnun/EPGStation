import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'

import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import { useEffect, useMemo, useState } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import { appSelectMenuProps } from '@/shared/appSelectConfig'
import type { SettingsConsumerValue } from '@/shared/settings'
import type { RecordedApiRepository, RecordedListItem } from '../recordedApi'
import { executeRecordedBulkDeleteAction, formatRecordedFileSize } from '../recordedRequests'
import type { RecordedBulkDeleteActionResult, RecordedBulkDeleteOption } from '../recordedRequests'
import { recordedId, videoFileId } from '../lib/recordedFormat'
import { RecordedPlainDialog } from './RecordedPlainDialog'
import { openSnackbar } from '../lib/recordedSnackbar'

export function RecordedDeleteDialog({
  item,
  open,
  settings,
  apiRepository,
  onClose,
  onSnackbar,
  onDeleteSuccess,
}: {
  item: RecordedListItem
  open: boolean
  settings: SettingsConsumerValue
  apiRepository: RecordedApiRepository
  onClose: () => void
  onSnackbar: (snackbar: ShellSnackbarState) => void
  onDeleteSuccess?: (result: { allFilesDeleted: boolean }) => void
}) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const files = useMemo(() => item.videoFiles ?? [], [item.videoFiles])

  useEffect(() => {
    if (!open) return
    const defaults = new Set<number>()
    if (settings.deleteRecordedDefaultValue) {
      files.forEach((file) => {
        const id = videoFileId(file)
        if (id !== undefined) defaults.add(id)
      })
    }
    // Dialog open resets must mirror the legacy close/remount behavior.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds(defaults)
  }, [files, open, settings.deleteRecordedDefaultValue])

  const executeDelete = async () => {
    onClose()
    if (selectedIds.size === 0) {
      return
    }
    const itemId = recordedId(item)
    if (itemId === undefined) {
      openSnackbar(onSnackbar, `${item.name ?? ''} を削除に失敗`, 'error')
      return
    }
    const allFileIds = files.flatMap((file) => {
      const id = videoFileId(file)
      return id === undefined ? [] : [id]
    })
    const allFilesDeleted = selectedIds.size === allFileIds.length
    const resultOk = allFilesDeleted
      ? (await apiRepository.deleteRecorded(itemId)).ok
      : await deleteSelectedVideoFiles(apiRepository, selectedIds)

    if (resultOk) {
      openSnackbar(onSnackbar, `${item.name ?? ''} を削除`)
      onDeleteSuccess?.({ allFilesDeleted })
      return
    }
    openSnackbar(onSnackbar, `${item.name ?? ''} を削除に失敗`, 'error')
  }

  return (
    <RecordedPlainDialog open={open} ariaLabel="録画削除" onClose={onClose}>
      <DialogContent sx={{ letterSpacing: 0, overflowWrap: 'break-word', p: '16px 16px 0' }}>
        <div>{item.name ?? ''} を削除しますか?</div>
        {files.map((file) => {
          const id = videoFileId(file)
          if (id === undefined) return undefined
          const label = `${file.name ?? `#${id}`} (${formatRecordedFileSize(file.size)})`
          return (
            <FormControlLabel
              key={id}
              control={
                <Checkbox
                  checked={selectedIds.has(id)}
                  onChange={(event) => {
                    const next = new Set(selectedIds)
                    if (event.target.checked) next.add(id)
                    else next.delete(id)
                    setSelectedIds(next)
                  }}
                />
              }
              label={label}
            />
          )
        })}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button onClick={executeDelete}>削除</Button>
      </DialogActions>
    </RecordedPlainDialog>
  )
}

async function deleteSelectedVideoFiles(
  apiRepository: RecordedApiRepository,
  selectedIds: Set<number>,
): Promise<boolean> {
  // Source A: v2 5cf2ea383 client/src/components/recorded/RecordedDeleteDialog.vue:152-166
  // attempts every checked video file even after an earlier one fails, and only reports failure
  // once every checked file has been attempted. Stopping early here would silently skip deleting
  // files that come after the first failure.
  let hasFailure = false
  for (const id of selectedIds) {
    const result = await apiRepository.deleteVideoFile(id)
    if (!result.ok) {
      hasFailure = true
    }
  }
  return !hasFailure
}

export function RecordedBulkDeleteDialog({
  open,
  items,
  apiRepository,
  disableOption = false,
  onClose,
  onSnackbar,
  onConfirmStart,
  onCompleted,
}: {
  open: boolean
  items: readonly RecordedListItem[]
  apiRepository: RecordedApiRepository
  disableOption?: boolean
  onClose: () => void
  onSnackbar: (snackbar: ShellSnackbarState) => void
  onConfirmStart?: () => void
  onCompleted: () => void
}) {
  const [option, setOption] = useState<RecordedBulkDeleteOption>('All')

  useEffect(() => {
    if (!open || items.length > 0) {
      return
    }

    onClose()
    openSnackbar(onSnackbar, '番組を選択してください。', 'error')
  }, [items.length, onClose, onSnackbar, open])

  const executeDelete = async () => {
    onClose()
    onConfirmStart?.()
    const result = disableOption
      ? await executeRecordedBulkDeleteVideoFilesOnly({
          apiRepository,
          items,
        })
      : await executeRecordedBulkDeleteAction({
          apiRepository,
          items,
          option,
        })

    if (result.status === 'zero-selection') {
      openSnackbar(onSnackbar, '番組を選択してください。', 'error')
      return
    }
    if (result.status === 'failure') {
      openSnackbar(onSnackbar, '一部番組の削除に失敗しました。', 'error')
      return
    }

    openSnackbar(onSnackbar, '選択した番組を削除しました。')
    onCompleted()
  }

  return (
    <RecordedPlainDialog open={open} ariaLabel="録画一括削除" onClose={onClose}>
      <div
        style={{
          fontSize: '0.875rem',
          lineHeight: '20px',
          minHeight: disableOption ? undefined : 100,
          padding: '16px 16px 0',
        }}
      >
        <div>選択した {items.length} 件の番組を削除しますか。</div>
        {!disableOption ? (
          <TextField
            fullWidth
            select
            aria-label="削除対象"
            variant="standard"
            value={option}
            sx={{ mt: 1 }}
            slotProps={{ select: { MenuProps: appSelectMenuProps } }}
            onChange={(event) => setOption(event.target.value as RecordedBulkDeleteOption)}
          >
            <MenuItem value="All">全て</MenuItem>
            <MenuItem value="OnlyOriginalFile">オリジナルファイルだけ</MenuItem>
            <MenuItem value="OnlyEncodedFile">エンコードファイルだけ</MenuItem>
          </TextField>
        ) : undefined}
      </div>
      <DialogActions sx={{ p: 1 }}>
        <Button sx={{ color: '#1976d2' }} onClick={onClose}>
          キャンセル
        </Button>
        <Button sx={{ color: '#1976d2' }} onClick={executeDelete}>
          削除
        </Button>
      </DialogActions>
    </RecordedPlainDialog>
  )
}

async function executeRecordedBulkDeleteVideoFilesOnly({
  apiRepository,
  items,
}: {
  apiRepository: RecordedApiRepository
  items: readonly RecordedListItem[]
}): Promise<RecordedBulkDeleteActionResult> {
  const videoFileIds = items.flatMap((item) =>
    (item.videoFiles ?? []).flatMap((file) => {
      const id = videoFileId(file)
      return id === undefined ? [] : [id]
    }),
  )

  if (videoFileIds.length === 0) {
    return { status: 'zero-selection' }
  }

  let hasFailure = false
  for (const videoFileId of videoFileIds) {
    const result = await apiRepository.deleteVideoFile(videoFileId)
    if (!result.ok) {
      hasFailure = true
    }
  }

  return hasFailure ? { status: 'failure' } : { status: 'success' }
}
