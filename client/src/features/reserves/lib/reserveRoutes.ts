import type { BroadcastWave } from '@/app/navigation'
import { buildReservePath, getJapanDateParts, pad2 } from './reserveEndpoint'
import type { ReserveVisualState } from './reservesListRequests'

export function resolveReserveDeleteLabel({ id, name }: { id: number; name?: string }): string {
  return name ?? `予約id: ${id}`
}

export function resolveReserveVisualState(input: {
  isSkip?: boolean
  isConflict?: boolean
  isOverlap?: boolean
}): {
  state: ReserveVisualState
  className: ReserveVisualState
} {
  if (input.isSkip === true) {
    return { state: 'skip', className: 'skip' }
  }
  if (input.isConflict === true) {
    return { state: 'conflict', className: 'conflict' }
  }
  if (input.isOverlap === true) {
    return { state: 'overlap', className: 'overlap' }
  }

  return { state: 'reserve', className: 'reserve' }
}

export function buildReserveRecordedSearchPath({ ruleId }: { ruleId?: number }): string {
  if (ruleId === undefined) {
    return '/recorded'
  }

  return `/recorded?ruleId=${ruleId}`
}

export function buildReserveEditPath({
  reserveId,
  ruleId,
}: {
  reserveId: number
  ruleId?: number
}): string {
  if (ruleId !== undefined) {
    return `/search?rule=${ruleId}`
  }

  return `/reserves/manual?reserveId=${reserveId}`
}

export function buildReserveGuidePath({
  startAt,
  broadcastWave,
}: {
  startAt: number
  broadcastWave?: BroadcastWave
}): string {
  const parts = getJapanDateParts(startAt)
  const parameters = new URLSearchParams()
  parameters.set(
    'time',
    `${pad2(parts.year % 100)}${pad2(parts.month)}${pad2(parts.day)}${pad2(parts.hour)}`,
  )
  if (broadcastWave !== undefined) {
    parameters.set('type', broadcastWave)
  }

  return buildReservePath('/guide', parameters)
}

export function formatReserveTimeRange({
  startAt,
  endAt,
}: {
  startAt?: number
  endAt?: number
}): string {
  if (startAt === undefined || endAt === undefined) {
    return ''
  }

  const start = getJapanDateParts(startAt)
  const end = getJapanDateParts(endAt)
  const duration = Math.floor((endAt - startAt) / 1000 / 60)

  return `${start.year}/${pad2(start.month)}/${pad2(start.day)} ${pad2(start.hour)}:${pad2(
    start.minute,
  )} - ${pad2(end.hour)}:${pad2(end.minute)} (${duration}分)`
}
export type ReserveExtendedTextToken =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'link'
      text: string
      href: string
    }

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)

    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function linkifyReserveExtendedText(text: string | undefined): ReserveExtendedTextToken[] {
  if (text === undefined || text === '') {
    return []
  }

  const tokens: ReserveExtendedTextToken[] = []
  const urlPattern = /https?:\/\/[^\s<>"']+/gi
  let index = 0

  for (const match of text.matchAll(urlPattern)) {
    const value = match[0]
    const matchIndex = match.index ?? 0

    if (matchIndex > index) {
      tokens.push({ type: 'text', text: text.slice(index, matchIndex) })
    }

    tokens.push(
      isSafeHttpUrl(value)
        ? { type: 'link', text: value, href: value }
        : { type: 'text', text: value },
    )
    index = matchIndex + value.length
  }

  if (index < text.length) {
    tokens.push({ type: 'text', text: text.slice(index) })
  }

  return tokens
}
