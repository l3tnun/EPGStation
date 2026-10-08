import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository, createSearchRuleRepository } from './searchRuleSupport'

function renderRuleList(overrides: { isEnableExtendedPagination?: boolean } = {}) {
  return render(
    <App
      settings={{
        ...new DefaultSettingsFactory().create(),
        rulesLength: 1,
        ...overrides,
      }}
      apiRepository={createShellRepository()}
      searchRuleApiRepository={createSearchRuleRepository()}
      osPrefersDark={false}
      viewportWidth={1440}
      initialDrawerState="none"
    />,
  )
}

describe('Rule list pagination switch (Requirement 3.35)', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/rule')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 3.35] keeps the legacy pagination by default', async () => {
    renderRuleList()

    await screen.findByTestId('rule-item-901')
    const nav = screen.getByRole('navigation', { name: 'ページ' })

    expect(within(nav).getByRole('button', { name: '前のページ' })).toBeVisible()
    expect(within(nav).getByRole('button', { name: '次のページ' })).toBeVisible()
    expect(within(nav).getByRole('button', { name: '2 ページ' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '最初のページへ移動' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '最後のページへ移動' })).not.toBeInTheDocument()
  })

  it('[AC 3.35] keeps the legacy pagination when the setting is explicitly false', async () => {
    renderRuleList({ isEnableExtendedPagination: false })

    await screen.findByTestId('rule-item-901')

    expect(screen.getByRole('button', { name: '次のページ' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '最後のページへ移動' })).not.toBeInTheDocument()
  })

  it('[AC 3.35] swaps in the extended pagination when the setting is true', async () => {
    renderRuleList({ isEnableExtendedPagination: true })

    await screen.findByTestId('rule-item-901')
    const nav = screen.getByRole('navigation', { name: 'ページ' })

    expect(within(nav).getByRole('button', { name: '最初のページへ移動' })).toBeDisabled()
    expect(within(nav).getByRole('button', { name: '最後のページへ移動' })).toBeEnabled()
    expect(within(nav).getByRole('button', { name: 'ページ数を入力して移動' })).toHaveTextContent(
      '1',
    )
    expect(screen.queryByRole('button', { name: '次のページ' })).not.toBeInTheDocument()
  })

  it('[AC 3.35] moves through the same ?page= query with the extended pagination', async () => {
    renderRuleList({ isEnableExtendedPagination: true })
    await screen.findByTestId('rule-item-901')

    fireEvent.click(screen.getByRole('button', { name: '最後のページへ移動' }))

    expect(window.location.hash).toContain('page=2')
    expect(await screen.findByRole('button', { name: '最初のページへ移動' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: '最初のページへ移動' }))
    expect(window.location.hash).toContain('page=1')
  })
})
