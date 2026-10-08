import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RecordedBulkDeleteDialog,
  RecordedDeleteDialog,
} from '@/features/recorded/components/RecordedDeleteDialogs'
import { RecordedCleanupDialog } from '@/features/recorded/components/RecordedCleanupDialog'
import { RecordedDownloadDialog } from '@/features/recorded/components/RecordedDownloadDialog'
import { DropLogDialog } from '@/features/recorded/components/RecordedDetailMoreMenu'
import { DefaultSettingsFactory } from '@/shared/settings'
import { createRecordedRepository } from './recordedSpecRepository'

const settings = new DefaultSettingsFactory().create()

afterEach(() => {
  vi.restoreAllMocks()
})

describe('RecordedDeleteDialog', () => {
  it('[AC 2.24] preselects every identified file and deletes only the checked ones', async () => {
    const apiRepository = createRecordedRepository()
    const onSnackbar = vi.fn()
    const onDeleteSuccess = vi.fn()
    render(
      <RecordedDeleteDialog
        item={{ id: 5, videoFiles: [{ id: 1, name: 'a', size: 10 }, { name: 'no id' }, { id: 2 }] }}
        open
        settings={{ ...settings, deleteRecordedDefaultValue: true }}
        apiRepository={apiRepository}
        onClose={vi.fn()}
        onSnackbar={onSnackbar}
        onDeleteSuccess={onDeleteSuccess}
      />,
    )

    expect(screen.getByText('を削除しますか?')).toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    fireEvent.click(screen.getByRole('checkbox', { name: /^#2/ }))
    fireEvent.click(screen.getByRole('button', { name: '削除' }))

    await waitFor(() => {
      expect(onDeleteSuccess).toHaveBeenCalledWith({ allFilesDeleted: false })
    })
    expect(apiRepository.deleteVideoFile).toHaveBeenCalledWith(1)
    expect(apiRepository.deleteRecorded).not.toHaveBeenCalled()
    expect(onSnackbar).toHaveBeenCalledWith({ text: ' を削除', severity: 'success' })
  })

  it('[AC 2.28] reports partial failures and items without an id', async () => {
    const apiRepository = createRecordedRepository()
    vi.mocked(apiRepository.deleteVideoFile).mockResolvedValue({
      ok: false,
      error: 'delete-failed',
      message: 'failed',
    })
    const onSnackbar = vi.fn()
    const failing = render(
      <RecordedDeleteDialog
        item={{ id: 5, name: 'Named', videoFiles: [{ id: 1 }, { id: 2 }] }}
        open
        settings={settings}
        apiRepository={apiRepository}
        onClose={vi.fn()}
        onSnackbar={onSnackbar}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: /^#1/ }))
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith({ text: 'Named を削除に失敗', severity: 'error' })
    })
    failing.unmount()

    const onSnackbarNoId = vi.fn()
    render(
      <RecordedDeleteDialog
        item={{ name: 'Orphan', videoFiles: [{ id: 1 }] }}
        open
        settings={{ ...settings, deleteRecordedDefaultValue: true }}
        apiRepository={apiRepository}
        onClose={vi.fn()}
        onSnackbar={onSnackbarNoId}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await waitFor(() => {
      expect(onSnackbarNoId).toHaveBeenCalledWith({
        text: 'Orphan を削除に失敗',
        severity: 'error',
      })
    })
  })
})

describe('RecordedBulkDeleteDialog', () => {
  it('[AC 2.11] rejects an empty selection on open and on confirm', async () => {
    const onClose = vi.fn()
    const onSnackbar = vi.fn()
    render(
      <RecordedBulkDeleteDialog
        open
        items={[]}
        apiRepository={createRecordedRepository()}
        onClose={onClose}
        onSnackbar={onSnackbar}
        onCompleted={vi.fn()}
      />,
    )
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledTimes(2)
    })
    expect(onSnackbar).toHaveBeenLastCalledWith({
      text: '番組を選択してください。',
      severity: 'error',
    })
  })

  it('[AC 2.13] deletes files only when options are disabled and reports failures', async () => {
    const apiRepository = createRecordedRepository()
    vi.mocked(apiRepository.deleteVideoFile).mockImplementation(async (id: number) =>
      id === 2
        ? { ok: false as const, error: 'delete-failed' as const, message: 'failed' }
        : { ok: true as const, value: undefined },
    )
    const onSnackbar = vi.fn()
    const view = render(
      <RecordedBulkDeleteDialog
        open
        items={[{ id: 1, videoFiles: [{ id: 1 }, { name: 'no id' }, { id: 2 }] }, { id: 3 }]}
        apiRepository={apiRepository}
        disableOption
        onClose={vi.fn()}
        onSnackbar={onSnackbar}
        onCompleted={vi.fn()}
      />,
    )
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith({
        text: '一部番組の削除に失敗しました。',
        severity: 'error',
      })
    })
    expect(apiRepository.deleteVideoFile).toHaveBeenCalledTimes(2)
    view.unmount()

    const onSnackbarEmpty = vi.fn()
    render(
      <RecordedBulkDeleteDialog
        open
        items={[{ id: 3 }]}
        apiRepository={apiRepository}
        disableOption
        onClose={vi.fn()}
        onSnackbar={onSnackbarEmpty}
        onCompleted={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await waitFor(() => {
      expect(onSnackbarEmpty).toHaveBeenCalledWith({
        text: '番組を選択してください。',
        severity: 'error',
      })
    })
  })

  it('[AC 2.12] applies the chosen deletion option', async () => {
    const apiRepository = createRecordedRepository()
    const onCompleted = vi.fn()
    render(
      <RecordedBulkDeleteDialog
        open
        items={[
          {
            id: 1,
            videoFiles: [
              { id: 11, type: 'ts' },
              { id: 12, type: 'encoded' },
            ],
          },
        ]}
        apiRepository={apiRepository}
        onClose={vi.fn()}
        onSnackbar={vi.fn()}
        onCompleted={onCompleted}
      />,
    )
    fireEvent.mouseDown(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: 'オリジナルファイルだけ' }))
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await waitFor(() => {
      expect(onCompleted).toHaveBeenCalledTimes(1)
    })
    expect(apiRepository.deleteVideoFile).toHaveBeenCalledWith(11)
    expect(apiRepository.deleteVideoFile).not.toHaveBeenCalledWith(12)
  })
})

