import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import {
  SyntheticRealtimeConnection,
  createShellRepository,
  createEncodeRepository,
} from './encodeTestKit'

function renderEncode(
  encodeRepository = createEncodeRepository(),
  connection?: SyntheticRealtimeConnection,
) {
  render(
    <App
      apiRepository={createShellRepository()}
      encodeApiRepository={encodeRepository}
      realtimeConnectionFactory={connection === undefined ? undefined : () => connection}
      osPrefersDark={false}
      viewportWidth={1440}
      initialDrawerState="none"
    />,
  )
  return encodeRepository
}

describe('Encode cancel dialogs and selection edges', () => {
  beforeEach(() => {
    vi.useRealTimers()
    localStorage.clear()
    window.history.replaceState(null, '', '/#/encode')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 2.6] [AC 2.7] [AC 2.8] [AC 2.25] stops a single encode once even when 停止 is pressed twice, and reports failure', async () => {
    let resolveCancel: (value: { ok: true; value: undefined }) => void = () => undefined
    const encodeRepository = createEncodeRepository()
    vi.mocked(encodeRepository.cancelEncode)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCancel = resolve
          }),
      )
      .mockResolvedValueOnce({ ok: false, error: 'encode-cancel-failed', message: 'failed' })
    renderEncode(encodeRepository)

    await screen.findByRole('button', { name: 'エンコード停止: Synthetic running encode' })
    fireEvent.click(
      screen.getByRole('button', { name: 'エンコード停止: Synthetic running encode' }),
    )
    const dialog = await screen.findByRole('dialog', { name: 'エンコード停止' })
    expect(dialog).toHaveTextContent('[running-mode] Synthetic running encode を停止しますか?')
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.getByRole('dialog', { name: 'エンコード停止' })).toBeVisible()
    expect(encodeRepository.cancelEncode).toHaveBeenCalledTimes(1)
    vi.useFakeTimers()
    await act(async () => {
      resolveCancel({ ok: true, value: undefined })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('[running-mode] Synthetic running encode を停止しました')).toBeVisible()

    // The closed cancel dialog stays mounted (and keeps the rest of the page aria-hidden) for its
    // 100ms delayed-unmount timer plus the Dialog's closing transition, so drive that under the
    // same fake-timer clock instead of racing it with a real-time find.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })

    fireEvent.click(screen.getByRole('button', { name: 'エンコード停止: Synthetic percent only' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('[percent-only] Synthetic percent only を停止しますか?')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('[percent-only] Synthetic percent only の停止に失敗')).toBeVisible()
    vi.useRealTimers()
    expect(encodeRepository.cancelEncode).toHaveBeenLastCalledWith(302)
  })

  it('[AC 2.7] closes the single cancel dialog with キャンセル without calling the API', async () => {
    const encodeRepository = renderEncode()

    fireEvent.click(
      await screen.findByRole('button', { name: 'エンコード停止: Synthetic running encode' }),
    )
    await screen.findByRole('dialog', { name: 'エンコード停止' })
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'エンコード停止' })).not.toBeInTheDocument()
    })
    expect(encodeRepository.cancelEncode).not.toHaveBeenCalled()
  })

  it('[AC 2.9] [AC 2.10] [AC 2.12] [AC 2.16] [AC 2.25] ignores a second 削除 press while the bulk cancel is already running', async () => {
    let resolveCancel: (value: { ok: true; value: undefined }) => void = () => undefined
    const encodeRepository = createEncodeRepository()
    vi.mocked(encodeRepository.cancelEncode).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCancel = resolve
        }),
    )
    renderEncode(encodeRepository)

    await waitFor(() => {
      expect(screen.getByTestId('encode-page')).toHaveAttribute('data-running-count', '2')
    })
    fireEvent.click(screen.getByRole('button', { name: 'エンコードを編集' }))
    fireEvent.click(screen.getByText('Synthetic running encode'))
    fireEvent.click(screen.getByRole('button', { name: '選択項目を削除' }))
    await screen.findByRole('dialog', { name: 'エンコード一括停止' })
    const confirm = screen.getByRole('button', { name: '削除' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(encodeRepository.cancelEncode).toHaveBeenCalledTimes(1)
    vi.useFakeTimers()
    await act(async () => {
      resolveCancel({ ok: true, value: undefined })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('選択したエンコードをキャンセルしました。')).toBeVisible()
    vi.useRealTimers()
  })

  it('[AC 2.26] hides a broken thumbnail and titles items without a recorded name by id', async () => {
    const encodeRepository = createEncodeRepository()
    vi.mocked(encodeRepository.fetchEncode).mockResolvedValue({
      ok: true,
      value: {
        runningItems: [
          { id: 1, mode: 'thumb', recorded: { id: 10, name: 'Thumb item', thumbnails: [5] } },
        ],
        waitItems: [{ id: 2, mode: 'noname', recorded: {} }],
      },
    })
    renderEncode(encodeRepository)

    const image = await screen.findByRole('img', { name: 'Thumb item サムネイル' })
    fireEvent.error(image)
    expect(image.style.visibility).toBe('hidden')
    expect(screen.getByText('#2')).toBeVisible()
  })

  it('[AC 2.10] [AC 2.11] [AC 2.27] narrows the edit selection to ids still visible after a refetch', async () => {
    const encodeRepository = createEncodeRepository()
    const connection = new SyntheticRealtimeConnection()
    renderEncode(encodeRepository, connection)

    await waitFor(() => {
      expect(screen.getByTestId('encode-page')).toHaveAttribute('data-running-count', '2')
    })
    fireEvent.click(screen.getByRole('button', { name: 'エンコードを編集' }))
    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('3 件選択')
    fireEvent.click(screen.getByText('Synthetic percent only'))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('2 件選択')

    vi.mocked(encodeRepository.fetchEncode).mockResolvedValueOnce({
      ok: true,
      value: {
        runningItems: [
          {
            id: 301,
            mode: 'running-mode',
            recorded: { id: 501, name: 'Synthetic running encode' },
          },
        ],
        waitItems: [],
      },
    })
    act(() => {
      connection.emit('updateEncode')
    })
    await waitFor(() => {
      expect(screen.getByTestId('encode-page')).toHaveAttribute('data-waiting-count', '0')
    })
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択')

    vi.mocked(encodeRepository.fetchEncode).mockResolvedValue({
      ok: true,
      value: {
        runningItems: [
          {
            id: 301,
            mode: 'running-mode',
            recorded: { id: 501, name: 'Synthetic running encode' },
          },
          { id: 303, mode: 'new-mode', recorded: { id: 503, name: 'Synthetic new encode' } },
        ],
        waitItems: [],
      },
    })
    act(() => {
      connection.emit('updateEncode')
    })
    await waitFor(() => {
      expect(screen.getByTestId('encode-page')).toHaveAttribute('data-running-count', '2')
    })
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択')
  })

  it('[AC 2.18] [AC 2.21] shows the error state when the first encode fetch fails', async () => {
    const encodeRepository = createEncodeRepository()
    vi.mocked(encodeRepository.fetchEncode).mockResolvedValueOnce({
      ok: false,
      error: 'encode-fetch-failed',
      message: 'エンコード情報取得に失敗',
    })
    vi.useFakeTimers()
    renderEncode(encodeRepository)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('エンコード情報取得に失敗')).toBeVisible()
    expect(screen.getByTestId('encode-page')).toHaveAttribute('data-running-count', '0')
    expect(screen.getByTestId('encode-page')).toHaveAttribute('data-waiting-count', '0')
    vi.useRealTimers()
  })
})
