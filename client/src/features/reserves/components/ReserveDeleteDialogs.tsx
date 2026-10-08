import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import type { ShellSnackbarState } from '@/app/AppShell'
import type { ReserveListItem, ReservesApiRepository } from '../lib/reservesApiTypes'
import { openReserveSnackbar } from '../lib/reserveLabels'
import { resolveReserveDeleteLabel } from '../lib/reserveRoutes'
import { executeReserveBulkDeleteAction } from '../lib/reserveSelection'

export function ReserveDeleteDialog({
  open,
  reserve,
  apiRepository,
  onClose,
  onDeleteSuccess,
  onSnackbar,
}: {
  open: boolean
  reserve: ReserveListItem | null
  apiRepository: ReservesApiRepository
  onClose: () => void
  onDeleteSuccess?: () => void
  onSnackbar: (snackbar: ShellSnackbarState) => void
}) {
  if (!open || reserve === null) {
    return null
  }

  const label = resolveReserveDeleteLabel(reserve)
  const executeDelete = async () => {
    onClose()
    const result = await apiRepository.deleteReserve(reserve.id)

    openReserveSnackbar(
      onSnackbar,
      result.ok ? `${label} を削除` : `${label} を削除に失敗`,
      result.ok ? 'success' : 'error',
    )
    if (result.ok) {
      onDeleteSuccess?.()
    }
  }

  return (
    <Dialog
      open
      keepMounted={false}
      scroll="paper"
      onClose={onClose}
      slotProps={{
        paper: {
          'aria-label': '予約削除',
          'aria-describedby': 'reserve-delete-content',
          sx: {
            width: 'calc(100% - 32px)',
            maxWidth: 300,
          },
        },
      }}
    >
      <DialogContent
        id="reserve-delete-content"
        sx={{ p: 2, fontSize: '0.875rem', lineHeight: 1.5 }}
      >
        {label} を削除しますか?
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>キャンセル</Button>
        <Button onClick={() => void executeDelete()}>削除</Button>
      </DialogActions>
    </Dialog>
  )
}

export function ReserveBulkDeleteDialog({
  open,
  reserves,
  apiRepository,
  onClose,
  onSnackbar,
  onConfirmStart,
}: {
  open: boolean
  reserves: readonly ReserveListItem[]
  apiRepository: ReservesApiRepository
  onClose: () => void
  onSnackbar: (snackbar: ShellSnackbarState) => void
  onConfirmStart: () => void
}) {
  if (!open || reserves.length === 0) {
    return null
  }

  const executeDelete = async () => {
    const reserveIds = reserves.map((reserve) => reserve.id)

    onClose()
    onConfirmStart()
    const result = await executeReserveBulkDeleteAction({
      apiRepository,
      reserveIds,
    })

    if (result.status === 'zero-selection') {
      openReserveSnackbar(onSnackbar, '番組を選択してください。', 'error')
      return
    }
    openReserveSnackbar(
      onSnackbar,
      result.status === 'success'
        ? '選択した番組の予約をキャンセルしました。'
        : '一部番組のキャンセルに失敗しました。',
      result.status === 'success' ? 'success' : 'error',
    )
  }

  return (
    <Dialog
      open
      keepMounted={false}
      scroll="paper"
      onClose={onClose}
      slotProps={{
        paper: {
          'aria-label': '予約一括削除',
          'aria-describedby': 'reserve-bulk-delete-content',
          sx: {
            width: 'calc(100% - 32px)',
            maxWidth: 300,
          },
        },
      }}
    >
      <DialogContent
        id="reserve-bulk-delete-content"
        sx={{ p: 2, pb: 0, fontSize: '0.875rem', lineHeight: 1.5 }}
      >
        選択した {reserves.length} 件の番組を削除しますか。
      </DialogContent>
      <DialogActions sx={{ minHeight: 52, p: 1 }}>
        <Button onClick={onClose}>キャンセル</Button>
        <Button onClick={() => void executeDelete()}>削除</Button>
      </DialogActions>
    </Dialog>
  )
}
