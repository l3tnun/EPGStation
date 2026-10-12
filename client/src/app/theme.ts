import { createTheme } from '@mui/material'
import type { ThemeSettings } from '@/shared/settings'

export type ShellThemeMode = 'light' | 'dark'

export interface ShellThemeResolutionInput {
  settings: ThemeSettings
  osPrefersDark: boolean
}

export function resolveShellThemeMode(input: ShellThemeResolutionInput): ShellThemeMode {
  if (input.settings.shouldUseOSColorTheme) {
    return input.osPrefersDark ? 'dark' : 'light'
  }

  return input.settings.isForceDarkTheme ? 'dark' : 'light'
}

export function createShellTheme(mode: ShellThemeMode) {
  const isDark = mode === 'dark'
  const textPrimary = isDark ? 'rgba(255,255,255,0.87)' : 'rgba(0,0,0,0.87)'
  const textSecondary = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)'
  const textDisabled = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.38)'
  const backgroundDefault = isDark ? '#121212' : '#f5f5f5'
  const backgroundPaper = isDark ? '#1e1e1e' : '#ffffff'
  const divider = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'
  const primary = isDark ? '#90caf9' : '#1976d2'

  return createTheme({
    palette: {
      mode,
      primary: {
        main: primary,
      },
      secondary: {
        main: isDark ? '#ce93d8' : '#9c27b0',
      },
      background: {
        default: backgroundDefault,
        paper: backgroundPaper,
      },
      text: {
        primary: textPrimary,
        secondary: textSecondary,
        disabled: textDisabled,
      },
      divider,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            colorScheme: mode,
            '--mui-palette-background-default': backgroundDefault,
            '--mui-palette-background-paper': backgroundPaper,
            '--mui-palette-text-primary': textPrimary,
            '--mui-palette-text-secondary': textSecondary,
            '--mui-palette-text-disabled': textDisabled,
            '--mui-palette-divider': divider,
            '--mui-palette-primary-main': primary,
          },
          'select, input, textarea': {
            colorScheme: mode,
            ...(isDark ? { color: textPrimary } : {}),
          },
          ...(isDark
            ? {
                'select:disabled, input:disabled, textarea:disabled': {
                  color: textDisabled,
                  WebkitTextFillColor: textDisabled,
                },
                option: {
                  backgroundColor: backgroundPaper,
                  color: textPrimary,
                },
              }
            : {}),
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: backgroundPaper,
            color: textPrimary,
          },
        },
      },
      MuiMenu: {
        styleOverrides: {
          paper: {
            backgroundColor: backgroundPaper,
            color: textPrimary,
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            backgroundColor: backgroundPaper,
            color: textPrimary,
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundColor: backgroundPaper,
            color: textPrimary,
          },
        },
      },
      MuiInputBase: {
        styleOverrides: {
          root: {
            color: textPrimary,
          },
          input: {
            color: textPrimary,
            colorScheme: mode,
            '&::placeholder': {
              color: textSecondary,
              opacity: 1,
            },
          },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: {
            color: textSecondary,
            '&.Mui-focused': {
              color: primary,
            },
            '&.Mui-disabled': {
              color: textDisabled,
            },
          },
        },
      },
      MuiSelect: {
        styleOverrides: {
          select: {
            color: textPrimary,
            colorScheme: mode,
          },
          icon: {
            color: textSecondary,
          },
        },
        defaultProps: {
          MenuProps: {
            slotProps: {
              paper: {
                sx: {
                  maxHeight: 216,
                },
              },
            },
          },
        },
      },
      MuiFormHelperText: {
        styleOverrides: {
          root: {
            color: textSecondary,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
        },
      },
      MuiSwitch: {
        styleOverrides: {
          switchBase: {
            color: isDark ? '#bdbdbd' : '#fafafa',
            '&.Mui-checked': {
              color: primary,
            },
            '&.Mui-checked + .MuiSwitch-track': {
              backgroundColor: primary,
              opacity: 0.5,
            },
          },
          track: {
            backgroundColor: isDark ? '#9e9e9e' : '#000000',
            opacity: isDark ? 0.3 : 0.38,
          },
        },
      },
      MuiCheckbox: {
        styleOverrides: {
          root: {
            color: textSecondary,
            '&.Mui-checked': {
              color: primary,
            },
            '&.Mui-disabled': {
              color: textDisabled,
            },
          },
        },
      },
    },
  })
}
