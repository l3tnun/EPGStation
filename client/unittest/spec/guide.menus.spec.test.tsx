import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from './hashRouteAssertions'
import {
  createShellRepository,
  chooseMuiSelectOption,
  expectMuiSelectText,
  expectMuiSelectBlank,
  createGuideRepository,
  waitForGuideVisible,
} from './support/guideSpecHarness'

describe('Guide route and fetch lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('fix-address-bar', 'guide-shell-scroll-lock')
    window.history.replaceState(null, '', '/#/guide?type=BS&time=26050509')
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-05-05T09:00:00+09:00'))
  })

  afterEach(() => {
    document.documentElement.classList.remove('fix-address-bar', 'guide-shell-scroll-lock')
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 3.3] [AC 3.4] [AC 3.5] [AC 3.6] opens the day selector from the Guide title and routes to the selected day while keeping valid filters', async () => {
    window.history.replaceState(null, '', '/#/guide?type=BS&channelId=301&time=26050512')

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={createGuideRepository()}
        navigationConfig={{
          status: 'loaded',
          liveStreamEnabled: false,
          enabledBroadcastWaves: ['GR', 'BS'],
        }}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await waitForGuideVisible()
    expect(screen.getByRole('button', { name: '時刻選択' })).toHaveTextContent('')
    expect(screen.getByRole('button', { name: '番組表メニュー' })).toHaveTextContent('')
    fireEvent.click(screen.getByRole('heading', { name: /Synthetic Channel/ }))

    const dayDialog = await screen.findByRole('dialog', { name: '日付選択' })
    expect(screen.queryByRole('dialog', { name: '表示ジャンル' })).not.toBeInTheDocument()
    expect(dayDialog).toHaveAttribute('data-max-width', '150')
    expect(dayDialog).toHaveStyle({ maxWidth: '150px' })
    expect(dayDialog).toHaveStyle({ height: '400px' })
    expect(dayDialog).not.toHaveTextContent('日付選択')
    expect(screen.getAllByTestId('guide-day-option')).toHaveLength(8)
    expect(screen.getByRole('button', { name: '05/05(火)' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '05/06(水)' }))

    await waitFor(() => {
      expectHashRoute('#/guide?time=26050600&type=BS&channelId=301')
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('[AC 3.8] [AC 3.9] [AC 3.10] [AC 3.11] [AC 3.12] [AC 3.13] uses the clock selector and broadcast select to update the Guide route and closes on outside click', async () => {
    window.history.replaceState(null, '', '/#/guide?channelId=301&time=26050512')

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isEnableDisplayForEachBroadcastWave: true,
        }}
        apiRepository={createShellRepository()}
        guideApiRepository={createGuideRepository()}
        navigationConfig={{
          status: 'loaded',
          liveStreamEnabled: false,
          enabledBroadcastWaves: ['GR', 'BS'],
        }}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await waitForGuideVisible()
    fireEvent.click(screen.getByRole('button', { name: '時刻選択' }))

    await screen.findByLabelText('日付')
    expect(screen.queryByRole('dialog', { name: '時刻選択' })).not.toBeInTheDocument()
    expectMuiSelectBlank('放送波')
    expectMuiSelectText('日付', '05/05(火)')
    expect(screen.queryByText('2026/05/05(火)')).not.toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '放送波' }))
    expect(await screen.findByRole('option', { name: 'GR' })).toBeVisible()
    expect(screen.queryByRole('option', { name: 'CS' })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: '閉じる' })).toBeInTheDocument()

    const background = document.querySelector('[class*="timeSelectorBackground"]')
    expect(background).not.toBeNull()
    fireEvent.click(background as Element)
    await waitFor(() => {
      expect(screen.queryByLabelText('日付')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '時刻選択' }))
    await screen.findByLabelText('日付')

    await chooseMuiSelectOption('放送波', 'BS')
    await chooseMuiSelectOption('日付', '05/07(木)')
    await chooseMuiSelectOption('時', '23時')
    fireEvent.click(screen.getByRole('button', { name: '表示' }))

    await waitFor(() => {
      expectHashRoute('#/guide?time=26050723&type=BS&channelId=301')
    })
  })

  it('[AC 3.14] [AC 3.15] [AC 3.16] [AC 3.17] [AC 3.18] [AC 3.21] [AC 3.22] runs Guide main menu actions for reserve refresh, genre visibility, and settings route', async () => {
    window.history.replaceState(null, '', '/#/guide?time=26050512')
    const guideRepository = createGuideRepository()
    const startAt = Date.parse('2026-05-05T12:00:00+09:00')
    vi.mocked(guideRepository.fetchSchedule).mockResolvedValue({
      ok: true,
      value: [
        {
          channel: { id: 10, name: 'Synthetic Video', type: 0x01 },
          programs: [
            {
              id: 100,
              name: 'Synthetic Genre',
              startAt,
              endAt: startAt + 60 * 60 * 1000,
              genre1: 1,
            },
          ],
        },
      ],
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={{
          status: 'loaded',
          liveStreamEnabled: false,
          enabledBroadcastWaves: ['GR', 'BS'],
        }}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('guide-program-100')
    const initialFetchCount = vi.mocked(guideRepository.fetchSchedule).mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: '番組表メニュー' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '予約情報更新' }))
    expect(await screen.findByText('予約情報の更新開始')).toBeInTheDocument()
    expect(guideRepository.triggerReserveUpdate).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '番組表メニュー' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '表示ジャンル' }))
    const genreDialog = await screen.findByRole('dialog', { name: '表示ジャンル' })
    expect(genreDialog).toHaveAttribute('data-max-width', '500')
    expect(genreDialog).toHaveStyle({ maxWidth: '500px' })
    expect(screen.getAllByRole('switch')).toHaveLength(16)
    fireEvent.click(screen.getByRole('switch', { name: 'スポーツ' }))
    fireEvent.click(screen.getByRole('button', { name: '更新' }))

    await waitFor(() => {
      expect(screen.getByTestId('guide-program-100')).toHaveClass('hide')
    })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '表示ジャンル' })).not.toBeInTheDocument()
    })
    expect(JSON.parse(localStorage.getItem('GuideGenreSetting') ?? '{}')).toMatchObject({
      1: false,
    })
    expect(guideRepository.fetchSchedule).toHaveBeenCalledTimes(initialFetchCount)

    fireEvent.click(screen.getByRole('button', { name: '番組表メニュー' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '表示設定' }))
    await waitFor(() => {
      expectHashRoute('#/guide/setting')
    })
  })

  it('waits for the closing main menu animation before opening the genre dialog', async () => {
    // v2's `GuideMainMenu.vue` `genreSetting()` closes the menu, then `await Util.sleep(300)`
    // before opening `GuideGenreSettingDialog` (300 行目付近). Measuring the real MUI Menu close
    // transition here (Playwright against a running build) showed it takes close to 300ms to
    // finish, so opening the dialog without a delay visibly overlaps the closing menu
    // with the newly opened dialog's backdrop for that whole window (screenshot evidence, not
    // reproducible in this fixture-only suite). Restoring the 300ms delay before opening the
    // dialog reproduces v2's own fix for the same problem.
    window.history.replaceState(null, '', '/#/guide?time=26050512')
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={createGuideRepository()}
        navigationConfig={{
          status: 'loaded',
          liveStreamEnabled: false,
          enabledBroadcastWaves: ['GR', 'BS'],
        }}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await waitForGuideVisible()
    fireEvent.click(screen.getByRole('button', { name: '番組表メニュー' }))
    const genreMenuItem = await screen.findByRole('menuitem', { name: '表示ジャンル' })

    vi.useFakeTimers()
    fireEvent.click(genreMenuItem)
    expect(screen.queryByRole('dialog', { name: '表示ジャンル' })).not.toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299)
    })
    expect(screen.queryByRole('dialog', { name: '表示ジャンル' })).not.toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(screen.getByRole('dialog', { name: '表示ジャンル' })).toBeVisible()
    vi.useRealTimers()
  })

  it('[AC 3.19] [AC 3.25] [AC 3.26] [AC 3.27] saves and resets Guide size settings without persisting reset until save', async () => {
    window.history.replaceState(null, '', '/#/guide/setting')
    localStorage.setItem(
      'GuideSizeSetting',
      JSON.stringify({
        tablet: {
          channelHeight: 40,
          channelWidth: 200,
          channelFontsize: 18,
          timescaleHeight: 220,
          timescaleWidth: 40,
          timescaleFontsize: 18,
          programFontSize: 12.5,
        },
        mobile: {
          channelHeight: 30,
          channelWidth: 120,
          channelFontsize: 13,
          timescaleHeight: 130,
          timescaleWidth: 30,
          timescaleFontsize: 13,
          programFontSize: 8.5,
        },
      }),
    )

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={createGuideRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(screen.getByTestId('title-bar')).toHaveTextContent('番組表設定')
    expectMuiSelectText('通常表示 チャンネル横幅', '200')
    expectMuiSelectText('モバイル表示 番組フォント', '8.5')

    await chooseMuiSelectOption('通常表示 チャンネル横幅', '210')
    await chooseMuiSelectOption('通常表示 時刻高さ', '400')
    await chooseMuiSelectOption('モバイル表示 番組フォント', '8.5')
    fireEvent.click(screen.getByRole('button', { name: 'リセット' }))

    expectMuiSelectText('通常表示 チャンネル横幅', '140')
    expect(JSON.parse(localStorage.getItem('GuideSizeSetting') ?? '{}').tablet.channelWidth).toBe(
      200,
    )

    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('保存されました')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('GuideSizeSetting') ?? '{}')).toMatchObject({
      tablet: {
        channelWidth: 140,
        timescaleHeight: 180,
        programFontSize: 10,
      },
      mobile: {
        channelWidth: 100,
        programFontSize: 7.5,
      },
    })
  })
})
