import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { RecordedListItemView } from '@/features/recorded/components/RecordedListItemView'
import { RecordedListTitleBar } from '@/features/recorded/components/RecordedListTitleBar'
import type { RecordedListItem } from '@/features/recorded/recordedApi'
import type { RecordedLayout } from '@/features/recorded/lib/recordedFormat'
import { DefaultSettingsFactory } from '@/shared/settings'
import { createRecordedRepository } from './recordedSpecRepository'

const settings = new DefaultSettingsFactory().create()

function renderItem(
  item: RecordedListItem,
  layout: RecordedLayout,
  overrides: { isEditMode?: boolean; isSelected?: boolean } = {},
) {
  const onSelectionChange = vi.fn()
  const onItemClick = vi.fn()
  const view = (
    <MemoryRouter>
      <RecordedListItemView
        item={item}
        index={0}
        settings={settings}
        layout={layout}
        isEditMode={overrides.isEditMode ?? false}
        isSelected={overrides.isSelected ?? false}
        isEncodeEnabled={false}
        encodeModes={[]}
        recordedDirectories={[]}
        apiRepository={createRecordedRepository()}
        onActionSnackbar={vi.fn()}
        onRefetchRequested={vi.fn()}
        onSelectionChange={onSelectionChange}
        onItemClick={onItemClick}
      />
    </MemoryRouter>
  )
  const utils = render(
    layout === 'table' ? (
      <table>
        <tbody>{view}</tbody>
      </table>
    ) : (
      view
    ),
  )

  return { ...utils, onSelectionChange, onItemClick }
}

const timedItem: RecordedListItem = {
  id: 7,
  name: 'Timed item',
  channelId: 12,
  startAt: 1_700_000_000_000,
  endAt: 1_700_000_600_000,
  thumbnails: [3],
}

