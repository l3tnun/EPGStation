import Box from '@mui/material/Box'
import Drawer, { type DrawerProps } from '@mui/material/Drawer'
import {
  APP_SHELL_DRAWER_TRANSITION_DURATION_MS,
  APP_SHELL_DRAWER_TRANSITION_EASING,
  type DrawerLayoutState,
} from '../drawerLayout'
import type { NavigationItem } from '../navigation'
import styles from '../AppShell.module.css'

export const SHELL_NAVIGATION_DRAWER_ID = 'shell-navigation-drawer'

const LEGACY_DRAWER_TRANSITION_DURATION_MS = APP_SHELL_DRAWER_TRANSITION_DURATION_MS
const LEGACY_DRAWER_TRANSITION_EASING = APP_SHELL_DRAWER_TRANSITION_EASING

// `drawerLayout.drawerVariant` ('permanent' | 'persistent' | 'temporary') is the *semantic* desktop
// open/closed label used for the `data-drawer-variant` attribute and other App Shell state. It must
// never be forwarded directly as MUI Drawer's `variant` prop: MUI's `variant="permanent"` renders
// the paper unconditionally with no Slide/transition wrapper at all (see
// @mui/material/Drawer/Drawer.js, the `variant === 'permanent'` branch returns the paper straight
// from DockedSlot) -- it structurally ignores `open` and can never animate. Using it for the
// desktop-open state, combined with unmounting the whole Drawer for the desktop-closed state, is
// what silently dropped the navigation drawer's open/close animation at every desktop width.
// `variant="persistent"` is the MUI variant that actually supports what the desktop drawer needs:
// docked (in-flow, not an overlay), toggleable via the `open` prop, and Slide-driven so it animates
// exactly like the mobile `temporary` variant already does. Both non-mobile states (open or closed)
// use it; only the mobile overlay case uses `temporary`.
function resolveMuiDrawerVariant(drawerLayout: DrawerLayoutState): DrawerProps['variant'] {
  return drawerLayout.isDesktop ? 'persistent' : 'temporary'
}

function formatNavigationItemTarget(item: NavigationItem): string {
  if (item.queryCondition === undefined) {
    return item.path
  }

  const parameters = new URLSearchParams(item.queryCondition)

  return `${item.path}?${parameters.toString()}`
}

export interface DrawerHostProps {
  drawerLayout: DrawerLayoutState
  navigationItems: readonly NavigationItem[]
  selectedNavigationItemId?: string
  onNavigationItemClick?: (item: NavigationItem) => void
  onNavigationClose?: () => void
  drawerHeaderTitle: string
}

export function DrawerHost({
  drawerLayout,
  navigationItems,
  selectedNavigationItemId,
  onNavigationItemClick,
  onNavigationClose,
  drawerHeaderTitle,
}: DrawerHostProps) {
  const muiDrawerVariant = resolveMuiDrawerVariant(drawerLayout)
  const drawerContent = (
    <Box
      className={styles.drawerContent}
      data-testid="shell-drawer-content"
      sx={{
        bgcolor: 'background.paper',
        borderRightColor: 'divider',
      }}
    >
      <div className={styles.drawerTitle}>{drawerHeaderTitle}</div>
      <nav aria-label="メインナビゲーション">
        <ul className={styles.navigationList}>
          {navigationItems.map((item) => {
            const isSelected = item.id === selectedNavigationItemId

            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={styles.navigationItem}
                  data-testid={`navigation-item-${item.id}`}
                  data-icon={item.icon}
                  data-route-target={formatNavigationItemTarget(item)}
                  data-selected={String(isSelected)}
                  aria-current={isSelected ? 'page' : undefined}
                  onKeyDown={(event) => {
                    if (event.key === ' ' || event.key === 'Spacebar') {
                      event.preventDefault()
                    }
                  }}
                  onClick={() => {
                    onNavigationItemClick?.(item)
                  }}
                >
                  <span className={styles.navigationIcon} aria-hidden="true">
                    {item.icon === 'settings' ? 'settings' : undefined}
                  </span>
                  <span className={styles.navigationLabel}>{item.label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </Box>
  )

  return (
    <Box
      id={SHELL_NAVIGATION_DRAWER_ID}
      data-testid="shell-drawer"
      data-drawer-open={String(drawerLayout.isDrawerOpen)}
      data-drawer-mounted="true"
      data-drawer-variant={drawerLayout.drawerVariant}
      data-drawer-width={drawerLayout.drawerWidth}
      data-drawer-transition-duration-ms={LEGACY_DRAWER_TRANSITION_DURATION_MS}
      data-drawer-transition-easing={LEGACY_DRAWER_TRANSITION_EASING}
    >
      <Drawer
        open={drawerLayout.isDrawerOpen}
        variant={muiDrawerVariant}
        transitionDuration={LEGACY_DRAWER_TRANSITION_DURATION_MS}
        onClose={(_, reason) => {
          if (reason === 'escapeKeyDown') {
            return
          }

          onNavigationClose?.()
        }}
        slotProps={{
          root: {
            keepMounted: !drawerLayout.isDesktop,
          },
          paper: {
            role: 'presentation',
            sx: {
              width: drawerLayout.drawerWidth,
              overflowX: 'hidden',
              overflowY: 'hidden',
              // Slide's exit on WebKit at a 1920px viewport sets translateX in one frame and
              // leaves the paper transitioning only box-shadow. A transform transition on the
              // paper itself is what the close slide interpolates.
              transition: `transform ${LEGACY_DRAWER_TRANSITION_DURATION_MS}ms ${LEGACY_DRAWER_TRANSITION_EASING}`,
              transitionTimingFunction: LEGACY_DRAWER_TRANSITION_EASING,
            },
          },
          transition: {
            easing: LEGACY_DRAWER_TRANSITION_EASING,
          },
          backdrop: {
            sx: {
              backgroundColor: 'rgba(0, 0, 0, 0.46)',
            },
          },
        }}
      >
        {drawerContent}
      </Drawer>
    </Box>
  )
}
