import type { ServerApiFetch } from '@/app/serverApi'
import type { GuideReserveIndexRequest } from '@/features/guide/guideRequests'
import type { RuleListRequest } from '../query'
import { isRecord } from './guards'

export function resolveDefaultFetch(): ServerApiFetch {
  return globalThis.fetch.bind(globalThis)
}

export function joinEndpoint(basePath: string, endpointPath: string): string {
  return `${basePath.replace(/\/$/, '')}${endpointPath}`
}

export async function postJson(
  fetcher: ServerApiFetch,
  url: string,
  body: unknown,
): Promise<{ status: number; body: unknown } | null> {
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      return {
        status: response.status,
        body: null,
      }
    }

    return {
      status: response.status,
      body: await response.json(),
    }
  } catch {
    return null
  }
}

export function compactOptionalApiFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(compactOptionalApiFields)
  }

  if (!isRecord(value)) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (key === 'channelNames') {
        return []
      }

      if (entry === null || entry === undefined) {
        return []
      }

      return [[key, compactOptionalApiFields(entry)]]
    }),
  )
}

export async function fetchJson(
  fetcher: ServerApiFetch,
  url: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown } | null> {
  try {
    const response = await fetcher(url, init)

    if (!response.ok) {
      return {
        status: response.status,
        body: null,
      }
    }

    if (response.status === 204) {
      return {
        status: response.status,
        body: undefined,
      }
    }

    return {
      status: response.status,
      body: await response.json(),
    }
  } catch {
    return null
  }
}

export async function fetchAction(
  fetcher: ServerApiFetch,
  url: string,
  init: RequestInit,
): Promise<boolean> {
  try {
    const response = await fetcher(url, init)

    return response.ok
  } catch {
    return false
  }
}

export function buildReserveIndexUrl(basePath: string, request: GuideReserveIndexRequest): string {
  const parameters = new URLSearchParams()
  parameters.set('startAt', String(request.startAt))
  parameters.set('endAt', String(request.endAt))

  return `${joinEndpoint(basePath, '/reserves/lists')}?${parameters.toString()}`
}

export function buildRuleReservesUrl(
  basePath: string,
  request: { ruleId: number; isHalfWidth: boolean },
): string {
  const parameters = new URLSearchParams()
  parameters.set('type', 'all')
  parameters.set('ruleId', String(request.ruleId))
  parameters.set('isHalfWidth', String(request.isHalfWidth))

  return `${joinEndpoint(basePath, '/reserves')}?${parameters.toString()}`
}

export function buildRuleListUrl(basePath: string, request: RuleListRequest): string {
  const parameters = new URLSearchParams()
  parameters.set('type', request.type)
  parameters.set('offset', String(request.offset))
  parameters.set('limit', String(request.limit))
  parameters.set('isHalfWidth', String(request.isHalfWidth))
  if (request.keyword !== undefined) {
    parameters.set('keyword', request.keyword)
  }

  return `${joinEndpoint(basePath, '/rules')}?${parameters.toString()}`
}
