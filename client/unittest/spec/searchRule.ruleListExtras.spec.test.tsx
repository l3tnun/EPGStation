import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository, createSearchRuleRepository } from './searchRuleSupport'

describe('Rule list menus and edit mode', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 3.8] reports success and marks the rule enabled when enableRule resolves ok', async () => {
    window.history.replaceState(null, '', '/#/rule')
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

    const disabledRow = await screen.findByTestId('rule-item-902')
    fireEvent.click(within(disabledRow).getByRole('button', { name: '有効化' }))

    await waitFor(() => expect(searchRuleRepository.enableRule).toHaveBeenCalledWith(902))
    expect(await screen.findByText('有効化: -')).toBeVisible()
    expect(
      within(screen.getByTestId('rule-item-902')).getByRole('button', { name: '無効化' }),
    ).toBeVisible()
  })

  it('[AC 3.4] clears the keyword field in the rule search menu', async () => {
    window.history.replaceState(null, '', '/#/rule?keyword=Synthetic')
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

    fireEvent.click(within(screen.getByTestId('title-bar')).getByRole('button', { name: '検索' }))
    const keyword = await screen.findByRole('textbox', { name: 'キーワード' })
    expect(keyword).toHaveValue('Synthetic')
    fireEvent.click(screen.getByRole('button', { name: 'キーワードをクリア' }))
    expect(keyword).toHaveValue('')
  })

  it('[AC 3.6] clears the pending navigation timer when the rule search is submitted again before it fires', async () => {
    window.history.replaceState(null, '', '/#/rule')
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
    expect(await screen.findByRole('heading', { name: 'ルール' })).toBeVisible()

    fireEvent.click(within(screen.getByTestId('title-bar')).getByRole('button', { name: '検索' }))
    const firstKeyword = await screen.findByRole('textbox', { name: 'キーワード' })
    fireEvent.change(firstKeyword, { target: { value: 'First' } })

    // submitRuleSearch debounces the route navigation by 300ms (see RuleListPage.tsx) so a
    // second submission before it fires replaces the pending one instead of stacking it. Switch
    // to fake timers before the first submit so clearTimeout can see the pending timer it
    // replaces; waitFor/findBy* cannot see a faked clock, so the rest reads synchronously.
    vi.useFakeTimers()
    fireEvent.keyDown(firstKeyword, { key: 'Enter' })

    fireEvent.click(within(screen.getByTestId('title-bar')).getByRole('button', { name: '検索' }))
    const secondKeyword = screen.getByRole('textbox', { name: 'キーワード' })
    fireEvent.change(secondKeyword, { target: { value: 'Second' } })
    fireEvent.keyDown(secondKeyword, { key: 'Enter' })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    vi.useRealTimers()

    expect(window.location.hash).toMatch(/^#\/rule\?keyword=Second/)
    expect(window.location.hash).not.toContain('First')
  })
})
