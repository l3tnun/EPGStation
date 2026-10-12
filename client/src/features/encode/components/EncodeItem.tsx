import IconButton from '@mui/material/IconButton'
import type { EncodeDisplayItem } from '../encodeRequests'
import styles from '../EncodePage.module.css'

function EncodeItemBody({ item }: { item: EncodeDisplayItem }) {
  return (
    <>
      {item.thumbnailPath === null ? (
        <span aria-hidden="true" className={`${styles.thumbnail} ${styles.thumbnailFallback}`} />
      ) : (
        <img
          alt={`${item.title} サムネイル`}
          className={styles.thumbnail}
          src={item.thumbnailPath}
          onError={(event) => {
            event.currentTarget.style.visibility = 'hidden'
          }}
        />
      )}
      <span className={styles.content}>
        <span className={styles.title}>{item.title}</span>
        {item.channelName === undefined ? undefined : (
          <span className={styles.meta}>{item.channelName}</span>
        )}
        <span className={styles.meta}>
          {[item.timeText, item.durationText === undefined ? undefined : `(${item.durationText})`]
            .filter(Boolean)
            .join(' ')}
        </span>
        <span className={styles.mode}>{item.mode}</span>
        <span className={styles.progressText}>{item.progressText ?? ''}</span>
        {item.progressValue === undefined ? undefined : (
          <span className={styles.progressTrack} aria-hidden="true">
            <span className={styles.progressBar} style={{ width: `${item.progressValue}%` }} />
          </span>
        )}
      </span>
    </>
  )
}

export function EncodeItem({
  item,
  isEditMode,
  isSelected,
  onSelect,
  onCancel,
}: {
  item: EncodeDisplayItem
  isEditMode: boolean
  isSelected: boolean
  onSelect: () => void
  onCancel: () => void
}) {
  return (
    <div
      className={styles.item}
      data-edit-mode={isEditMode ? 'true' : 'false'}
      data-selected={isSelected ? 'true' : 'false'}
      data-testid="encode-list-item"
      role="listitem"
    >
      <span className={styles.itemButton} onClick={isEditMode ? onSelect : undefined}>
        <EncodeItemBody item={item} />
      </span>
      {!isEditMode ? (
        <span className={styles.itemActions}>
          <IconButton aria-label={`エンコード停止: ${item.title}`} onClick={onCancel}>
            <span aria-hidden="true" className={styles.closeIcon} />
          </IconButton>
        </span>
      ) : undefined}
    </div>
  )
}

export function EncodeSection({
  label,
  items,
  isEditMode,
  selectedIds,
  onSelect,
  onCancel,
}: {
  label: string
  items: readonly EncodeDisplayItem[]
  isEditMode: boolean
  selectedIds: ReadonlySet<number>
  onSelect: (encodeId: number) => void
  onCancel: (item: EncodeDisplayItem) => void
}) {
  if (items.length === 0) {
    return undefined
  }

  return (
    <section className={styles.section} aria-label={label}>
      <h2 className={styles.sectionTitle}>{label}</h2>
      <div className={styles.list} role="list">
        {items.map((item) => (
          <EncodeItem
            key={item.id}
            item={item}
            isEditMode={isEditMode}
            isSelected={selectedIds.has(item.id)}
            onSelect={() => onSelect(item.id)}
            onCancel={() => onCancel(item)}
          />
        ))}
      </div>
    </section>
  )
}
