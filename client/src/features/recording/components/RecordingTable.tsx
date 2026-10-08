import type { ReactNode } from 'react'
import type { RecordedListItem } from '@/features/recorded/recordedApi'
import { formatShortTime, itemChannel, itemId, itemLabel } from '../lib/recordingFormat'
import styles from '../RecordingPage.module.css'

export interface RecordingListProps {
  records: readonly RecordedListItem[]
  isEditMode: boolean
  selectedIds: ReadonlySet<number>
  onRowAction: (id: number) => void
  renderMenu: (item: RecordedListItem, label: string) => ReactNode
}

export function RecordingTable({
  records,
  isEditMode,
  selectedIds,
  onRowAction,
  renderMenu,
}: RecordingListProps) {
  return (
    <div className={styles.recordingTableCard}>
      <table className={styles.recordingTable} aria-label="録画中一覧">
        <thead>
          <tr>
            <th scope="col">タイトル</th>
            <th className={styles.channelColumn} scope="col">
              放送局
            </th>
            <th className={styles.timeColumn} scope="col">
              時間
            </th>
            <th className={styles.menuColumn} scope="col" aria-label="メニュー" />
          </tr>
        </thead>
        <tbody>
          {records.map((item, index) => {
            const id = itemId(item)
            const label = itemLabel(item, index)
            const isSelected = id !== undefined && selectedIds.has(id)

            return (
              <tr
                className={isSelected ? styles.selectedRow : undefined}
                data-selected={isSelected ? 'true' : 'false'}
                data-testid="recording-list-item"
                key={`${id ?? 'recording'}-${index}`}
                onClick={() => {
                  if (id !== undefined) {
                    onRowAction(id)
                  }
                }}
              >
                <td>{label}</td>
                <td>{itemChannel(item)}</td>
                <td>{formatShortTime(item)}</td>
                <td className={styles.menuColumn}>
                  {!isEditMode ? (
                    <div onClick={(event) => event.stopPropagation()}>
                      {renderMenu(item, label)}
                    </div>
                  ) : undefined}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
