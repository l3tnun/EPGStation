import type { LiveStreamConfig, ServerConfigNavigationState } from '@/app/serverApi'
import type { URLSchemePlatform } from '@/shared/settings/urlSchemePlatform'
import {
  DEFAULT_SELECT_STREAM_SETTING,
  ONAIR_RESERVE_LOOKAHEAD_MS,
  ONAIR_SELECT_STREAM_STORAGE_KEY,
  type LiveStreamCandidate,
  type LiveStreamType,
  type OnAirRequest,
  type OnAirRequestUrls,
  type OnAirSelectStreamSetting,
} from './onairRequestTypes'

export function buildEndpointUrl(
  basePath: string,
  endpointPath: string,
  parameters: URLSearchParams,
) {
  const endpoint = `${basePath.replace(/\/$/, '')}${endpointPath}`
  const query = parameters.toString()

  return query === '' ? endpoint : `${endpoint}?${query}`
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isLiveStreamType(value: unknown): value is LiveStreamType {
  return (
    value === 'M2TS' ||
    value === 'M2TS-LL' ||
    value === 'WebM' ||
    value === 'MP4' ||
    value === 'HLS'
  )
}

export function appendCandidate(
  candidates: LiveStreamCandidate[],
  type: LiveStreamType,
  modes: readonly string[] | undefined,
): void {
  if (modes !== undefined && modes.length > 0) {
    candidates.push({ type, modes })
  }
}

export function formatWatchInfoTime(
  startAt: number | undefined,
  endAt: number | undefined,
): string {
  if (startAt === undefined || endAt === undefined) {
    return ''
  }

  const weekdayMap: Record<string, string> = {
    Sun: '日',
    Mon: '月',
    Tue: '火',
    Wed: '水',
    Thu: '木',
    Fri: '金',
    Sat: '土',
  }
  const weekdayToken =
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tokyo',
      weekday: 'short',
    })
      .formatToParts(new Date(startAt))
      .find((part) => part.type === 'weekday')?.value ?? 'Sun'
  const weekday = weekdayMap[weekdayToken] ?? '日'
  const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit',
    day: '2-digit',
  })
  const timeFormatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

  return `${dateFormatter.format(new Date(startAt))}(${weekday}) ${timeFormatter.format(
    new Date(startAt),
  )} ~ ${timeFormatter.format(new Date(endAt))}`
}

export function normalizeMode(mode: unknown, maxLength: number): number {
  if (typeof mode !== 'number' || !Number.isSafeInteger(mode) || mode < 0 || mode >= maxLength) {
    return 0
  }

  return mode
}

export function buildOnAirRequestUrls({
  isHalfWidth,
  reserveStartAt,
  basePath = './api',
}: OnAirRequest & {
  reserveStartAt: number
  basePath?: string
}): OnAirRequestUrls {
  const reserveParameters = new URLSearchParams()
  reserveParameters.set('startAt', String(reserveStartAt))
  reserveParameters.set('endAt', String(reserveStartAt + ONAIR_RESERVE_LOOKAHEAD_MS))

  const broadcastingParameters = new URLSearchParams()
  broadcastingParameters.set('isHalfWidth', String(isHalfWidth))

  return {
    reserveIndex: buildEndpointUrl(basePath, '/reserves/lists', reserveParameters),
    broadcasting: buildEndpointUrl(basePath, '/schedules/broadcasting', broadcastingParameters),
  }
}

export function buildOnAirStreamsUrl({
  isHalfWidth,
  basePath = './api',
}: OnAirRequest & { basePath?: string }): string {
  const parameters = new URLSearchParams()
  parameters.set('isHalfWidth', String(isHalfWidth))

  return buildEndpointUrl(basePath, '/streams', parameters)
}

