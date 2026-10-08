import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ShellSnackbarState } from '@/app/AppShell'
import { readCurrentRouteScrollPosition, useScrollHistory } from '@/app/scrollHistory'
import { LegacyPagination } from '@/shared/LegacyPagination'
import type { SettingsConsumerValue } from '@/shared/settings'
import { useDeferredLoading } from '@/shared/useDeferredLoading'
import { useMeasuredContainerWidth } from '@/shared/useMeasuredContainerWidth'
import { ReserveDialog } from './components/ReserveDialog'
import { ReserveBulkDeleteDialog, ReserveDeleteDialog } from './components/ReserveDeleteDialogs'
import { ReservesList } from './components/ReservesList'
import { ReservesTitleBar } from './components/ReservesTitleBar'
import { useVisibleReserves } from './hooks/useVisibleReserves'
import type { ReserveListItem, ReservesApiRepository } from './lib/reservesApiTypes'
import { openReserveSnackbar, type ReserveBroadcastWaveResolver } from './lib/reserveLabels'
import { toggleVisibleReserveSelection } from './lib/reserveSelection'
import {
  RESERVES_FAILURE_MESSAGE,
  RESERVES_UPDATE_FAILURE_MESSAGE,
  RESERVES_UPDATE_STARTED_MESSAGE,
  buildReservesPageSearch,
  resolveReservesLayout,
  resolveReservesTitle,
} from './lib/reservesListRequests'
import styles from './ReservesPage.module.css'

export { ReserveBulkDeleteDialog, ReserveDeleteDialog } from './components/ReserveDeleteDialogs'

export interface ReservesPageProps {
  isNavigationOpen: boolean
  onNavigationClick: () => void
  settings: SettingsConsumerValue
  viewportWidth?: number
  /**
   * Overrides the measured list container width used for the card/table layout decision
   * (`resolveReservesLayout`). Real usage measures the actual rendered container via
   * `ResizeObserver`, matching v2 `ReserveItems.vue`'s `this.$el.clientWidth`; this prop exists
   * so tests can inject a container width directly, since jsdom never fires `ResizeObserver`.
   */
  containerWidth?: number
  apiRepository: ReservesApiRepository
  onFetchFailure: (snackbar: ShellSnackbarState) => void
  isEnableDisplayForEachBroadcastWave?: boolean
  resolveBroadcastWave?: ReserveBroadcastWaveResolver
}

const EMPTY_RESERVES: ReserveListItem[] = []

