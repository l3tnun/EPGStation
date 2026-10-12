import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  NOW,
  createShellRepository,
  createSchedule,
  createOnAirRepository,
  renderOnAir,
  createLiveNavigationConfig,
} from './support/onairSpecHarness'

describe('On Air card and ProgramDialog actions', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 2.1] [AC 2.2] [AC 2.3] [AC 2.4] [AC 2.9] renders card metadata, logo fallback, stable header height, and clamped progress', async () => {
    renderOnAir({
      repository: createOnAirRepository([
        {
          channel: {
            id: 101,
            name: 'Synthetic Logo Channel',
            channelType: 'GR',
            hasLogoData: true,
          },
          programs: [
            {
              id: 1010,
              name: 'Synthetic Logo Program',
              description: 'Synthetic Logo Description',
              startAt: NOW - 30 * 60 * 1000,
              endAt: NOW + 30 * 60 * 1000,
            },
          ],
        },
        {
          channel: {
            id: 102,
            name: 'Synthetic Fallback Channel',
            channelType: 'GR',
            hasLogoData: false,
          },
          programs: [
            {
              id: 1020,
              name: 'Synthetic Fallback Program',
              description: 'Synthetic Fallback Description',
              startAt: NOW - 2 * 60 * 60 * 1000,
              endAt: NOW - 60 * 60 * 1000,
            },
          ],
        },
      ]),
      settings: {
        ...new DefaultSettingsFactory().create(),
        isOnAirTabListView: false,
      },
    })

    const logoCard = await screen.findByTestId('onair-card-1010')
    expect(logoCard).toHaveTextContent('Synthetic Logo Program')
    expect(logoCard).toHaveTextContent('Synthetic Logo Description')
    expect(logoCard).toHaveTextContent('08:30 ~ 09:30')
    expect(within(logoCard).getByAltText('Synthetic Logo Channel')).toHaveAttribute(
      'src',
      './api/channels/101/logo',
    )
    expect(within(logoCard).getByTestId('onair-card-header')).toHaveStyle({ minHeight: '28px' })
    expect(within(logoCard).getByRole('progressbar', { name: '進行状況' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    )

    const fallbackCard = screen.getByTestId('onair-card-1020')
    expect(fallbackCard).toHaveTextContent('Synthetic Fallback Channel')
    expect(within(fallbackCard).queryByRole('img')).not.toBeInTheDocument()
    expect(within(fallbackCard).getByTestId('onair-card-header')).toHaveStyle({
      minHeight: '28px',
    })
    expect(within(fallbackCard).getByRole('progressbar', { name: '進行状況' })).toHaveAttribute(
      'aria-valuenow',
      '100',
    )
  })

  it('[AC 2.5] [AC 2.7] [AC 2.8] opens the shared ProgramDialog from the header without adding reserve classes to the card', async () => {
    const schedule = createSchedule('GR', 100, 30)
    const repository = createOnAirRepository(
      [
        {
          ...schedule,
          programs: schedule.programs?.map((program) => ({
            ...program,
            genre1: 8,
            subGenre1: 1,
            isFree: false,
            videoComponentType: 0xb3,
            audioComponentType: 0x03,
            audioSamplingRate: 48000,
          })),
        },
      ],
      {
        100: {
          type: 'reserve',
          item: { reserveId: 900, programId: 100 },
        },
      },
    )

    renderOnAir({ repository })
    const card = await screen.findByTestId('onair-card-100')
    expect(card.className).not.toMatch(/reserve|conflict|skip|overlap/)

    fireEvent.click(within(card).getByTestId('onair-card-header'))

    const dialog = await screen.findByRole('dialog', { name: 'Synthetic GR program' })
    expect(dialog).toBeVisible()
    expect(within(dialog).getByText('Synthetic GR')).toBeVisible()
    expect(within(dialog).getByText('05/05 08:30 ~ 09:30(60分)')).toBeVisible()
    expect(within(dialog).getByText('ドキュメンタリー・教養 / 歴史・紀行')).toBeVisible()
    expect(
      within(dialog).getByText('1080i(1125i), アスペクト比16:9 パンベクトルなし'),
    ).toBeVisible()
    expect(within(dialog).getByText('2/0モード(ステレオ)')).toBeVisible()
    expect(within(dialog).getByText('48kHz')).toBeVisible()
    expect(within(dialog).getByText('有料放送')).toBeVisible()
    expect(within(dialog).queryByText('チャンネル')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('時刻')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '編集' })).toBeVisible()
    expect(screen.queryByRole('dialog', { name: 'ストリーム選択' })).not.toBeInTheDocument()
  })

  it('[AC 2.5] keeps the shared ProgramDialog open after StrictMode effect replay', async () => {
    const repository = createOnAirRepository([createSchedule('GR', 100, 30)])
    window.history.replaceState(null, '', '/#/onair?type=GR')

    render(
      <StrictMode>
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          onAirApiRepository={repository}
          navigationConfig={{
            ...createLiveNavigationConfig(),
            enabledBroadcastWaves: ['GR', 'BS', 'CS', 'SKY'],
          }}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        />
      </StrictMode>,
    )

    const card = await screen.findByTestId('onair-card-100')
    fireEvent.click(within(card).getByTestId('onair-card-header'))

    expect(await screen.findByRole('dialog', { name: 'Synthetic GR program' })).toBeVisible()
  })

  it('[AC 2.6] [AC 3.2] [AC 3.16] opens a stream selection entrypoint from the card body', async () => {
    renderOnAir()

    fireEvent.click(await screen.findByTestId('onair-card-body-10'))

    const dialog = await screen.findByRole('dialog', { name: 'ストリーム選択' })
    expect(dialog).toHaveTextContent('Synthetic GR')
    expect(within(dialog).queryByText('ストリーム選択')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('配信方式')).not.toBeInTheDocument()
    expect(within(dialog).queryByText('画質')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('switch', { name: '外部アプリで開く' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '視聴' })).toBeVisible()
    expect(within(dialog).queryByRole('button', { name: '番組表' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('combobox', { name: '配信方式' })).toHaveTextContent('M2TS-LL')
    expect(within(dialog).getByRole('combobox', { name: '画質' })).toHaveTextContent('ll-low')
  })

  it('[AC 3.4] [AC 3.14] repairs stream selection when URL scheme mode is toggled and saves the closed value', async () => {
    localStorage.setItem(
      'OnAirSelectStreamSetting',
      JSON.stringify({ useURLScheme: false, type: 'HLS', mode: 9 }),
    )
    renderOnAir()

    fireEvent.click(await screen.findByTestId('onair-card-body-10'))
    const dialog = await screen.findByRole('dialog', { name: 'ストリーム選択' })
    expect(within(dialog).getByRole('combobox', { name: '配信方式' })).toHaveTextContent('HLS')
    expect(within(dialog).getByRole('combobox', { name: '画質' })).toHaveTextContent('hls-low')

    fireEvent.click(within(dialog).getByLabelText('外部アプリで開く'))

    expect(within(dialog).getByRole('combobox', { name: '配信方式' })).toHaveTextContent('M2TS')
    expect(within(dialog).getByRole('combobox', { name: '画質' })).toHaveTextContent('m2ts-default')

    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'ストリーム選択' })).not.toBeInTheDocument()
    })
    expect(JSON.parse(localStorage.getItem('OnAirSelectStreamSetting') ?? '{}')).toStrictEqual({
      useURLScheme: true,
      type: 'M2TS',
      mode: 0,
    })
  })
})
