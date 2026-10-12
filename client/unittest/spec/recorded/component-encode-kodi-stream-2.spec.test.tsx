import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecordedStreamSelectDialog } from '@/features/recorded/components/RecordedStreamSelectDialog'
import { SendVideoFileToKodiDialog } from '@/features/recorded/components/SendVideoFileToKodiDialog'
import { changeSettingsSelect } from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('SendVideoFileToKodiDialog remaining branches', () => {
  it('[AC 3.15] clears the stored host and skips items without video files when closing with a blank host', () => {
    const apiRepository = createRecordedRepository()
    localStorage.setItem('SendVideoFileSelectHostSetting', JSON.stringify({ hostName: 'h1' }))
    const onClose = vi.fn()
    render(
      <SendVideoFileToKodiDialog
        open
        item={{ name: 'No files' }}
        hosts={[]}
        apiRepository={apiRepository}
        onClose={onClose}
        onSnackbar={vi.fn()}
      />,
    )
    // The item has no video files, so no send buttons are rendered at all.
    expect(screen.queryByRole('button', { name: /^#/ })).not.toBeInTheDocument()

    // Closing without picking a host clears the stored adjacent setting.
    const backdrop = document.querySelector('.MuiBackdrop-root')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop as Element)
    expect(onClose).toHaveBeenCalled()
    expect(JSON.parse(localStorage.getItem('SendVideoFileSelectHostSetting') ?? '{}')).toEqual({
      hostName: null,
    })
  })
})

describe('RecordedStreamSelectDialog quality selection', () => {
  it('[AC 3.4] changes the selected mode when a candidate offers more than one quality', async () => {
    const onNavigate = vi.fn()
    render(
      <RecordedStreamSelectDialog
        open
        item={{ id: 9 }}
        file={{ id: 1, type: 'ts' }}
        streamConfig={{ recorded: { ts: { webm: ['mode-a', 'mode-b'] } } }}
        onClose={vi.fn()}
        onNavigate={onNavigate}
        onSnackbar={vi.fn()}
      />,
    )

    await changeSettingsSelect('画質', 'mode-b')
    fireEvent.click(screen.getByRole('button', { name: '視聴' }))
    expect(onNavigate).toHaveBeenCalledWith(expect.stringContaining('mode=1'))
  })
})
