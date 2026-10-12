import IconButton from '@mui/material/IconButton'
import { useEffect, useMemo, useState } from 'react'
import { SHELL_NAVIGATION_DRAWER_ID, type ShellSnackbarState } from '@/app/AppShell'
import { EditTitleBar, TitleBar } from '@/app/titleBar'
import type { SettingsConsumerValue } from '@/shared/settings'
import { BulkCancelDialog, SingleCancelDialog } from './components/EncodeCancelDialogs'
import { EncodeSection } from './components/EncodeItem'
import type { EncodeApiRepository } from './encodeApi'
import {
  createEncodeSectionItems,
  type EncodeDisplayItem,
  isSameEncodeSelection,
  toggleVisibleEncodeSelection,
} from './encodeRequests'
import { useVisibleEncode } from './hooks/useVisibleEncode'
import styles from './EncodePage.module.css'

export interface EncodePageProps {
  isNavigationOpen: boolean
  onNavigationClick: () => void
  settings: SettingsConsumerValue
  apiRepository: EncodeApiRepository
  onFetchFailure: (snackbar: ShellSnackbarState) => void
}

export function EncodePage({
  isNavigationOpen,
  onNavigationClick,
  settings,
  apiRepository,
  onFetchFailure,
}: EncodePageProps) {
  const [isEditMode, setEditMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [singleCancelItem, setSingleCancelItem] = useState<EncodeDisplayItem | null>(null)
  const [isBulkCancelOpen, setBulkCancelOpen] = useState(false)
  const { visibleState } = useVisibleEncode({ settings, apiRepository, onFetchFailure })

  const sections = useMemo(() => createEncodeSectionItems(visibleState.value), [visibleState.value])
  const visibleItems = useMemo(
    () => [...sections.running, ...sections.waiting],
    [sections.running, sections.waiting],
  )
  const visibleEncodeIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems])
  const selectedItems = visibleItems.filter((item) => selectedIds.has(item.id))

  useEffect(() => {
    // Refetch replaces row objects; selection is intentionally narrowed to ids still visible.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds((current) => {
      const next = toggleVisibleEncodeSelection({
        currentSelectedIds: current,
        visibleEncodeIds,
        action: 'preserve-visible',
      })

      return isSameEncodeSelection(current, next) ? current : next
    })
  }, [visibleEncodeIds])

  const closeEditMode = () => {
    setEditMode(false)
    setSelectedIds(new Set())
  }
  const toggleSelection = (encodeId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(encodeId)) {
        next.delete(encodeId)
      } else {
        next.add(encodeId)
      }
      return next
    })
  }
  const selectAllVisible = () => {
    setSelectedIds((current) =>
      toggleVisibleEncodeSelection({
        currentSelectedIds: current,
        visibleEncodeIds,
        action: 'select-all',
      }),
    )
  }
  return (
    <>
      {isEditMode ? (
        <EditTitleBar
          title={`${selectedItems.length} 件選択`}
          onClose={closeEditMode}
          onSelectAll={selectAllVisible}
          onDelete={() => setBulkCancelOpen(true)}
        />
      ) : (
        <TitleBar
          title="エンコード"
          isNavigationOpen={isNavigationOpen}
          navigationControlsId={SHELL_NAVIGATION_DRAWER_ID}
          onNavigationClick={onNavigationClick}
          rightActions={
            <IconButton
              aria-label="エンコードを編集"
              className={styles.titleIconButton}
              color="inherit"
              onClick={() => setEditMode(true)}
            >
              <span aria-hidden="true" className={styles.editIcon} />
            </IconButton>
          }
        />
      )}
      <main
        className={styles.encodePage}
        data-running-count={sections.running.length}
        data-waiting-count={sections.waiting.length}
        data-testid="encode-page"
        aria-label="エンコード一覧"
      >
        <EncodeSection
          label="エンコード中"
          items={sections.running}
          isEditMode={isEditMode}
          selectedIds={selectedIds}
          onSelect={toggleSelection}
          onCancel={setSingleCancelItem}
        />
        <EncodeSection
          label="待機中"
          items={sections.waiting}
          isEditMode={isEditMode}
          selectedIds={selectedIds}
          onSelect={toggleSelection}
          onCancel={setSingleCancelItem}
        />
      </main>
      <SingleCancelDialog
        item={singleCancelItem}
        apiRepository={apiRepository}
        onClose={() => setSingleCancelItem(null)}
        onSnackbar={onFetchFailure}
      />
      <BulkCancelDialog
        open={isBulkCancelOpen}
        items={selectedItems}
        apiRepository={apiRepository}
        onClose={() => setBulkCancelOpen(false)}
        onConfirmStart={closeEditMode}
        onSnackbar={onFetchFailure}
      />
    </>
  )
}
