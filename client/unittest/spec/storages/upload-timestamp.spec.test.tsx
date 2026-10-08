import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ServerConfigNavigationState } from '@/app/serverApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository } from '../recorded/recordedSpecHelpers'
import { createRecordedRepository } from '../recorded/recordedSpecRepository'
import {
  fillRequiredUploadFields,
  uploadProgramNameInput,
  warmUpRecordedUploadAppRender,
} from './recordedUploadSpecSupport'

function readRouteTimestamp(): number {
  const [, search = ''] = window.location.hash.split('?')
  return Number(new URLSearchParams(search).get('timestamp'))
}

describe('Recorded upload route timestamp refresh', () => {
  beforeAll(async () => {
    await warmUpRecordedUploadAppRender()
  })

  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded/upload')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 3.13] updates the route to a new timestamp after a successful upload while keeping form values', async () => {
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={
          {
            status: 'loaded',
            liveStreamEnabled: false,
            enabledBroadcastWaves: [],
            recordedDirectories: ['archive-root'],
          } as ServerConfigNavigationState
        }
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-upload-page')
    expect(window.location.hash.split('?')[0]).toBe('#/recorded/upload')
    const initialTimestamp = readRouteTimestamp()
    expect(Number.isNaN(initialTimestamp)).toBe(false)

    await fillRequiredUploadFields()

    vi.useFakeTimers()
    // Force the mocked clock strictly past whatever real time the initial route timestamp was
    // captured at, so a route update is unambiguous even if this test runs fast enough that two
    // `Date.now()` reads would otherwise land in the same millisecond.
    vi.setSystemTime(Date.now() + 5000)

    fireEvent.click(screen.getByRole('button', { name: 'アップロード' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('アップロード完了')).toBeVisible()
    // Flush the uploading dialog's remount-delay timer while still under fake timers, so
    // switching back to real timers below does not drop it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    vi.useRealTimers()

    expect(window.location.hash.split('?')[0]).toBe('#/recorded/upload')
    const updatedTimestamp = readRouteTimestamp()
    expect(Number.isNaN(updatedTimestamp)).toBe(false)
    expect(updatedTimestamp).toBeGreaterThan(initialTimestamp)
    expect(uploadProgramNameInput()).toHaveValue('Synthetic program')
  })

  it('[AC 3.13] closes the upload-success snackbar when the user navigates to another route afterward', async () => {
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={
          {
            status: 'loaded',
            liveStreamEnabled: false,
            enabledBroadcastWaves: [],
            recordedDirectories: ['archive-root'],
          } as ServerConfigNavigationState
        }
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-upload-page')
    await fillRequiredUploadFields()

    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 5000)
    fireEvent.click(screen.getByRole('button', { name: 'アップロード' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('アップロード完了')).toBeVisible()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    vi.useRealTimers()

    // A subsequent navigation to another route is a normal route change, so it closes the
    // snackbar shown by the upload success above.
    act(() => {
      window.location.hash = '#/recorded'
    })
    await screen.findByTestId('recorded-page')
    expect(screen.queryByText('アップロード完了')).not.toBeInTheDocument()
  })

  it('[AC 3.5] does not update the route timestamp when metadata creation fails', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.createRecorded).mockResolvedValueOnce({
      ok: false,
      error: 'recorded-create-failed',
      message: 'metadata failed',
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={
          {
            status: 'loaded',
            liveStreamEnabled: false,
            enabledBroadcastWaves: [],
            recordedDirectories: ['archive-root'],
          } as ServerConfigNavigationState
        }
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-upload-page')
    const initialTimestamp = readRouteTimestamp()
    await fillRequiredUploadFields()

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'アップロード' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('アップロードに失敗')).toBeVisible()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    vi.useRealTimers()

    expect(window.location.hash.split('?')[0]).toBe('#/recorded/upload')
    expect(readRouteTimestamp()).toBe(initialTimestamp)
  })
})
