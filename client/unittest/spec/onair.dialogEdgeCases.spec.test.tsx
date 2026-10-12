import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'
import {
  LiveStreamSelectDialog,
  type LiveStreamSelectDialogProps,
} from '@/features/onair/LiveStreamSelectDialog'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { chooseMuiSelectOption } from './support/onairSpecHarness'

function LocationDisplay() {
  const location = useLocation()

  return <div data-testid="location-display">{`${location.pathname}${location.search}`}</div>
}

function renderDialog({
  initialEntry = '/onair',
  ...props
}: Partial<LiveStreamSelectDialogProps> & { initialEntry?: string } = {}) {
  const onClose = props.onClose ?? vi.fn()
  const onSnackbar = props.onSnackbar ?? vi.fn()
  const settings = props.settings ?? new DefaultSettingsFactory().create()
  const channel = 'channel' in props ? (props.channel ?? null) : { id: 10, name: 'Channel' }

  const rendered = render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <LiveStreamSelectDialog
        open
        channel={channel}
        settings={settings}
        streamConfig={props.streamConfig}
        urlscheme={props.urlscheme}
        showGuide={props.showGuide}
        onClose={onClose}
        onSnackbar={onSnackbar}
      />
      <LocationDisplay />
    </MemoryRouter>,
  )

  return { ...rendered, onClose, onSnackbar }
}

const webStreamConfig = {
  live: {
    ts: {
      m2tsll: ['ll-low'],
      webm: ['webm-low'],
    },
  },
}

describe('LiveStreamSelectDialog guide navigation', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 3.20] navigates to the guide with only channelId when the current route has no valid time', () => {
    vi.useFakeTimers()
    const { onClose } = renderDialog({
      showGuide: true,
      streamConfig: webStreamConfig,
      initialEntry: '/onair?time=not-a-time',
    })

    fireEvent.click(screen.getByRole('button', { name: '番組表' }))
    expect(onClose).toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(screen.getByTestId('location-display')).toHaveTextContent('/guide?channelId=10')
  })

  it('[AC 3.20] carries a valid time query parameter forward to the guide route', () => {
    vi.useFakeTimers()
    renderDialog({
      showGuide: true,
      streamConfig: webStreamConfig,
      initialEntry: '/onair?time=26050509',
    })

    fireEvent.click(screen.getByRole('button', { name: '番組表' }))
    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(screen.getByTestId('location-display')).toHaveTextContent(
      '/guide?channelId=10&time=26050509',
    )
  })

  it('[AC 3.20] does not navigate or close when there is no channel to build a guide route from', () => {
    vi.useFakeTimers()
    const { onClose } = renderDialog({
      showGuide: true,
      streamConfig: webStreamConfig,
      channel: null,
    })

    fireEvent.click(screen.getByRole('button', { name: '番組表' }))
    act(() => {
      vi.advanceTimersByTime(300)
    })

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('location-display')).toHaveTextContent('/onair')
  })

  it('[AC 3.16] does not render the guide button when showGuide is not set', () => {
    renderDialog({ streamConfig: webStreamConfig })

    expect(screen.queryByRole('button', { name: '番組表' })).not.toBeInTheDocument()
  })

  it('[AC 3.1] renders an empty channel label when the channel has no name', () => {
    renderDialog({ streamConfig: webStreamConfig, channel: { id: 10 } })

    const dialog = screen.getByRole('dialog', { name: 'ストリーム選択' })
    expect(dialog.querySelector('p')).toHaveTextContent('')
  })
})

