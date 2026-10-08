import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import type { RuleListItem } from '../api'
import { ruleChannel, ruleGenre, ruleIgnoreKeyword, ruleKeyword } from '../lib/ruleListText'
import styles from '../SearchRulePage.module.css'

export function RuleListRow({
  rule,
  isEnabled,
  isEditMode,
  isSelected,
  onToggleEnable,
  onToggleSelection,
  onOpenMenu,
}: {
  rule: RuleListItem
  isEnabled: boolean
  isEditMode: boolean
  isSelected: boolean
  onToggleEnable: () => void
  onToggleSelection: () => void
  onOpenMenu: (anchor: HTMLElement) => void
}) {
  return (
    <article
      className={styles.ruleItem}
      data-selected={isSelected}
      data-testid={`rule-item-${rule.id}`}
      role="listitem"
    >
      {isEditMode ? (
        <span className={styles.ruleSwitchButton} aria-hidden="true" />
      ) : (
        <Button className={styles.ruleSwitchButton} variant="text" onClick={onToggleEnable}>
          <span className={styles.ruleSwitch} data-checked={isEnabled} />
          <span className={styles.accessibleText}>{isEnabled ? '無効化' : '有効化'}</span>
        </Button>
      )}
      <button
        className={styles.ruleItemMain}
        type="button"
        onClick={() => {
          if (isEditMode) onToggleSelection()
        }}
      >
        <span>{ruleKeyword(rule)}</span>
        <span>{ruleIgnoreKeyword(rule)}</span>
        <span>{ruleChannel(rule)}</span>
        <span>{ruleGenre(rule)}</span>
        <span>{rule.reservesCnt ?? 0}</span>
      </button>
      {isEditMode ? null : (
        <div className={styles.ruleActions}>
          <IconButton
            aria-label={`ルールメニュー: ${ruleKeyword(rule)}`}
            onClick={(event) => onOpenMenu(event.currentTarget)}
          >
            <span className={styles.ruleActionIcon} aria-hidden="true" />
          </IconButton>
        </div>
      )}
    </article>
  )
}
