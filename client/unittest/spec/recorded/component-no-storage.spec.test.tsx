import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AddEncodeDialog } from '@/features/recorded/components/AddEncodeDialog'
import { RecordedStreamSelectDialog } from '@/features/recorded/components/RecordedStreamSelectDialog'
import { SendVideoFileToKodiDialog } from '@/features/recorded/components/SendVideoFileToKodiDialog'
import { createPlaybackNavigationConfig } from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

vi.mock('@/features/recorded/lib/recordedBrowser', () => ({
  getBrowserStorage: () => undefined,
  getBrowserOrigin: () => 'https://host.example',
  getBrowserHref: () => 'https://host.example/',
}))

describe('recorded dialogs without browser storage', () => {
  it('[AC 3.17] add encode dialog starts from defaults and skips persistence', () => {
    const onClose = vi.fn()
    render(
      <AddEncodeDialog
        item={{ id: 3, name: 'N', videoFiles: [{ id: 1 }] }}
        open
        encodeModes={['fast']}
        recordedDirectories={['d1']}
        apiRepository={createRecordedRepository()}
        onClose={onClose}
        onSnackbar={vi.fn()}
      />,
    )
    expect(screen.getByRole('combobox', { name: 'preset' })).toHaveTextContent('fast')
    expect(screen.getByRole('checkbox', { name: '元ファイルを削除する' })).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('AddEncodeSeting')).toBeNull()
  })

  it('[AC 3.15] kodi dialog picks the first host and closes without persistence', () => {
    const onClose = vi.fn()
    render(
      <SendVideoFileToKodiDialog
        open
        item={{ name: 'N', videoFiles: [{ id: 2 }] }}
        hosts={['h1', 'h2']}
        apiRepository={createRecordedRepository()}
        onClose={onClose}
        onSnackbar={vi.fn()}
      />,
    )
    expect(screen.getByRole('combobox', { name: 'kodi host' })).toHaveTextContent('h1')
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('SendVideoFileSelectHostSetting')).toBeNull()
  })

  it('[AC 3.4] stream dialog watches with the default candidate and skips persistence', () => {
    const onNavigate = vi.fn()
    render(
      <RecordedStreamSelectDialog
        open
        item={{ id: 9 }}
        file={{ id: 1, type: 'ts' }}
        streamConfig={createPlaybackNavigationConfig().streamConfig}
        onClose={vi.fn()}
        onNavigate={onNavigate}
        onSnackbar={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '視聴' }))
    expect(onNavigate).toHaveBeenCalledWith(expect.stringContaining('/recorded/streaming/1'))
    expect(localStorage.getItem('RecordedSelectStreamSetting')).toBeNull()
  })
})
