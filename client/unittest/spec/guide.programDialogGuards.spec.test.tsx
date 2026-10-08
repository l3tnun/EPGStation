import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProgramDialog } from '@/features/guide/ProgramDialog'
import type { GuideReserveIndex } from '@/features/guide/guideRequests'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

describe('ProgramDialog internal guard clauses', () => {
  const settings = new DefaultSettingsFactory().create()
  const program = { id: 900, name: 'Synthetic Guard Program', startAt: 0, endAt: 1_000 }

  function baseProps() {
    return {
      program,
      settings,
      detailSetting: { encode: 'TS', isDeleteOriginalAfterEncode: false },
      encodeModes: ['TS', 'H.264'],
      onClose: vi.fn(),
      onExited: vi.fn(),
      onNavigate: vi.fn(),
      onSnackbar: vi.fn(),
      onAddReserve: vi.fn(async () => true),
      onDeleteReserve: vi.fn(async () => true),
      onUnlockSkipReserve: vi.fn(async () => true),
      onUnlockOverlapReserve: vi.fn(async () => true),
    }
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('[AC 4.20] cancels a pending navigation timer instead of stacking a second one when navigating twice quickly', () => {
    const props = baseProps()

    render(<ProgramDialog open reserveIndex={{}} {...props} />)

    fireEvent.click(screen.getByRole('button', { name: '詳細' }))
    // Navigating again before the first delayed navigation fires exercises the clearTimeout
    // guard, and only the second navigation should ultimately run.
    fireEvent.click(screen.getByRole('button', { name: '検索' }))

    vi.advanceTimersByTime(300)

    expect(props.onNavigate).toHaveBeenCalledTimes(1)
  })

  it('[AC 4.26] ignores a second action click while the first is still in flight', async () => {
    const props = baseProps()
    let resolveAdd: (value: boolean) => void = () => undefined
    props.onAddReserve = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveAdd = resolve
        }),
    )

    render(<ProgramDialog open reserveIndex={{}} {...props} />)

    const addButton = screen.getByRole('button', { name: '予約' })
    // Both clicks are dispatched inside one `act` so React has not yet re-rendered (and
    // disabled the button) between them, which is what exercises the in-flight guard itself
    // (`isActionRunningRef`) rather than the browser's native disabled-button click filtering.
    act(() => {
      fireEvent.click(addButton)
      fireEvent.click(addButton)
    })

    expect(props.onAddReserve).toHaveBeenCalledTimes(1)

    resolveAdd(true)
    await vi.waitFor(() => expect(props.onSnackbar).toHaveBeenCalledTimes(1))
  })

  it('[AC 4.27] reports a failed action instead of calling a reserve endpoint when the reserve item is malformed', async () => {
    const props = baseProps()
    // GuideReserveIndex entries always carry `item` in practice (the fetch adapters drop any
    // that don't), so a same-shaped-but-itemless entry is only reachable by constructing the
    // index directly, to exercise the defensive `reserveItem !== undefined` guard.
    const malformedReserveIndex = {
      900: { type: 'reserve' },
    } as unknown as GuideReserveIndex

    render(<ProgramDialog open reserveIndex={malformedReserveIndex} {...props} />)

    fireEvent.click(screen.getByRole('button', { name: '削除' }))

    await vi.waitFor(() => expect(props.onSnackbar).toHaveBeenCalledTimes(1))
    expect(props.onDeleteReserve).not.toHaveBeenCalled()
    expect(props.onSnackbar).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }))
  })
})
