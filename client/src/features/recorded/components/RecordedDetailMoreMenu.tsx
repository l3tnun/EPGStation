import Button from '@mui/material/Button'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import { useState } from 'react'
import type { HTMLAttributes } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ShellSnackbarState } from '@/app/AppShell'
import type { SettingsConsumerValue } from '@/shared/settings'
import type { RecordedApiRepository, RecordedListItem } from '../recordedApi'
import { buildItemRecordedSearchPath, buildItemRuleSearchPath } from '../recordedRequests'
import styles from '../RecordedPage.module.css'
import { recordedId } from '../lib/recordedFormat'
import { RecordedPlainDialog } from './RecordedPlainDialog'
import { openSnackbar } from '../lib/recordedSnackbar'
import { RecordedDeleteDialog } from './RecordedDeleteDialogs'
import { RecordedDownloadDialog } from './RecordedDownloadDialog'

export function DropLogDialog({
  open,
  title,
  content,
  onClose,
}: {
  open: boolean
  title: string
  content: string | null
  onClose: () => void
}) {
  return (
    <RecordedPlainDialog open={open} title={title} maxWidth={600} onClose={onClose}>
      <DialogContent className={styles.dropLogContent}>
        <pre className={styles.dropLogPre}>{content ?? 'ログファイルがありません'}</pre>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>閉じる</Button>
      </DialogActions>
    </RecordedPlainDialog>
  )
}

export function RecordedDetailMoreMenu({
  item,
  settings,
  apiRepository,
  recordedDownloadUrlScheme,
  onSnackbar,
  onDeletedAllFiles,
}: {
  item: RecordedListItem
  settings: SettingsConsumerValue
  apiRepository: RecordedApiRepository
  recordedDownloadUrlScheme?: string | null
  onSnackbar: (snackbar: ShellSnackbarState) => void
  onDeletedAllFiles: () => void
}) {
  const navigate = useNavigate()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [isDownloadOpen, setDownloadOpen] = useState(false)
  const [isDeleteOpen, setDeleteOpen] = useState(false)
  const itemId = recordedId(item)
  const label = item.name ?? `#${item.id ?? ''}`
  const close = () => setAnchor(null)
  const runProtect = async () => {
    close()
    if (itemId === undefined) return
    const result = item.isProtected
      ? await apiRepository.unprotectRecorded(itemId)
      : await apiRepository.protectRecorded(itemId)
    if (result.ok) {
      openSnackbar(onSnackbar, item.isProtected ? '保護解除に成功' : '保護に成功')
      return
    }
    openSnackbar(onSnackbar, item.isProtected ? '保護解除に失敗' : '保護に失敗', 'error')
  }

  return (
    <>
      <IconButton
        className={styles.detailTitleMenuButton}
        aria-label={`録画詳細メニュー: ${label}`}
        color="inherit"
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        <span className={styles.menuButtonIcon} aria-hidden="true" />
      </IconButton>
      <Menu
        anchorEl={anchor}
        anchorOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        open={anchor !== null}
        onClose={close}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        slotProps={{
          paper: {
            className: styles.legacyMenuPaper,
          },
          list: {
            className: styles.legacyMenuList,
            'data-recorded-detail-menu-anchor': 'legacy-overlap',
          } as HTMLAttributes<HTMLUListElement>,
        }}
      >
        <MenuItem
          className={styles.legacyMenuItem}
          onClick={() => {
            close()
            setDownloadOpen(true)
          }}
        >
          <span className={styles.legacyMenuIcon} data-recorded-menu-icon="download" />
          download
        </MenuItem>
        {item.ruleId !== undefined ? (
          <MenuItem
            className={styles.legacyMenuItem}
            onClick={() => {
              close()
              navigate(buildItemRuleSearchPath({ ruleId: item.ruleId }))
            }}
          >
            <span className={styles.legacyMenuIcon} data-recorded-menu-icon="rule" />
            rule
          </MenuItem>
        ) : undefined}
        <MenuItem
          className={styles.legacyMenuItem}
          onClick={() => {
            close()
            navigate(buildItemRecordedSearchPath({ ruleId: item.ruleId, name: item.name }))
          }}
        >
          <span className={styles.legacyMenuIcon} data-recorded-menu-icon="search" />
          search
        </MenuItem>
        <MenuItem className={styles.legacyMenuItem} onClick={runProtect}>
          <span
            className={styles.legacyMenuIcon}
            data-recorded-menu-icon={item.isProtected ? 'unprotect' : 'protect'}
          />
          {item.isProtected ? 'unprotect' : 'protect'}
        </MenuItem>
        <MenuItem
          className={styles.legacyMenuItem}
          onClick={() => {
            close()
            setDeleteOpen(true)
          }}
        >
          <span className={styles.legacyMenuIcon} data-recorded-menu-icon="delete" />
          delete
        </MenuItem>
      </Menu>
      <RecordedDownloadDialog
        open={isDownloadOpen}
        item={item}
        settings={settings}
        recordedDownloadUrlScheme={recordedDownloadUrlScheme}
        onClose={() => setDownloadOpen(false)}
      />
      <RecordedDeleteDialog
        item={item}
        open={isDeleteOpen}
        settings={settings}
        apiRepository={apiRepository}
        onClose={() => setDeleteOpen(false)}
        onSnackbar={onSnackbar}
        onDeleteSuccess={(result) => {
          if (result.allFilesDeleted) {
            onDeletedAllFiles()
          }
        }}
      />
    </>
  )
}
