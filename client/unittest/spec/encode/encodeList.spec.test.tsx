import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository, createEncodeRepository } from './encodeTestKit'

describe('Encode list route lifecycle and single cancel', () => {
  beforeEach(() => {
    vi.useRealTimers()
    localStorage.clear()
    window.history.replaceState(null, '', '/#/encode')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 2.1] [AC 2.2] [AC 2.4] [AC 2.5] [AC 2.20] [AC 2.30] renders running and waiting sections, fetches with settings, and does not POST /encode', async () => {
    const encodeRepository = createEncodeRepository()
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isHalfWidthDisplayed: false,
    }

    render(
      <App
        settings={settings}
        apiRepository={createShellRepository()}
        encodeApiRepository={encodeRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(screen.getByTestId('title-bar')).toHaveTextContent('エンコード')
    const page = await screen.findByTestId('encode-page')
    await waitFor(() => {
      expect(page).toHaveAttribute('data-running-count', '2')
    })
    expect(page).toHaveAttribute('data-waiting-count', '1')
    expect(encodeRepository.fetchEncode).toHaveBeenCalledWith({ isHalfWidth: false })
    expect(screen.getByRole('heading', { name: 'エンコード中' })).toBeVisible()
    expect(screen.getByRole('heading', { name: '待機中' })).toBeVisible()
    expect(screen.getByText('Synthetic running encode')).toBeVisible()
    expect(screen.getByText('Synthetic channel')).toBeVisible()
    expect(screen.getByAltText('Synthetic running encode サムネイル')).toHaveAttribute(
      'src',
      './api/thumbnails/777',
    )
    expect(screen.getByText('45% frame=456')).toBeVisible()
    expect(screen.queryByText('50%')).not.toBeInTheDocument()
    expect(screen.getByText('Synthetic waiting encode')).toBeVisible()
    expect('addEncode' in encodeRepository).toBe(false)
  })

  it('[AC 2.6] [AC 2.7] [AC 2.8] [AC 2.22] [AC 2.25] handles single cancel dialog success and failure with close cleanup', async () => {
    const encodeRepository = createEncodeRepository()

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
    fireEvent.click(
      screen.getByRole('button', { name: 'エンコード停止: Synthetic running encode' }),
    )
    expect(screen.getByRole('dialog')).toHaveTextContent(
      '[running-mode] Synthetic running encode を停止しますか?',
    )
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    await waitFor(() => {
      expect(encodeRepository.cancelEncode).toHaveBeenCalledWith(301)
    })
    expect(encodeRepository.cancelEncode).toHaveBeenCalledTimes(1)
    expect(encodeRepository.fetchEncode).toHaveBeenCalledTimes(1)
    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('[running-mode] Synthetic running encode を停止しました')).toBeVisible()
    vi.useRealTimers()

    expect(screen.getByTestId('single-encode-cancel-dialog')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByTestId('single-encode-cancel-dialog')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    vi.mocked(encodeRepository.cancelEncode).mockResolvedValueOnce({
      ok: false,
      error: 'encode-cancel-failed',
      message: 'cancel failed',
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'エンコード停止: Synthetic waiting encode' }),
    )
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    await waitFor(() => {
      expect(encodeRepository.cancelEncode).toHaveBeenCalledWith(401)
    })
    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('[waiting-mode] Synthetic waiting encode の停止に失敗')).toBeVisible()
    vi.useRealTimers()
  })
})
