import type { MenuProps } from '@mui/material/Menu'
import type { CSSProperties } from 'react'

export const APP_SELECT_ITEM_HEIGHT = 48
export const APP_SELECT_MAX_VISIBLE_ITEMS = 4.5
export const APP_SELECT_MENU_MAX_HEIGHT = APP_SELECT_ITEM_HEIGHT * APP_SELECT_MAX_VISIBLE_ITEMS

export interface AppSelectMenuConfig {
  disableInternalScroll?: boolean
}

export function createAppSelectMenuProps(
  maxVisibleItems = APP_SELECT_MAX_VISIBLE_ITEMS,
  config: AppSelectMenuConfig = {},
): Partial<MenuProps> {
  const maxHeight = config.disableInternalScroll ? 'none' : APP_SELECT_ITEM_HEIGHT * maxVisibleItems
  const paperStyle: CSSProperties | undefined = config.disableInternalScroll
    ? {
        maxHeight: 'none',
        overflowX: 'visible',
        overflowY: 'visible',
      }
    : undefined

  return {
    slotProps: {
      list: {
        sx: config.disableInternalScroll
          ? {
              overflowY: 'visible',
            }
          : undefined,
      },
      paper: {
        style: paperStyle,
        sx: config.disableInternalScroll
          ? {
              maxHeight: 'none !important',
              overflowX: 'visible !important',
              overflowY: 'visible !important',
            }
          : {
              maxHeight,
            },
      },
    },
  }
}

export const appSelectMenuProps = createAppSelectMenuProps()
