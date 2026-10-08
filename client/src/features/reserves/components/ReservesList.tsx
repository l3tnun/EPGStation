import type { ShellSnackbarState } from '@/app/AppShell'
import type { ReserveListItem, ReservesApiRepository } from '../lib/reservesApiTypes'
import type { ReserveBroadcastWaveResolver } from '../lib/reserveLabels'
import type { ReservesLayout } from '../lib/reservesListRequests'
import { ReserveListItem as ReserveListItemView } from '../ReserveListItem'
import styles from '../ReservesPage.module.css'

export interface ReservesListProps {
  reserves: readonly ReserveListItem[]
  layout: ReservesLayout
  apiRepository: ReservesApiRepository
  isEditMode: boolean
  selectedIds: ReadonlySet<number>
  isEnableDisplayForEachBroadcastWave: boolean
  resolveBroadcastWave?: ReserveBroadcastWaveResolver
  onDeleteRequest: (item: ReserveListItem) => void
  onDialogOpen: (item: ReserveListItem) => void
  onSelectionChange: (reserveId: number) => void
  onSnackbar: (snackbar: ShellSnackbarState) => void
}

export function ReservesList({
  reserves,
  layout,
  apiRepository,
  isEditMode,
  selectedIds,
  isEnableDisplayForEachBroadcastWave,
  resolveBroadcastWave,
  onDeleteRequest,
  onDialogOpen,
  onSelectionChange,
  onSnackbar,
}: ReservesListProps) {
  const items = reserves.map((item, index) => (
    <ReserveListItemView
      apiRepository={apiRepository}
      index={index}
      layout={layout}
      isEditMode={isEditMode}
      isSelected={selectedIds.has(item.id)}
      item={item}
      key={`${item.id ?? 'reserve'}-${index}`}
      isEnableDisplayForEachBroadcastWave={isEnableDisplayForEachBroadcastWave}
      resolveBroadcastWave={resolveBroadcastWave}
      onDeleteRequest={onDeleteRequest}
      onDialogOpen={onDialogOpen}
      onSelectionChange={onSelectionChange}
      onSnackbar={onSnackbar}
    />
  ))

  if (layout === 'table') {
    return (
      <div className={styles.tableCard}>
        <table className={styles.reservesTable}>
          <colgroup>
            <col className={styles.channelColumn} />
            <col className={styles.dateColumn} />
            <col className={styles.timeColumn} />
            <col />
            <col />
            <col className={styles.menuColumn} />
          </colgroup>
          <thead>
            <tr>
              <th>放送局</th>
              <th>日付</th>
              <th>時間</th>
              <th>番組名</th>
              <th>内容</th>
              <th />
            </tr>
          </thead>
          <tbody>{items}</tbody>
        </table>
      </div>
    )
  }

  return (
    <div className={styles.list} role="list" aria-label="予約一覧">
      {items}
    </div>
  )
}
