export function joinReserveEndpoint(basePath: string, endpoint: string): string {
  return `${basePath.replace(/\/$/, '')}${endpoint}`
}

export function buildReserveEndpointUrl(
  basePath: string,
  endpointPath: string,
  parameters: URLSearchParams,
): string {
  const endpoint = joinReserveEndpoint(basePath, endpointPath)
  const query = parameters.toString()

  return query === '' ? endpoint : `${endpoint}?${query}`
}

export function buildReservePath(pathname: string, parameters: URLSearchParams): string {
  const query = parameters.toString()

  return query === '' ? pathname : `${pathname}?${query}`
}

export function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export function getJapanDateParts(timestamp: number): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
} {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp))
  const valueOf = (type: string): number => {
    const value = parts.find((part) => part.type === type)?.value

    return value === undefined ? 0 : Number(value)
  }

  return {
    year: valueOf('year'),
    month: valueOf('month'),
    day: valueOf('day'),
    hour: valueOf('hour'),
    minute: valueOf('minute'),
  }
}
