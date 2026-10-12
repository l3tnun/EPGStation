export function parseOptionalNumber(value: string | null): number | null {
  if (value === null || value === '') {
    return null
  }
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}

export function parseRecordedDetailRouteId(value: string | undefined): number | null {
  if (value === undefined || /^\d+$/.test(value) === false) {
    return null
  }

  const parsed = Number(value)

  return Number.isSafeInteger(parsed) ? parsed : null
}
