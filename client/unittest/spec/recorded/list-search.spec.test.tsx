import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from '../hashRouteAssertions'
import {
  changeSettingsSelect,
  createShellRepository,
  expectMuiSelectOption,
  expectMuiSelectText,
} from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

describe('Recorded list actions', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 2.1] [AC 2.2] [AC 2.9] submits only non-empty search conditions, keeps ruleId=0, and reports option fetch failures only', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecordedOptions).mockResolvedValueOnce({
      ok: false,
      error: 'recorded-options-failed',
      message: '録画検索オプションの取得に失敗',
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-page')
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '録画検索' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('録画検索オプションの取得に失敗')).toBeVisible()
    expect(screen.getByRole('menu', { name: '録画検索' })).toBeVisible()
    vi.useRealTimers()

    fireEvent.change(screen.getByRole('textbox', { name: 'キーワード' }), {
      target: { value: '   ' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: '手動録画のみ' }))
    fireEvent.click(screen.getAllByRole('button', { name: '検索' }).at(-1)!)

    await waitFor(() => {
      expectHashRoute('#/recorded?ruleId=0')
    })

    cleanup()
    window.history.replaceState(null, '', '/#/recorded?ruleId=55')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ruleFailureRepository = createRecordedRepository()
    vi.mocked(ruleFailureRepository.fetchRule).mockResolvedValueOnce({
      ok: false,
      error: 'rule-fetch-failed',
      message: 'rule failed',
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={ruleFailureRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-page')
    await waitFor(() => {
      expect(ruleFailureRepository.fetchRule).toHaveBeenCalledWith(55)
    })
    expect(screen.queryByText('rule failed')).not.toBeInTheDocument()
    expect(consoleError).toHaveBeenCalled()
  })

  it('[AC 2.3] [AC 2.35] submits selected recorded search rule, channel, and genre options', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecordedOptions).mockResolvedValue({
      ok: true,
      value: {
        channels: [{ id: 34, name: 'Synthetic channel(2)' }],
        genres: [{ id: 5, name: 'Synthetic genre(3)' }],
      },
    })
    vi.mocked(recordedRepository.fetchRuleKeywords).mockResolvedValue({
      ok: true,
      value: [{ id: 12, keyword: 'Synthetic rule' }],
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-page')
    fireEvent.click(screen.getByRole('button', { name: '録画検索' }))
    await screen.findByRole('menu', { name: '録画検索' })
    await changeSettingsSelect('ルール', 'Synthetic rule')
    await changeSettingsSelect('放送局', 'Synthetic channel(2)')
    await changeSettingsSelect('ジャンル', 'Synthetic genre(3)')
    expect(screen.getByRole('button', { name: 'ルールをクリア' })).toBeVisible()
    expect(screen.getByRole('button', { name: '放送局をクリア' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'ジャンルをクリア' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '放送局をクリア' }))
    expectMuiSelectText('放送局', '放送局')
    await changeSettingsSelect('放送局', 'Synthetic channel(2)')
    fireEvent.click(screen.getAllByRole('button', { name: '検索' }).at(-1)!)

    await waitFor(() => {
      expectHashRoute('#/recorded?ruleId=12&channelId=34&genre=5')
    })
  })

  it('[AC 2.3] [AC frontend-settings-storage 3.6] [AC frontend-settings-storage 3.8] labels the 放送局 search option by isHalfWidthDisplayed and keeps the option value stable when the setting changes', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecordedOptions).mockResolvedValue({
      ok: true,
      value: {
        channels: [
          {
            id: 34,
            name: 'Synthetic full channel(2)',
            halfWidthName: 'Synthetic half channel(2)',
          },
        ],
        genres: [],
      },
    })

    const { rerender } = render(
      <App
        settings={{ ...new DefaultSettingsFactory().create(), isHalfWidthDisplayed: true }}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-page')
    fireEvent.click(screen.getByRole('button', { name: '録画検索' }))
    await screen.findByRole('menu', { name: '録画検索' })

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '放送局' }))
    expect(await screen.findByRole('option', { name: 'Synthetic half channel(2)' })).toBeVisible()
    expect(
      screen.queryByRole('option', { name: 'Synthetic full channel(2)' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'Synthetic half channel(2)' }))
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
    fireEvent.click(screen.getAllByRole('button', { name: '検索' }).at(-1)!)
    await waitFor(() => {
      expectHashRoute('#/recorded?channelId=34')
    })
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    rerender(
      <App
        settings={{ ...new DefaultSettingsFactory().create(), isHalfWidthDisplayed: false }}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-page')
    fireEvent.click(screen.getByRole('button', { name: '録画検索' }))
    await screen.findByRole('menu', { name: '録画検索' })

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '放送局' }))
    expect(await screen.findByRole('option', { name: 'Synthetic full channel(2)' })).toBeVisible()
    expect(
      screen.queryByRole('option', { name: 'Synthetic half channel(2)' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'Synthetic full channel(2)' }))
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })
    fireEvent.click(screen.getAllByRole('button', { name: '検索' }).at(-1)!)
    await waitFor(() => {
      expectHashRoute('#/recorded?channelId=34')
    })
  })

  it('[AC 2.5] adds the route rule option when the current recorded rule is missing from keyword results', async () => {
    window.history.replaceState(null, '', '/#/recorded?ruleId=55')
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRuleKeywords).mockResolvedValue({
      ok: true,
      value: [{ id: 12, keyword: 'Synthetic rule' }],
    })
    vi.mocked(recordedRepository.fetchRule).mockResolvedValue({
      ok: true,
      value: { id: 55, keyword: 'Fetched route rule' },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-page')
    fireEvent.click(screen.getByRole('button', { name: '録画検索' }))

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'ルール' })).toHaveValue('Fetched route rule')
    })
    await expectMuiSelectOption('ルール', 'Fetched route rule')
    expect(recordedRepository.fetchRule).toHaveBeenCalledWith(55)
  })
})
