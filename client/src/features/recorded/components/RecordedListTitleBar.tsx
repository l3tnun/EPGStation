import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import type { MouseEvent } from 'react'
import { useState } from 'react'
import { SHELL_NAVIGATION_DRAWER_ID } from '@/app/AppShell'
import { EditTitleBar, TitleBar } from '@/app/titleBar'
import styles from '../RecordedPage.module.css'

export interface RecordedListTitleBarProps {
  isEditMode: boolean
  editTitle: string
  isNavigationOpen: boolean
  onNavigationClick: () => void
  onCloseEditMode: () => void
  onSelectAll: () => void
  onBulkDelete: () => void
  onSearchOpen: (anchor: HTMLElement) => void
  onEditStart: () => void
  onCleanupOpen: () => void
  onUploadClick: () => void
}

export function RecordedListTitleBar({
  isEditMode,
  editTitle,
  isNavigationOpen,
  onNavigationClick,
  onCloseEditMode,
  onSelectAll,
  onBulkDelete,
  onSearchOpen,
  onEditStart,
  onCleanupOpen,
  onUploadClick,
}: RecordedListTitleBarProps) {
  const [mainMenuAnchor, setMainMenuAnchor] = useState<HTMLElement | null>(null)

  return (
    <>
      {isEditMode ? (
        <EditTitleBar
          title={editTitle}
          onClose={onCloseEditMode}
          onSelectAll={onSelectAll}
          onDelete={onBulkDelete}
        />
      ) : (
        <TitleBar
          title="録画済み"
          isNavigationOpen={isNavigationOpen}
          navigationControlsId={SHELL_NAVIGATION_DRAWER_ID}
          onNavigationClick={onNavigationClick}
          rightActions={
            <>
              <IconButton
                aria-label="録画検索"
                color="inherit"
                onClick={(event: MouseEvent<HTMLElement>) => onSearchOpen(event.currentTarget)}
              >
                <span
                  className={styles.titleBarIcon}
                  data-recorded-title-icon="search"
                  aria-hidden="true"
                />
              </IconButton>
              <IconButton
                aria-label="録画済みメニュー"
                color="inherit"
                onClick={(event) => setMainMenuAnchor(event.currentTarget)}
              >
                <span
                  className={styles.titleBarIcon}
                  data-recorded-title-icon="more"
                  aria-hidden="true"
                />
              </IconButton>
              <Menu
                anchorEl={mainMenuAnchor}
                anchorOrigin={{
                  vertical: 'top',
                  horizontal: 'right',
                }}
                disableAutoFocusItem
                open={mainMenuAnchor !== null}
                onClose={() => setMainMenuAnchor(null)}
                transformOrigin={{
                  vertical: 'top',
                  horizontal: 'right',
                }}
                slotProps={{
                  list: {
                    className: styles.legacyMenuList,
                  },
                  paper: {
                    className: `${styles.legacyMenuPaper} ${styles.recordedMainMenuPaper}`,
                  },
                }}
              >
                <MenuItem
                  className={styles.legacyMenuItem}
                  onClick={() => {
                    setMainMenuAnchor(null)
                    onEditStart()
                  }}
                >
                  <span
                    className={styles.legacyMenuIcon}
                    data-recorded-menu-icon="edit"
                    aria-hidden="true"
                  ></span>
                  編集
                </MenuItem>
                <MenuItem
                  className={styles.legacyMenuItem}
                  onClick={() => {
                    setMainMenuAnchor(null)
                    onCleanupOpen()
                  }}
                >
                  <span
                    className={styles.legacyMenuIcon}
                    data-recorded-menu-icon="delete"
                    aria-hidden="true"
                  ></span>
                  クリーンアップ
                </MenuItem>
                <MenuItem
                  className={styles.legacyMenuItem}
                  onClick={() => {
                    setMainMenuAnchor(null)
                    onUploadClick()
                  }}
                >
                  <span
                    className={styles.legacyMenuIcon}
                    data-recorded-menu-icon="upload"
                    aria-hidden="true"
                  ></span>
                  アップロード
                </MenuItem>
              </Menu>
            </>
          }
        />
      )}
    </>
  )
}
