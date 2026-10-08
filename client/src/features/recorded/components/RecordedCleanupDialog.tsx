import Button from '@mui/material/Button'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import LinearProgress from '@mui/material/LinearProgress'
import { useState } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import type { RecordedApiRepository } from '../recordedApi'
import { RecordedPlainDialog } from './RecordedPlainDialog'
import { openSnackbar } from '../lib/recordedSnackbar'

function waitMilliseconds(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function RecordedCleanupDialog({
  open,
  apiRepository,
  onClose,
  onSnackbar,
}: {
  open: boolean
  apiRepository: RecordedApiRepository
  onClose: () => void
  onSnackbar: (snackbar: ShellSnackbarState) => void
}) {
  const [isClearing, setClearing] = useState(false)
  const execute = async () => {
    setClearing(true)
    const startedAt = Date.now()
    const recordedResult = await apiRepository.cleanupRecorded()
    let isSuccess = false

    if (recordedResult.ok) {
      const thumbnailResult = await apiRepository.cleanupThumbnails()
      isSuccess = thumbnailResult.ok
    }

    const elapsed = Date.now() - startedAt
    if (elapsed < 1000) {
      await waitMilliseconds(1000 - elapsed)
    }

    setClearing(false)
    onClose()
    openSnackbar(
      onSnackbar,
      isSuccess ? 'クリーンアップ完了' : 'クリーンアップに失敗',
      isSuccess ? 'success' : 'error',
    )
  }

  return (
    <RecordedPlainDialog
      open={open}
      ariaLabel="録画クリーンアップ"
      maxWidth={300}
      onClose={isClearing ? undefined : onClose}
    >
      <DialogContent sx={{ fontSize: 14, lineHeight: '22px', p: 2 }}>
        {isClearing ? (
          <>
            <h3>クリーンアップ中</h3>
            <LinearProgress />
          </>
        ) : (
          <div>
            データベースに登録されていないファイルおよびディレクトリを削除します。実行しますか?
          </div>
        )}
      </DialogContent>
      {!isClearing ? (
        <DialogActions>
          <Button onClick={onClose}>キャンセル</Button>
          <Button onClick={execute}>実行</Button>
        </DialogActions>
      ) : undefined}
    </RecordedPlainDialog>
  )
}