describe('RecordedCleanupDialog', () => {
  it('[AC 2.30] skips the minimum progress wait when cleanup already took a second', async () => {
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => (now += 5_000))
    const onSnackbar = vi.fn()
    render(
      <RecordedCleanupDialog
        open
        apiRepository={createRecordedRepository()}
        onClose={vi.fn()}
        onSnackbar={onSnackbar}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '実行' }))
    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith({ text: 'クリーンアップ完了', severity: 'success' })
    })
  })
})

describe('RecordedDownloadDialog and DropLogDialog', () => {
  it('[AC 3.14] lists download and playlist links for identified files only', () => {
    const onClose = vi.fn()
    render(
      <RecordedDownloadDialog
        open
        item={{ videoFiles: [{ id: 1 }, { name: 'no id' }, { id: 2, filename: 'f.ts', size: 5 }] }}
        settings={{ ...settings, shouldUseRecordedDownloadURLScheme: false }}
        onClose={onClose}
      />,
    )
    expect(screen.getByRole('link', { name: '#1 (0.0B)' })).toHaveAttribute(
      'href',
      './api/videos/1?isDownload=true',
    )
    expect(screen.getByRole('link', { name: '#2' })).toHaveAttribute(
      'href',
      './api/videos/2/playlist',
    )
    expect(screen.queryByRole('link', { name: /no id/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('video files'))
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onClose).not.toHaveBeenCalled()
    const backdrop = document.querySelector('.MuiBackdrop-root')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop as Element)
    expect(onClose).toHaveBeenCalled()
  })

  it('[AC 3.16] shows a placeholder when no drop log content exists', () => {
    render(<DropLogDialog open title="Log" content={null} onClose={vi.fn()} />)
    expect(screen.getByText('ログファイルがありません')).toBeInTheDocument()
  })
})
