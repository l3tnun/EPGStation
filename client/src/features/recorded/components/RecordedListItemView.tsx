import { useState } from 'react'
import type { MouseEvent } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import type { SettingsConsumerValue } from '@/shared/settings'
import type { RecordedApiRepository, RecordedListItem } from '../recordedApi'
import styles from '../RecordedPage.module.css'
import {
  formatRecordedListTime,
  formatRecordedTableTime,
  hasRecordedDropError,
  isInteractiveItemClick,
  itemLabel,
  itemSecondaryText,
  recordedId,
  shouldShowRecordedListDropInfo,
} from '../lib/recordedFormat'
import type { RecordedLayout } from '../lib/recordedFormat'
import { RecordedItemMenu } from './RecordedItemMenu'

export function RecordedThumbnail({ item, label }: { item: RecordedListItem; label: string }) {
  const [hasLoadFailed, setHasLoadFailed] = useState(false)
  const thumbnailPath =
    item.thumbnails === undefined || item.thumbnails.length === 0
      ? undefined
      : `./api/thumbnails/${item.thumbnails[0]}`
  const isFallbackImage = thumbnailPath === undefined || hasLoadFailed
  const imagePath = isFallbackImage ? './img/noimg.png' : thumbnailPath

  return (
    <img
      alt={`${label} サムネイル`}
      className={isFallbackImage ? styles.noImage : styles.thumbnail}
      data-thumbnail-state={isFallbackImage ? 'fallback' : 'loaded'}
      data-testid={isFallbackImage ? 'recorded-no-image' : 'recorded-thumbnail'}
      src={imagePath}
      onError={() => setHasLoadFailed(true)}
    />
  )
}

export function RecordedListItemView({
  item,
  index,
  settings,
  layout,
  isEditMode,
  isSelected,
  isEncodeEnabled,
  encodeModes,
  recordedDirectories,
  apiRepository,
  onActionSnackbar,
  onRefetchRequested,
  onSelectionChange,
  onItemClick,
}: {
  item: RecordedListItem
  index: number
  settings: SettingsConsumerValue
  layout: RecordedLayout
  isEditMode: boolean
  isSelected: boolean
  isEncodeEnabled: boolean
  encodeModes: readonly string[]
  recordedDirectories: readonly string[]
  apiRepository: RecordedApiRepository
  onActionSnackbar: (snackbar: ShellSnackbarState) => void
  onRefetchRequested: () => void
  onSelectionChange: (itemId: number, selected: boolean) => void
  onItemClick: (itemId: number) => void
}) {
  const label = itemLabel(item, index)
  const secondary = itemSecondaryText(item, settings)
  const itemId = recordedId(item)
  const isDropInfoSecondary = shouldShowRecordedListDropInfo(item, settings)
  const secondaryClassName = `${styles.itemDescription}${
    isDropInfoSecondary && hasRecordedDropError(item) ? ` ${styles.dropWarning}` : ''
  }`
  // Every layout renders the actions only outside edit mode; edit mode selects by clicking the
  // row or card itself.
  const actions = (
    <RecordedItemMenu
      item={item}
      label={label}
      apiRepository={apiRepository}
      isEncodeEnabled={isEncodeEnabled}
      encodeModes={encodeModes}
      recordedDirectories={recordedDirectories}
      settings={settings}
      onSnackbar={onActionSnackbar}
      onRefetchRequested={onRefetchRequested}
    />
  )

  if (layout === 'table') {
    const channelText =
      item.channelName ?? (item.channelId === undefined ? '' : `${item.channelId}`)
    const timeText = formatRecordedTableTime(item)
    const handleRowClick = (event: MouseEvent<HTMLTableRowElement>) => {
      if (isInteractiveItemClick(event)) {
        return
      }
      if (itemId === undefined) {
        return
      }
      if (isEditMode) {
        onSelectionChange(itemId, !isSelected)
        return
      }
      onItemClick(itemId)
    }

    return (
      <tr
        className={isSelected ? styles.selectedTableRow : undefined}
        data-testid="recorded-list-item"
        onClick={handleRowClick}
      >
        <td>{label}</td>
        <td>{channelText}</td>
        <td>{timeText}</td>
        <td className={styles.tableMenuCell}>{isEditMode ? undefined : actions}</td>
      </tr>
    )
  }

  if (layout === 'large-card') {
    const channelText =
      item.channelName ?? (item.channelId === undefined ? '' : `${item.channelId}`)
    const timeText = formatRecordedListTime(item)
    const toggleSelected = (event: MouseEvent<HTMLElement>) => {
      if (isInteractiveItemClick(event)) {
        return
      }
      if (itemId === undefined) {
        return
      }
      if (isEditMode) {
        onSelectionChange(itemId, !isSelected)
        return
      }
      onItemClick(itemId)
    }

    return (
      <article
        className={`${styles.card} ${isSelected ? styles.selectedCard : ''}`}
        data-testid="recorded-list-item"
        onClick={toggleSelected}
      >
        <RecordedThumbnail item={item} label={label} />
        <div className={styles.cardBody}>
          <div className={styles.cardTitleRow}>
            <h2 className={styles.itemTitle}>{label}</h2>
            {isEditMode ? undefined : actions}
          </div>
          {channelText === '' ? undefined : <div className={styles.itemMeta}>{channelText}</div>}
          {timeText === '' ? undefined : <div className={styles.itemMeta}>{timeText}</div>}
          {secondary.trim() === '' ? (
            <div className={`${styles.itemDescription} ${styles.itemDescriptionDummy}`}>dummy</div>
          ) : (
            <p className={secondaryClassName}>{secondary}</p>
          )}
        </div>
      </article>
    )
  }

  const channelText = item.channelName ?? (item.channelId === undefined ? '' : `${item.channelId}`)
  const timeText = formatRecordedListTime(item)

  return (
    <article
      className={`${styles.card} ${isSelected ? styles.selectedCard : ''}`}
      data-testid="recorded-list-item"
      onClick={(event) => {
        if (isInteractiveItemClick(event)) {
          return
        }
        if (itemId === undefined) {
          return
        }
        if (isEditMode) {
          onSelectionChange(itemId, !isSelected)
          return
        }
        onItemClick(itemId)
      }}
    >
      {isEditMode ? undefined : actions}
      <RecordedThumbnail item={item} label={label} />
      <h2 className={styles.itemTitle}>{label}</h2>
      {channelText === '' ? undefined : <div className={styles.itemMeta}>{channelText}</div>}
      {timeText === '' ? undefined : <div className={styles.itemMeta}>{timeText}</div>}
      {secondary === '' ? undefined : <div className={secondaryClassName}>{secondary}</div>}
    </article>
  )
}
