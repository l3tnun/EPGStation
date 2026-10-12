import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import { SHELL_NAVIGATION_DRAWER_ID } from '@/app/AppShell'
import { EditTitleBar, TitleBar } from '@/app/titleBar'
import styles from '../SearchRulePage.module.css'

const MDI_PENCIL = '\\F03EB'

export function RuleListTitleBar({
  isEditMode,
  title,
  isNavigationOpen,
  onNavigationClick,
  onCloseEditMode,
  onSelectAll,
  onDelete,
  onOpenSearch,
  onOpenEditMode,
}: {
  isEditMode: boolean
  title: string
  isNavigationOpen: boolean
  onNavigationClick: () => void
  onCloseEditMode: () => void
  onSelectAll: () => void
  onDelete: () => void
  onOpenSearch: (anchor: HTMLElement) => void
  onOpenEditMode: () => void
}) {
  if (isEditMode) {
    return (
      <EditTitleBar
        title={title}
        onClose={onCloseEditMode}
        onSelectAll={onSelectAll}
        onDelete={onDelete}
      />
    )
  }

  return (
    <TitleBar
      title="ルール"
      isNavigationOpen={isNavigationOpen}
      navigationControlsId={SHELL_NAVIGATION_DRAWER_ID}
      onNavigationClick={onNavigationClick}
      rightActions={
        <div className={styles.titleActions}>
          <IconButton
            aria-label="検索"
            color="inherit"
            onClick={(event) => onOpenSearch(event.currentTarget)}
          >
            <span
              className={styles.titleBarIcon}
              data-rule-title-icon="search"
              aria-hidden="true"
            />
          </IconButton>
          <IconButton
            aria-label="ルールを編集"
            color="inherit"
            sx={{ fontSize: 14, height: 48, p: 0, width: 48 }}
            onClick={onOpenEditMode}
          >
            <Box
              aria-hidden="true"
              component="span"
              sx={{
                display: 'inline-block',
                font: "normal normal normal 24px/1 'Material Design Icons'",
                height: 24,
                width: 24,
                '&::before': { content: `"${MDI_PENCIL}"` },
              }}
            />
          </IconButton>
        </div>
      }
    />
  )
}