describe('LiveStreamSelectDialog M2TS handoff', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 3.5] opens the external app URL scheme when a template resolves for M2TS', async () => {
    localStorage.setItem(
      'OnAirSelectStreamSetting',
      JSON.stringify({ useURLScheme: true, type: 'M2TS', mode: 0 }),
    )
    const { onClose } = renderDialog({
      streamConfig: { live: { ts: { m2ts: [{ name: 'm2ts-default' }] } } },
      settings: {
        ...new DefaultSettingsFactory().create(),
        onAirM2TSViewURLScheme: 'vlc://PROTOCOL://ADDRESS',
      },
    })

    fireEvent.click(screen.getByRole('button', { name: '視聴' }))

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('[AC 3.5] falls back to the direct M2TS playlist path when no URL scheme template resolves', async () => {
    localStorage.setItem(
      'OnAirSelectStreamSetting',
      JSON.stringify({ useURLScheme: true, type: 'M2TS', mode: 0 }),
    )
    const { onClose, onSnackbar } = renderDialog({
      streamConfig: { live: { ts: { m2ts: [{ name: 'm2ts-default' }] } } },
      settings: {
        ...new DefaultSettingsFactory().create(),
        onAirM2TSViewURLScheme: null,
      },
      urlscheme: undefined,
    })

    fireEvent.click(screen.getByRole('button', { name: '視聴' }))

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled()
    })
    expect(onSnackbar).not.toHaveBeenCalled()
  })

  it.each([
    [
      'https://example.invalid/#/onair',
      'https://example.invalid/api/streams/live/10/m2ts/playlist?mode=0',
    ],
    [
      'https://example.invalid/epgstation/#/onair',
      'https://example.invalid/epgstation/api/streams/live/10/m2ts/playlist?mode=0',
    ],
  ])(
    '[AC 3.5] hands the playlist off as a relative ./api URL that resolves under the page path (%s)',
    async (pageHref, expectedResolvedHref) => {
      const assignedHrefs: string[] = []
      vi.stubGlobal('location', {
        get href() {
          return pageHref
        },
        set href(value: string) {
          assignedHrefs.push(value)
        },
      })
      localStorage.setItem(
        'OnAirSelectStreamSetting',
        JSON.stringify({ useURLScheme: true, type: 'M2TS', mode: 0 }),
      )
      try {
        const { onClose } = renderDialog({
          streamConfig: { live: { ts: { m2ts: [{ name: 'm2ts-default' }] } } },
          settings: {
            ...new DefaultSettingsFactory().create(),
            onAirM2TSViewURLScheme: null,
          },
          urlscheme: undefined,
        })

        fireEvent.click(screen.getByRole('button', { name: '視聴' }))

        await waitFor(() => {
          expect(onClose).toHaveBeenCalled()
        })
        expect(assignedHrefs).toStrictEqual(['./api/streams/live/10/m2ts/playlist?mode=0'])
        expect(new URL(assignedHrefs[0] ?? '', pageHref).href).toBe(expectedResolvedHref)
      } finally {
        vi.unstubAllGlobals()
      }
    },
  )
})

describe('LiveStreamSelectDialog M2TS ignores the web playback preference', () => {
  const withMockedMediaSource = (isTypeSupported: boolean) => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'MediaSource')
    Object.defineProperty(window, 'MediaSource', {
      configurable: true,
      value: {
        isTypeSupported: vi.fn(() => isTypeSupported),
      },
    })

    return () => {
      if (descriptor !== undefined) {
        Object.defineProperty(window, 'MediaSource', descriptor)
      } else {
        Reflect.deleteProperty(window, 'MediaSource')
      }
    }
  }

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 3.24] still hands M2TS off to the external app when the preference is on and mpegts is supported', () => {
    const restoreMediaSource = withMockedMediaSource(true)
    localStorage.setItem(
      'OnAirSelectStreamSetting',
      JSON.stringify({ useURLScheme: true, type: 'M2TS', mode: 0 }),
    )

    try {
      const { onClose } = renderDialog({
        streamConfig: { live: { ts: { m2ts: [{ name: 'm2ts-default' }] } } },
        settings: {
          ...new DefaultSettingsFactory().create(),
          isPreferredPlayingLiveM2TSOnWeb: true,
          onAirM2TSViewURLScheme: null,
        },
        urlscheme: undefined,
      })

      fireEvent.click(screen.getByRole('button', { name: '視聴' }))

      expect(onClose).toHaveBeenCalled()
      const locationDisplay = screen.getByTestId('location-display')
      expect(locationDisplay).toHaveTextContent('/onair')
      expect(locationDisplay).not.toHaveTextContent('/onair/watch')
    } finally {
      restoreMediaSource()
    }
  })

  it('[AC 3.24] hands M2TS off to the external app when the preference is off even though mpegts is supported', () => {
    const restoreMediaSource = withMockedMediaSource(true)
    localStorage.setItem(
      'OnAirSelectStreamSetting',
      JSON.stringify({ useURLScheme: true, type: 'M2TS', mode: 0 }),
    )

    try {
      const { onClose } = renderDialog({
        streamConfig: { live: { ts: { m2ts: [{ name: 'm2ts-default' }] } } },
        settings: {
          ...new DefaultSettingsFactory().create(),
          isPreferredPlayingLiveM2TSOnWeb: false,
          onAirM2TSViewURLScheme: null,
        },
        urlscheme: undefined,
      })

      fireEvent.click(screen.getByRole('button', { name: '視聴' }))

      expect(onClose).toHaveBeenCalled()
      const locationDisplay = screen.getByTestId('location-display')
      expect(locationDisplay).toHaveTextContent('/onair')
      expect(locationDisplay).not.toHaveTextContent('/onair/watch')
    } finally {
      restoreMediaSource()
    }
  })

  it('[AC 3.24] hands M2TS off to the external app when mpegts is not supported even though the preference is on', () => {
    const restoreMediaSource = withMockedMediaSource(false)
    localStorage.setItem(
      'OnAirSelectStreamSetting',
      JSON.stringify({ useURLScheme: true, type: 'M2TS', mode: 0 }),
    )

    try {
      const { onClose } = renderDialog({
        streamConfig: { live: { ts: { m2ts: [{ name: 'm2ts-default' }] } } },
        settings: {
          ...new DefaultSettingsFactory().create(),
          isPreferredPlayingLiveM2TSOnWeb: true,
          onAirM2TSViewURLScheme: null,
        },
        urlscheme: undefined,
      })

      fireEvent.click(screen.getByRole('button', { name: '視聴' }))

      expect(onClose).toHaveBeenCalled()
      const locationDisplay = screen.getByTestId('location-display')
      expect(locationDisplay).toHaveTextContent('/onair')
      expect(locationDisplay).not.toHaveTextContent('/onair/watch')
    } finally {
      restoreMediaSource()
    }
  })
})