export function ReservesPage({
  isNavigationOpen,
  onNavigationClick,
  settings,
  viewportWidth = 1440,
  containerWidth,
  apiRepository,
  onFetchFailure,
  isEnableDisplayForEachBroadcastWave = false,
  resolveBroadcastWave,
}: ReservesPageProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const scrollHistory = useScrollHistory()
  const [isEditMode, setEditMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [dialogReserve, setDialogReserve] = useState<ReserveListItem | null>(null)
  const [deleteEntryReserve, setDeleteEntryReserve] = useState<ReserveListItem | null>(null)
  const [isBulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [pageContainerRef, measuredContainerWidth] = useMeasuredContainerWidth<HTMLElement>()
  const { request, visibleState, refetch } = useVisibleReserves({
    settings,
    pathname: location.pathname,
    search: location.search,
    apiRepository,
    onFetchFailure,
  })
  // Only drives whether the "読み込み中" text itself is painted; branch
  // selection below still keys off `visibleState.status` directly so real
  // content is never held back once it arrives.
  const showLoadingIndicator = useDeferredLoading(visibleState.status === 'loading')

  const total = visibleState.status === 'loaded' ? visibleState.value.total : 0
  const reserves = visibleState.status === 'loaded' ? visibleState.value.reserves : EMPTY_RESERVES
  // Reserves owns the time row click route builder contract (design.md:307,312), so it must be
  // able to resolve a channel's broadcast wave from its own fetched reserve list without relying
  // on a caller-supplied resolver, matching DashboardPage's self-contained
  // `resolveDashboardBroadcastWave`. The `resolveBroadcastWave` prop remains as an override point.
  const resolveOwnBroadcastWave = useMemo<ReserveBroadcastWaveResolver>(
    () => (channelId) => reserves.find((reserve) => reserve.channelId === channelId)?.channelType,
    [reserves],
  )
  const effectiveResolveBroadcastWave = resolveBroadcastWave ?? resolveOwnBroadcastWave
  const layout = resolveReservesLayout(containerWidth ?? measuredContainerWidth ?? viewportWidth)
  const visibleReserveIds = useMemo(() => reserves.map((item) => item.id), [reserves])
  const selectedReserves = reserves.filter((item) => selectedIds.has(item.id))
  const selectedVisibleCount = reserves.filter((item) => selectedIds.has(item.id)).length
  const goToPage = (page: number) => {
    scrollHistory.updateHistoryPosition(readCurrentRouteScrollPosition())
    navigate({
      pathname: location.pathname,
      search: buildReservesPageSearch({
        search: location.search,
        page,
      }),
    })
  }
  const closeEditMode = () => {
    setEditMode(false)
    setSelectedIds(new Set())
  }
  const toggleSelection = (reserveId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(reserveId)) {
        next.delete(reserveId)
      } else {
        next.add(reserveId)
      }
      return next
    })
  }
  const selectAllVisible = () => {
    setSelectedIds((current) =>
      toggleVisibleReserveSelection({
        currentSelectedIds: current,
        visibleReserveIds,
        action: 'select-all',
      }),
    )
  }
  const openBulkDeleteDialog = () => {
    if (selectedReserves.length === 0) {
      openReserveSnackbar(onFetchFailure, '番組を選択してください。', 'error')
      return
    }

    setBulkDeleteOpen(true)
  }
  const runUpdateReserves = async () => {
    const result = await apiRepository.updateReserves()
    onFetchFailure({
      text: result.ok ? RESERVES_UPDATE_STARTED_MESSAGE : RESERVES_UPDATE_FAILURE_MESSAGE,
      severity: result.ok ? 'success' : 'error',
    })
  }

  useEffect(() => {
    // Refetch replaces row objects; selection is intentionally narrowed to ids still visible.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds((current) =>
      toggleVisibleReserveSelection({
        currentSelectedIds: current,
        visibleReserveIds,
        action: 'preserve-visible',
      }),
    )
  }, [visibleReserveIds])

  return (
    <>
      <ReservesTitleBar
        title={resolveReservesTitle(request.routeType)}
        isNavigationOpen={isNavigationOpen}
        onNavigationClick={onNavigationClick}
        isEditMode={isEditMode}
        selectedVisibleCount={selectedVisibleCount}
        onCloseEditMode={closeEditMode}
        onSelectAll={selectAllVisible}
        onBulkDelete={openBulkDeleteDialog}
        onEnterEditMode={() => setEditMode(true)}
        onUpdateReserves={() => void runUpdateReserves()}
      />
      <ReserveDialog
        open={dialogReserve !== null}
        reserve={dialogReserve}
        isEnableDisplayForEachBroadcastWave={isEnableDisplayForEachBroadcastWave}
        resolveBroadcastWave={effectiveResolveBroadcastWave}
        onClose={() => setDialogReserve(null)}
      />
      <ReserveDeleteDialog
        open={deleteEntryReserve !== null}
        reserve={deleteEntryReserve}
        apiRepository={apiRepository}
        onClose={() => setDeleteEntryReserve(null)}
        onDeleteSuccess={refetch}
        onSnackbar={onFetchFailure}
      />
      <ReserveBulkDeleteDialog
        open={isBulkDeleteOpen}
        reserves={selectedReserves}
        apiRepository={apiRepository}
        onClose={() => setBulkDeleteOpen(false)}
        onSnackbar={onFetchFailure}
        onConfirmStart={closeEditMode}
      />
      {visibleState.status === 'loading' ? (
        showLoadingIndicator ? (
          <div
            className={styles.state}
            data-testid="reserves-loading"
            role="status"
            aria-live="polite"
          >
            読み込み中
          </div>
        ) : undefined
      ) : showLoadingIndicator ? (
        // Data already resolved, but the indicator only just became visible
        // (a slow fetch): keep it up for its minimum hold time instead of
        // swapping straight to content, which would itself flash.
        <div
          className={styles.state}
          data-testid="reserves-loading"
          role="status"
          aria-live="polite"
        >
          読み込み中
        </div>
      ) : (
        <section
          ref={pageContainerRef}
          className={styles.reservesPage}
          data-reserves-layout={layout}
          data-reserves-total={total}
          data-testid="reserves-page"
          aria-label="予約一覧"
        >
          {visibleState.status === 'error' ? (
            <div className={styles.state} data-testid="reserves-error">
              {RESERVES_FAILURE_MESSAGE}
            </div>
          ) : reserves.length === 0 ? undefined : (
            <ReservesList
              reserves={reserves}
              layout={layout}
              apiRepository={apiRepository}
              isEditMode={isEditMode}
              selectedIds={selectedIds}
              isEnableDisplayForEachBroadcastWave={isEnableDisplayForEachBroadcastWave}
              resolveBroadcastWave={effectiveResolveBroadcastWave}
              onDeleteRequest={setDeleteEntryReserve}
              onDialogOpen={setDialogReserve}
              onSelectionChange={toggleSelection}
              onSnackbar={onFetchFailure}
            />
          )}
          <LegacyPagination
            page={request.page}
            pageSize={request.limit}
            total={total}
            onPageChange={goToPage}
          />
        </section>
      )}
    </>
  )
}
