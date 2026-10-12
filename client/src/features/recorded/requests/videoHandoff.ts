import type { SettingsConsumerValue } from '@/shared/settings'
import { replaceURLSchemePlaceholders, resolveURLSchemeTemplate } from '@/shared/settings/urlScheme'
import { RECORDED_INVALID_HANDOFF_ID_MESSAGE } from './constants'

export type VideoHandoffMode = 'view' | 'download'

export function buildVideoDownloadUrl({
  videoFileId,
  basePath = './api',
}: {
  videoFileId: number
  basePath?: string
}): string {
  return `${basePath.replace(/\/$/, '')}/videos/${videoFileId}?isDownload=true`
}

export function buildVideoPlaylistUrl({
  videoFileId,
  basePath = './api',
}: {
  videoFileId: number
  basePath?: string
}): string {
  return `${basePath.replace(/\/$/, '')}/videos/${videoFileId}/playlist`
}

function buildVideoViewUrl({
  videoFileId,
  basePath = './api',
}: {
  videoFileId: number
  basePath?: string
}): string {
  return `${basePath.replace(/\/$/, '')}/videos/${videoFileId}`
}
function buildRawVideoUrl({
  videoFileId,
  mode,
  basePath = './api',
}: {
  videoFileId: number
  mode: VideoHandoffMode
  basePath?: string
}): string {
  if (mode === 'download') {
    return buildVideoDownloadUrl({ videoFileId, basePath })
  }

  return buildVideoViewUrl({ videoFileId, basePath })
}

function buildUrlSchemeAddress({ origin, rawVideoUrl }: { origin: string; rawVideoUrl: string }) {
  const url = new URL(rawVideoUrl, origin)

  return `${url.host}${url.pathname}${url.search}${url.hash}`
}

export function buildVideoUrlSchemeHandoffUrl({
  shouldUseUrlScheme,
  urlScheme,
  videoFileId,
  filename,
  mode,
  origin,
  basePath = './api',
}: {
  shouldUseUrlScheme: boolean
  urlScheme?: string | null
  videoFileId: number
  filename?: string
  mode: VideoHandoffMode
  origin: string
  basePath?: string
}): string | null {
  if (!shouldUseUrlScheme || urlScheme === undefined || urlScheme === null || urlScheme === '') {
    return null
  }

  const originUrl = new URL(origin)
  const rawVideoUrl = buildRawVideoUrl({ videoFileId, mode, basePath })
  let address = buildUrlSchemeAddress({ origin, rawVideoUrl })

  if (urlScheme.includes('vlc-x-callback')) {
    address = encodeURIComponent(address)
  }

  return replaceURLSchemePlaceholders(urlScheme, {
    protocol: originUrl.protocol.replace(':', ''),
    address,
    filename: filename ?? '',
  })
}

export type RecordedHandoffVideoFileType = 'ts' | 'encoded'

export interface RecordedHandoffVideoFile {
  id?: number
  type?: string
  filename?: string
  name?: string
}

export type RecordedPlaybackHandoffTarget =
  | {
      ok: true
      kind: 'route'
      to: string
    }
  | {
      ok: true
      kind: 'href'
      href: string
    }
  | {
      ok: false
      message: string
    }

function buildBrowserRelativeApiUrl({
  browserHref,
  apiPath,
  basePath = './api',
}: {
  browserHref: string
  apiPath: string
  basePath?: string
}): string {
  const browserUrl = new URL(browserHref)
  const subDirectory = browserUrl.pathname.replace(/\/[^/]*$/, '')
  const normalizedBasePath = basePath.replace(/^\.\//, '/').replace(/\/$/, '')

  return `${subDirectory}${normalizedBasePath}${apiPath}`
}

function buildRecordedViewUrlSchemeUrl({
  videoFileId,
  filename,
  browserHref,
  template,
  basePath = './api',
}: {
  videoFileId: number
  filename?: string
  browserHref: string
  template: string | null | undefined
  basePath?: string
}): string | null {
  if (template === undefined || template === null || template.trim() === '') {
    return null
  }

  const browserUrl = new URL(browserHref)
  let address = `${browserUrl.host}${buildBrowserRelativeApiUrl({
    browserHref,
    apiPath: `/videos/${videoFileId}`,
    basePath,
  })}`

  if (template.includes('vlc-x-callback')) {
    address = encodeURIComponent(address)
  }

  return replaceURLSchemePlaceholders(template, {
    protocol: browserUrl.protocol.replace(':', ''),
    address,
    filename: filename ?? '',
  })
}

export function buildRecordedPlaybackHandoffTarget({
  recordedId,
  file,
  settings,
  browserHref,
  recordedViewUrlScheme,
}: {
  recordedId?: number
  file: RecordedHandoffVideoFile
  settings: SettingsConsumerValue
  browserHref: string
  recordedViewUrlScheme?: string | null
}): RecordedPlaybackHandoffTarget {
  if (recordedId === undefined || file.id === undefined) {
    return {
      ok: false,
      message: RECORDED_INVALID_HANDOFF_ID_MESSAGE,
    }
  }

  if (file.type === 'encoded' && settings.isPreferredPlayingOnWeb) {
    const parameters = new URLSearchParams()
    parameters.set('videoId', String(file.id))
    parameters.set('recordedId', String(recordedId))

    return {
      ok: true,
      kind: 'route',
      to: `/recorded/watch?${parameters.toString()}`,
    }
  }

  const viewTemplate =
    settings.shouldUseRecordedViewURLScheme === true && recordedViewUrlScheme !== null
      ? resolveURLSchemeTemplate(settings.recordedViewURLScheme, recordedViewUrlScheme ?? '')
      : settings.recordedViewURLScheme
  const urlScheme = buildRecordedViewUrlSchemeUrl({
    videoFileId: file.id,
    filename: file.filename ?? file.name,
    browserHref,
    template: settings.shouldUseRecordedViewURLScheme === true ? viewTemplate : null,
  })

  return {
    ok: true,
    kind: 'href',
    href: urlScheme ?? buildVideoPlaylistUrl({ videoFileId: file.id }),
  }
}
