import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RecordedBulkDeleteDialog,
  RecordedDeleteDialog,
} from '@/features/recorded/components/RecordedDeleteDialogs'
import { DefaultSettingsFactory } from '@/shared/settings'
import { createRecordedRepository } from './recordedSpecRepository'

const settings = new DefaultSettingsFactory().create()

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RecordedDeleteDialog nameless item failure messages', () => {
  it('[AC 3.10] falls back to a blank name when an id-less item fails to delete', async () => {
    const apiRepository = createRecordedRepository()
    const onSnackbar = vi.fn()
    render(
      <RecordedDeleteDialog
        item={{ videoFiles: [{ id: 1, size: 5 }] }}
        open
        settings={{ ...settings, deleteRecordedDefaultValue: true }}
        apiRepository={apiRepository}
        onClose={vi.fn()}
        onSnackbar={onSnackbar}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith({ text: ' を削除に失敗', severity: 'error' })
    })
    expect(apiRepository.deleteRecorded).not.toHaveBeenCalled()
    expect(apiRepository.deleteVideoFile).not.toHaveBeenCalled()
  })

  it('[AC 3.10] falls back to a blank name when a nameless full delete fails', async () => {
    const apiRepository = createRecordedRepository()
    vi.mocked(apiRepository.deleteRecorded).mockResolvedValue({
      ok: false,
      error: 'delete-failed',
      message: 'failed',
    })
    const onSnackbar = vi.fn()
    render(
      <RecordedDeleteDialog
        item={{ id: 5, videoFiles: [{ id: 1, size: 5 }] }}
        open
        settings={{ ...settings, deleteRecordedDefaultValue: true }}
        apiRepository={apiRepository}
        onClose={vi.fn()}
        onSnackbar={onSnackbar}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith({ text: ' を削除に失敗', severity: 'error' })
    })
    expect(apiRepository.deleteRecorded).toHaveBeenCalledWith(5)
  })
})

describe('RecordedBulkDeleteDialog video-files-only success', () => {
  it('[AC 2.13] reports success when every video file only deletion succeeds', async () => {
    const apiRepository = createRecordedRepository()
    const onSnackbar = vi.fn()
    render(
      <RecordedBulkDeleteDialog
        open
        items={[
          { id: 1, videoFiles: [{ id: 11 }, { id: 12 }] },
          { id: 2, videoFiles: [{ id: 21 }] },
        ]}
        apiRepository={apiRepository}
        disableOption
        onClose={vi.fn()}
        onSnackbar={onSnackbar}
        onCompleted={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith({
        text: '選択した番組を削除しました。',
        severity: 'success',
      })
    })
    expect(apiRepository.deleteVideoFile).toHaveBeenCalledTimes(3)
    expect(apiRepository.deleteRecorded).not.toHaveBeenCalled()
  })
})
