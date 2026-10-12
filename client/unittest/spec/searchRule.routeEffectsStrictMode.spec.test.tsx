import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
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

  it('[AC 2.9] preloads a rule-edit route only once even when StrictMode replays the mount effect', async () => {
    window.history.replaceState(null, '', '/#/search?rule=77')
    const searchRuleRepository = createSearchRuleRepository()

    render(
      <StrictMode>
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          searchRuleApiRepository={searchRuleRepository}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        />
      </StrictMode>,
    )

    expect(await screen.findByText('1 件ヒット')).toBeVisible()

    // StrictMode double-invokes the mount effect; the rule-edit preload guard must still only
    // issue a single search request for the same route/rule/settings combination.
    expect(searchRuleRepository.searchSchedules).toHaveBeenCalledTimes(1)
  })
})
