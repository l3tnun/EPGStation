import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ReserveListItem } from '@/features/reserves/ReserveListItem'
import type { ReserveListItem as ReserveListItemModel } from '@/features/reserves/lib/reservesApiTypes'
import type { ReservesLayout } from '@/features/reserves/lib/reservesListRequests'
import { createReservesRepository } from './reservesTestKit'

function renderItem(
  item: ReserveListItemModel,
  layout: ReservesLayout,
  overrides: { needsDecoration?: boolean; isSelected?: boolean; isEditMode?: boolean } = {},
) {
  const onDialogOpen = vi.fn()
  const onSelectionChange = vi.fn()
  const onSnackbar = vi.fn()
  const view = (
    <MemoryRouter>
      <ReserveListItem
        item={item}
        index={0}
        layout={layout}
        apiRepository={createReservesRepository()}
        isEditMode={overrides.isEditMode ?? false}
        isSelected={overrides.isSelected ?? false}
        needsDecoration={overrides.needsDecoration ?? false}
        onDialogOpen={onDialogOpen}
        onSelectionChange={onSelectionChange}
        onSnackbar={onSnackbar}
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

  return { ...utils, onDialogOpen, onSelectionChange }
}

function findContentButton(label: string): HTMLElement {
  const button = screen.getByText(label).closest('button')
  if (button === null) {
    throw new Error(`content button for "${label}" not found`)
  }

  return button
}

describe('ReserveListItem direct interaction and rendering edges', () => {
  it('[AC 2.21] applies the decorated-item class when a consumer passes needsDecoration', () => {
    renderItem({ id: 1, name: 'Decorated' }, 'card', { needsDecoration: true })

    expect(screen.getByTestId('reserves-list-item')).toHaveAttribute(
      'data-needs-decoration',
      'true',
    )
  })

  it('[AC 2.9] opens the reserve dialog when Enter is pressed on the card content button', () => {
    const { onDialogOpen } = renderItem({ id: 1, name: 'Keyboard reserve' }, 'card')

    fireEvent.keyDown(findContentButton('Keyboard reserve'), { key: 'Enter' })

    expect(onDialogOpen).toHaveBeenCalledWith({ id: 1, name: 'Keyboard reserve' })
  })

  it('[AC 2.9] opens the reserve dialog when Space is pressed on the card content button', () => {
    const { onDialogOpen } = renderItem({ id: 1, name: 'Space reserve' }, 'card')

    fireEvent.keyDown(findContentButton('Space reserve'), { key: ' ' })

    expect(onDialogOpen).toHaveBeenCalledWith({ id: 1, name: 'Space reserve' })
  })

  it('[AC 2.9] ignores keyboard keys other than Enter and Space on the card content button', () => {
    const { onDialogOpen } = renderItem({ id: 1, name: 'Ignored key reserve' }, 'card')

    fireEvent.keyDown(findContentButton('Ignored key reserve'), { key: 'Tab' })

    expect(onDialogOpen).not.toHaveBeenCalled()
  })

  it('[AC 2.9] keeps a table-layout menu cell click from opening the reserve dialog behind it', () => {
    const { onDialogOpen } = renderItem({ id: 1, name: 'Table menu reserve' }, 'table')

    fireEvent.click(screen.getByTestId('reserves-list-item').querySelector('td:last-child')!)

    expect(onDialogOpen).not.toHaveBeenCalled()
  })

  it('[AC 2.9] keeps a card-layout menu click from opening the reserve dialog behind it', () => {
    const { onDialogOpen } = renderItem({ id: 1, name: 'Card menu reserve' }, 'card')

    fireEvent.click(screen.getByTestId('reserves-list-item').querySelector('[class*="cardMenu"]')!)

    expect(onDialogOpen).not.toHaveBeenCalled()
  })

  it('[AC 2.23] omits the channel label span when the reserve has no channel information', () => {
    renderItem({ id: 1, name: 'No channel reserve' }, 'card')

    const article = screen.getByTestId('reserves-list-item')
    expect(article.querySelector('[class*="itemChannel"]')).toBeNull()
  })

  it('[AC 2.23] omits the legacy card time span when the reserve has no start/end timestamps', () => {
    renderItem({ id: 1, name: 'No time reserve' }, 'card')

    const article = screen.getByTestId('reserves-list-item')
    expect(article.querySelector('[class*="itemLegacyTime"]')).toBeNull()
  })
})
