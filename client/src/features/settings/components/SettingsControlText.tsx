import type { SettingsControlDefinition } from '../settingsControlMatrix'
import styles from '../SettingsPage.module.css'

export function SettingsControlText({ control }: { control: SettingsControlDefinition }) {
  return (
    <span className={styles.controlText}>
      <span className={styles.controlLabel}>{control.label}</span>
      {control.subtitle === undefined ? undefined : (
        <span className={styles.controlSubtitle}>{control.subtitle}</span>
      )}
    </span>
  )
}
