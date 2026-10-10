import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { SHELL_NAVIGATION_DRAWER_ID, type ShellSnackbarState } from '@/app/AppShell'
import { readCurrentRouteScrollPosition, useScrollHistory } from '@/app/scrollHistory'
import { EditTitleBar, TitleBar } from '@/app/titleBar'
import { RecordedBulkDeleteDialog, RecordedItemMenu } from '@/features/recorded'
import type { RecordedListItem } from '@/features/recorded/recordedApi'
import { AppPagination } from '@/shared/AppPagination'
import type { SettingsConsumerValue } from '@/shared/settings'
import { RecordingCards } from './components/RecordingCards'
import { RecordingTable } from './components/RecordingTable'
import { useVisibleRecording } from './hooks/useVisibleRecording'
import { RECORDING_MENU_ACTION_DELAY_MS, itemId } from './lib/recordingFormat'
import type { RecordingApiRepository } from './recordingApi'
import { buildRecordingPageSearch, toggleVisibleRecordingSelection } from './recordingRequests'
import styles from './RecordingPage.module.css'

const MDI_PENCIL = '\\F03EB'

export interface RecordingPageProps {
  isNavigationOpen: boolean
  onNavigationClick: () => void
  settings: SettingsConsumerValue
  apiRepository: RecordingApiRepository
  onFetchFailure: (snackbar: ShellSnackbarState) => void
}

const EMPTY_RECORDING_ITEMS: RecordedListItem[] = []

function LegacyToolbarIcon({ code }: { code: string }) {
  return (
    <Box
      aria-hidden="true"
      component="span"
      sx={{
        display: 'inline-block',
        font: "normal normal normal 24px/1 'Material Design Icons'",
        height: 24,
        width: 24,
        '&::before': {
          content: `"${code}"`,
        },
      }}
    />
  )
}

export function RecordingPage({
  isNavigationOpen,
  onNavigationClick,
  settings,
  apiRepository,
  onFetchFailure,
}: RecordingPageProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const scrollHistory = useScrollHistory()
  const [isEditMode, setEditMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [isBulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const { request, visibleState, isCardLayout, refetch } = useVisibleRecording({
    settings,
    pathname: location.pathname,
    search: location.search,
    apiRepository,
    onFetchFailure,
  })

  const records = visibleState.status === 'loaded' ? visibleState.records : EMPTY_RECORDING_ITEMS
  const total = visibleState.status === 'loaded' ? visibleState.total : 0
  const visibleRecordingIds = useMemo(
    () => records.flatMap((item) => (item.id === undefined ? [] : [item.id])),
    [records],
  )
  const selectedRecords = records.filter((item) => {
    const id = itemId(item)
    return id !== undefined && selectedIds.has(id)
  })
  const selectedVisibleCount = selectedRecords.length

  useEffect(() => {
    // Refetch replaces row objects; selection is intentionally narrowed to ids still visible.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds((current) => {
      const next = toggleVisibleRecordingSelection({
        currentSelectedIds: current,
        visibleRecordingIds,
        action: 'preserve-visible',
      })

      // 'preserve-visible' only removes ids, so an unchanged size means an
      // unchanged set and the current reference can be kept.
      if (next.size === current.size) {
        return current
      }

      return next
    })
  }, [visibleRecordingIds])

  const closeEditMode = () => {
    setEditMode(false)
    setSelectedIds(new Set())
  }
  const toggleSelection = (recordingId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(recordingId)) {
        next.delete(recordingId)
      } else {
        next.add(recordingId)
      }
      return next
    })
  }
  const selectAllVisible = () => {
    setSelectedIds((current) =>
      toggleVisibleRecordingSelection({
        currentSelectedIds: current,
        visibleRecordingIds,
        action: 'select-all',
      }),
    )
  }
  const goToPage = (page: number) => {
    scrollHistory.updateHistoryPosition(readCurrentRouteScrollPosition())
    navigate({
      pathname: location.pathname,
      search: buildRecordingPageSearch({ search: location.search, page }),
    })
  }
  const onRowAction = (id: number) => {
    if (isEditMode) {
      toggleSelection(id)
      return
    }
    navigate(`/recorded/detail/${id}`)
  }
  const renderMenu = (item: RecordedListItem, label: string) => (
    <RecordedItemMenu
      item={{ ...item, isRecording: true, isEncoding: false }}
      label={label}
      apiRepository={apiRepository}
      settings={settings}
      isEncodeEnabled={false}
      onSnackbar={onFetchFailure}
      onRefetchRequested={refetch}
      actionDelayMs={RECORDING_MENU_ACTION_DELAY_MS}
    />
  )
  const listProps = { records, isEditMode, selectedIds, onRowAction, renderMenu }

  return (
    <>
      {isEditMode ? (
        <EditTitleBar
          title={`${selectedVisibleCount} 件選択`}
          onClose={closeEditMode}
          onSelectAll={selectAllVisible}
          onDelete={() => setBulkDeleteOpen(true)}
        />
      ) : (
        <TitleBar
          title="録画中"
          isNavigationOpen={isNavigationOpen}
          navigationControlsId={SHELL_NAVIGATION_DRAWER_ID}
          onNavigationClick={onNavigationClick}
          rightActions={
            <IconButton
              aria-label="録画中を編集"
              color="inherit"
              sx={{ fontSize: 14, height: 48, p: 0, width: 48 }}
              onClick={() => setEditMode(true)}
            >
              <LegacyToolbarIcon code={MDI_PENCIL} />
            </IconButton>
          }
        />
      )}
      <RecordedBulkDeleteDialog
        open={isBulkDeleteOpen}
        items={selectedRecords}
        apiRepository={apiRepository}
        disableOption={true}
        onClose={() => setBulkDeleteOpen(false)}
        onSnackbar={onFetchFailure}
        onConfirmStart={closeEditMode}
        onCompleted={() => {
          closeEditMode()
          refetch()
        }}
      />
      {visibleState.status !== 'loaded' || records.length === 0 ? null : (
        <section
          className={styles.recordingPage}
          data-edit-mode={String(isEditMode)}
          data-recording-total={total}
          data-testid="recording-page"
          aria-label="録画中一覧"
        >
          {!isCardLayout ? <RecordingTable {...listProps} /> : undefined}
          {isCardLayout ? <RecordingCards {...listProps} /> : undefined}
          <AppPagination
            isEnableExtendedPagination={settings.isEnableExtendedPagination}
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
