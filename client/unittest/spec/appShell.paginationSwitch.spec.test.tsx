import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createRecordedRepository } from './recorded/recordedSpecRepository'
import { createRecordingRepository } from './recording/recordingTestKit'
import { createReservesRepository } from './reserves/reservesTestKit'
import { createShellRepository, createSearchRuleRepository } from './searchRuleSupport'

// Every screen that pages its list goes through the shared AppPagination, so one setting
// (isEnableExtendedPagination) switches all of them (frontend-app-shell requirement 8.49).
const SCREENS = [
  {
    name: 'recorded list',
    hash: '/#/recorded',
    ready: 'recorded-list-item',
    lengthKey: 'recordedLength',
    requirement: 'frontend-recorded 1.16',
  },
  {
    name: 'recording list',
    hash: '/#/recording',
    ready: 'recording-page',
    lengthKey: 'recordingLength',
    requirement: 'frontend-recording-encode 1.35',
  },
  {
    name: 'reserves list',
    hash: '/#/reserves',
    ready: 'reserves-page',
    lengthKey: 'reservesLength',
    requirement: 'frontend-reserves 1.12',
  },
  {
    name: 'rule list',
    hash: '/#/rule',
    ready: 'rule-item-901',
    lengthKey: 'rulesLength',
    requirement: 'frontend-search-rule 3.35',
  },
] as const

function renderScreen(
  screenCase: (typeof SCREENS)[number],
  overrides: { isEnableExtendedPagination?: boolean } = {},
) {
  window.history.replaceState(null, '', screenCase.hash)

  return render(
    <App
      settings={{
        ...new DefaultSettingsFactory().create(),
        [screenCase.lengthKey]: 1,
        ...overrides,
      }}
      apiRepository={createShellRepository()}
      recordedApiRepository={createRecordedRepository()}
      recordingApiRepository={createRecordingRepository()}
      reservesApiRepository={createReservesRepository()}
      searchRuleApiRepository={createSearchRuleRepository()}
      osPrefersDark={false}
      viewportWidth={1440}
      initialDrawerState="none"
    />,
  )
}

describe('Pagination switch on every paged screen (requirement 8.49)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe.each(SCREENS)('$name', (screenCase) => {
    it(`[AC 8.49] keeps the legacy pagination by default (${screenCase.requirement})`, async () => {
      renderScreen(screenCase)

      await screen.findAllByTestId(screenCase.ready)
      const nav = await screen.findByRole('navigation', { name: 'ページ' })

      expect(within(nav).getByRole('button', { name: '次のページ' })).toBeVisible()
      expect(screen.queryByRole('button', { name: '最後のページへ移動' })).not.toBeInTheDocument()
    })

    it(`[AC 8.49] keeps the legacy pagination when the setting is false (${screenCase.requirement})`, async () => {
      renderScreen(screenCase, { isEnableExtendedPagination: false })

      await screen.findAllByTestId(screenCase.ready)
      const nav = await screen.findByRole('navigation', { name: 'ページ' })

      expect(within(nav).getByRole('button', { name: '次のページ' })).toBeVisible()
      expect(
        screen.queryByRole('button', { name: 'ページ数を入力して移動' }),
      ).not.toBeInTheDocument()
    })

    it(`[AC 8.49] shows the extended pagination when the setting is true (${screenCase.requirement})`, async () => {
      renderScreen(screenCase, { isEnableExtendedPagination: true })

      await screen.findAllByTestId(screenCase.ready)
      const nav = await screen.findByRole('navigation', { name: 'ページ' })

      expect(within(nav).getByRole('button', { name: '最初のページへ移動' })).toBeDisabled()
      expect(within(nav).getByRole('button', { name: '最後のページへ移動' })).toBeEnabled()
      expect(within(nav).getByRole('button', { name: 'ページ数を入力して移動' })).toHaveTextContent(
        '1',
      )
      expect(screen.queryByRole('button', { name: '次のページ' })).not.toBeInTheDocument()
    })

    it(`[AC 8.49] moves through the ?page= query with the extended pagination (${screenCase.requirement})`, async () => {
      renderScreen(screenCase, { isEnableExtendedPagination: true })
      await screen.findAllByTestId(screenCase.ready)

      const last = await screen.findByRole('button', { name: '最後のページへ移動' })
      fireEvent.click(last)

      await waitFor(() => {
        expect(screen.getByRole('button', { name: '最初のページへ移動' })).toBeEnabled()
      })
      expect(window.location.hash).toMatch(/page=[2-9]/)
    })
  })
})
