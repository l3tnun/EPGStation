import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type * as ReactRouterDom from 'react-router-dom'
import { LiveStreamSelectDialog } from '@/features/onair/LiveStreamSelectDialog'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { chooseMuiSelectOption } from './support/onairSpecHarness'

const throwingNavigate = vi.fn(() => {
  throw new Error('navigation blocked')
})

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof ReactRouterDom>('react-router-dom')

  return {
    ...actual,
    useNavigate: () => throwingNavigate,
  }
})

describe('LiveStreamSelectDialog watch route navigation failure', () => {
  beforeEach(() => {
    localStorage.clear()
    throwingNavigate.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 3.9] shows a snackbar when navigating to the watch route throws', async () => {
    const onSnackbar = vi.fn()

    render(
      <MemoryRouter initialEntries={['/onair']}>
        <LiveStreamSelectDialog
          open
          channel={{ id: 10, name: 'Channel' }}
          settings={new DefaultSettingsFactory().create()}
          streamConfig={{ live: { ts: { webm: ['webm-low'] } } }}
          onClose={vi.fn()}
          onSnackbar={onSnackbar}
        />
      </MemoryRouter>,
    )

    await chooseMuiSelectOption('配信方式', 'WebM')
    fireEvent.click(screen.getByRole('button', { name: '視聴' }))

    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith({
        text: '視聴ページへの移動に失敗',
        severity: 'error',
      })
    })
    expect(throwingNavigate).toHaveBeenCalled()
  })
})
