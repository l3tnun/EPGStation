import { useState, type RefObject } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import { RecordedItemMenu } from '@/features/recorded'
import type { RecordedApiRepository, RecordedListItem } from '@/features/recorded/recordedApi'
import type { SettingsConsumerValue } from '@/shared/settings'
import { formatDashboardSectionTitle } from '../dashboardRequests'
import { itemLabel, recordedMetadataLines, recordedSecondaryText } from '../lib/dashboardFormat'
import styles from '../DashboardPage.module.css'

export type RecordsSectionKind = 'recording' | 'recorded'

function SummaryThumbnail({
  item,
  label,
  noImageTestId,
  thumbnailTestId,
  className,
}: {
  item: RecordedListItem
  label: string
  noImageTestId?: string
  thumbnailTestId?: string
  className: string
}) {
  const [hasLoadFailed, setHasLoadFailed] = useState(false)
  const thumbnailPath =
    item.thumbnails === undefined || item.thumbnails.length === 0
      ? undefined
      : `./api/thumbnails/${item.thumbnails[0]}`
  const imagePath = thumbnailPath === undefined || hasLoadFailed ? './img/noimg.png' : thumbnailPath

  return (
    <img
      alt={`${label} サムネイル`}
      className={
        thumbnailPath === undefined || hasLoadFailed
          ? `${styles.noImage} ${className}`
          : `${styles.thumbnail} ${className}`
      }
      data-testid={thumbnailPath === undefined || hasLoadFailed ? noImageTestId : thumbnailTestId}
      src={imagePath}
      onError={() => setHasLoadFailed(true)}
    />
  )
}

export function DashboardRecordsSection({
  label,
  kind,
  items,
  total,
  testId,
  listRef,
  settings,
  apiRepository,
  isEncodeEnabled,
  encodeModes,
  recordedDirectories,
  onItemClick,
  onMoreClick,
  onSnackbar,
  onRefetchRequested,
  onScroll,
}: {
  label: string
  kind: RecordsSectionKind
  items: readonly RecordedListItem[]
  total: number
  testId: string
  listRef: RefObject<HTMLUListElement | null>
  settings: SettingsConsumerValue
  apiRepository: RecordedApiRepository
  isEncodeEnabled: boolean
  encodeModes: readonly string[]
  recordedDirectories: readonly string[]
  onItemClick: (item: RecordedListItem) => void
  onMoreClick: () => void
  onSnackbar: (snackbar: ShellSnackbarState) => void
  onRefetchRequested: () => void
  onScroll: () => void
}) {
  const kindClass = (recorded: string, recording: string) =>
    kind === 'recorded' ? recorded : recording

  return (
    <section className={styles.section} data-testid={testId} aria-labelledby={`${testId}-title`}>
      <h2 id={`${testId}-title`} className={styles.sectionTitle}>
        {formatDashboardSectionTitle(label, items.length, total)}
      </h2>
      <ul
        className={styles.itemList}
        data-testid={`${testId}-list`}
        ref={listRef}
        onScroll={onScroll}
      >
        {items.map((item, index) => {
          const labelText = itemLabel(item, index)
          const secondary = recordedSecondaryText(item, settings)
          const metadataLines = recordedMetadataLines(item)
          const itemContent = (
            <>
              {kind === 'recording' ? undefined : (
                <SummaryThumbnail
                  item={item}
                  label={labelText}
                  noImageTestId="dashboard-recorded-no-image"
                  thumbnailTestId="dashboard-recorded-thumbnail"
                  className={styles.recordedThumbnail}
                />
              )}
              <span
                className={`${styles.itemText} ${kindClass(styles.recordedText, styles.recordingText)}`}
              >
                <span className={styles.itemTitle}>{labelText}</span>
                {metadataLines.map((line) => (
                  <span className={styles.itemMeta} key={line}>
                    {line}
                  </span>
                ))}
                {secondary === '' ? undefined : (
                  <span className={styles.itemDescription}>{secondary}</span>
                )}
              </span>
            </>
          )
          const itemContentClassName = `${styles.itemContentButton} ${kindClass(
            styles.recordedContentButton,
            styles.recordingContentButton,
          )}`

          return (
            <li
              className={`${styles.item} ${kindClass(styles.recordedItem, styles.recordingItem)}`}
              data-dashboard-recording-card={kind === 'recording' ? 'true' : undefined}
              data-dashboard-recorded-card={kind === 'recorded' ? 'true' : undefined}
              data-testid={
                kind === 'recorded'
                  ? 'dashboard-recorded-summary-item'
                  : 'dashboard-recording-summary-item'
              }
              key={`${item.id ?? 'item'}-${index}`}
            >
              <button
                className={itemContentClassName}
                aria-label={labelText}
                type="button"
                onClick={() => onItemClick(item)}
              >
                {itemContent}
              </button>
              <RecordedItemMenu
                item={
                  kind === 'recording' ? { ...item, isRecording: true, isEncoding: false } : item
                }
                label={labelText}
                apiRepository={apiRepository}
                settings={settings}
                isEncodeEnabled={kind === 'recorded' && isEncodeEnabled}
                encodeModes={encodeModes}
                recordedDirectories={recordedDirectories}
                onSnackbar={onSnackbar}
                onRefetchRequested={onRefetchRequested}
              />
            </li>
          )
        })}
        {total > items.length ? (
          <li className={styles.moreItem}>
            <button className={styles.moreButton} type="button" onClick={onMoreClick}>
              MORE
            </button>
          </li>
        ) : undefined}
      </ul>
    </section>
  )
}
