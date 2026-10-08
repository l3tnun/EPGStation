import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecordedDeleteDialog } from '@/features/recorded/components/RecordedDeleteDialogs'
import { RecordedDetailMoreMenu } from '@/features/recorded/components/RecordedDetailMoreMenu'
import type { RecordedApiRepository, RecordedListItem } from '@/features/recorded/recordedApi'
import { DefaultSettingsFactory } from '@/shared/settings'
import { createRecordedRepository } from './recordedSpecRepository'

// The detail more menu and the delete dialog both resolve their API result through a
// conditional expression that awaits on both arms before branching on the result. These
// specs drive the failure arm of that branch repeatedly, each time from a fresh mount, so
// the failure snackbar path is exercised independently of the success path.

const settings = new DefaultSettingsFactory().create()
const protectFailed = { ok: false as const, error: 'protect-failed' as const, message: 'failed' }
const deleteFileFailed = {
  ok: false as const,
  error: 'delete-failed' as const,
  message: 'failed',
}

afterEach(() => {
  vi.restoreAllMocks()
})

function renderMoreMenu(item: RecordedListItem, apiRepository: RecordedApiRepository) {
  const onSnackbar = vi.fn()
  const view = render(
    <MemoryRouter>
      <RecordedDetailMoreMenu
        item={item}
        settings={settings}
        apiRepository={apiRepository}
        onSnackbar={onSnackbar}
        onDeletedAllFiles={vi.fn()}
      />
    </MemoryRouter>,
  )
  return { onSnackbar, unmount: view.unmount }
}

describe('RecordedDetailMoreMenu protect failure path', () => {
  it('[AC 3.13] reports 保護に失敗 for every failed protect attempt', async () => {
    const apiRepository = createRecordedRepository()
    vi.mocked(apiRepository.protectRecorded).mockResolvedValue(protectFailed)

    for (const id of [11, 12, 13]) {
      const menu = renderMoreMenu({ id, name: `Item ${id}` }, apiRepository)
      fireEvent.click(screen.getByRole('button', { name: `録画詳細メニュー: Item ${id}` }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'protect' }))
      await waitFor(() => {
        expect(menu.onSnackbar).toHaveBeenCalledWith({ text: '保護に失敗', severity: 'error' })
      })
      expect(menu.onSnackbar).toHaveBeenCalledTimes(1)
      expect(apiRepository.protectRecorded).toHaveBeenLastCalledWith(id)
      menu.unmount()
    }

    expect(apiRepository.protectRecorded).toHaveBeenCalledTimes(3)
    expect(apiRepository.unprotectRecorded).not.toHaveBeenCalled()
  })
})

describe('RecordedDeleteDialog partial delete failure path', () => {
  it('[AC 3.10] reports <name> を削除に失敗 when a partial video file delete fails', async () => {
    const apiRepository = createRecordedRepository()
    vi.mocked(apiRepository.deleteVideoFile).mockResolvedValue(deleteFileFailed)

    for (const id of [21, 22, 23]) {
      const onSnackbar = vi.fn()
      const onDeleteSuccess = vi.fn()
      const onClose = vi.fn()
      const view = render(
        <RecordedDeleteDialog
          item={{
            id,
            name: `Target ${id}`,
            videoFiles: [
              { id: id * 10, name: 'ts', size: 10 },
              { id: id * 10 + 1, name: 'mp4', size: 5 },
            ],
          }}
          open
          settings={{ ...settings, deleteRecordedDefaultValue: true }}
          apiRepository={apiRepository}
          onClose={onClose}
          onSnackbar={onSnackbar}
          onDeleteSuccess={onDeleteSuccess}
        />,
      )

      fireEvent.click(screen.getByRole('checkbox', { name: /^mp4/ }))
      fireEvent.click(screen.getByRole('button', { name: '削除' }))
      await waitFor(() => {
        expect(onSnackbar).toHaveBeenCalledWith({
          text: `Target ${id} を削除に失敗`,
          severity: 'error',
        })
      })
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(onDeleteSuccess).not.toHaveBeenCalled()
      expect(apiRepository.deleteVideoFile).toHaveBeenLastCalledWith(id * 10)
      view.unmount()
    }

    expect(apiRepository.deleteVideoFile).toHaveBeenCalledTimes(3)
    expect(apiRepository.deleteRecorded).not.toHaveBeenCalled()
  })

  it('[AC 3.9] attempts every selected video file even after an earlier one fails to delete', async () => {
    // Source A: v2 5cf2ea383 client/src/components/recorded/RecordedDeleteDialog.vue:152-166 —
    // the `delete()` loop calls videoApiModel.delete() for every checked file, catching each
    // failure into `isError` instead of stopping the loop, and throws only after every checked
    // file has been attempted.
    const apiRepository = createRecordedRepository()
    vi.mocked(apiRepository.deleteVideoFile).mockImplementation(async (id: number) =>
      id === 31 ? deleteFileFailed : { ok: true as const, value: undefined },
    )
    const onSnackbar = vi.fn()
    const onDeleteSuccess = vi.fn()
    render(
      <RecordedDeleteDialog
        item={{
          id: 9,
          name: 'Multi file target',
          videoFiles: [
            { id: 31, name: 'ts', size: 10 },
            { id: 32, name: 'mp4', size: 5 },
            { id: 33, name: 'mkv', size: 5 },
          ],
        }}
        open
        settings={{ ...settings, deleteRecordedDefaultValue: true }}
        apiRepository={apiRepository}
        onClose={vi.fn()}
        onSnackbar={onSnackbar}
        onDeleteSuccess={onDeleteSuccess}
      />,
    )

    // Leave file 33 unchecked so the selection is partial (2 of 3), which routes through the
    // per-video-file DELETE /videos/:videoFileId loop instead of DELETE /recorded/:id.
    fireEvent.click(screen.getByRole('checkbox', { name: /^mkv/ }))
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith({
        text: 'Multi file target を削除に失敗',
        severity: 'error',
      })
    })

    expect(apiRepository.deleteVideoFile).toHaveBeenCalledWith(31)
    expect(apiRepository.deleteVideoFile).toHaveBeenCalledWith(32)
    expect(apiRepository.deleteVideoFile).not.toHaveBeenCalledWith(33)
    expect(apiRepository.deleteVideoFile).toHaveBeenCalledTimes(2)
    expect(onDeleteSuccess).not.toHaveBeenCalled()
  })
})
