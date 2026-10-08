import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from './hashRouteAssertions'
import {
  createShellRepository,
  createSearchRuleRepository,
  warmUpSearchAppRender,
} from './searchRuleSupport'

describe('Search route lifecycle', () => {
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

  it('[AC 2.10] navigates to the reservation edit page from a search result ProgramDialog', async () => {
    window.history.replaceState(null, '', '/#/search?keyword=Synthetic')
    const searchRuleRepository = createSearchRuleRepository()
    vi.mocked(searchRuleRepository.fetchReserveIndex).mockResolvedValue({
      ok: true,
      value: {
        1001: {
          type: 'reserve',
          item: { id: 811, programId: 1001 },
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

    fireEvent.click(await screen.findByRole('button', { name: 'Synthetic Program One' }))
    const dialog = await screen.findByRole('dialog', { name: 'Synthetic Program One' })
    fireEvent.click(within(dialog).getByRole('button', { name: '編集' }))
    await waitFor(() => {
      expectHashRoute('#/reserves/manual?reserveId=811')
    })
  })

  it('[AC 2.10] deletes an existing reservation from a search result ProgramDialog', async () => {
    window.history.replaceState(null, '', '/#/search?keyword=Synthetic')
    const searchRuleRepository = createSearchRuleRepository()
    vi.mocked(searchRuleRepository.fetchReserveIndex).mockResolvedValue({
      ok: true,
      value: {
        1001: {
          type: 'reserve',
          item: { id: 811, programId: 1001 },
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

    fireEvent.click(await screen.findByRole('button', { name: 'Synthetic Program One' }))
    const dialog = await screen.findByRole('dialog', { name: 'Synthetic Program One' })
    fireEvent.click(within(dialog).getByRole('button', { name: '削除' }))

    await waitFor(() => {
      expect(searchRuleRepository.deleteReserve).toHaveBeenCalledWith(811)
    })
    expect(await screen.findByText('Synthetic Program One キャンセル')).toBeVisible()
  })

  it('[AC 2.10] unlocks a skipped reservation from a search result ProgramDialog', async () => {
    window.history.replaceState(null, '', '/#/search?keyword=Synthetic')
    const searchRuleRepository = createSearchRuleRepository()
    vi.mocked(searchRuleRepository.fetchReserveIndex).mockResolvedValue({
      ok: true,
      value: {
        1001: {
          type: 'skip',
          item: { id: 812, programId: 1001, ruleId: 701 },
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

    fireEvent.click(await screen.findByRole('button', { name: 'Synthetic Program One' }))
    const dialog = await screen.findByRole('dialog', { name: 'Synthetic Program One' })
    fireEvent.click(within(dialog).getByRole('button', { name: '除外解除' }))

    await waitFor(() => {
      expect(searchRuleRepository.unlockSkipReserve).toHaveBeenCalledWith(812)
    })
    expect(await screen.findByText('Synthetic Program One 除外解除')).toBeVisible()
  })

  it('[AC 2.10] unlocks an overlapping reservation from a search result ProgramDialog', async () => {
    window.history.replaceState(null, '', '/#/search?keyword=Synthetic')
    const searchRuleRepository = createSearchRuleRepository()
    vi.mocked(searchRuleRepository.fetchReserveIndex).mockResolvedValue({
      ok: true,
      value: {
        1001: {
          type: 'overlap',
          item: { id: 813, programId: 1001, ruleId: 701 },
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

    fireEvent.click(await screen.findByRole('button', { name: 'Synthetic Program One' }))
    const dialog = await screen.findByRole('dialog', { name: 'Synthetic Program One' })
    fireEvent.click(within(dialog).getByRole('button', { name: '重複解除' }))

    await waitFor(() => {
      expect(searchRuleRepository.unlockOverlapReserve).toHaveBeenCalledWith(813)
    })
    expect(await screen.findByText('Synthetic Program One 重複解除')).toBeVisible()
  })

  it('[AC 2.3] [AC 2.5] shows 編集/検索/除外解除 for a manual reserve in skip state and edits it', async () => {
    window.history.replaceState(null, '', '/#/search?keyword=Synthetic')
    const searchRuleRepository = createSearchRuleRepository()
    vi.mocked(searchRuleRepository.fetchReserveIndex).mockResolvedValue({
      ok: true,
      value: {
        1001: {
          type: 'skip',
          item: { id: 814, programId: 1001 },
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

    fireEvent.click(await screen.findByRole('button', { name: 'Synthetic Program One' }))
    const dialog = await screen.findByRole('dialog', { name: 'Synthetic Program One' })
    expect(within(dialog).getByRole('button', { name: '編集' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '検索' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '除外解除' })).toBeVisible()

    fireEvent.click(within(dialog).getByRole('button', { name: '編集' }))
    await waitFor(() => {
      expectHashRoute('#/reserves/manual?reserveId=814')
    })
  })

  it('[AC 2.3] [AC 2.5] shows 編集/検索/重複解除 for a manual reserve in overlap state and edits it', async () => {
    window.history.replaceState(null, '', '/#/search?keyword=Synthetic')
    const searchRuleRepository = createSearchRuleRepository()
    vi.mocked(searchRuleRepository.fetchReserveIndex).mockResolvedValue({
      ok: true,
      value: {
        1001: {
          type: 'overlap',
          item: { id: 815, programId: 1001 },
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

    fireEvent.click(await screen.findByRole('button', { name: 'Synthetic Program One' }))
    const dialog = await screen.findByRole('dialog', { name: 'Synthetic Program One' })
    expect(within(dialog).getByRole('button', { name: '編集' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '検索' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '重複解除' })).toBeVisible()

    fireEvent.click(within(dialog).getByRole('button', { name: '編集' }))
    await waitFor(() => {
      expectHashRoute('#/reserves/manual?reserveId=815')
    })
  })
})