describe('RecordedListItemView: table layout', () => {
  it('[AC 1.4] shows the channel id when no channel name exists and routes row clicks', () => {
    const { onItemClick, onSelectionChange } = renderItem(timedItem, 'table', {
      isSelected: true,
    })
    const row = screen.getByTestId('recorded-list-item')

    expect(within(row).getByText('12')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Timed item' }))
    expect(onItemClick).not.toHaveBeenCalled()
    fireEvent.click(within(row).getByText('Timed item'))
    expect(onItemClick).toHaveBeenCalledWith(7)
    expect(onSelectionChange).not.toHaveBeenCalled()
  })

  it('[AC 2.6] toggles the selection on row click in edit mode and ignores id-less rows', () => {
    const edit = renderItem(timedItem, 'table', { isEditMode: true, isSelected: true })
    fireEvent.click(screen.getByText('Timed item'))
    expect(edit.onSelectionChange).toHaveBeenCalledWith(7, false)
    expect(edit.onItemClick).not.toHaveBeenCalled()
    edit.unmount()

    const anonymous = renderItem({ name: 'No id' }, 'table')
    fireEvent.click(screen.getByText('No id'))
    expect(anonymous.onItemClick).not.toHaveBeenCalled()
  })
})

describe('RecordedListItemView: card layouts', () => {
  it('[AC 1.4] renders a large card without meta rows and falls back on thumbnail errors', () => {
    const { onItemClick, onSelectionChange } = renderItem({ id: 1 }, 'large-card', {
      isSelected: true,
    })

    expect(screen.getByText('dummy')).toBeInTheDocument()
    expect(screen.queryByText(/\(\d+ m\)/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('heading', { name: '#1' }))
    expect(onItemClick).toHaveBeenCalledWith(1)
    expect(onSelectionChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('recorded-no-image')).toHaveAttribute(
      'data-thumbnail-state',
      'fallback',
    )
  })

  it('[AC 1.5] marks a loaded thumbnail as fallback after an image error', () => {
    renderItem(timedItem, 'large-card')
    const image = screen.getByTestId('recorded-thumbnail')
    fireEvent.error(image)
    expect(screen.getByTestId('recorded-no-image')).toHaveAttribute(
      'data-thumbnail-state',
      'fallback',
    )
  })

  it('[AC 2.6] selects by card click in edit mode without rendering the item menu', () => {
    const { onSelectionChange, onItemClick } = renderItem(timedItem, 'large-card', {
      isEditMode: true,
    })

    expect(
      screen.queryByRole('button', { name: '録画メニュー: Timed item' }),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('heading', { name: 'Timed item' }))
    expect(onSelectionChange).toHaveBeenCalledWith(7, true)
    expect(onItemClick).not.toHaveBeenCalled()
  })

  it('[AC 1.4] ignores clicks on id-less large cards and on interactive children', () => {
    const anonymous = renderItem({ name: 'Anonymous', description: 'desc' }, 'large-card')
    fireEvent.click(screen.getByRole('heading', { name: 'Anonymous' }))
    expect(anonymous.onItemClick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Anonymous' }))
    expect(anonymous.onItemClick).not.toHaveBeenCalled()
  })

  it('[AC 1.4] renders small cards with meta, selection and every click path', () => {
    const selected = renderItem({ ...timedItem, description: 'small desc' }, 'small-card', {
      isSelected: true,
    })
    expect(screen.getByText('small desc')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Timed item' }))
    expect(selected.onItemClick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Timed item', { selector: 'h2' }))
    expect(selected.onItemClick).toHaveBeenCalledWith(7)
    selected.unmount()

    const edit = renderItem(timedItem, 'small-card', { isEditMode: true })
    fireEvent.click(screen.getByRole('heading', { name: 'Timed item' }))
    expect(edit.onSelectionChange).toHaveBeenCalledWith(7, true)
    edit.unmount()

    const anonymous = renderItem({}, 'small-card')
    fireEvent.click(screen.getByRole('heading', { name: '#1' }))
    expect(anonymous.onItemClick).not.toHaveBeenCalled()
    expect(screen.queryByText(/\(\d+ m\)/)).not.toBeInTheDocument()
  })
})

describe('RecordedListItemView: delete dialog outside click (#9a)', () => {
  // With the recorded list showing a
  // single item ("表示件数" set to 1), open its menu, click "delete", then click *outside* the
  // resulting confirmation dialog (its backdrop/container, not the "キャンセル"/"削除" buttons).
  // That outside click must only close the dialog, never navigate to the item's detail page.
  //
  // Root cause: `RecordedPlainDialog`'s MUI `<Dialog>` closes on an outside click via handlers
  // (`Modal`'s backdrop click, `Dialog`'s own container/root click) that never call
  // `event.stopPropagation()`. Because the dialog renders through a React portal, and React
  // dispatches a portal's synthetic events along the *React component tree* rather than the DOM
  // tree, that unstopped click keeps bubbling past the dialog to whichever list row/card
  // rendered the menu that opened it -- firing the row's own `onClick` (`onItemClick`) as an
  // unintended side effect of merely closing the dialog. This happens regardless of how many
  // items the list shows; recordedLength=1 is used here as the simplest precondition.
  it('[#9a] closes on an outside click without triggering the row navigation, with a single item shown', async () => {
    const { onItemClick } = renderItem(
      { id: 42, name: 'Solo item', videoFiles: [{ id: 99, name: 'video', size: 10 }] },
      'large-card',
    )

    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Solo item' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'delete' }))

    const dialog = await screen.findByRole('dialog', { name: '録画削除' })
    const outsideArea = dialog.parentElement
    expect(outsideArea).not.toBeNull()
    expect(outsideArea).toHaveClass('MuiDialog-container')

    fireEvent.mouseDown(outsideArea as Element)
    fireEvent.click(outsideArea as Element)

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '録画削除' })).not.toBeInTheDocument()
    })
    expect(onItemClick).not.toHaveBeenCalled()
  })
})

describe('RecordedListTitleBar', () => {
  it('[AC 2.9] closes the main menu on Escape and routes the upload item', async () => {
    const onUploadClick = vi.fn()
    render(
      <RecordedListTitleBar
        isEditMode={false}
        editTitle=""
        isNavigationOpen={false}
        onNavigationClick={vi.fn()}
        onCloseEditMode={vi.fn()}
        onSelectAll={vi.fn()}
        onBulkDelete={vi.fn()}
        onSearchOpen={vi.fn()}
        onEditStart={vi.fn()}
        onCleanupOpen={vi.fn()}
        onUploadClick={onUploadClick}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '録画済みメニュー' }))
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: '録画済みメニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'アップロード' }))
    expect(onUploadClick).toHaveBeenCalledTimes(1)
  })
})
