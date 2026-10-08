import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import type { MouseEvent } from 'react'
import {
  LegacyToolbarIcon,
  MDI_BOOKMARK,
  MDI_CLOCK_OUTLINE,
  MDI_COG,
  MDI_DOTS_VERTICAL,
  MDI_UPDATE,
} from './LegacyToolbarIcon'
import styles from '../GuidePage.module.css'

export function GuideTitleActions({
  showTimeSelector,
  mainMenuAnchor,
  onOpenTimeMenu,
  onOpenMainMenu,
  onCloseMainMenu,
  onReserveUpdate,
  onOpenGenreDialog,
  onOpenSetting,
}: {
  showTimeSelector: boolean
  mainMenuAnchor: HTMLElement | null
  onOpenTimeMenu: (anchor: HTMLElement) => void
  onOpenMainMenu: (anchor: HTMLElement) => void
  onCloseMainMenu: () => void
  onReserveUpdate: () => void
  onOpenGenreDialog: () => void
  onOpenSetting: () => void
}) {
  return (
    <>
      {showTimeSelector ? (
        <IconButton
          aria-label="時刻選択"
          color="inherit"
          onClick={(event: MouseEvent<HTMLButtonElement>) => onOpenTimeMenu(event.currentTarget)}
          sx={{ fontSize: 14, height: 48, p: 0, width: 48 }}
        >
          <LegacyToolbarIcon code={MDI_CLOCK_OUTLINE} />
        </IconButton>
      ) : undefined}
      <IconButton
        aria-label="番組表メニュー"
        color="inherit"
        onClick={(event: MouseEvent<HTMLButtonElement>) => onOpenMainMenu(event.currentTarget)}
        sx={{ fontSize: 14, height: 48, p: 0, width: 48 }}
      >
        <LegacyToolbarIcon code={MDI_DOTS_VERTICAL} />
      </IconButton>
      <Menu
        anchorEl={mainMenuAnchor}
        anchorOrigin={{ horizontal: 'right', vertical: 'top' }}
        open={mainMenuAnchor !== null}
        slotProps={{
          list: {
            className: styles.mainMenuList,
          },
          paper: {
            className: styles.mainMenuPaper,
          },
        }}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        onClose={onCloseMainMenu}
      >
        <MenuItem className={styles.mainMenuItem} onClick={onReserveUpdate}>
          <LegacyToolbarIcon code={MDI_UPDATE} />
          <span>予約情報更新</span>
        </MenuItem>
        <MenuItem className={styles.mainMenuItem} onClick={onOpenGenreDialog}>
          <LegacyToolbarIcon code={MDI_BOOKMARK} />
          <span>表示ジャンル</span>
        </MenuItem>
        <MenuItem className={styles.mainMenuItem} onClick={onOpenSetting}>
          <LegacyToolbarIcon code={MDI_COG} />
          <span>表示設定</span>
        </MenuItem>
      </Menu>
    </>
  )
}
