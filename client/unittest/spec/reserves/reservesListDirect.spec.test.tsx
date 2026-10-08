import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ReservesList } from '@/features/reserves/components/ReservesList'
import type { ReserveListItem } from '@/features/reserves/lib/reservesApiTypes'
import { createReservesRepository } from './reservesTestKit'

describe('ReservesList direct rendering edges', () => {
  it('[AC 2.6] falls back to a stable "reserve" key segment when a list item has no id', () => {
    const malformedItem = { name: 'No id reserve' } as unknown as ReserveListItem

    render(
      <MemoryRouter>
        <ReservesList
          reserves={[malformedItem]}
          layout="card"
          apiRepository={createReservesRepository()}
          isEditMode={false}
          selectedIds={new Set()}
          isEnableDisplayForEachBroadcastWave={false}
          onDeleteRequest={vi.fn()}
          onDialogOpen={vi.fn()}
          onSelectionChange={vi.fn()}
          onSnackbar={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('No id reserve')).toBeVisible()
  })
})