export function resolveLiveStreamCandidates({
  streamConfig,
  useURLScheme,
}: {
  streamConfig?: LiveStreamConfig
  useURLScheme: boolean
}): LiveStreamCandidate[] {
  const tsConfig = streamConfig?.live?.ts
  const candidates: LiveStreamCandidate[] = []

  if (tsConfig === undefined) {
    return candidates
  }

  if (useURLScheme) {
    const m2ts = tsConfig.m2ts?.map((mode) => mode.name).filter((mode) => mode !== '')
    appendCandidate(candidates, 'M2TS', m2ts)
    return candidates
  }

  appendCandidate(candidates, 'M2TS-LL', tsConfig.m2tsll)
  appendCandidate(candidates, 'WebM', tsConfig.webm)
  appendCandidate(candidates, 'MP4', tsConfig.mp4)
  appendCandidate(candidates, 'HLS', tsConfig.hls)

  return candidates
}

export function readOnAirSelectStreamSetting(
  storage: Storage | undefined,
): OnAirSelectStreamSetting {
  if (storage === undefined) {
    return DEFAULT_SELECT_STREAM_SETTING
  }

  try {
    const raw = JSON.parse(storage.getItem(ONAIR_SELECT_STREAM_STORAGE_KEY) ?? 'null')
    if (!isRecord(raw) || typeof raw.useURLScheme !== 'boolean' || !isLiveStreamType(raw.type)) {
      return DEFAULT_SELECT_STREAM_SETTING
    }

    return {
      useURLScheme: raw.useURLScheme,
      type: raw.type,
      mode: typeof raw.mode === 'number' && Number.isSafeInteger(raw.mode) ? raw.mode : 0,
    }
  } catch {
    return DEFAULT_SELECT_STREAM_SETTING
  }
}

export function normalizeOnAirSelectStreamSetting({
  saved,
  candidates,
}: {
  saved: OnAirSelectStreamSetting
  candidates: readonly LiveStreamCandidate[]
}): OnAirSelectStreamSetting {
  const selectedCandidate =
    candidates.find((candidate) => candidate.type === saved.type) ?? candidates[0]

  if (selectedCandidate === undefined) {
    return {
      ...saved,
      type: DEFAULT_SELECT_STREAM_SETTING.type,
      mode: 0,
    }
  }

  return {
    ...saved,
    type: selectedCandidate.type,
    mode: normalizeMode(saved.mode, selectedCandidate.modes.length),
  }
}

export function writeOnAirSelectStreamSetting(
  storage: Storage | undefined,
  setting: OnAirSelectStreamSetting,
): void {
  storage?.setItem(ONAIR_SELECT_STREAM_STORAGE_KEY, JSON.stringify(setting))
}

export function buildLiveM2TSPlaylistUrl({
  channelId,
  mode,
  basePath = './api',
}: {
  channelId: number
  mode: number
  basePath?: string
}): string {
  return `${basePath.replace(/\/$/, '')}/streams/live/${channelId}/m2ts/playlist?mode=${mode}`
}

export function buildLiveM2TSUrlSchemeUrl({
  channelId,
  mode,
  browserHref,
  template,
  basePath = './api',
}: {
  channelId: number
  mode: number
  browserHref: string
  template: string | null | undefined
  basePath?: string
}): string | null {
  if (template === undefined || template === null || template.trim() === '') {
    return null
  }

  const browserUrl = new URL(browserHref)
  const subDirectory = browserUrl.pathname.replace(/\/[^/]*$/, '')
  const apiPath = basePath.replace(/^\.\//, '/').replace(/\/$/, '')
  const streamPath = `${subDirectory}${apiPath}/streams/live/${channelId}/m2ts?mode=${mode}`
  let address = `${browserUrl.host}${streamPath}`

  if (template.includes('vlc-x-callback')) {
    address = encodeURIComponent(address)
  }

  return template
    .replace(/PROTOCOL/g, browserUrl.protocol.replace(':', ''))
    .replace(/ADDRESS/g, address)
}

export function resolveLiveM2TSUrlSchemeTemplate({
  savedTemplate,
  serverUrlScheme,
  platform,
}: {
  savedTemplate: string | null
  serverUrlScheme?: ServerConfigNavigationState['urlscheme']
  platform: URLSchemePlatform | null
}): string | null {
  if (savedTemplate !== null && savedTemplate.trim() !== '') {
    return savedTemplate
  }

  return platform === null ? null : (serverUrlScheme?.m2ts?.[platform] ?? null)
}
