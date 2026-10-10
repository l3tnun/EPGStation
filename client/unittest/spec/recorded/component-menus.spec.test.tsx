import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { RecordedDetailMoreMenu } from '@/features/recorded/components/RecordedDetailMoreMenu'
import { RecordedDetailVideoFileMenu } from '@/features/recorded/components/RecordedDetailVideoFileMenu'
import { RecordedItemMenu } from '@/features/recorded/components/RecordedItemMenu'
import { RecordedSearchDialog } from '@/features/recorded/components/RecordedSearchDialog'
import type { RecordedApiRepository, RecordedListItem } from '@/features/recorded/recordedApi'
import { DefaultSettingsFactory } from '@/shared/settings'
import { changeSettingsSelect } from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

const settings = new DefaultSettingsFactory().create()
const protectFailed = { ok: false as const, error: 'protect-failed' as const, message: 'failed' }
const unprotectFailed = {
  ok: false as const,
  error: 'unprotect-failed' as const,
  message: 'failed',
}

function renderItemMenu(item: RecordedListItem, apiRepository: RecordedApiRepository) {
  const onSnackbar = vi.fn()
  render(
    <MemoryRouter>
      <RecordedItemMenu
        item={item}
        apiRepository={apiRepository}
        settings={settings}
        onSnackbar={onSnackbar}
        onRefetchRequested={vi.fn()}
      />
    </MemoryRouter>,
  )
  return onSnackbar
}

describe('RecordedItemMenu', () => {
  it('[AC 2.16] labels id-less items and ignores protect and stop without an id', async () => {
    const apiRepository = createRecordedRepository()
    renderItemMenu({ isEncoding: true }, apiRepository)
    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: #' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'protect' }))
    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: #' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'stop' }))
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
    expect(apiRepository.protectRecorded).not.toHaveBeenCalled()
    expect(apiRepository.stopEncode).not.toHaveBeenCalled()
  })

  it('[AC 2.20] shows stop encode for an item that is still recording, matching v2 (isEncoding alone gates the action)', async () => {
    const apiRepository = createRecordedRepository()
    renderItemMenu(
      { id: 5, name: 'Still recording', isRecording: true, isEncoding: true },
      apiRepository,
    )
    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Still recording' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'stop' }))
    await waitFor(() => {
      expect(apiRepository.stopEncode).toHaveBeenCalledWith(5)
    })
  })

  it('[AC 2.16] reports a protect failure', async () => {
    const apiRepository = createRecordedRepository()
    vi.mocked(apiRepository.protectRecorded).mockResolvedValue(protectFailed)
    const onSnackbar = renderItemMenu({ id: 1, name: 'N' }, apiRepository)
    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: N' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'protect' }))
    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith({ text: '保護に失敗', severity: 'error' })
    })
  })
})

