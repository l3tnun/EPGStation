export function toggleVisibleReserveSelection({
  currentSelectedIds,
  visibleReserveIds,
  action,
}: {
  currentSelectedIds: ReadonlySet<number>
  visibleReserveIds: readonly number[]
  action: 'select-all' | 'preserve-visible'
}): Set<number> {
  const visibleIds = new Set(visibleReserveIds)

  if (action === 'preserve-visible') {
    return new Set([...currentSelectedIds].filter((id) => visibleIds.has(id)))
  }

  const areAllVisibleSelected =
    visibleReserveIds.length > 0 && visibleReserveIds.every((id) => currentSelectedIds.has(id))

  if (areAllVisibleSelected) {
    return new Set([...currentSelectedIds].filter((id) => !visibleIds.has(id)))
  }

  return new Set([...currentSelectedIds, ...visibleReserveIds])
}

export type ReserveBulkDeleteActionStatus = 'zero-selection' | 'success' | 'failure'

export async function executeReserveBulkDeleteAction({
  apiRepository,
  reserveIds,
}: {
  apiRepository: {
    deleteReserve(reserveId: number): Promise<{ ok: boolean }>
  }
  reserveIds: readonly number[]
}): Promise<{ status: ReserveBulkDeleteActionStatus }> {
  if (reserveIds.length === 0) {
    return { status: 'zero-selection' }
  }

  let hasFailure = false

  for (const reserveId of reserveIds) {
    const result = await apiRepository.deleteReserve(reserveId)
    if (!result.ok) {
      hasFailure = true
    }
  }

  return { status: hasFailure ? 'failure' : 'success' }
}
