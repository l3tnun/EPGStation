import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import { useState } from 'react'
import { SHELL_NAVIGATION_DRAWER_ID } from '@/app/AppShell'
import { EditTitleBar, TitleBar } from '@/app/titleBar'
import styles from '../ReservesPage.module.css'
import { LegacyMdiIcon, MDI_DOTS_VERTICAL, MDI_PENCIL, MDI_UPDATE } from './LegacyMdiIcon'

export function ReservesTitleBar({
  title,
  isNavigationOpen,
  onNavigationClick,
  isEditMode,
  selectedVisibleCount,
  onCloseEditMode,
  onSelectAll,
  onBulkDelete,
  onEnterEditMode,
  onUpdateReserves,
}: {
  title: string
  isNavigationOpen: boolean
  onNavigationClick: () => void
  isEditMode: boolean
  selectedVisibleCount: number
  onCloseEditMode: () => void
  onSelectAll: () => void
  onBulkDelete: () => void
  onEnterEditMode: () => void
  onUpdateReserves: () => void
}) {
  const [mainMenuAnchor, setMainMenuAnchor] = useState<HTMLElement | null>(null)

  if (isEditMode) {
    return (
      <EditTitleBar
        title={`${selectedVisibleCount} 件選択`}
        onClose={onCloseEditMode}
        onSelectAll={onSelectAll}
        onDelete={onBulkDelete}
      />
    )
  }

  return (
    <TitleBar
      title={title}
      isNavigationOpen={isNavigationOpen}
      navigationControlsId={SHELL_NAVIGATION_DRAWER_ID}
      onNavigationClick={onNavigationClick}
      rightActions={
        <>
          <IconButton
            aria-label="予約メニュー"
            color="inherit"
            sx={{ height: 48, p: 0, width: 48 }}
            onClick={(event) => setMainMenuAnchor(event.currentTarget)}
          >
            <LegacyMdiIcon code={MDI_DOTS_VERTICAL} />
          </IconButton>
          <Menu
            anchorEl={mainMenuAnchor}
            anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
            open={mainMenuAnchor !== null}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            onClose={() => setMainMenuAnchor(null)}
            sx={{
              '& .MuiPaper-root': {
                width: 164,
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
            <MenuItem
              onClick={() => {
                setMainMenuAnchor(null)
                onEnterEditMode()
              }}
            >
              <LegacyMdiIcon className={styles.reserveMenuItemIcon} code={MDI_PENCIL} />
              編集
            </MenuItem>
            <MenuItem
              onClick={() => {
                setMainMenuAnchor(null)
                onUpdateReserves()
              }}
            >
              <LegacyMdiIcon className={styles.reserveMenuItemIcon} code={MDI_UPDATE} />
              予約情報更新
            </MenuItem>
          </Menu>
        </>
      }
    />
  )
}
