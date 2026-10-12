import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ShellSnackbarState } from '@/app/AppShell'
import type {
  ReservesApiRepository,
  ReserveListItem as ReserveListItemModel,
} from '../lib/reservesApiTypes'
import { openReserveSnackbar, reserveLabel } from '../lib/reserveLabels'
import { buildReserveEditPath, buildReserveRecordedSearchPath } from '../lib/reserveRoutes'
import styles from '../ReservesPage.module.css'
import {
  LegacyMdiIcon,
  MDI_DELETE,
  MDI_DOTS_VERTICAL,
  MDI_FILMSTRIP_BOX_MULTIPLE,
  MDI_LOCK_OPEN,
  MDI_PENCIL,
} from './LegacyMdiIcon'

export function ReserveMenu({
  item,
  label,
  apiRepository,
  disableEdit = false,
  onSnackbar,
  onDeleteRequest,
  onRefetchRequested,
}: {
  item: ReserveListItemModel
  label?: string
  apiRepository: ReservesApiRepository
  disableEdit?: boolean
  onSnackbar: (snackbar: ShellSnackbarState) => void
  onDeleteRequest?: (item: ReserveListItemModel) => void
  onRefetchRequested?: () => void
}) {
  const navigate = useNavigate()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const resolvedLabel = label ?? reserveLabel(item)
  const close = () => setAnchor(null)
  const runUnlock = async () => {
    close()
    const isSkip = item.isSkip === true
    const result = isSkip
      ? await apiRepository.unlockSkipReserve(item.id)
      : await apiRepository.unlockOverlapReserve(item.id)
    const text = isSkip
      ? `${resolvedLabel} ${result.ok ? '除外解除' : '除外解除失敗'}`
      : `${resolvedLabel} ${result.ok ? '重複解除' : '重複解除失敗'}`

    openReserveSnackbar(onSnackbar, text, result.ok ? 'success' : 'error')
    if (result.ok) {
      onRefetchRequested?.()
    }
  }

  return (
    <>
      <IconButton
        aria-label={`予約メニュー: ${resolvedLabel}`}
        sx={{ height: 36, p: 0, width: 36 }}
        onClick={(event) => {
          event.stopPropagation()
          setAnchor(event.currentTarget)
        }}
      >
        <LegacyMdiIcon code={MDI_DOTS_VERTICAL} />
      </IconButton>
      <Menu
        anchorEl={anchor}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        open={anchor !== null}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        onClick={(event) => event.stopPropagation()}
        onClose={close}
        sx={{
          '& .MuiPaper-root': {
            width: 129,
          },
          '& .MuiMenu-list': {
            py: 1,
          },
          '& .MuiMenuItem-root': {
            fontSize: '1rem',
            minHeight: 56,
            px: 2,
          },
        }}
      >
        {item.ruleId !== undefined ? (
          <MenuItem
            onClick={() => {
              close()
              navigate(buildReserveRecordedSearchPath({ ruleId: item.ruleId }))
            }}
          >
            <LegacyMdiIcon
              className={styles.reserveMenuItemIcon}
              code={MDI_FILMSTRIP_BOX_MULTIPLE}
            />
            recorded
          </MenuItem>
        ) : undefined}
        {!disableEdit ? (
          <MenuItem
            onClick={() => {
              close()
              const path = buildReserveEditPath({ reserveId: item.id, ruleId: item.ruleId })
              navigate(path)
            }}
          >
            <LegacyMdiIcon className={styles.reserveMenuItemIcon} code={MDI_PENCIL} />
            edit
          </MenuItem>
        ) : undefined}
        {!disableEdit &&
        item.isConflict !== true &&
        item.isSkip !== true &&
        item.isOverlap !== true ? (
          <MenuItem
            onClick={() => {
              close()
              onDeleteRequest?.(item)
            }}
          >
            <LegacyMdiIcon className={styles.reserveMenuItemIcon} code={MDI_DELETE} />
            delete
          </MenuItem>
        ) : undefined}
        {!disableEdit &&
        item.isConflict !== true &&
        (item.isSkip === true || item.isOverlap === true) ? (
          <MenuItem onClick={() => void runUnlock()}>
            <LegacyMdiIcon className={styles.reserveMenuItemIcon} code={MDI_LOCK_OPEN} />
            unlock
          </MenuItem>
        ) : undefined}
      </Menu>
    </>
  )
}
