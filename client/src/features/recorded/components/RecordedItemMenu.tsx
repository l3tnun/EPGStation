import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ShellSnackbarState } from '@/app/AppShell'
import type { SettingsConsumerValue } from '@/shared/settings'
import type { RecordedApiRepository, RecordedListItem } from '../recordedApi'
import { buildItemRecordedSearchPath, buildItemRuleSearchPath } from '../recordedRequests'
import styles from '../RecordedPage.module.css'
import { recordedId } from '../lib/recordedFormat'
import { openSnackbar } from '../lib/recordedSnackbar'
import { RecordedDeleteDialog } from './RecordedDeleteDialogs'
import { AddEncodeDialog } from './AddEncodeDialog'
import { EMPTY_STRING_LIST } from '../lib/emptyList'

export function RecordedItemMenu({
  item,
  label,
  apiRepository,
  settings,
  isEncodeEnabled = false,
  encodeModes = EMPTY_STRING_LIST,
  recordedDirectories = EMPTY_STRING_LIST,
  onSnackbar,
  onRefetchRequested,
  actionDelayMs = 0,
}: {
  item: RecordedListItem
  label?: string
  apiRepository: RecordedApiRepository
  settings: SettingsConsumerValue
  isEncodeEnabled?: boolean
  encodeModes?: readonly string[]
  recordedDirectories?: readonly string[]
  onSnackbar: (snackbar: ShellSnackbarState) => void
  onRefetchRequested: () => void
  actionDelayMs?: number
}) {
  const navigate = useNavigate()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [isDeleteOpen, setDeleteOpen] = useState(false)
  const [isEncodeOpen, setEncodeOpen] = useState(false)
  const actionTimeout = useRef<number | undefined>(undefined)
  const resolvedLabel = label ?? item.name ?? `#${item.id ?? ''}`
  const itemId = recordedId(item)
  const close = () => setAnchor(null)
  const runAfterMenuClose = (action: () => void) => {
    close()
    if (actionDelayMs <= 0) {
      action()
      return
    }
    window.clearTimeout(actionTimeout.current)
    actionTimeout.current = window.setTimeout(action, actionDelayMs)
  }
  useEffect(
    () => () => {
      window.clearTimeout(actionTimeout.current)
    },
    [],
  )
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
  const runStopEncode = async () => {
    close()
    if (itemId === undefined) return
    const result = await apiRepository.stopEncode(itemId)
    if (result.ok) {
      openSnackbar(onSnackbar, 'エンコード停止')
      onRefetchRequested()
      return
    }
    openSnackbar(onSnackbar, 'エンコード停止に失敗', 'error')
  }

  return (
    <>
      <IconButton
        aria-label={`録画メニュー: ${resolvedLabel}`}
        onClick={(event) => {
          event.stopPropagation()
          setAnchor(event.currentTarget)
        }}
      >
        <span className={styles.menuButtonIcon} aria-hidden="true" />
      </IconButton>
      <Menu
        anchorEl={anchor}
        anchorOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        disableAutoFocusItem
        open={anchor !== null}
        onClose={close}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        slotProps={{
          list: {
            className: styles.legacyMenuList,
          },
          paper: {
            className: `${styles.legacyMenuPaper} ${styles.recordedItemMenuPaper}`,
          },
        }}
      >
        {item.ruleId !== undefined ? (
          <MenuItem
            className={styles.legacyMenuItem}
            onClick={() => {
              runAfterMenuClose(() => {
                navigate(buildItemRuleSearchPath({ ruleId: item.ruleId }))
              })
            }}
          >
            <span
              className={styles.legacyMenuIcon}
              data-recorded-menu-icon="rule"
              aria-hidden="true"
            ></span>
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
          <span
            className={styles.legacyMenuIcon}
            data-recorded-menu-icon="search"
            aria-hidden="true"
          ></span>
          search
        </MenuItem>
        <MenuItem className={styles.legacyMenuItem} onClick={runProtect}>
          <span
            className={styles.legacyMenuIcon}
            data-recorded-menu-icon={item.isProtected ? 'unprotect' : 'protect'}
            aria-hidden="true"
          ></span>
          {item.isProtected ? 'unprotect' : 'protect'}
        </MenuItem>
        {item.isRecording !== true && isEncodeEnabled ? (
          <MenuItem
            className={styles.legacyMenuItem}
            onClick={() => {
              close()
              setEncodeOpen(true)
            }}
          >
            <span
              className={styles.legacyMenuIcon}
              data-recorded-menu-icon="encode"
              aria-hidden="true"
            ></span>
            encode
          </MenuItem>
        ) : undefined}
        {item.isEncoding === true ? (
          <MenuItem className={styles.legacyMenuItem} onClick={runStopEncode}>
            <span
              className={styles.legacyMenuIcon}
              data-recorded-menu-icon="stop"
              aria-hidden="true"
            ></span>
            stop
          </MenuItem>
        ) : undefined}
        <MenuItem
          className={styles.legacyMenuItem}
          onClick={() => {
            runAfterMenuClose(() => {
              setDeleteOpen(true)
            })
          }}
        >
          <span
            className={styles.legacyMenuIcon}
            data-recorded-menu-icon="delete"
            aria-hidden="true"
          ></span>
          delete
        </MenuItem>
      </Menu>
      <RecordedDeleteDialog
        item={item}
        open={isDeleteOpen}
        settings={settings}
        apiRepository={apiRepository}
        onClose={() => setDeleteOpen(false)}
        onSnackbar={onSnackbar}
      />
      <AddEncodeDialog
        item={item}
        open={isEncodeOpen}
        encodeModes={encodeModes}
        recordedDirectories={recordedDirectories}
        apiRepository={apiRepository}
        onClose={() => setEncodeOpen(false)}
        onSnackbar={onSnackbar}
      />
    </>
  )
}
