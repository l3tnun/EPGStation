import type { RefObject } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import { ReserveMenu } from '@/features/reserves'
import type { ReserveListItemModel, ReservesApiRepository } from '@/features/reserves'
import { formatDashboardSectionTitle } from '../dashboardRequests'
import {
  formatDashboardReserveTimeRange,
  itemLabel,
  reserveChannelLine,
} from '../lib/dashboardFormat'
import styles from '../DashboardPage.module.css'

export function DashboardReservesSection({
  label,
  items,
  total,
  conflictCount,
  testId,
  listRef,
  apiRepository,
  onDialogOpen,
  onConflictClick,
  onMoreClick,
  onDeleteRequest,
  onSnackbar,
  onRefetchRequested,
  onScroll,
}: {
  label: string
  items: readonly ReserveListItemModel[]
  total: number
  conflictCount: number
  testId: string
  listRef: RefObject<HTMLUListElement | null>
  apiRepository: ReservesApiRepository
  onDialogOpen: (item: ReserveListItemModel) => void
  onConflictClick: () => void
  onMoreClick: () => void
  onDeleteRequest: (item: ReserveListItemModel) => void
  onSnackbar: (snackbar: ShellSnackbarState) => void
  onRefetchRequested: () => void
  onScroll: () => void
}) {
  return (
    <section className={styles.section} data-testid={testId} aria-labelledby={`${testId}-title`}>
      <div className={styles.sectionHeader}>
        <h2 id={`${testId}-title`} className={styles.sectionTitle}>
          {conflictCount >= 1 ? (
            <button
              className={styles.sectionTitleLabelButton}
              type="button"
              onClick={onConflictClick}
            >
              {formatDashboardSectionTitle(label, items.length, total)}
            </button>
          ) : (
            formatDashboardSectionTitle(label, items.length, total)
          )}
          {conflictCount >= 1 ? (
            <button
              className={styles.conflictButton}
              type="button"
              aria-label={`競合 ${conflictCount} 件`}
              onClick={onConflictClick}
            >
              <span className={styles.conflictBadge} aria-hidden="true">
                {conflictCount}
              </span>
            </button>
          ) : undefined}
        </h2>
      </div>
      <ul
        className={styles.itemList}
        data-testid={`${testId}-list`}
        ref={listRef}
        onScroll={onScroll}
      >
        {items.map((item, index) => {
          const labelText = itemLabel(item, index)
          const channelLine = reserveChannelLine(item)
          const timeLine = formatDashboardReserveTimeRange(item)

          return (
            <li className={`${styles.item} ${styles.reserveItem}`} key={`${item.id}-${index}`}>
              <button
                className={`${styles.itemContentButton} ${styles.reserveContentButton}`}
                aria-label={labelText}
                type="button"
                onClick={() => onDialogOpen(item)}
              >
                <span className={styles.itemText}>
                  <span className={styles.reserveTitleLine}>
                    <span
                      className={`${styles.reserveIcon} ${
                        item.ruleId === undefined ? styles.reserveIconTimer : styles.reserveIconRule
                      }`}
                      aria-hidden="true"
                    />
                    <span className={`${styles.itemTitle} ${styles.reserveTitle}`}>
                      {labelText}
                    </span>
                  </span>
                  {channelLine === undefined ? undefined : (
                    <span className={`${styles.itemMeta} ${styles.reserveChannelMeta}`}>
                      {channelLine}
                    </span>
                  )}
                  {timeLine === undefined ? undefined : (
                    <span className={`${styles.itemMeta} ${styles.reserveTimeMeta}`}>
                      {timeLine}
                    </span>
                  )}
                  {item.description === undefined ? undefined : (
                    <span className={`${styles.itemDescription} ${styles.reserveDescription}`}>
                      {item.description}
                    </span>
                  )}
                </span>
              </button>
              <ReserveMenu
                item={item}
                label={labelText}
                apiRepository={apiRepository}
                onSnackbar={onSnackbar}
                onDeleteRequest={onDeleteRequest}
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
