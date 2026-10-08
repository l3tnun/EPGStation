export const APP_SHELL_DESKTOP_BREAKPOINT = 1264
export const APP_SHELL_DRAWER_WIDTH = 256

// Matches the legacy Vue/Vuetify navigation drawer (see
// vuetify/src/styles/settings/_variables.scss `fast-out-slow-in` and
// vuetify/src/components/VNavigationDrawer/VNavigationDrawer.sass, `transition-duration: 0.2s`)
// and the main content area's own margin shift (vuetify/src/components/VMain/_variables.scss,
// `$main-transition: 0.2s map-get($transition, 'fast-out-slow-in')`). Both the drawer's own
// open/close slide and the main content's margin-left shift must share this single duration and
// easing so the two stay visually in sync, exactly as they did in the legacy app.
export const APP_SHELL_DRAWER_TRANSITION_DURATION_MS = 200
export const APP_SHELL_DRAWER_TRANSITION_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'

export type DrawerUserState = 'none' | 'userOpen' | 'userClosed'
export type DrawerVariant = 'permanent' | 'persistent' | 'temporary'

export interface DrawerLayoutInput {
  isDesktop: boolean
  userDrawerState: DrawerUserState
}

export interface DrawerLayoutState {
  isDesktop: boolean
  isDrawerOpen: boolean
  drawerVariant: DrawerVariant
  drawerWidth: number
  mainContentOffset: number
}

export function resolveDrawerLayout(input: DrawerLayoutInput): DrawerLayoutState {
  const { isDesktop } = input
  const isDrawerOpen =
    input.userDrawerState === 'none' ? isDesktop : input.userDrawerState === 'userOpen'

  return {
    isDesktop,
    isDrawerOpen,
    drawerVariant:
      isDesktop && !isDrawerOpen ? 'persistent' : isDesktop ? 'permanent' : 'temporary',
    drawerWidth: APP_SHELL_DRAWER_WIDTH,
    mainContentOffset: isDesktop && isDrawerOpen ? APP_SHELL_DRAWER_WIDTH : 0,
  }
}
