import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { createScrollHistory } from '@/app/scrollHistory'
import {
  SyntheticRealtimeConnection,
  createShellRepository,
  createEncodeRepository,
} from './encodeTestKit'

describe('Encode edit mode, bulk cancel and realtime refresh', () => {
  beforeEach(() => {
    vi.useRealTimers()
    localStorage.clear()
    window.history.replaceState(null, '', '/#/encode')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 2.9] [AC 2.10] [AC 2.11] [AC 2.13] [AC 2.14] [AC 2.15] [AC 2.16] [AC 2.24] [AC 2.25] supports edit mode select-all, zero-selection snackbar, and bulk cancel continuing after failures', async () => {
    const encodeRepository = createEncodeRepository()
    vi.mocked(encodeRepository.cancelEncode)
      .mockResolvedValueOnce({
        ok: false,
        error: 'encode-cancel-failed',
        message: 'cancel failed',
      })
      .mockResolvedValueOnce({ ok: true as const, value: undefined })
      .mockResolvedValueOnce({ ok: true as const, value: undefined })

    render(
      <App
        apiRepository={createShellRepository()}
        encodeApiRepository={encodeRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('encode-page')).toHaveAttribute('data-running-count', '2')
    })
    fireEvent.click(screen.getByRole('button', { name: 'エンコードを編集' }))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('0 件選択')
    expect(screen.queryByRole('button', { name: /エンコード停止:/ })).not.toBeInTheDocument()
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '選択項目を削除' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('番組を選択してください。')).toBeVisible()
    expect(screen.queryByRole('dialog', { name: 'エンコード一括削除' })).not.toBeInTheDocument()
    vi.useRealTimers()

    fireEvent.click(screen.getByText('Synthetic running encode'))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択')
    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('3 件選択')
    fireEvent.click(screen.getByRole('button', { name: '選択項目を削除' }))
    expect(await screen.findByText('選択した 3 件の番組を削除しますか。')).toBeVisible()
    const bulkDialog = screen.getByRole('dialog', { name: 'エンコード一括停止' })
    expect(bulkDialog).toHaveTextContent('選択した 3 件の番組を削除しますか。')
    expect(bulkDialog).toHaveClass(/bulkCancelDialogPaper/)
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeVisible()
    expect(screen.getByRole('button', { name: '削除' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await waitFor(() => {
      expect(encodeRepository.cancelEncode).toHaveBeenCalledTimes(3)
    })
    expect(encodeRepository.fetchEncode).toHaveBeenCalledTimes(1)
    expect(encodeRepository.cancelEncode).toHaveBeenNthCalledWith(1, 301)
    expect(encodeRepository.cancelEncode).toHaveBeenNthCalledWith(2, 302)
    expect(encodeRepository.cancelEncode).toHaveBeenNthCalledWith(3, 401)
    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('一部エンコードのキャンセルに失敗しました。')).toBeVisible()
    vi.useRealTimers()
    expect(screen.getByTestId('title-bar')).toHaveTextContent('エンコード')
  })

  it('[AC 2.28] keeps bulk cancel dialog paper free of the legacy fixed-height scrollbar trap', () => {
    const css = readFileSync('src/features/encode/EncodePage.module.css', 'utf8')
    const bulkPaperRule = css.match(/\.bulkCancelDialogPaper\s*\{(?<body>[^}]*)\}/u)?.groups?.body

    expect(bulkPaperRule).toContain('min-height: 120px')
    expect(bulkPaperRule).not.toMatch(/(?:^|[;\s])height\s*:\s*90px/u)
  })

  it('[AC 2.2] [AC 2.3] [AC 2.18] [AC 2.21] [AC 2.29] [AC 3.1] [AC 3.2] refetches on updateStatus and updateEncode, reports fetch failure, and leaves empty encode content blank', async () => {
    const encodeRepository = createEncodeRepository()
    const connection = new SyntheticRealtimeConnection()
    const scrollHistory = createScrollHistory({ shouldRestoreHistory: false })
    const emitDoneGetData = vi.spyOn(scrollHistory, 'emitDoneGetData')

    render(
      <App
        apiRepository={createShellRepository()}
        encodeApiRepository={encodeRepository}
        scrollHistory={scrollHistory}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('encode-page')).toHaveAttribute('data-running-count', '2')
    })
    vi.mocked(encodeRepository.fetchEncode).mockResolvedValueOnce({
      ok: true,
      value: {
        runningItems: [],
        waitItems: [],
      },
    })
    act(() => {
      connection.emit('updateEncode')
    })
    await waitFor(() => {
      expect(encodeRepository.fetchEncode).toHaveBeenCalledTimes(2)
    })
    await waitFor(() => {
      expect(screen.getByTestId('encode-page')).toHaveAttribute('data-running-count', '0')
    })
    expect(screen.getByTestId('encode-page')).toHaveAttribute('data-waiting-count', '0')
    expect(screen.queryByRole('heading', { name: 'エンコード中' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '待機中' })).not.toBeInTheDocument()
    expect(screen.queryByText('エンコードはありません')).not.toBeInTheDocument()

    vi.mocked(encodeRepository.fetchEncode).mockResolvedValueOnce({
      ok: true,
      value: {
        runningItems: [],
        waitItems: [],
      },
    })
    act(() => {
      connection.emit('updateEncode')
    })
    await waitFor(() => {
      expect(encodeRepository.fetchEncode).toHaveBeenCalledTimes(3)
    })

    vi.mocked(encodeRepository.fetchEncode).mockResolvedValueOnce({
      ok: false,
      error: 'encode-fetch-failed',
      message: 'エンコード情報取得に失敗',
    })
    vi.useFakeTimers()
    act(() => {
      connection.emit('updateStatus')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('エンコード情報取得に失敗')).toBeVisible()
    expect(encodeRepository.fetchEncode).toHaveBeenCalledTimes(4)
    expect(emitDoneGetData).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('[AC 2.27] preserves visible edit selection across Socket.IO updateEncode refetch', async () => {
    const encodeRepository = createEncodeRepository()
    const connection = new SyntheticRealtimeConnection()

    render(
      <App
        apiRepository={createShellRepository()}
        encodeApiRepository={encodeRepository}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await waitFor(() => {
      expect(screen.getByTestId('encode-page')).toHaveAttribute('data-running-count', '2')
    })
    fireEvent.click(screen.getByRole('button', { name: 'エンコードを編集' }))
    fireEvent.click(screen.getByText('Synthetic running encode'))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択')

    act(() => {
      connection.emit('updateEncode')
    })

    await waitFor(() => {
      expect(encodeRepository.fetchEncode).toHaveBeenCalledTimes(2)
    })
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択')
  })
})