describe('LiveStreamSelectDialog select interactions', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 3.3] changes the selected mode through the quality select', async () => {
    renderDialog({
      streamConfig: { live: { ts: { m2tsll: ['ll-low', 'll-high'] } } },
    })

    await chooseMuiSelectOption('配信方式', 'M2TS-LL')
    await chooseMuiSelectOption('画質', 'll-high')

    expect(screen.getByRole('combobox', { name: '画質' })).toHaveTextContent('ll-high')
  })

  it('[AC 3.25] keeps the selected mode index when switching to a type whose candidates include that index', async () => {
    renderDialog({
      streamConfig: {
        live: {
          ts: {
            m2tsll: ['ll-low', 'll-high'],
            webm: ['webm-low', 'webm-high'],
          },
        },
      },
    })

    await chooseMuiSelectOption('画質', 'll-high')
    await chooseMuiSelectOption('配信方式', 'WebM')

    expect(screen.getByRole('combobox', { name: '配信方式' })).toHaveTextContent('WebM')
    expect(screen.getByRole('combobox', { name: '画質' })).toHaveTextContent('webm-high')
  })

  it('[AC 3.25] resets the mode to 0 when the new type has no candidate at the selected mode index', async () => {
    renderDialog({
      streamConfig: {
        live: {
          ts: {
            m2tsll: ['ll-low', 'll-high'],
            mp4: ['mp4-only'],
          },
        },
      },
    })

    await chooseMuiSelectOption('画質', 'll-high')
    await chooseMuiSelectOption('配信方式', 'MP4')

    expect(screen.getByRole('combobox', { name: '配信方式' })).toHaveTextContent('MP4')
    expect(screen.getByRole('combobox', { name: '画質' })).toHaveTextContent('mp4-only')
  })

  it('[AC 3.14] falls back to the first candidate type when the URL scheme toggle empties the current type', async () => {
    localStorage.setItem(
      'OnAirSelectStreamSetting',
      JSON.stringify({ useURLScheme: false, type: 'WebM', mode: 0 }),
    )
    renderDialog({
      streamConfig: { live: { ts: {} } },
    })

    fireEvent.click(screen.getByLabelText('外部アプリで開く'))

    expect(screen.getByRole('button', { name: '視聴' })).toBeDisabled()
  })

  it('[AC 3.21] disables 視聴 and attaches no watch handler when no channel is given', () => {
    const { onSnackbar } = renderDialog({
      channel: null,
      streamConfig: webStreamConfig,
    })

    const watchButton = screen.getByRole('button', { name: '視聴' })
    expect(watchButton).toBeDisabled()

    fireEvent.click(watchButton)

    expect(onSnackbar).not.toHaveBeenCalled()
    expect(screen.getByTestId('location-display')).toHaveTextContent('/onair')
  })
})
