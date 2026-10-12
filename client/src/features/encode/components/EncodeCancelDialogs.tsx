import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import { useEffect, useState } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import type { EncodeApiRepository } from '../encodeApi'
import { cancelSelectedEncodeJobs, type EncodeDisplayItem } from '../encodeRequests'
import styles from '../EncodePage.module.css'

const DIALOG_REMOVE_DELAY_MS = 100

function useDelayedDialogMount(open: boolean): boolean {
  const [isMounted, setMounted] = useState(open)

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMounted(true)
      return () => undefined
    }

    const timer = setTimeout(() => {
      setMounted(false)
    }, DIALOG_REMOVE_DELAY_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [open])

  return isMounted
}

function useDelayedDialogItem<T>(item: T | null): T | null {
  const [mountedItem, setMountedItem] = useState<T | null>(item)

  useEffect(() => {
    if (item !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMountedItem(item)
      return () => undefined
    }

    const timer = setTimeout(() => {
      setMountedItem(null)
    }, DIALOG_REMOVE_DELAY_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [item])

  return mountedItem
}

export function SingleCancelDialog({
  item,
  apiRepository,
  onClose,
  onSnackbar,
}: {
  item: EncodeDisplayItem | null
  apiRepository: EncodeApiRepository
  onClose: () => void
  onSnackbar: (snackbar: ShellSnackbarState) => void
}) {
  const isOpen = item !== null
  const mountedItem = useDelayedDialogItem(item)
  const isMounted = useDelayedDialogMount(isOpen)
  const [isSubmitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubmitting(false)
    }
  }, [isOpen])

  if (!isMounted || mountedItem === null) {
    return null
  }

  const title = `[${mountedItem.mode}] ${mountedItem.title} を停止しますか?`

  const executeCancel = async () => {
    setSubmitting(true)
    const result = await apiRepository.cancelEncode(mountedItem.id)
    onClose()
    if (result.ok) {
      onSnackbar({
        text: `[${mountedItem.mode}] ${mountedItem.title} を停止しました`,
        severity: 'success',
      })
      return
    }

    onSnackbar({
      text: `[${mountedItem.mode}] ${mountedItem.title} の停止に失敗`,
      severity: 'error',
    })
  }

  const close = () => {
    if (!isSubmitting) {
      onClose()
    }
  }

  return (
    <Dialog
      open={isOpen}
      onClose={close}
      data-testid="single-encode-cancel-dialog"
      slotProps={{ paper: { className: styles.cancelDialogPaper, 'aria-label': 'エンコード停止' } }}
    >
      <DialogContent className={styles.singleCancelContent}>{title}</DialogContent>
      <DialogActions>
        <Button color="error" disabled={isSubmitting} onClick={close}>
          キャンセル
        </Button>
        <Button color="primary" disabled={isSubmitting} onClick={() => void executeCancel()}>
          停止
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function BulkCancelDialog({
  open,
  items,
  apiRepository,
  onClose,
  onConfirmStart,
  onSnackbar,
}: {
  open: boolean
  items: readonly EncodeDisplayItem[]
  apiRepository: EncodeApiRepository
  onClose: () => void
  onConfirmStart: () => void
  onSnackbar: (snackbar: ShellSnackbarState) => void
}) {
  const isMounted = useDelayedDialogMount(open)
  const [isSubmitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open || items.length > 0) {
      return
    }

    onClose()
    onSnackbar({
      text: '番組を選択してください。',
      severity: 'error',
    })
  }, [items.length, onClose, onSnackbar, open])

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubmitting(false)
    }
  }, [open])

  if (!isMounted || (open && items.length === 0)) {
    return null
  }

  const executeCancel = async () => {
    const encodeIds = items.map((item) => item.id)
    onClose()
    onConfirmStart()
    setSubmitting(true)
    const isSuccess = await cancelSelectedEncodeJobs({
      apiRepository,
      encodeIds,
    })

    onSnackbar({
      text: isSuccess
        ? '選択したエンコードをキャンセルしました。'
        : '一部エンコードのキャンセルに失敗しました。',
      severity: isSuccess ? 'success' : 'error',
    })
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          className: `${styles.cancelDialogPaper} ${styles.bulkCancelDialogPaper}`,
          'aria-label': 'エンコード一括停止',
        },
      }}
    >
      <DialogContent className={styles.bulkCancelContent}>
        選択した {items.length} 件の番組を削除しますか。
      </DialogContent>
      <DialogActions>
        <Button color="primary" disabled={isSubmitting} onClick={onClose}>
          キャンセル
        </Button>
        <Button color="primary" disabled={isSubmitting} onClick={() => void executeCancel()}>
          削除
        </Button>
      </DialogActions>
    </Dialog>
  )
}
