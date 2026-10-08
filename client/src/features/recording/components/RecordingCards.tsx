import { formatFullTime, itemChannel, itemId, itemLabel } from '../lib/recordingFormat'
import styles from '../RecordingPage.module.css'
import type { RecordingListProps } from './RecordingTable'

function isBlankDescription(description: string | undefined): boolean {
  return description === undefined || description.replace(/\s+/g, '').length === 0
}

export function RecordingCards({
  records,
  isEditMode,
  selectedIds,
  onRowAction,
  renderMenu,
}: RecordingListProps) {
  return (
    <div className={styles.recordingCards} aria-label="録画中一覧カード">
      {records.map((item, index) => {
        const id = itemId(item)
        const label = itemLabel(item, index)
        const isSelected = id !== undefined && selectedIds.has(id)

        return (
          <article
            className={`${styles.recordingCard} ${isSelected ? styles.selectedCard : ''}`}
            data-selected={isSelected ? 'true' : 'false'}
            data-testid="recording-list-item"
            key={`${id ?? 'recording-card'}-${index}`}
            onClick={() => {
              if (id !== undefined) {
                onRowAction(id)
              }
            }}
          >
            <div className={styles.cardContent}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitle}>{label}</div>
                {!isEditMode ? (
                  <div className={styles.cardMenu} onClick={(event) => event.stopPropagation()}>
                    {renderMenu(item, label)}
                  </div>
                ) : undefined}
              </div>
              <div className={styles.cardText}>{itemChannel(item)}</div>
              <div className={styles.cardText}>{formatFullTime(item)}</div>
              <div
                className={
                  isBlankDescription(item.description)
                    ? `${styles.cardText} ${styles.cardDummy}`
                    : styles.cardDescription
                }
              >
                {isBlankDescription(item.description) ? 'dummy' : item.description}
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}
