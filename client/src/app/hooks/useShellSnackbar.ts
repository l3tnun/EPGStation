import { useCallback, useRef, useState, type MutableRefObject } from 'react'
import type { ShellSnackbarState } from '../AppShell'

export interface ShellSnackbarController {
  activeSnackbar: ShellSnackbarState | undefined
  showSnackbar: (snackbar: ShellSnackbarState) => void
  /**
   * Closes the snackbar. Given the snackbar that asked for it, closes only if that one is still the
   * active one: a request made on behalf of a snackbar that has since been replaced is dropped.
   */
  closeSnackbar: (snackbar?: ShellSnackbarState) => void
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
  const closeSnackbar = useCallback((snackbar?: ShellSnackbarState) => {
    setActiveSnackbar((active) =>
      snackbar === undefined || active === snackbar ? undefined : active,
    )
  }, [])

  return { activeSnackbar, showSnackbar, closeSnackbar, suppressedRouteSnackbarClosesRef }
}
