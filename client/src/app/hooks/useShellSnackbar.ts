import { useCallback, useRef, useState, type MutableRefObject } from 'react'
import type { ShellSnackbarState } from '../AppShell'

export interface ShellSnackbarController {
  activeSnackbar: ShellSnackbarState | undefined
  showSnackbar: (snackbar: ShellSnackbarState) => void
  closeSnackbar: () => void
  /** Number of upcoming route changes that must not close the active snackbar. */
  suppressedRouteSnackbarClosesRef: MutableRefObject<number>
}

export function useShellSnackbar(
  initialSnackbar: ShellSnackbarState | undefined,
): ShellSnackbarController {
  const suppressedRouteSnackbarClosesRef = useRef(0)
  const [activeSnackbar, setActiveSnackbar] = useState<ShellSnackbarState | undefined>(
    initialSnackbar,
  )
  const showSnackbar = useCallback((snackbar: ShellSnackbarState) => {
    setActiveSnackbar({
      timeout: 1500,
      ...snackbar,
    })
  }, [])
  const closeSnackbar = useCallback(() => {
    setActiveSnackbar(undefined)
  }, [])

  return { activeSnackbar, showSnackbar, closeSnackbar, suppressedRouteSnackbarClosesRef }
}
