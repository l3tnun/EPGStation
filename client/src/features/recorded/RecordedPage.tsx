import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import {
  readCurrentRouteScrollPosition,
  useScrollHistory,
  useScrollHistoryPageReady,
} from '@/app/scrollHistory'

import { AppPagination } from '@/shared/AppPagination'
import { useDeferredLoading } from '@/shared/useDeferredLoading'
import { useMeasuredContainerWidth } from '@/shared/useMeasuredContainerWidth'
import {
  buildRecordedListRequest,
  buildRecordedPageSearch,
  createRecordedQueryKey,
  formatRecordedFileSize,
  toggleVisibleRecordedSelection,
} from './recordedRequests'
import styles from './RecordedPage.module.css'

export { RecordedDetailPage } from './RecordedDetailPage'
export type { RecordedPageProps } from './recordedPageProps'
import { RecordedSearchDialog } from './components/RecordedSearchDialog'
import { recordedId, resolveRecordedLayout } from './lib/recordedFormat'
import { RecordedListItemView } from './components/RecordedListItemView'
import { RecordedBulkDeleteDialog } from './components/RecordedDeleteDialogs'
import type { RecordedPageProps } from './recordedPageProps'
import { RecordedCleanupDialog } from './components/RecordedCleanupDialog'
import { RecordedListTitleBar } from './components/RecordedListTitleBar'
import { EMPTY_RECORDED_ITEMS, EMPTY_STRING_LIST } from './lib/emptyList'

