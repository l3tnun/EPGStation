import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { SEARCH_RULE_QUERY_KEY, SearchRulePage } from '@/features/search/rule'
import type { SearchRuleDetail } from '@/features/search/rule/query'
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

  it.each([
    ['route-backed search', '/#/search?keyword=Synthetic', 'Synthetic'],
    ['plain user search', '/#/search', 'Typed Search'],
  ])(
    '[AC 2.41][AC 2.9] does not run a stale active search from %s when cached rule detail is available during rule edit navigation',
    async (_label, initialHash, expectedFirstKeyword) => {
      window.history.replaceState(null, '', initialHash)
      const searchRuleRepository = createSearchRuleRepository()
      const initialProgramName = `${expectedFirstKeyword} Program`
      const cachedRuleProgramName = 'Cached Rule Program'
      const cachedRuleDetail = {
        id: 55,
        isTimeSpecification: false,
        searchOption: {
          keyword: 'Cached Rule',
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
          directory: 'Cached Directory',
          recordedFormat: null,
        },
      } satisfies SearchRuleDetail
      vi.mocked(searchRuleRepository.searchSchedules).mockImplementation(async (body) => ({
        ok: true,
        value: [
          {
            id: body.option.keyword === 'Cached Rule' ? 2002 : 2001,
            name:
              body.option.keyword === 'Cached Rule' ? cachedRuleProgramName : initialProgramName,
            channelId: body.option.keyword === 'Cached Rule' ? 33 : 12,
            channelName:
              body.option.keyword === 'Cached Rule'
                ? 'Synthetic Rule Channel'
                : 'Synthetic Channel',
            startAt: 1_700_000_000_000,
            endAt: 1_700_003_600_000,
            description: 'Synthetic description',
            isFree: true,
          },
        ],
      }))
      vi.mocked(searchRuleRepository.fetchRule).mockResolvedValue({
        ok: true,
        value: cachedRuleDetail,
      })

      function CacheRuleDetail() {
        const queryClient = useQueryClient()

        useEffect(() => {
          queryClient.setQueryData([...SEARCH_RULE_QUERY_KEY, 'rule', 55], {
            ok: true,
            value: cachedRuleDetail,
          })
        }, [queryClient])

        return null
      }

      // App children replace routed content here, so this mounts a single SearchRulePage with a real QueryClient.
      render(
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          searchRuleApiRepository={searchRuleRepository}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        >
          <CacheRuleDetail />
          <SearchRulePage
            apiRepository={searchRuleRepository}
            encodeModes={['Synthetic Encode', 'Encode 2', 'Encode 3']}
            enabledBroadcastWaves={['GR', 'BS', 'CS']}
            isNavigationOpen={false}
            onSnackbar={vi.fn()}
            onNavigationClick={vi.fn()}
            recordedDirectories={['Recorded']}
            settings={new DefaultSettingsFactory().create()}
          />
        </App>,
      )

      if (initialHash === '/#/search') {
        await screen.findByRole('heading', { name: '検索' })
        fireEvent.change(screen.getByLabelText('keyword'), {
          target: { value: expectedFirstKeyword },
        })
        fireEvent.click(
          within(screen.getByRole('region', { name: '検索条件' })).getByRole('button', {
            name: '検索',
          }),
        )
      }
      await screen.findByText('1 件ヒット')
      expect(await screen.findByText(initialProgramName)).toBeVisible()
      const callsBeforeRuleEdit = vi.mocked(searchRuleRepository.searchSchedules).mock.calls.length

      await act(async () => {
        window.location.hash = '#/search?rule=55'
        window.dispatchEvent(new HashChangeEvent('hashchange'))
      })

      await waitFor(() => {
        expect(screen.queryByText(initialProgramName)).not.toBeInTheDocument()
      })
      expect(await screen.findByText(cachedRuleProgramName)).toBeVisible()
      await waitFor(() => {
        expect(vi.mocked(searchRuleRepository.searchSchedules).mock.calls.length).toBeGreaterThan(
          callsBeforeRuleEdit,
        )
      })
      const callsAfterRuleEdit = vi
        .mocked(searchRuleRepository.searchSchedules)
        .mock.calls.slice(callsBeforeRuleEdit)
      const requestBodiesAfterRuleEdit = callsAfterRuleEdit.map(([body]) => body)
      expect(requestBodiesAfterRuleEdit).toContainEqual({
        option: {
          keyword: 'Cached Rule',
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
      expect(requestBodiesAfterRuleEdit).not.toContainEqual(
        expect.objectContaining({
          option: expect.objectContaining({
            keyword: expectedFirstKeyword,
          }),
        }),
      )
      expect(searchRuleRepository.searchSchedules).toHaveBeenLastCalledWith({
        option: {
          keyword: 'Cached Rule',
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
    },
  )

  it('[AC 2.17][AC 2.26][AC 2.13] preloads time-specified rule reserves without running schedule search actions', async () => {
    window.history.replaceState(null, '', '/#/search?rule=56')
    const searchRuleRepository = createSearchRuleRepository()
    vi.mocked(searchRuleRepository.fetchRule).mockResolvedValueOnce({
      ok: true as const,
      value: {
        id: 56,
        isTimeSpecification: true,
        searchOption: {
          times: [{ week: 0x7f }],
        },
        reserveOption: {
          enable: true,
          allowEndLack: true,
          avoidDuplicate: false,
          periodToAvoidDuplicate: null,
        },
        saveOption: {
          parentDirectoryName: null,
          directory: null,
          recordedFormat: null,
        },
      },
    })
    vi.mocked(searchRuleRepository.fetchRuleReserves).mockResolvedValueOnce({
      ok: true as const,
      value: [
        {
          id: 801,
          name: 'Synthetic Time Rule Reserve',
          channelName: 'Synthetic Rule Channel',
          startAt: 1_700_010_000_000,
          endAt: 1_700_013_600_000,
          isTimeSpecified: true,
        },
      ],
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

    expect(await screen.findByText('Synthetic Time Rule Reserve')).toBeVisible()
    expect(searchRuleRepository.searchSchedules).not.toHaveBeenCalled()
    expect(searchRuleRepository.fetchRuleReserves).toHaveBeenCalledWith({
      ruleId: 56,
      isHalfWidth: true,
    })
    expect(screen.getByTestId('reserves-list-item')).toHaveAttribute(
      'data-needs-decoration',
      'true',
    )
    expect(screen.queryByRole('button', { name: 'edit' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '更新' }))
    await waitFor(() => {
      expect(searchRuleRepository.updateRule).toHaveBeenCalledWith(
        56,
        expect.objectContaining({
          isTimeSpecification: true,
          searchOption: {
            times: [{ week: 0x7f }],
          },
        }),
      )
    })
  })
})
