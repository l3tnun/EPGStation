import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { legacyTitleBarToolbarSx, resolveLegacyTitleBarMetrics } from './titleBarLayout'
import { resolveBrowserTitle } from './titleBarContracts'

export interface TitleBarProps {
  title: string
  onNavigationClick: () => void
  isNavigationOpen: boolean
  navigationControlsId?: string
  onTitleClick?: () => void
  rightActions?: ReactNode
  extension?: ReactNode
}

const legacyTitleBarMetrics = resolveLegacyTitleBarMetrics()
const legacyTitleBarAppBarSx = {
  clipPath: 'inset(0 0 -16px 0)',
  top: 0,
} as const
const LEGACY_LIGHT_APP_BAR_COLOR = '#3f51b5'
const LEGACY_DARK_APP_BAR_COLOR = '#272727'

function useBrowserTitle(title: string): void {
  useEffect(() => {
    document.title = resolveBrowserTitle({ routeKind: 'screen', title })
  }, [title])
}

export function TitleBar({
  title,
  onNavigationClick,
  isNavigationOpen,
  navigationControlsId,
  onTitleClick,
  rightActions,
  extension,
}: TitleBarProps) {
  const theme = useTheme()
  const isDarkTheme = theme.palette.mode === 'dark'
  useBrowserTitle(title)

  return (
    <AppBar
      data-app-bar-treatment={isDarkTheme ? 'dark' : 'light'}
      data-testid="title-bar"
      elevation={isDarkTheme ? 0 : 4}
      position="sticky"
      sx={{
        ...legacyTitleBarAppBarSx,
        bgcolor: isDarkTheme ? LEGACY_DARK_APP_BAR_COLOR : LEGACY_LIGHT_APP_BAR_COLOR,
        color: isDarkTheme ? 'text.primary' : 'primary.contrastText',
      }}
    >
      <Toolbar disableGutters sx={legacyTitleBarToolbarSx}>
        <IconButton
          aria-controls={navigationControlsId}
          aria-expanded={isNavigationOpen}
          aria-label="ナビゲーションを開閉"
          color="inherit"
          edge="start"
          onClick={onNavigationClick}
          sx={{
            fontSize: 14,
            fontWeight: 500,
            height: legacyTitleBarMetrics.navigationButtonSize,
            letterSpacing: '1.25px',
            lineHeight: '21px',
            ml: `${legacyTitleBarMetrics.navigationButtonMarginLeft}px`,
            mr: 0,
            p: 0,
            width: legacyTitleBarMetrics.navigationButtonSize,
          }}
        >
          <Box
            aria-hidden="true"
            component="span"
            sx={{
              display: 'inline-block',
              font: "normal normal normal 24px/1 'Material Design Icons'",
              height: 24,
              width: 24,
              '&::before': {
                content: '"\\F035C"',
              },
            }}
          />
        </IconButton>
        {onTitleClick === undefined ? (
          <Box sx={{ minWidth: 0, pr: 1 }}>
            <Typography
              component="h1"
              noWrap
              sx={{
                fontWeight: 400,
                letterSpacing: 'normal',
                lineHeight: '30px',
                pl: `${legacyTitleBarMetrics.titlePaddingLeft}px`,
              }}
              variant="h6"
            >
              {title}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ minWidth: 0, pr: 1 }}>
            <Typography
              component="h1"
              noWrap
              onClick={onTitleClick}
              sx={{
                cursor: 'pointer',
                fontWeight: 400,
                letterSpacing: 'normal',
                lineHeight: '30px',
                pl: `${legacyTitleBarMetrics.titlePaddingLeft}px`,
              }}
              variant="h6"
            >
              {title}
            </Typography>
          </Box>
        )}
        <Box sx={{ flexGrow: 1 }} />
        {rightActions}
      </Toolbar>
      {extension === undefined ? undefined : <Box>{extension}</Box>}
    </AppBar>
  )
}
