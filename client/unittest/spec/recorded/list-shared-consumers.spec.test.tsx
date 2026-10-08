import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RecordedBulkDeleteDialog, RecordedItemMenu } from '@/features/recorded'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { MemoryRouter } from 'react-router-dom'
import { createRecordedRepository } from './recordedSpecRepository'

describe('Recorded list actions', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 3.24] keeps shared component consumer state distinct for dashboard and recording hosts', async () => {
    const recordedRepository = createRecordedRepository()
    const onSnackbar = vi.fn()
    const onRefetchRequested = vi.fn()

    const { unmount } = render(
      <MemoryRouter>
        <RecordedItemMenu
          item={{
            id: 101,
            name: 'Synthetic dashboard consumer',
            isProtected: false,
            isRecording: false,
            isEncoding: true,
            ruleId: 55,
            videoFiles: [{ id: 201, name: 'synthetic-video-one', size: 1024 }],
          }}
          apiRepository={recordedRepository}
          encodeModes={['synthetic-mode']}
          isEncodeEnabled={true}
          recordedDirectories={['synthetic-parent']}
          settings={new DefaultSettingsFactory().create()}
          onRefetchRequested={onRefetchRequested}
          onSnackbar={onSnackbar}
        />
      </MemoryRouter>,
    )

    fireEvent.click(
      screen.getByRole('button', { name: '録画メニュー: Synthetic dashboard consumer' }),
    )
    expect(screen.getByRole('menuitem', { name: 'encode' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'stop' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'delete' })).toBeVisible()
    unmount()

    render(
      <MemoryRouter>
        <RecordedItemMenu
          item={{
            id: 102,
            name: 'Synthetic recording consumer',
            isProtected: false,
            isRecording: true,
            isEncoding: false,
            ruleId: 56,
            videoFiles: [{ id: 202, name: 'synthetic-video-two', size: 1024 }],
          }}
          apiRepository={recordedRepository}
          encodeModes={['synthetic-mode']}
          isEncodeEnabled={true}
          recordedDirectories={['synthetic-parent']}
          settings={new DefaultSettingsFactory().create()}
          onRefetchRequested={onRefetchRequested}
          onSnackbar={onSnackbar}
        />
      </MemoryRouter>,
    )

    fireEvent.click(
      screen.getByRole('button', { name: '録画メニュー: Synthetic recording consumer' }),
    )
    expect(screen.getByRole('menuitem', { name: 'rule' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'search' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'protect' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'delete' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: 'encode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'stop' })).not.toBeInTheDocument()
  })

  it('[AC 3.24] matches the legacy recorded item menu contract without playback entries and with icons', async () => {
    const recordedRepository = createRecordedRepository()

    render(
      <MemoryRouter>
        <RecordedItemMenu
          item={{
            id: 101,
            name: 'Synthetic legacy menu target',
            isProtected: false,
            isRecording: false,
            isEncoding: false,
            videoFiles: [{ id: 201, name: 'TS', size: 1024 }],
          }}
          apiRepository={recordedRepository}
          encodeModes={['synthetic-mode']}
          isEncodeEnabled={true}
          recordedDirectories={['synthetic-parent']}
          settings={new DefaultSettingsFactory().create()}
          onRefetchRequested={vi.fn()}
          onSnackbar={vi.fn()}
        />
      </MemoryRouter>,
    )

    fireEvent.click(
      screen.getByRole('button', { name: '録画メニュー: Synthetic legacy menu target' }),
    )
    const menu = screen.getByRole('menu')
    const menuItems = within(menu).getAllByRole('menuitem')

    expect(menuItems).toHaveLength(4)
    expect(menuItems[0]).toHaveAccessibleName('search')
    expect(menuItems[1]).toHaveAccessibleName('protect')
    expect(menuItems[2]).toHaveAccessibleName('encode')
    expect(menuItems[3]).toHaveAccessibleName('delete')
    expect(within(menu).queryByRole('menuitem', { name: 'play TS' })).not.toBeInTheDocument()
    expect(menu.querySelectorAll('[data-recorded-menu-icon]')).toHaveLength(4)
  })

  it('[AC 3.26] hides bulk delete target options for recording consumer state', async () => {
    render(
      <RecordedBulkDeleteDialog
        open={true}
        items={[
          {
            id: 101,
            name: 'Synthetic recording bulk consumer',
            videoFiles: [{ id: 201, name: 'synthetic-video-one', type: 'ts', size: 1024 }],
          },
        ]}
        apiRepository={createRecordedRepository()}
        disableOption={true}
        onClose={vi.fn()}
        onCompleted={vi.fn()}
        onSnackbar={vi.fn()}
      />,
    )

    expect(await screen.findByRole('dialog')).toBeVisible()
    expect(screen.getByText('選択した 1 件の番組を削除しますか。')).toBeVisible()
    expect(screen.queryByRole('listbox', { name: '削除対象' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '全て' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'オリジナルファイルだけ' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'エンコードファイルだけ' })).not.toBeInTheDocument()
  })
})
