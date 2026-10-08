import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const executeReserveBulkDeleteAction = vi.fn()

vi.mock('@/features/reserves/lib/reserveSelection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/reserves/lib/reserveSelection')>()

  return {
    ...actual,
    executeReserveBulkDeleteAction: (...args: unknown[]) => executeReserveBulkDeleteAction(...args),
  }
})

describe('ReserveBulkDeleteDialog zero-selection contract from the shared bulk delete helper', () => {
  it('[AC 3.9] reports the "select a program" snackbar when the shared helper reports zero-selection at confirm time', async () => {
    const { ReserveBulkDeleteDialog } =
      await import('@/features/reserves/components/ReserveDeleteDialogs')
    executeReserveBulkDeleteAction.mockResolvedValueOnce({ status: 'zero-selection' })
    const onSnackbar = vi.fn()

    render(
      <ReserveBulkDeleteDialog
        open
        reserves={[{ id: 1, name: 'Synthetic reserve' }]}
        apiRepository={{} as never}
        onClose={vi.fn()}
        onSnackbar={onSnackbar}
        onConfirmStart={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '削除' }))

    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith({
        text: '番組を選択してください。',
        severity: 'error',
      })
    })
  })
})
