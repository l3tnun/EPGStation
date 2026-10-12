import type { ReactNode } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import { ReserveListItem as ReserveListItemView } from '@/features/reserves/ReserveListItem'
import type { ReserveListItem as ReserveListItemModel } from '@/features/reserves/reservesApi'
import { READ_ONLY_RESERVES_API_REPOSITORY } from '../lib/readOnlyReservesRepository'
import styles from '../SearchRulePage.module.css'

export function TimeSpecifiedReserveSection({
  reserves,
  ruleOptionForm,
  onSnackbar,
}: {
  reserves: readonly ReserveListItemModel[] | null
  ruleOptionForm: ReactNode
  onSnackbar: (snackbar: ShellSnackbarState) => void
}) {
  return (
    <section className={styles.result} role="region" aria-label="時刻指定予約">
      {reserves === null || reserves.length === 0 ? null : (
        <div className={styles.resultHeader}>
          <div>{`予約数 ${reserves.length} 件`}</div>
        </div>
      )}
      {reserves !== null && reserves.length > 0 ? (
        <div className={styles.resultList} role="list" aria-label="時刻指定予約一覧">
          {reserves.map((item, index) => (
            <ReserveListItemView
              apiRepository={READ_ONLY_RESERVES_API_REPOSITORY}
              index={index}
              isEditMode
              needsDecoration
              disableEdit
              item={item}
              key={`${item.id}-${index}`}
              onDialogOpen={() => undefined}
              onSnackbar={onSnackbar}
            />
          ))}
        </div>
      ) : null}
      {ruleOptionForm}
    </section>
  )
}
