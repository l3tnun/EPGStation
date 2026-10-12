import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ServerConfigNavigationState } from '@/app/serverApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository } from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

describe('Recorded detail route, data, and actions', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded/detail/301')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 2.18] [AC 2.19] [AC 2.20] [AC 3.17] [AC 3.19] reuses add encode and stop encode actions from the detail action buttons', async () => {
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
            encodeModes: ['detail-mode'],
            isEncodeEnabled: true,
            recordedDirectories: ['archive-root'],
          } as ServerConfigNavigationState
        }
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-detail-page')
    expect(screen.getByRole('button', { name: 'stop' })).toHaveAttribute(
      'data-recorded-detail-action',
      'stop',
    )
    fireEvent.click(screen.getByRole('button', { name: 'encode' }))
    const dialog = await screen.findByRole('dialog', { name: 'エンコード追加' })
    expect(dialog).toHaveAttribute('data-recorded-add-encode-dialog', 'legacy')
    expect(screen.queryByRole('heading', { name: 'エンコード追加' })).not.toBeInTheDocument()
    expect(dialog).toHaveTextContent('Synthetic detail target')
    expect(screen.getByLabelText('source')).toHaveAttribute(
      'data-recorded-add-encode-field',
      'source',
    )
    expect(screen.getByLabelText('preset')).toHaveAttribute(
      'data-recorded-add-encode-field',
      'preset',
    )
    expect(screen.getByLabelText('recorded')).toHaveAttribute(
      'data-recorded-add-encode-field',
      'parent',
    )
    expect(screen.getByLabelText('sub directory')).toHaveAttribute(
      'data-recorded-add-encode-field',
      'directory',
    )
    fireEvent.click(await screen.findByRole('button', { name: '追加' }))
    expect(recordedRepository.addEncode).toHaveBeenCalledWith({
      recordedId: 301,
      sourceVideoFileId: 701,
      mode: 'detail-mode',
      removeOriginal: false,
      isSaveSameDirectory: false,
      parentDir: 'archive-root',
    })
    expect(await screen.findByText('エンコード追加')).toBeVisible()
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'stop' }))
    expect(await screen.findByText('エンコード停止')).toBeVisible()
    expect(recordedRepository.stopEncode).toHaveBeenCalledWith(301)
  })
})
