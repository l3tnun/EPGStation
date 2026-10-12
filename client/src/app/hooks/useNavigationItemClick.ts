import { useEffect, useRef } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import type { DrawerLayoutState, DrawerUserState } from '../drawerLayout'
import { createNavigationPath } from '../lib/routePath'
import {
  buildNavigationTarget,
  shouldPushNavigation,
  type NavigationItem,
  type NavigationRoute,
  type NavigationTimestampProvider,
} from '../navigation'

export interface NavigationItemClickInput {
  drawerLayout: DrawerLayoutState
  currentRoute: NavigationRoute
  navigate: NavigateFunction
  navigationClickDelayMs: number
  navigationTimestampProvider: NavigationTimestampProvider
  onDrawerUserStateChange: (state: DrawerUserState) => void
  saveCurrentRouteScrollPosition: (options?: { force?: boolean }) => void
}

export function useNavigationItemClick({
  drawerLayout,
  currentRoute,
  navigate,
  navigationClickDelayMs,
  navigationTimestampProvider,
  onDrawerUserStateChange,
  saveCurrentRouteScrollPosition,
}: NavigationItemClickInput): (item: NavigationItem) => void {
  const pendingNavigationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const executeRouteMove = (item: NavigationItem) => {
    const targetRoute = buildNavigationTarget(item, navigationTimestampProvider)

    if (!shouldPushNavigation(currentRoute, targetRoute)) {
      return
    }

    saveCurrentRouteScrollPosition({ force: true })
    navigate(createNavigationPath(targetRoute))
  }
  const handleNavigationItemClick = (item: NavigationItem) => {
    if (pendingNavigationTimer.current !== undefined) {
      clearTimeout(pendingNavigationTimer.current)
      pendingNavigationTimer.current = undefined
    }

    if (drawerLayout.isDesktop) {
      executeRouteMove(item)
      return
    }

    onDrawerUserStateChange('userClosed')
    pendingNavigationTimer.current = setTimeout(() => {
      pendingNavigationTimer.current = undefined
      executeRouteMove(item)
    }, navigationClickDelayMs)
  }

  useEffect(
    () => () => {
      if (pendingNavigationTimer.current !== undefined) {
        clearTimeout(pendingNavigationTimer.current)
      }
    },
    [],
  )

  return handleNavigationItemClick
}