export function RecordedPage({
  isNavigationOpen,
  onNavigationClick,
  settings,
  viewportWidth,
  containerWidth,
  apiRepository,
  onFetchFailure,
  isEncodeEnabled = false,
  encodeModes = EMPTY_STRING_LIST,
  recordedDirectories = EMPTY_STRING_LIST,
}: RecordedPageProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const scrollHistory = useScrollHistory()
  const [searchAnchor, setSearchAnchor] = useState<HTMLElement | null>(null)
  const [isEditMode, setEditMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [isBulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [isCleanupOpen, setCleanupOpen] = useState(false)
  const [pageContainerRef, measuredContainerWidth] = useMeasuredContainerWidth<HTMLElement>()
  const handledRouteKey = useRef<string | undefined>(undefined)
  const request = useMemo(
    () => buildRecordedListRequest({ settings, search: location.search }),
    [location.search, settings],
  )
  const queryKey = useMemo(
    () => createRecordedQueryKey({ settings, search: location.search }),
    [location.search, settings],
  )
  const routeKey = `${location.pathname}${location.search}`
  const layout = resolveRecordedLayout(
    containerWidth ?? measuredContainerWidth ?? viewportWidth,
    settings,
  )
  const query = useQuery({
    queryKey,
    queryFn: () => apiRepository.fetchRecorded(request),
  })
  const data = query.data
  // Only drives whether the "読み込み中" text itself is painted; branch
  // selection below still keys off `data === undefined` directly so real
  // content is never held back once it arrives.
  const showLoadingIndicator = useDeferredLoading(data === undefined)
  const refetchRecorded = () => {
    void query.refetch()
  }
  useScrollHistoryPageReady(query.data !== undefined && !query.isFetching, routeKey)

  useEffect(() => {
    if (query.data === undefined || query.isFetching || handledRouteKey.current === routeKey) {
      return
    }

    handledRouteKey.current = routeKey
    if (!query.data.ok) {
      onFetchFailure({
        text: query.data.message,
        severity: 'error',
      })
    }
  }, [onFetchFailure, query.data, query.isFetching, routeKey])

  const records = query.data?.ok === true ? query.data.value.records : EMPTY_RECORDED_ITEMS
  const total = query.data?.ok === true ? query.data.value.total : 0
  const visibleRecordedIds = useMemo(
    () => records.flatMap((item) => (item.id === undefined ? [] : [item.id])),
    [records],
  )
  useEffect(() => {
    // Refetch replaces row objects; selection is intentionally narrowed to ids
    // still visible, matching Recording (toggleVisibleRecordingSelection) and
    // Reserves (toggleVisibleReserveSelection). Without this, an id selected
    // before a refetch removed it from view can silently resurrect as
    // "selected" if a later refetch brings the same id back.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds((current) => {
      const next = toggleVisibleRecordedSelection({
        currentSelectedIds: current,
        visibleRecordedIds,
        action: 'preserve-visible',
      })

      // 'preserve-visible' only removes ids, so an unchanged size means an
      // unchanged set and the current reference can be kept.
      if (next.size === current.size) {
        return current
      }

      return next
    })
  }, [visibleRecordedIds])
  const goToPage = (page: number) => {
    scrollHistory.updateHistoryPosition(readCurrentRouteScrollPosition())
    navigate({
      pathname: location.pathname,
      search: buildRecordedPageSearch({
        search: location.search,
        page,
      }),
    })
  }
  const selectedRecords = records.filter((item) => {
    const id = recordedId(item)
    return id !== undefined && selectedIds.has(id)
  })
  const selectedTotalFileSize = selectedRecords.reduce((sum, item) => {
    return sum + (item.videoFiles ?? []).reduce((fileSum, file) => fileSum + (file.size ?? 0), 0)
  }, 0)
  const editTitle = `${selectedRecords.length} 件選択 (${formatRecordedFileSize(selectedTotalFileSize)})`
  const setItemSelected = (itemId: number, selected: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (selected) next.add(itemId)
      else next.delete(itemId)
      return next
    })
  }
  const selectAll = () => {
    setSelectedIds((current) =>
      toggleVisibleRecordedSelection({
        currentSelectedIds: current,
        visibleRecordedIds,
        action: 'select-all',
      }),
    )
  }
  const closeEditMode = () => {
    setEditMode(false)
    setSelectedIds(new Set())
  }
  const handleBulkDeleteClick = () => {
    setBulkDeleteOpen(true)
  }

  return (
    <>
      <RecordedListTitleBar
        isEditMode={isEditMode}
        editTitle={editTitle}
        isNavigationOpen={isNavigationOpen}
        onNavigationClick={onNavigationClick}
        onCloseEditMode={closeEditMode}
        onSelectAll={selectAll}
        onBulkDelete={handleBulkDeleteClick}
        onSearchOpen={setSearchAnchor}
        onEditStart={() => setEditMode(true)}
        onCleanupOpen={() => setCleanupOpen(true)}
        onUploadClick={() => navigate('/recorded/upload')}
      />
      <RecordedSearchDialog
        anchorEl={searchAnchor}
        search={location.search}
        apiRepository={apiRepository}
        isHalfWidthDisplayed={settings.isHalfWidthDisplayed}
        onClose={() => setSearchAnchor(null)}
        onNavigate={(path) => navigate(path)}
        onSnackbar={onFetchFailure}
      />
      <RecordedCleanupDialog
        open={isCleanupOpen}
        apiRepository={apiRepository}
        onClose={() => setCleanupOpen(false)}
        onSnackbar={onFetchFailure}
      />
      <RecordedBulkDeleteDialog
        open={isBulkDeleteOpen}
        items={selectedRecords}
        apiRepository={apiRepository}
        onClose={() => setBulkDeleteOpen(false)}
        onSnackbar={onFetchFailure}
        onCompleted={() => {
          closeEditMode()
          refetchRecorded()
        }}
      />
      <section
        ref={pageContainerRef}
        className={styles.recordedPage}
        data-recorded-layout={layout}
        data-recorded-total={total}
        data-testid="recorded-page"
        aria-label="録画済み一覧"
      >
        {data === undefined ? (
          showLoadingIndicator ? (
            <div
              className={styles.state}
              data-testid="recorded-loading"
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
            data-testid="recorded-loading"
            role="status"
            aria-live="polite"
          >
            読み込み中
          </div>
        ) : data.ok !== true ? (
          <div className={styles.state} data-testid="recorded-error">
            {data.message}
          </div>
        ) : records.length === 0 ? undefined : (
          <>
            {layout === 'table' ? (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>タイトル</th>
                      <th className={styles.tableChannelCell}>放送局</th>
                      <th className={styles.tableTimeCell}>時間</th>
                      <th className={styles.tableMenuCell}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((item, index) => (
                      <RecordedListItemView
                        key={`${item.id ?? 'recorded'}-${index}`}
                        index={index}
                        item={item}
                        layout={layout}
                        settings={settings}
                        apiRepository={apiRepository}
                        isEditMode={isEditMode}
                        isSelected={item.id !== undefined && selectedIds.has(item.id)}
                        isEncodeEnabled={isEncodeEnabled}
                        encodeModes={encodeModes}
                        recordedDirectories={recordedDirectories}
                        onActionSnackbar={onFetchFailure}
                        onRefetchRequested={refetchRecorded}
                        onSelectionChange={setItemSelected}
                        onItemClick={(id) => navigate(`/recorded/detail/${id}`)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={layout === 'large-card' ? styles.cards : styles.smallCards}>
                {records.map((item, index) => (
                  <RecordedListItemView
                    key={`${item.id ?? 'recorded'}-${index}`}
                    index={index}
                    item={item}
                    layout={layout}
                    settings={settings}
                    apiRepository={apiRepository}
                    isEditMode={isEditMode}
                    isSelected={item.id !== undefined && selectedIds.has(item.id)}
                    isEncodeEnabled={isEncodeEnabled}
                    encodeModes={encodeModes}
                    recordedDirectories={recordedDirectories}
                    onActionSnackbar={onFetchFailure}
                    onRefetchRequested={refetchRecorded}
                    onSelectionChange={setItemSelected}
                    onItemClick={(id) => navigate(`/recorded/detail/${id}`)}
                  />
                ))}
              </div>
            )}
            <AppPagination
              isEnableExtendedPagination={settings.isEnableExtendedPagination}
              page={request.page}
              pageSize={request.limit}
              total={total}
              onPageChange={goToPage}
            />
            <div className={styles.hiddenDummy}>dummy</div>
          </>
        )}
      </section>
    </>
  )
}
