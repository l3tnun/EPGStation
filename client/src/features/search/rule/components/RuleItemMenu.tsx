import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import type { NavigateFunction } from 'react-router-dom'
import type { RuleListItem } from '../api'
import styles from '../SearchRulePage.module.css'

export interface RuleItemMenuState {
  anchor: HTMLElement
  rule: RuleListItem
}

export function RuleItemMenu({
  menuState,
  navigate,
  onClose,
  onDelete,
}: {
  menuState: RuleItemMenuState | null
  navigate: NavigateFunction
  onClose: () => void
  onDelete: (rule: RuleListItem) => void
}) {
  const rule = menuState?.rule
  const run = (action: (target: RuleListItem) => void, target: RuleListItem) => () => {
    onClose()
    action(target)
  }
  const items =
    rule === undefined
      ? []
      : [
          <MenuItem
            key="recorded"
            onClick={run((target) => navigate(`/recorded?ruleId=${target.id}`), rule)}
          >
            <span
              className={styles.ruleMenuIcon}
              data-rule-menu-icon="recorded"
              aria-hidden="true"
            />
            recorded
          </MenuItem>,
          <MenuItem
            key="edit"
            onClick={run((target) => navigate(`/search?rule=${target.id}`), rule)}
          >
            <span className={styles.ruleMenuIcon} data-rule-menu-icon="edit" aria-hidden="true" />
            edit
          </MenuItem>,
          <MenuItem key="delete" onClick={run(onDelete, rule)}>
            <span className={styles.ruleMenuIcon} data-rule-menu-icon="delete" aria-hidden="true" />
            delete
          </MenuItem>,
        ]

  return (
    <Menu anchorEl={menuState?.anchor ?? null} open={rule !== undefined} onClose={onClose}>
      {items}
    </Menu>
  )
}
