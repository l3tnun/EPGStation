import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository } from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

// The route boundary in AppShellContent normalizes (by replacing the location in place, without
// remounting the routed screen) any non-root routed URL that lacks a `timestamp` query parameter.
// Recorded pagination navigates with buildRecordedPageSearch, which deletes `timestamp` from the
// outgoing search before pushing the new page — so every page change momentarily produces a URL
// the boundary must normalize. See .kiro/specs/frontend-app-shell/requirements.md AC 5.22.
//
// This test only asserts on edit mode surviving the normalization, not on selection surviving it: a
// refetch (any refetch, pagination or not) intentionally narrows the current selection to ids
// still visible in the newly returned page — see the `toggleVisibleRecordedSelection` call and
// its comment a few lines above in RecordedPage.tsx. That narrowing is independent of this route
// boundary and applies equally whether or not the boundary ever remounts anything, so it is out of
// scope here.
describe('Recorded list pagination and the app-shell timestamp route boundary', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded?timestamp=initial')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC frontend-app-shell 5.22] keeps edit mode active (and usable) across a pagination move that drops the timestamp query', async () => {
    const recordedRepository = createRecordedRepository()

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

    await screen.findByRole('heading', { name: '録画済み' })

    fireEvent.click(screen.getByRole('button', { name: '録画済みメニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '編集' }))

    const [firstItem] = await screen.findAllByTestId('recorded-list-item')
    fireEvent.click(firstItem)

    await waitFor(() => {
      expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択')
    })

    fireEvent.click(screen.getByRole('button', { name: '2 ページ' }))

    // The pagination navigate() call itself produces a URL without `timestamp`; the app shell's
    // route boundary must correct it back with `replace`.
    await waitFor(() => {
      expect(window.location.hash).toMatch(/^#\/recorded\?page=2&timestamp=\d+$/)
    })

    // Edit mode must survive: it is unrelated to which page's records are visible, unlike
    // selection. If the route boundary's <Navigate> swap unmounted RecordedPage on every such
    // redirect, isEditMode would reset to its initial `false` and this bar would be replaced with
    // the plain (non-edit) title bar.
    expect(screen.getByTestId('edit-title-bar')).toBeInTheDocument()

    // Edit mode must also still be functional (not just visually present) after the redirect: a
    // fresh selection on the now-current page's records must register.
    const [itemOnNewPage] = await screen.findAllByTestId('recorded-list-item')
    fireEvent.click(itemOnNewPage)
    await waitFor(() => {
      expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択')
    })
  })
})
