import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createShellRepository,
  createSearchRuleRepository,
  warmUpSearchAppRender,
} from './searchRuleSupport'

describe('Search result reserve/conflict/skip/overlap decoration', () => {
  beforeAll(async () => {
    await warmUpSearchAppRender()
  })

  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it.each([
    ['reserve', 'reserve'],
    ['conflict', 'conflict'],
    ['skip', 'skip'],
    ['overlap', 'overlap'],
  ])(
    '[AC 1.7][AC 2.24] marks a search result item with the %s reserve state',
    async (_label, reserveState) => {
      window.history.replaceState(null, '', '/#/search?keyword=Synthetic')
      const searchRuleRepository = createSearchRuleRepository()
      searchRuleRepository.fetchReserveIndex = vi.fn(async () => ({
        ok: true as const,
        value: {
          1001: {
            type: reserveState as 'reserve' | 'conflict' | 'skip' | 'overlap',
            item: { id: 5001, programId: 1001 },
          },
        },
      }))

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

      const resultItem = await screen.findByRole('button', { name: 'Synthetic Program One' })
      await waitFor(() => {
        expect(resultItem).toHaveAttribute('data-reserve-state', reserveState)
      })
    },
  )

  it('[AC 1.7][AC 2.24] leaves the data-reserve-state attribute off items with no reserve', async () => {
    window.history.replaceState(null, '', '/#/search?keyword=Synthetic')
    const searchRuleRepository = createSearchRuleRepository()

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

    const resultItem = await screen.findByRole('button', { name: 'Synthetic Program One' })
    await waitFor(() => {
      expect(searchRuleRepository.fetchReserveIndex).toHaveBeenCalled()
    })
    expect(resultItem).not.toHaveAttribute('data-reserve-state')
  })

  // Navigating Rule -> row menu -> edit into the search page must show reserve state on the
  // resulting search results. This path (rule-edit mode reached via in-app navigation, not a direct
  // URL load) is covered here because every other reserve-decoration case above only exercises plain
  // search mode (`mode: 'search'`). The field mapping that decides the reserve state is the
  // `adaptReserveItem` adapter (client/src/features/search/rule/api/adaptPrograms.ts), covered by
  // unittest/imp/searchRule.adapters.imp.test.ts and searchRule.apiSearch.imp.test.ts; this test
  // covers the component-level reserve-state wiring in rule-edit mode.
  it('[AC 1.7][AC 2.24] marks rule-edit search results reached via the rule menu with reserve state', async () => {
    window.history.replaceState(null, '', '/#/rule')
    const searchRuleRepository = createSearchRuleRepository()
    searchRuleRepository.fetchReserveIndex = vi.fn(async () => ({
      ok: true as const,
      value: {
        1001: {
          type: 'reserve' as const,
          item: { id: 5001, programId: 1001 },
        },
      },
    }))

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

    const row = await screen.findByTestId('rule-item-901')
    fireEvent.click(within(row).getByRole('button', { name: /ルールメニュー:/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'edit' }))

    // Matches the 8000ms budget searchRuleSupport.tsx's warmUpSearchAppRender uses for this same
    // lookup. Measured directly (console.time around this call): the menu-open animation plus
    // route navigation into rule-edit mode resolves in ~100-140ms running this file alone and
    // ~440ms inside a full parallel `npm run test:run` (16-way contention), both comfortably under
    // testing-library's 1000ms default. The larger, shared budget is kept anyway because a CI
    // runner has far fewer cores than that, and this heading is the gate before the slower fetch
    // chain below - a flake here would hide the real one.
    expect(
      await screen.findByRole('heading', { name: 'ルール編集' }, { timeout: 8000 }),
    ).toBeVisible()
    // Matches the same 8000ms budget for the same reason: reaching this point chains the menu-open
    // animation, the route navigation and two sequential fetches (rule detail, then search).
    // Measured directly: this lookup alone took ~740ms running the file alone and ~1.9s inside the
    // full parallel `npm run test:run`, already past testing-library's 1000ms default under that
    // load, so the 8000ms budget used by warmUpSearchAppRender's cold-start render is reused here
    // rather than a value tuned to this one machine.
    const resultItem = await screen.findByRole(
      'button',
      { name: 'Synthetic Program One' },
      { timeout: 8000 },
    )
    await waitFor(() => {
      expect(resultItem).toHaveAttribute('data-reserve-state', 'reserve')
    })
  })
})
