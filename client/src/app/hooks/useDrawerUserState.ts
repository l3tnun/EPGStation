import { useEffect, useRef, useState } from 'react'
import { resolveDrawerLayout, type DrawerLayoutState, type DrawerUserState } from '../drawerLayout'

export interface DrawerUserStateResult {
  drawerLayout: DrawerLayoutState
  setDrawerUserState: (state: DrawerUserState) => void
  toggleDrawer: () => void
}

export function useDrawerUserState(
  initialDrawerState: DrawerUserState,
  isDesktop: boolean,
): DrawerUserStateResult {
  const [drawerUserState, setDrawerUserState] = useState<DrawerUserState>(initialDrawerState)
  const wasDesktopViewportRef = useRef<boolean>(isDesktop)
  const drawerLayout = resolveDrawerLayout({
    isDesktop,
    userDrawerState: drawerUserState,
  })

  useEffect(() => {
    const wasDesktopViewport = wasDesktopViewportRef.current
    wasDesktopViewportRef.current = isDesktop

    if (!wasDesktopViewport && isDesktop) {
      setDrawerUserState('none')
    }
  }, [isDesktop])

  const toggleDrawer = () => {
    setDrawerUserState(drawerLayout.isDrawerOpen ? 'userClosed' : 'userOpen')
  }

  return { drawerLayout, setDrawerUserState, toggleDrawer }
}
