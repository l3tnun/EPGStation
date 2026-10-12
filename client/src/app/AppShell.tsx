import Box from '@mui/material/Box'
import { useEffect, type ReactNode } from 'react'
import { DrawerHost } from './components/DrawerHost'
import { ShellSnackbarHost, type ShellSnackbarState } from './components/ShellSnackbarHost'
import {
  APP_SHELL_DRAWER_TRANSITION_DURATION_MS,
  APP_SHELL_DRAWER_TRANSITION_EASING,
  type DrawerLayoutState,
} from './drawerLayout'
import {
  useFixedTitleBarHeightVariable,
  useFixedTitleBarTouchScrollBridge,
  useViewportHeightVariable,
} from './hooks/useFixedShellViewport'
import type { NavigationItem } from './navigation'
import type { ShellThemeMode } from './theme'
import styles from './AppShell.module.css'

export type { ShellSnackbarSeverity, ShellSnackbarState } from './components/ShellSnackbarHost'
export { SHELL_NAVIGATION_DRAWER_ID } from './components/DrawerHost'

export interface AppShellProps {
  drawerLayout: DrawerLayoutState
  navigationItems: readonly NavigationItem[]
  selectedNavigationItemId?: string
  onNavigationItemClick?: (item: NavigationItem) => void
  onNavigationClose?: () => void
  themeMode: ShellThemeMode
  drawerHeaderTitle?: string
  snackbar?: ShellSnackbarState
  onSnackbarClose?: (snackbar: ShellSnackbarState) => void
  isDisconnected?: boolean
  children: ReactNode
}

export function AppShell({
  drawerLayout,
  navigationItems,
  selectedNavigationItemId,
  onNavigationItemClick,
  onNavigationClose,
  themeMode,
  drawerHeaderTitle = 'EPGStation',
  snackbar,
  onSnackbarClose,
  isDisconnected = false,
  children,
}: AppShellProps) {
  useViewportHeightVariable()
  useFixedTitleBarHeightVariable(children)
  useFixedTitleBarTouchScrollBridge()

  useEffect(() => {
    const previousBodyThemeMode = document.body.dataset.themeMode
    const previousDocumentThemeMode = document.documentElement.dataset.themeMode
    document.body.dataset.themeMode = themeMode
    document.documentElement.dataset.themeMode = themeMode

    return () => {
      if (previousBodyThemeMode === undefined) {
        delete document.body.dataset.themeMode
      } else {
        document.body.dataset.themeMode = previousBodyThemeMode
      }

      if (previousDocumentThemeMode === undefined) {
        delete document.documentElement.dataset.themeMode
      } else {
        document.documentElement.dataset.themeMode = previousDocumentThemeMode
      }
    }
  }, [themeMode])

  return (
    <Box
      className={styles.shell}
      data-testid="app-shell"
      data-theme-mode={themeMode}
      sx={{
        bgcolor: 'background.default',
        color: 'text.primary',
      }}
    >
      <DrawerHost
        drawerLayout={drawerLayout}
        navigationItems={navigationItems}
        selectedNavigationItemId={selectedNavigationItemId}
        onNavigationItemClick={onNavigationItemClick}
        onNavigationClose={onNavigationClose}
        drawerHeaderTitle={drawerHeaderTitle}
      />
      <Box
        className={styles.content}
        data-testid="shell-content"
        sx={{
          '--app-main-offset': `${drawerLayout.mainContentOffset}px`,
          // No explicit width/maxWidth is set here (unlike an earlier implementation that pinned
          // this box to `viewportWidth - drawerLayout.mainContentOffset` in JS pixels): as a
          // block-level box this simply fills whatever width its parent (.shell, which is not
          // itself width-constrained) leaves after `margin-left`, exactly like the legacy Vuetify
          // shell's `.v-main` (vuetify/src/components/VMain/VMain.tsx), which only ever applied a
          // padding-left equal to the drawer width and never measured or set a pixel width of its
          // own. Setting an explicit width here would create a feedback loop on mobile: this
          // box's width fed into the JS-measured viewport width (AppShellContent.tsx), which fed
          // back into this box's own width on the next render.
          marginLeft: `${drawerLayout.mainContentOffset}px`,
          // Shift in step with the drawer's own slide (DrawerHost.tsx), matching the legacy
          // Vuetify shell where `.v-main` carried the same `0.2s fast-out-slow-in` transition as
          // `.v-navigation-drawer` (vuetify/src/components/VMain/_variables.scss,
          // `$main-transition`) so the drawer and the content it displaces move together instead
          // of the drawer sliding while the content jumps.
          transition: `margin-left ${APP_SHELL_DRAWER_TRANSITION_DURATION_MS}ms ${APP_SHELL_DRAWER_TRANSITION_EASING}`,
        }}
      >
        <main
          className={styles.main}
          data-testid="shell-main"
          data-main-offset={drawerLayout.mainContentOffset}
        >
          {children}
        </main>
      </Box>
      {isDisconnected ? (
        <Box className={styles.disconnectedOverlay} data-testid="disconnected-overlay" />
      ) : undefined}
      <ShellSnackbarHost snackbar={snackbar} onSnackbarClose={onSnackbarClose} />
    </Box>
  )
}
