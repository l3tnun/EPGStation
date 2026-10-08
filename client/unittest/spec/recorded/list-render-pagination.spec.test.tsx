import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository } from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

describe('Recorded list route lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(
      null,
      '',
      '/#/recorded?page=3&keyword=alpha&ruleId=0&channelId=34&genre=5&hasOriginalFile=true&timestamp=999',
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 1.1] [AC 1.2] [AC 1.4] [AC 1.7] [AC 1.8] [AC 1.9] [AC 1.12] renders the recorded title, fetches with route settings, and exposes list states', async () => {
    const recordedRepository = createRecordedRepository()
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isHalfWidthDisplayed: false,
      recordedLength: 25,
      isShowDropInfoInsteadOfDescription: false,
      isShowTableMode: true,
    }

    render(
      <App
        settings={settings}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(screen.getByTestId('title-bar')).toHaveTextContent('録画済み')

    const page = await screen.findByTestId('recorded-page')
    await waitFor(() => {
      expect(page).toHaveAttribute('data-recorded-total', '50')
    })
    expect(page).toHaveAttribute('data-recorded-layout', 'table')
    expect(screen.queryByText(/empty/i)).not.toBeInTheDocument()
    expect(screen.queryByText('timestamp')).not.toBeInTheDocument()

    expect(recordedRepository.fetchRecorded).toHaveBeenCalledWith({
      isHalfWidth: false,
      limit: 25,
      offset: 50,
      page: 3,
      keyword: 'alpha',
      ruleId: 0,
      channelId: 34,
      genre: 5,
      hasOriginalFile: true,
    })
    expect(screen.getByRole('table')).toBeVisible()
    expect(screen.getByRole('columnheader', { name: 'タイトル' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: '放送局' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: '時間' })).toBeVisible()
    expect(screen.getByRole('row', { name: /Synthetic recorded one/ })).toBeVisible()
    expect(screen.queryByText('Synthetic description')).not.toBeInTheDocument()
    expect(screen.queryByTestId('recorded-no-image')).not.toBeInTheDocument()
  })

  it('[AC 1.5] [AC 1.13] [AC 1.14] uses card layouts at responsive widths and can show drop information instead of description', async () => {
    const recordedRepository = createRecordedRepository()

    const { rerender } = render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isShowDropInfoInsteadOfDescription: true,
        }}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={760}
        initialDrawerState="none"
      />,
    )

    await screen.findByText('2/1/0 1.0KB')
    expect(screen.getByTestId('recorded-page')).toHaveAttribute(
      'data-recorded-layout',
      'large-card',
    )
    expect(screen.getByText('2/1/0 1.0KB').className).toContain('dropWarning')
    expect(screen.getByTestId('recorded-no-image')).toBeVisible()

    rerender(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isShowDropInfoInsteadOfDescription: true,
        }}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={616}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByTestId('recorded-page')).toHaveAttribute(
      'data-recorded-layout',
      'large-card',
    )

    rerender(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isShowDropInfoInsteadOfDescription: true,
        }}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={615}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByTestId('recorded-page')).toHaveAttribute(
      'data-recorded-layout',
      'small-card',
    )

    rerender(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isShowDropInfoInsteadOfDescription: true,
        }}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={360}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByTestId('recorded-page')).toHaveAttribute(
      'data-recorded-layout',
      'small-card',
    )
  })

  it('[AC 1.15] derives the desktop pagination cluster from the measured element width, not window.innerWidth', async () => {
    // v2 Vuetify `VPagination` derives its ellipsis cluster from
    // `this.$el.parentElement.clientWidth` (VPagination.ts:156-161), not from viewport width. jsdom
    // does not lay elements out, so the un-measured `maxButtons` stays 0 and the pagination falls
    // back to v2's `totalVisible=12` unconstrained six-first/five-last split regardless of
    // `window.innerWidth`.
    for (const width of [600, 611, 612]) {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: width,
      })
      const recordedRepository = createRecordedRepository()
      vi.mocked(recordedRepository.fetchRecorded).mockResolvedValue({
        ok: true,
        value: {
          records: [{ id: 101, name: 'Synthetic recorded one' }],
          total: 480,
        },
      })

      const { unmount } = render(
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          recordedApiRepository={recordedRepository}
          osPrefersDark={false}
          viewportWidth={width}
          initialDrawerState="none"
        />,
      )

      await screen.findByText('Synthetic recorded one')
      expect(screen.getByRole('button', { name: '1 ページ' })).toBeVisible()
      expect(screen.getByRole('button', { name: '6 ページ' })).toBeVisible()
      expect(screen.queryByRole('button', { name: '7 ページ' })).not.toBeInTheDocument()
      expect(screen.getByText('...')).toBeVisible()
      expect(screen.getByRole('button', { name: '16 ページ' })).toBeVisible()
      expect(screen.getByRole('button', { name: '20 ページ' })).toBeVisible()

      unmount()
    }
  })

  // Set recorded list "表示件数"
  // (recordedLength) to 1, open the single item's menu, click "delete", then click outside the
  // resulting confirmation dialog. That must only close the dialog -- it must not navigate to
  // the item's detail page. See component-list-item.spec.test.tsx's "(#9a)" describe block for
  // the focused unit-level regression test and root cause explanation; this test additionally
  // covers the recordedLength=1 precondition end-to-end through the real route.
  it('[#9a] recordedLength=1: an outside click on the delete dialog does not navigate to detail', async () => {
    window.history.replaceState(null, '', '/#/recorded')
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: {
        records: [{ id: 55, name: 'Solo recorded item', videoFiles: [{ id: 1, size: 10 }] }],
        total: 1,
      },
    })
    const settings = { ...new DefaultSettingsFactory().create(), recordedLength: 1 }

    render(
      <App
        settings={settings}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1272}
        initialDrawerState="none"
      />,
    )

    await screen.findByText('Solo recorded item')
    expect(screen.getAllByTestId('recorded-list-item')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Solo recorded item' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'delete' }))
    const dialog = await screen.findByRole('dialog', { name: '録画削除' })
    const outsideArea = dialog.parentElement as Element
    expect(outsideArea).toHaveClass('MuiDialog-container')

    fireEvent.mouseDown(outsideArea)
    fireEvent.click(outsideArea)

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '録画削除' })).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('title-bar')).toHaveTextContent('録画済み')
    expect(window.location.hash.startsWith('#/recorded/detail/')).toBe(false)
  })
})
