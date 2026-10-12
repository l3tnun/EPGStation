import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository, createSearchRuleRepository } from './searchRuleSupport'

describe('Search route lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    document.documentElement.classList.remove('fix-address-bar2')
  })

  it('[AC 2.41] hides rule-edit results before showing plain search results after returning from rule edit', async () => {
    window.history.replaceState(null, '', '/#/search?rule=55')
    const searchRuleRepository = createSearchRuleRepository()
    vi.mocked(searchRuleRepository.searchSchedules)
      .mockResolvedValueOnce({
        ok: true as const,
        value: [
          {
            id: 2001,
            name: 'Cached Rule Result',
            channelId: 33,
            channelName: 'Synthetic Rule Channel',
            startAt: 1_700_000_000_000,
            endAt: 1_700_003_600_000,
          },
        ],
      })
      .mockResolvedValue({
        ok: true as const,
        value: [
          {
            id: 2002,
            name: 'Plain Search Result',
            channelId: 12,
            channelName: 'Synthetic Channel',
            startAt: 1_700_010_000_000,
            endAt: 1_700_013_600_000,
          },
        ],
      })
    vi.mocked(searchRuleRepository.fetchRule).mockResolvedValue({
      ok: true,
      value: {
        id: 55,
        isTimeSpecification: false,
        searchOption: {
          keyword: 'Rule Keyword',
          name: true,
          times: [{ week: 0x7f }],
        },
        reserveOption: {
          enable: true,
          allowEndLack: true,
          avoidDuplicate: true,
          periodToAvoidDuplicate: null,
        },
        saveOption: {
          parentDirectoryName: null,
          directory: 'Loaded Directory',
          recordedFormat: null,
        },
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByText('Cached Rule Result')).toBeVisible()

    await act(async () => {
      window.location.hash = '#/search'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    await waitFor(() => {
      expect(screen.queryByText('Cached Rule Result')).not.toBeInTheDocument()
    })

    fireEvent.change(await screen.findByLabelText('keyword'), {
      target: { value: 'Plain Keyword' },
    })
    fireEvent.click(
      within(screen.getByRole('region', { name: '検索条件' })).getByRole('button', {
        name: '検索',
      }),
    )

    expect(await screen.findByText('Plain Search Result')).toBeVisible()
    expect(screen.queryByText('Cached Rule Result')).not.toBeInTheDocument()
  })

  it('[AC 2.41][AC 2.9] clears stale search requests before hydrating rule edit from an existing search route', async () => {
    window.history.replaceState(null, '', '/#/search?keyword=Synthetic')
    const searchRuleRepository = createSearchRuleRepository()
    vi.mocked(searchRuleRepository.fetchRule).mockResolvedValueOnce({
      ok: true as const,
      value: {
        id: 55,
        isTimeSpecification: false,
        searchOption: {
          keyword: 'Loaded Rule',
          name: true,
          channelIds: [33],
          channelNames: ['Synthetic Rule Channel'],
          times: [{ week: 0x7f }],
        },
        reserveOption: {
          enable: true,
          allowEndLack: true,
          avoidDuplicate: true,
          periodToAvoidDuplicate: null,
        },
        saveOption: {
          parentDirectoryName: null,
          directory: 'Loaded Directory',
          recordedFormat: null,
        },
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        searchRuleApiRepository={searchRuleRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByText('1 件ヒット')
    expect(searchRuleRepository.searchSchedules).toHaveBeenCalledWith(
      expect.objectContaining({
        option: expect.objectContaining({ keyword: 'Synthetic' }),
      }),
    )

    await act(async () => {
      window.location.hash = '#/search?rule=55'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })

    expect(await screen.findByRole('heading', { name: 'ルール編集' })).toBeVisible()
    await waitFor(() => {
      expect(searchRuleRepository.fetchRule).toHaveBeenCalledWith(55, true)
    })
    await waitFor(() => {
      expect(searchRuleRepository.searchSchedules).toHaveBeenLastCalledWith({
        option: {
          keyword: 'Loaded Rule',
          keyCS: false,
          keyRegExp: false,
          name: true,
          description: false,
          extended: false,
          channelIds: [33],
          times: [{ week: 0x7f }],
        },
        isHalfWidth: true,
        limit: 300,
      })
    })
    await waitFor(() => {
      expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(2)
    })
  })
})
