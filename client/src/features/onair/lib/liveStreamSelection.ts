import {
  normalizeOnAirSelectStreamSetting,
  type LiveStreamCandidate,
  type LiveStreamType,
  type OnAirSelectStreamSetting,
} from '../onairRequests'

export function getBrowserLocalStorage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage
}

export function getBrowserHref(): string {
  return typeof window === 'undefined' ? 'http://localhost/' : window.location.href
}

export function isGuideRouteTimeValue(value: string): boolean {
  if (!/^\d{8}$/.test(value)) {
    return false
  }

  const year = 2000 + Number(value.slice(0, 2))
  const month = Number(value.slice(2, 4))
  const day = Number(value.slice(4, 6))
  const hour = Number(value.slice(6, 8))
  const date = new Date(Date.UTC(year, month - 1, day, hour))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour
  )
}

export function findCandidate(
  candidates: readonly LiveStreamCandidate[],
  type: LiveStreamType,
): LiveStreamCandidate | undefined {
  return candidates.find((candidate) => candidate.type === type)
}

export function repairSelectionForCandidates(
  value: OnAirSelectStreamSetting,
  candidates: readonly LiveStreamCandidate[],
): OnAirSelectStreamSetting {
  return normalizeOnAirSelectStreamSetting({ saved: value, candidates })
}
