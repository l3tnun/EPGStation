import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createShellRepository,
  createGuideNavigationConfigWithEncodeModes,
  chooseMuiSelectOption,
  expectMuiSelectText,
  createGuideRepository,
} from './support/guideSpecHarness'

describe('Guide route and fetch lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('fix-address-bar', 'guide-shell-scroll-lock')
    window.history.replaceState(null, '', '/#/guide?type=BS&time=26050509')
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-05-05T09:00:00+09:00'))
  })

  afterEach(() => {
    document.documentElement.classList.remove('fix-address-bar', 'guide-shell-scroll-lock')
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 4.1] [AC 4.2] [AC 4.16] [AC 4.17] [AC 4.22] opens ProgramDialog with metadata, safe extended links, and closes with unmount cleanup', async () => {
    window.history.replaceState(null, '', '/#/guide?time=26050509')
    const guideRepository = createGuideRepository()
    const startAt = Date.parse('2026-05-05T09:00:00+09:00')

    vi.mocked(guideRepository.fetchSchedule).mockResolvedValue({
      ok: true,
      value: [
        {
          channel: {
            id: 301,
            name: 'Synthetic Channel',
            type: 0x01,
          },
          programs: [
            {
              id: 700,
              name: 'Synthetic Dialog Program',
              description: 'Synthetic description',
              extended:
                'safe https://example.test/path and http://example.test/one javascript:alert(1)',
              startAt,
              endAt: startAt + 30 * 60 * 1000,
              genre1: 7,
              subGenre1: 3,
            },
          ],
        },
      ],
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    fireEvent.click(await screen.findByTestId('guide-program-700'))

    const dialog = await screen.findByRole('dialog', { name: 'Synthetic Dialog Program' })
    expect(dialog).toBeVisible()
    expect(dialog).toHaveAttribute('data-max-width', '500')
    expect(dialog).toHaveStyle({
      margin: '24px',
      maxWidth: '500px',
      width: 'calc(100% - 48px)',
    })
    expect(within(dialog).getByText('Synthetic Channel')).toBeVisible()
    expect(within(dialog).getByText('Synthetic description')).toBeVisible()
    expectMuiSelectText('エンコード', 'TS', within(dialog))
    expect(within(dialog).getByLabelText('元ファイル削除')).not.toBeChecked()
    expect(within(dialog).getByRole('button', { name: '詳細' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '検索' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '予約' })).toBeVisible()

    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toStrictEqual([
      'https://example.test/path',
      'http://example.test/one',
    ])
    links.forEach((link) => {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })
    expect(screen.getByTestId('guide-program-extended')).toHaveTextContent('javascript:alert(1)')

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Synthetic Dialog Program' }),
      ).not.toBeInTheDocument()
    })

    fireEvent.click(await screen.findByTestId('guide-program-700'))
    await screen.findByRole('dialog', { name: 'Synthetic Dialog Program' })
    await chooseMuiSelectOption('エンコード', 'H.264')
    fireEvent.click(screen.getByLabelText('元ファイル削除'))

    await act(async () => {
      window.location.hash = '#/guide/setting'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Synthetic Dialog Program' }),
      ).not.toBeInTheDocument()
    })
    expect(JSON.parse(localStorage.getItem('GuideProgramDetailSetting') ?? '{}')).toStrictEqual({
      encode: 'H.264',
      isDeleteOriginalAfterEncode: true,
    })
  })

  it('[G-7] keeps a saved encode value selectable even after it is removed from server config', async () => {
    window.history.replaceState(null, '', '/#/guide?time=26050509')
    localStorage.setItem(
      'GuideProgramDetailSetting',
      JSON.stringify({ encode: 'H.265', isDeleteOriginalAfterEncode: false }),
    )
    const guideRepository = createGuideRepository()
    const startAt = Date.parse('2026-05-05T09:00:00+09:00')

    vi.mocked(guideRepository.fetchSchedule).mockResolvedValue({
      ok: true,
      value: [
        {
          channel: {
            id: 301,
            name: 'Synthetic Channel',
            type: 0x01,
          },
          programs: [
            {
              id: 701,
              name: 'Synthetic Stale Encode Program',
              startAt,
              endAt: startAt + 30 * 60 * 1000,
            },
          ],
        },
      ],
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    fireEvent.click(await screen.findByTestId('guide-program-701'))
    const dialog = await screen.findByRole('dialog', { name: 'Synthetic Stale Encode Program' })

    // encodeModes from server config is only ['H.264'], so 'H.265' is a stale saved value.
    expectMuiSelectText('エンコード', 'H.265', within(dialog))
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'エンコード' }))
    expect(await screen.findByRole('option', { name: 'H.265' })).toBeVisible()
    expect(screen.getByRole('option', { name: 'TS' })).toBeVisible()
    expect(screen.getByRole('option', { name: 'H.264' })).toBeVisible()
  })

  it('[AC 4.12] [AC 4.15] shows the shared cancel failure snackbar when ProgramDialog delete fails', async () => {
    window.history.replaceState(null, '', '/#/guide?time=26050509')
    const guideRepository = createGuideRepository()
    const startAt = Date.parse('2026-05-05T09:00:00+09:00')

    vi.mocked(guideRepository.fetchSchedule).mockResolvedValue({
      ok: true,
      value: [
        {
          channel: {
            id: 301,
            name: 'Synthetic Channel',
            type: 0x01,
          },
          programs: [
            {
              id: 715,
              name: 'Synthetic Delete Failure Target',
              startAt,
              endAt: startAt + 30 * 60 * 1000,
            },
          ],
        },
      ],
    })
    vi.mocked(guideRepository.fetchReserveIndex).mockResolvedValue({
      ok: true,
      value: {
        715: {
          type: 'reserve',
          item: { id: 815, programId: 715 },
        },
      },
    })
    vi.mocked(guideRepository.deleteReserve).mockResolvedValue({
      ok: false,
      error: 'guide-reserve-delete-failed',
      message: 'キャンセル失敗',
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={{
          status: 'loaded',
          liveStreamEnabled: false,
          enabledBroadcastWaves: ['GR', 'BS'],
        }}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    fireEvent.click(await screen.findByTestId('guide-program-715'))
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    expect(guideRepository.deleteReserve).toHaveBeenCalledWith(815)

    // The cancel failure snackbar closes on a 5 second wall-clock timer, and the dialog's own
    // exit transition also runs on a timer. Drive both under fake timers and read the alert
    // synchronously, so the assertion never races the host.
    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    // The dialog's exit transition (MUI default 195ms) must finish before ModalManager restores
    // aria-hidden on the rest of the shell, which is where the snackbar lives.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Synthetic Delete Failure Target キャンセル失敗',
    )
  })

  it.each([
    {
      label: 'adding a reserve',
      programId: 721,
      entry: undefined,
      button: '予約',
      repositoryMethod: 'addProgramReserve',
      message: '予約失敗',
    },
    {
      label: 'unlocking a skipped rule reserve',
      programId: 722,
      entry: { type: 'skip', item: { id: 822, programId: 722, ruleId: 501 } },
      button: '除外解除',
      repositoryMethod: 'unlockSkipReserve',
      message: '除外解除失敗',
    },
    {
      label: 'unlocking an overlapping rule reserve',
      programId: 723,
      entry: { type: 'overlap', item: { id: 823, programId: 723, ruleId: 501 } },
      button: '重複解除',
      repositoryMethod: 'unlockOverlapReserve',
      message: '重複解除失敗',
    },
  ] as const)(
    '[AC 4.15] announces $message in the snackbar when $label fails',
    async ({ programId, entry, button, repositoryMethod, message }) => {
      window.history.replaceState(null, '', '/#/guide?time=26050509')
      const guideRepository = createGuideRepository()
      const startAt = Date.parse('2026-05-05T09:00:00+09:00')

      vi.mocked(guideRepository.fetchSchedule).mockResolvedValue({
        ok: true,
        value: [
          {
            channel: { id: 301, name: 'Synthetic Channel', type: 0x01 },
            programs: [
              {
                id: programId,
                name: 'Synthetic Failure Target',
                startAt,
                endAt: startAt + 30 * 60 * 1000,
              },
            ],
          },
        ],
      })
      vi.mocked(guideRepository.fetchReserveIndex).mockResolvedValue({
        ok: true,
        value: entry === undefined ? {} : { [programId]: entry },
      })
      vi.mocked(guideRepository[repositoryMethod]).mockResolvedValue({
        ok: false,
        error: 'synthetic-failure',
        message,
      } as never)

      render(
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          guideApiRepository={guideRepository}
          navigationConfig={createGuideNavigationConfigWithEncodeModes()}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        />,
      )

      fireEvent.click(await screen.findByTestId(`guide-program-${programId}`))
      fireEvent.click(screen.getByRole('button', { name: button }))
      expect(guideRepository[repositoryMethod]).toHaveBeenCalledTimes(1)

      vi.useFakeTimers()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      expect(screen.getByRole('alert')).toHaveTextContent(`Synthetic Failure Target ${message}`)
    },
  )
})
