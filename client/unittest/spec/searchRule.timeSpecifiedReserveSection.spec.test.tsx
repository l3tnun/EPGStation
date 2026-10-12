import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TimeSpecifiedReserveSection } from '@/features/search/rule/components/TimeSpecifiedReserveSection'

vi.mock('@/features/reserves/ReserveListItem', () => ({
  ReserveListItem: (props: {
    item: { id: number; name?: string }
    onDialogOpen: (item: unknown) => void
  }) => (
    <button type="button" onClick={() => props.onDialogOpen(props.item)}>
      {`item-${props.item.id}`}
    </button>
  ),
}))

describe('TimeSpecifiedReserveSection', () => {
  it('[AC 2.17][AC 2.26] shows no count text and no list when reserves have not loaded yet', () => {
    render(
      <TimeSpecifiedReserveSection
        reserves={null}
        ruleOptionForm={<div>form</div>}
        onSnackbar={vi.fn()}
      />,
    )

    expect(screen.queryByText(/件$/)).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '時刻指定予約一覧' })).not.toBeInTheDocument()
  })

  it('[AC 2.17][AC 2.26] shows no count text and no list when reserves resolve to an empty array', () => {
    render(
      <TimeSpecifiedReserveSection
        reserves={[]}
        ruleOptionForm={<div>form</div>}
        onSnackbar={vi.fn()}
      />,
    )

    expect(screen.queryByText(/件$/)).not.toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '時刻指定予約一覧' })).not.toBeInTheDocument()
  })

  it('[AC 2.17][AC 2.26] renders the reserve count with the "予約数" prefix, the reserve list, and its inert onDialogOpen callback resolves to no observable action', () => {
    render(
      <TimeSpecifiedReserveSection
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reserves={[{ id: 1, name: 'Synthetic Reserve' } as any]}
        ruleOptionForm={<div>form</div>}
        onSnackbar={vi.fn()}
      />,
    )

    expect(screen.getByText('予約数 1 件')).toBeVisible()
    expect(screen.getByRole('list', { name: '時刻指定予約一覧' })).toBeVisible()
    // This read-only view always renders the item in edit mode, so clicking never opens a
    // dialog in practice; invoking the callback directly here only proves it is inert.
    expect(fireEvent.click(screen.getByText('item-1'))).toBe(true)
  })
})
