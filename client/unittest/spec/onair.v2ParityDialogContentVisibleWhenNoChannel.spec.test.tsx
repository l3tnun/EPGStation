import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LiveStreamSelectDialog } from '@/features/onair/LiveStreamSelectDialog'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

// Requirement (frontend-onair requirements.md 3.21):
// v2 (`client/src/components/onair/OnAirSelectStream.vue:4`) used
// `v-card v-if="dialogState.getChannelItem() !== null"`, so when no channel was selected the
// entire dialog card (selects, switch, cancel/view/guide buttons) was not rendered at all.
// v3's LiveStreamSelectDialog instead always renders the dialog content and only disables the
// 視聴 button. This test pins that v3 behavior explicitly, distinct from the existing
// "[AC 3.21] disables 視聴 ..." test which only checks the button's disabled state.
const webStreamConfig = {
  live: {
    ts: {
      m2tsll: ['ll-low'],
      webm: ['webm-low'],
    },
  },
}

describe('LiveStreamSelectDialog v2 parity: dialog content stays visible without a channel', () => {
  it('keeps select/switch/cancel controls rendered and enabled when channel is null', () => {
    render(
      <MemoryRouter initialEntries={['/onair']}>
        <LiveStreamSelectDialog
          open
          channel={null}
          settings={new DefaultSettingsFactory().create()}
          streamConfig={webStreamConfig}
          onClose={vi.fn()}
          onSnackbar={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '配信方式' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '画質' })).toBeInTheDocument()

    const urlSchemeSwitch = screen.getByLabelText('外部アプリで開く')
    expect(urlSchemeSwitch).toBeInTheDocument()
    expect(urlSchemeSwitch).not.toBeDisabled()

    const cancelButton = screen.getByRole('button', { name: 'キャンセル' })
    expect(cancelButton).toBeInTheDocument()
    expect(cancelButton).not.toBeDisabled()

    expect(screen.getByRole('button', { name: '視聴' })).toBeDisabled()
  })
})
