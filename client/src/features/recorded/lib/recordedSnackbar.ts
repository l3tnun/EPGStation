import type { ShellSnackbarState } from '@/app/AppShell'
export function openSnackbar(
  onSnackbar: (snackbar: ShellSnackbarState) => void,
  text: string,
  severity: ShellSnackbarState['severity'] = 'success',
): void {
  onSnackbar({ text, severity })
}