describe('RecordedDetailMoreMenu', () => {
  function renderMoreMenu(item: RecordedListItem, apiRepository: RecordedApiRepository) {
    const onSnackbar = vi.fn()
    render(
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
    return { onSnackbar }
  }

  it('[AC 2.29] does not offer クリーンアップ in the Recorded detail more menu', () => {
    renderMoreMenu({ id: 1 }, createRecordedRepository())
    fireEvent.click(screen.getByRole('button', { name: '録画詳細メニュー: #1' }))

    expect(screen.getAllByRole('menuitem').length).toBeGreaterThan(0)
    expect(screen.queryByRole('menuitem', { name: 'クリーンアップ' })).not.toBeInTheDocument()
  })

  it('[AC 3.13] toggles protection with success and failure notices, relying on Socket.IO updateStatus for the refetch instead of an explicit one', async () => {
    const apiRepository = createRecordedRepository()
    const protectedItem = renderMoreMenu({ id: 1, isProtected: true }, apiRepository)
    fireEvent.click(screen.getByRole('button', { name: '録画詳細メニュー: #1' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'unprotect' }))
    await waitFor(() => {
      expect(protectedItem.onSnackbar).toHaveBeenCalledWith({
        text: '保護解除に成功',
        severity: 'success',
      })
    })
    expect(apiRepository.unprotectRecorded).toHaveBeenCalledTimes(1)

    vi.mocked(apiRepository.unprotectRecorded).mockResolvedValue(unprotectFailed)
    fireEvent.click(screen.getByRole('button', { name: '録画詳細メニュー: #1' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'unprotect' }))
    await waitFor(() => {
      expect(protectedItem.onSnackbar).toHaveBeenLastCalledWith({
        text: '保護解除に失敗',
        severity: 'error',
      })
    })
  })

  it('[AC 3.13] reports protect failures and ignores id-less items', async () => {
    const apiRepository = createRecordedRepository()
    vi.mocked(apiRepository.protectRecorded).mockResolvedValue(protectFailed)
    const named = renderMoreMenu({ id: 2, name: 'N' }, apiRepository)
    fireEvent.click(screen.getByRole('button', { name: '録画詳細メニュー: N' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'protect' }))
    await waitFor(() => {
      expect(named.onSnackbar).toHaveBeenCalledWith({ text: '保護に失敗', severity: 'error' })
    })

    renderMoreMenu({}, apiRepository)
    fireEvent.click(screen.getByRole('button', { name: '録画詳細メニュー: #' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'protect' }))
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
    expect(apiRepository.protectRecorded).toHaveBeenCalledTimes(1)
  })
})

describe('RecordedDetailVideoFileMenu', () => {
  it('[AC 3.2] labels files by name or id for links and buttons', () => {
    const onSelect = vi.fn()
    render(
      <RecordedDetailVideoFileMenu
        title="play"
        icon="i"
        files={[{}, { name: 'named' }, { id: 1 }]}
        onSelect={onSelect}
        hrefForFile={(file) => (file.name === 'named' ? 'https://example.invalid/x' : undefined)}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'play' }))
    expect(screen.getByRole('link', { name: 'named' })).toHaveAttribute(
      'href',
      'https://example.invalid/x',
    )
    expect(screen.getByRole('button', { name: '#' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '#1' }))
    expect(onSelect).toHaveBeenCalledWith({ id: 1 })
  })

  it('[AC 3.2] labels an id-less, name-less linked file with a bare hash', () => {
    render(
      <RecordedDetailVideoFileMenu
        title="play"
        icon="i"
        files={[{}]}
        onSelect={vi.fn()}
        hrefForFile={() => 'https://example.invalid/z'}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'play' }))
    expect(screen.getByRole('link', { name: '#' })).toHaveAttribute(
      'href',
      'https://example.invalid/z',
    )
  })
})

describe('RecordedSearchDialog', () => {
  it('[AC 2.1] submits on Enter, clears fields, and changes the genre', async () => {
    const apiRepository = createRecordedRepository()
    const onNavigate = vi.fn()
    render(
      <RecordedSearchDialog
        anchorEl={document.body}
        search=""
        apiRepository={apiRepository}
        isHalfWidthDisplayed={settings.isHalfWidthDisplayed}
        onClose={vi.fn()}
        onNavigate={onNavigate}
        onSnackbar={vi.fn()}
      />,
    )
    const keyword = await screen.findByRole('textbox', { name: 'キーワード' })
    fireEvent.change(keyword, { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: 'キーワードをクリア' }))
    expect(keyword).toHaveValue('')
    fireEvent.change(keyword, { target: { value: 'kw' } })
    fireEvent.keyDown(keyword, { key: 'a' })
    expect(onNavigate).not.toHaveBeenCalled()

    await changeSettingsSelect('ルール', 'Synthetic rule')
    fireEvent.click(screen.getByRole('button', { name: 'ルールをクリア' }))
    await changeSettingsSelect('ジャンル', 'Synthetic genre')
    fireEvent.click(screen.getByRole('button', { name: 'ジャンルをクリア' }))
    await changeSettingsSelect('ジャンル', 'Synthetic genre')
    fireEvent.keyDown(keyword, { key: 'Enter' })
    expect(onNavigate).toHaveBeenCalledWith('/recorded?keyword=kw&genre=5')
  })
})
