import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Snackbar from '@mui/material/Snackbar'
import SnackbarContent from '@mui/material/SnackbarContent'
import { useState } from 'react'

export type ShellSnackbarSeverity = 'success' | 'info' | 'warning' | 'error'

export interface ShellSnackbarState {
  text: string
  severity?: ShellSnackbarSeverity
  timeout?: number
}

const SNACKBAR_BACKGROUND_BY_SEVERITY: Record<ShellSnackbarSeverity | 'default', string> = {
  default: '#424242',
  error: '#ff5252',
  info: '#2196f3',
  success: '#4caf50',
  warning: '#fb8c00',
}

export interface ShellSnackbarHostProps {
  snackbar?: ShellSnackbarState
  onSnackbarClose?: () => void
}

export function ShellSnackbarHost({ snackbar, onSnackbarClose }: ShellSnackbarHostProps) {
  // What was announced, kept after the announcement itself is gone.
  //
  // The snackbar dismisses itself on a timer, so anything reading it from the outside has to catch
  // it while it is on screen. A browser test cannot: it observes over a real clock, and by the time
  // it looks the notification may have closed, or a later one may have taken its place. Freezing the
  // clock does not help either -- the work that produces the notification is itself timer-driven, so
  // stopping time stops the notification from ever arriving.
  //
  // This keeps the announced text and severity in the DOM after the snackbar closes, so a reader can
  // ask what was announced instead of racing to see it. Nothing renders from it; it exists to be
  // read.
  const [announced, setAnnounced] = useState<{
    history: ShellSnackbarState[]
    last?: ShellSnackbarState
  }>({
    history: [],
  })
  // Derived while rendering rather than in an effect: an effect would set state after the render
  // that already showed the snackbar, so a reader could see the notification on screen before the
  // record of it exists. Comparing against what was last recorded is what keeps this from looping,
  // and re-rendering during render is how React is meant to be told a value depends on a prop.
  if (snackbar !== undefined && snackbar !== announced.last) {
    setAnnounced({ history: [...announced.history, snackbar], last: snackbar })
  }

  return (
    <>
      <span
        data-testid="shell-announced-notification"
        data-announced-text={announced.last?.text ?? ''}
        data-announced-severity={announced.last?.severity ?? ''}
        data-announced-count={String(announced.history.length)}
        data-announced-history={JSON.stringify(announced.history.map((entry) => entry.text))}
        hidden
      />
      <Snackbar
        open={snackbar !== undefined}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        autoHideDuration={snackbar?.timeout}
        onClose={onSnackbarClose}
        sx={{
          bottom: '8px !important',
          left: '50% !important',
          maxWidth: 'calc(100vw - 16px)',
          right: 'auto !important',
          transform: 'translateX(-50%)',
          width: 'auto',
        }}
      >
        {snackbar === undefined ? undefined : (
          <Box
            data-snackbar-severity={snackbar.severity ?? 'default'}
            sx={{ maxWidth: 'calc(100vw - 16px)' }}
          >
            <SnackbarContent
              className={`snackbar ${snackbar.severity ?? 'default'}`}
              message={snackbar.text}
              role="alert"
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => onSnackbarClose?.()}
                  sx={{
                    borderRadius: '4px',
                    fontSize: '12px',
                    height: 28,
                    minWidth: 65,
                    padding: '0 12.4444px',
                    transform: 'translateX(-3px)',
                  }}
                >
                  閉じる
                </Button>
              }
              sx={{
                alignItems: 'center',
                bgcolor: SNACKBAR_BACKGROUND_BY_SEVERITY[snackbar.severity ?? 'default'],
                borderRadius: '4px',
                boxShadow:
                  '0 3px 5px -1px rgba(0,0,0,.2), 0 6px 10px 0 rgba(0,0,0,.14), 0 1px 18px 0 rgba(0,0,0,.12)',
                color: '#fff',
                flexWrap: 'nowrap',
                fontSize: '16px',
                boxSizing: 'border-box',
                maxWidth: 680,
                minHeight: 48,
                minWidth: 300,
                padding: 0,
                width: 'max-content',
                '& .MuiSnackbarContent-message': {
                  flex: '1 1 auto',
                  fontSize: '16px',
                  lineHeight: '24px',
                  minWidth: 0,
                  overflowWrap: 'break-word',
                  padding: '14px 16px',
                  whiteSpace: 'normal',
                },
                '& .MuiSnackbarContent-action': {
                  alignSelf: 'center',
                  marginRight: '5.578125px',
                  paddingLeft: 0,
                },
              }}
            />
          </Box>
        )}
      </Snackbar>
    </>
  )
}
