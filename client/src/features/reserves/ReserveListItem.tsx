import type { KeyboardEvent } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import { LegacyMdiIcon, MDI_CALENDAR, MDI_TIMER_OUTLINE } from './components/LegacyMdiIcon'
import { ReserveMenu } from './components/ReserveMenu'
import type {
  ReservesApiRepository,
  ReserveListItem as ReserveListItemModel,
} from './lib/reservesApiTypes'
import {
  formatReserveCardTimeRange,
  formatReserveDate,
  formatReserveTableTimeParts,
  reserveChannelLabel,
  reserveLabel,
  type ReserveBroadcastWaveResolver,
} from './lib/reserveLabels'
import { resolveReserveVisualState } from './lib/reserveRoutes'
import type { ReservesLayout } from './lib/reservesListRequests'
import styles from './ReservesPage.module.css'

export { ReserveDialog } from './components/ReserveDialog'
export { ReserveMenu } from './components/ReserveMenu'
export type { ReserveBroadcastWaveResolver } from './lib/reserveLabels'

export function ReserveListItem({
  item,
  index,
  layout = 'card',
  apiRepository,
  isEditMode = false,
  isSelected = false,
  needsDecoration = false,
  disableEdit = false,
  isEnableDisplayForEachBroadcastWave = false,
  resolveBroadcastWave,
  onDialogOpen,
  onSelectionChange,
  onSnackbar,
  onDeleteRequest,
}: {
  item: ReserveListItemModel
  index: number
  layout?: ReservesLayout
  apiRepository: ReservesApiRepository
  isEditMode?: boolean
  isSelected?: boolean
  needsDecoration?: boolean
  disableEdit?: boolean
  isEnableDisplayForEachBroadcastWave?: boolean
  resolveBroadcastWave?: ReserveBroadcastWaveResolver
  onDialogOpen: (item: ReserveListItemModel) => void
  onSelectionChange?: (reserveId: number) => void
  onSnackbar: (snackbar: ShellSnackbarState) => void
  onDeleteRequest?: (item: ReserveListItemModel) => void
}) {
  void isEnableDisplayForEachBroadcastWave
  void resolveBroadcastWave
  const label = reserveLabel(item, index)
  const visualState = resolveReserveVisualState(item)
  const cardTimeText = formatReserveCardTimeRange(item)
  const tableDateText = formatReserveDate(item.startAt)
  const tableTimeParts = formatReserveTableTimeParts(item)
  const channelLabel = reserveChannelLabel(item)
  const className = [
    styles.item,
    needsDecoration ? styles.decoratedItem : '',
    isSelected ? styles.selectedItem : '',
  ]
    .filter(Boolean)
    .join(' ')
  const clickItem = () => {
    if (isEditMode) {
      onSelectionChange?.(item.id)
      return
    }

    onDialogOpen(item)
  }
  const handleContentKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    event.preventDefault()
    clickItem()
  }
  const menu = !isEditMode ? (
    <ReserveMenu
      item={item}
      label={label}
      apiRepository={apiRepository}
      disableEdit={disableEdit}
      onSnackbar={onSnackbar}
      onDeleteRequest={onDeleteRequest}
    />
  ) : undefined

  if (layout === 'table') {
    return (
      <tr
        className={className}
        data-reserve-state={visualState.state}
        data-needs-decoration={String(needsDecoration)}
        data-selected={String(isSelected)}
        data-testid="reserves-list-item"
        onClick={clickItem}
      >
        <td className={styles.itemChannel}>{channelLabel}</td>
        <td className={styles.itemDate}>{tableDateText}</td>
        <td className={styles.itemTime}>
          {tableTimeParts === null ? undefined : (
            <>
              <span>{tableTimeParts.range}</span>
              <span>{tableTimeParts.duration}</span>
            </>
          )}
        </td>
        <td className={styles.itemTitle}>
          <LegacyMdiIcon
            className={styles.itemTitleIcon}
            code={item.ruleId === undefined ? MDI_TIMER_OUTLINE : MDI_CALENDAR}
          />
          {label}
        </td>
        <td className={styles.itemDescription}>{item.description}</td>
        <td className={styles.itemMenuCell} onClick={(event) => event.stopPropagation()}>
          {menu}
        </td>
      </tr>
    )
  }

  return (
    <article
      className={className}
      data-reserve-state={visualState.state}
      data-needs-decoration={String(needsDecoration)}
      data-selected={String(isSelected)}
      data-testid="reserves-list-item"
      role="listitem"
    >
      <div className={styles.cardHeader}>
        <button
          className={styles.itemContentButton}
          type="button"
          onClick={clickItem}
          onKeyDown={handleContentKeyDown}
        >
          <span className={styles.itemTitle}>
            <LegacyMdiIcon
              className={styles.itemTitleIcon}
              code={item.ruleId === undefined ? MDI_TIMER_OUTLINE : MDI_CALENDAR}
            />
            <span>{label}</span>
          </span>
          {channelLabel === undefined ? undefined : (
            <span className={styles.itemChannel}>{channelLabel}</span>
          )}
          {cardTimeText === '' ? undefined : (
            <span className={styles.itemLegacyTime}>{cardTimeText}</span>
          )}
          {item.description === undefined ? undefined : (
            <span className={styles.itemDescription}>{item.description}</span>
          )}
        </button>
        {menu === undefined ? undefined : (
          <div className={styles.cardMenu} onClick={(event) => event.stopPropagation()}>
            {menu}
          </div>
        )}
      </div>
    </article>
  )
}
