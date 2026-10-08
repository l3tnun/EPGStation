import Collapse from '@mui/material/Collapse'
import type { ReactNode } from 'react'
import type { ManualOptionPanelIndex } from '../lib/manualReserveForm'
import styles from '../ReservesPage.module.css'

export function ManualOptionPanel({
  index,
  title,
  isOpen,
  onToggle,
  children,
}: {
  index: ManualOptionPanelIndex
  title: string
  isOpen: boolean
  onToggle: (index: ManualOptionPanelIndex) => void
  children: ReactNode
}) {
  return (
    <section
      className={`${styles.manualOptionPanel} ${isOpen ? '' : styles.manualCollapsedPanel}`}
      data-option-panel-index={String(index)}
    >
      <button
        className={styles.manualPanelHeader}
        type="button"
        aria-expanded={isOpen}
        onClick={() => onToggle(index)}
      >
        <h2>{title}</h2>
        <span
          className={styles.manualPanelChevron}
          aria-hidden="true"
          data-direction={isOpen ? 'up' : 'down'}
        />
      </button>
      <Collapse in={isOpen} timeout="auto" unmountOnExit>
        {children}
      </Collapse>
    </section>
  )
}
