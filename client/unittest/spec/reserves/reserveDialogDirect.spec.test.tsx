import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ReserveDialog } from '@/features/reserves/components/ReserveDialog'

describe('ReserveDialog optional field rendering edges', () => {
  it('[AC 2.9] omits the channel subtext and the time button when the reserve has neither', () => {
    render(
      <MemoryRouter>
        <ReserveDialog open reserve={{ id: 1, name: 'Bare reserve' }} onClose={vi.fn()} />
      </MemoryRouter>,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Bare reserve')
    expect(screen.queryByRole('button', { name: /~/ })).not.toBeInTheDocument()
  })
})
