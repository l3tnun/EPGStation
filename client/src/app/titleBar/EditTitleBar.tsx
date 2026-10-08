import AppBar from '@mui/material/AppBar'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Toolbar from '@mui/material/Toolbar'
import Typography from '@mui/material/Typography'
import { useTheme } from '@mui/material/styles'
import { legacyTitleBarToolbarSx } from './titleBarLayout'

const MDI_CLOSE = '\\F0156'
const MDI_DELETE = '\\F01B4'
const MDI_SELECT_ALL = '\\F0486'
const legacyEditTitleBarAppBarSx = {
  clipPath: 'inset(0 0 -16px 0)',
  top: 0,
} as const
const LEGACY_DARK_APP_BAR_COLOR = '#272727'

export interface EditTitleBarProps {
  title: string
  onClose: () => void
  onSelectAll: () => void
  onDelete: () => void
}

function LegacyTitleBarIcon({ code }: { code: string }) {
  return (
    <Box
      aria-hidden="true"
      component="span"
      sx={{
        display: 'inline-block',
        font: "normal normal normal 24px/1 'Material Design Icons'",
        height: 24,
        width: 24,
        '&::before': {
          content: `"${code}"`,
        },
      }}
    />
  )
}

export function EditTitleBar({ title, onClose, onSelectAll, onDelete }: EditTitleBarProps) {
  const theme = useTheme()
  const isDarkTheme = theme.palette.mode === 'dark'

  return (
    <AppBar
      data-app-bar-treatment={isDarkTheme ? 'dark' : 'light'}
      data-testid="edit-title-bar"
      elevation={isDarkTheme ? 0 : 2}
      position="sticky"
      sx={{
        ...legacyEditTitleBarAppBarSx,
        bgcolor: isDarkTheme ? LEGACY_DARK_APP_BAR_COLOR : '#ffffff',
        color: 'text.primary',
      }}
    >
      <Toolbar disableGutters sx={legacyTitleBarToolbarSx}>
        <IconButton
          aria-label="編集を終了"
          color="inherit"
          edge="start"
          onClick={onClose}
          sx={{ fontSize: 14, height: 48, ml: 0.5, mr: 0, p: 0, width: 48 }}
        >
          <LegacyTitleBarIcon code={MDI_CLOSE} />
        </IconButton>
        <Typography component="h1" noWrap sx={{ minWidth: 0, px: 1 }} variant="h6">
          {title}
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <IconButton
          aria-label="すべて選択"
          color="inherit"
          sx={{ fontSize: 14, height: 48, p: 0, width: 48 }}
          onClick={onSelectAll}
        >
          <LegacyTitleBarIcon code={MDI_SELECT_ALL} />
        </IconButton>
        <IconButton
          aria-label="選択項目を削除"
          color="inherit"
          sx={{ fontSize: 14, height: 48, p: 0, width: 48 }}
          onClick={onDelete}
        >
          <LegacyTitleBarIcon code={MDI_DELETE} />
        </IconButton>
      </Toolbar>
    </AppBar>
  )
}
