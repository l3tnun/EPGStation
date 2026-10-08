import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import type { RuleListItem } from '../api'
import { ruleKeyword } from '../lib/ruleListText'

const DIALOG_PAPER_SX = {
  width: 'calc(100% - 32px)',
  maxWidth: 300,
}

export function RuleDeleteDialog({
  rule,
  onCancel,
  onConfirm,
}: {
  rule: RuleListItem
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open
      aria-labelledby="rule-delete-title"
      keepMounted={false}
      scroll="paper"
      onClose={onCancel}
      slotProps={{ paper: { sx: DIALOG_PAPER_SX } }}
    >
      <DialogTitle id="rule-delete-title">ルール削除</DialogTitle>
      <DialogContent>{ruleKeyword(rule)} を削除しますか?</DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onCancel}>
          キャンセル
        </Button>
        <Button variant="text" color="primary" onClick={onConfirm}>
          削除
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export function BulkDeleteDialog({
  count,
  onCancel,
  onConfirm,
}: {
  count: number
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open
      aria-labelledby="rule-bulk-delete-title"
      keepMounted={false}
      scroll="paper"
      onClose={onCancel}
      slotProps={{ paper: { sx: DIALOG_PAPER_SX } }}
    >
      <DialogTitle id="rule-bulk-delete-title">ルール削除</DialogTitle>
      <DialogContent>選択した {count} 件のルールを削除しますか。</DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onCancel}>
          キャンセル
        </Button>
        <Button variant="text" color="primary" onClick={onConfirm}>
          削除
        </Button>
      </DialogActions>
    </Dialog>
  )
}
