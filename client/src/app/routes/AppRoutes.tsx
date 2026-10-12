import { useEffect } from 'react'
import { Route, Routes } from 'react-router-dom'
import { broadcastRoutes } from './broadcastRoutes'
import { managementRoutes } from './managementRoutes'
import { recordedRoutes } from './recordedRoutes'
import type { AppRouteProps } from './routeProps'

function RoutedPlaceholder() {
  useEffect(() => {
    document.title = 'epgstation'
  }, [])

  return null
}

export function AppRoutes(props: AppRouteProps) {
  return (
    <Routes>
      {broadcastRoutes(props)}
      {recordedRoutes(props)}
      {managementRoutes(props)}
      <Route path="*" element={<RoutedPlaceholder />} />
    </Routes>
  )
}
