export function parseNumberInput(value: string): number | null {
  if (value.trim() === '') {
    return null
  }

  const parsed = Number(value)

  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export function parseDatetimeLocalInput(value: string): number | null {
  if (value === '') {
    return null
  }

  const parsed = new Date(value).getTime()

  return Number.isFinite(parsed) ? parsed : null
}

export function formatDatetimeLocalInput(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return ''
  }

  const date = new Date(value)
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${year}-${month}-${day}T${hours}:${minutes}`
}

export function parseNullableTextInput(value: string): string | null {
  const trimmed = value.trim()

  return trimmed === '' ? null : value
}
