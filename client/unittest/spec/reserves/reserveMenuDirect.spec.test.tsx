import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ReserveMenu } from '@/features/reserves/components/ReserveMenu'
import { createReservesRepository } from './reservesTestKit'

describe('ReserveMenu direct interaction edges', () => {
  it('[AC 2.16] falls back to the derived reserve label when no explicit label is supplied', () => {
    render(
      <MemoryRouter>
        <ReserveMenu
          item={{ id: 1, name: 'Derived label reserve' }}
          apiRepository={createReservesRepository()}
          onSnackbar={vi.fn()}
        />
      </MemoryRouter>,
    )

    expect(
      screen.getByRole('button', { name: '予約メニュー: Derived label reserve' }),
    ).toBeInTheDocument()
  })

  it('[AC 2.16] unlocks an overlap reserve successfully', async () => {
    const apiRepository = createReservesRepository()
    const onSnackbar = vi.fn()
    const onRefetchRequested = vi.fn()

    render(
      <MemoryRouter>
        <ReserveMenu
          item={{ id: 1, name: 'Overlap reserve', isOverlap: true }}
          apiRepository={apiRepository}
          onSnackbar={onSnackbar}
          onRefetchRequested={onRefetchRequested}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /^予約メニュー/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /unlock/ }))

    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith({
        text: 'Overlap reserve 重複解除',
        severity: 'success',
      })
    })
    expect(apiRepository.unlockOverlapReserve).toHaveBeenCalledWith(1)
    expect(onRefetchRequested).toHaveBeenCalled()
  })

  it('[AC 2.16] reports overlap unlock failure without a refetch request', async () => {
    const apiRepository = createReservesRepository()
    vi.mocked(apiRepository.unlockOverlapReserve).mockResolvedValueOnce({
      ok: false,
      error: 'unlock-overlap-failed',
      message: '重複解除失敗',
    })
    const onSnackbar = vi.fn()
    const onRefetchRequested = vi.fn()

    render(
      <MemoryRouter>
        <ReserveMenu
          item={{ id: 1, name: 'Overlap reserve failure', isOverlap: true }}
          apiRepository={apiRepository}
          onSnackbar={onSnackbar}
          onRefetchRequested={onRefetchRequested}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /^予約メニュー/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /unlock/ }))

    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith({
        text: 'Overlap reserve failure 重複解除失敗',
        severity: 'error',
      })
    })
    expect(onRefetchRequested).not.toHaveBeenCalled()
  })

  it('[AC 2.15] reports skip unlock failure', async () => {
    const apiRepository = createReservesRepository()
    vi.mocked(apiRepository.unlockSkipReserve).mockResolvedValueOnce({
      ok: false,
      error: 'unlock-skip-failed',
      message: '除外解除失敗',
    })
    const onSnackbar = vi.fn()

    render(
      <MemoryRouter>
        <ReserveMenu
          item={{ id: 1, name: 'Skip reserve failure', isSkip: true }}
          apiRepository={apiRepository}
          onSnackbar={onSnackbar}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /^予約メニュー/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /unlock/ }))

    await waitFor(() => {
      expect(onSnackbar).toHaveBeenCalledWith({
        text: 'Skip reserve failure 除外解除失敗',
        severity: 'error',
      })
    })
  })

  it('[AC 2.21] hides edit, delete, and unlock actions when a consumer disables editing', async () => {
    render(
      <MemoryRouter>
        <ReserveMenu
          item={{ id: 1, name: 'Disabled edit reserve', ruleId: 501, isSkip: true }}
          apiRepository={createReservesRepository()}
          disableEdit
          onSnackbar={vi.fn()}
        />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: /^予約メニュー/ }))

    expect(await screen.findByRole('menuitem', { name: /recorded/ })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: /^edit/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /delete/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /unlock/ })).not.toBeInTheDocument()
  })
})
