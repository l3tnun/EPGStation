import type { SettingsConsumerValue } from '@/shared/settings'
import type {
  GuideFetchRequestSet,
  GuideProgramAddReservePayload,
  GuideProgramDialogSearchSource,
  GuideRequestUrls,
} from './guideRequestTypes'

export function buildEndpointUrl(
  basePath: string,
  endpointPath: string,
  parameters: URLSearchParams,
): string {
  const endpoint = `${basePath.replace(/\/$/, '')}${endpointPath}`
  const query = parameters.toString()

  return query === '' ? endpoint : `${endpoint}?${query}`
}

export function buildPath(pathname: string, parameters: URLSearchParams): string {
  const query = parameters.toString()

  return query === '' ? pathname : `${pathname}?${query}`
}

export function appendPathNumber(
  parameters: URLSearchParams,
  key: string,
  value: number | undefined,
): void {
  if (value !== undefined && Number.isSafeInteger(value) && value >= 0) {
    parameters.set(key, String(value))
  }
}

export function createGuideProgramSearchKeyword(name: string | undefined): string {
  const outTitle = (name ?? '')
    .replace(/\[.+?\]/g, ' ')
    .replace(/【.+?】/g, ' ')
    .replace(/\(.\)/g, ' ')
    .replace(/ +/g, ' ')
    .trim()
  const delimiter = outTitle.includes(' #') ? ' #' : outTitle.includes('「') ? '「' : ''
  const keyword = delimiter === '' ? outTitle : outTitle.split(delimiter)[0]

  return keyword === '' ? outTitle : keyword
}

export function firstGuideProgramGenre(program: GuideProgramDialogSearchSource):
  | {
      genre: number
      subGenre?: number
    }
  | undefined {
  if (program.genre1 !== undefined) {
    return { genre: program.genre1, subGenre: program.subGenre1 }
  }
  if (program.genre2 !== undefined) {
    return { genre: program.genre2, subGenre: program.subGenre2 }
  }
  if (program.genre3 !== undefined) {
    return { genre: program.genre3, subGenre: program.subGenre3 }
  }

  return undefined
}

export function appendBooleanFilter(
  parameters: URLSearchParams,
  key: string,
  value: boolean,
): void {
  if (value) {
    parameters.set(key, 'true')
  }
}

export function buildGuideRequestUrls({
  requestSet,
  basePath = './api',
}: {
  requestSet: GuideFetchRequestSet
  basePath?: string
}): GuideRequestUrls {
  const scheduleParameters = new URLSearchParams()
  scheduleParameters.set('startAt', String(requestSet.schedule.startAt))

  if (requestSet.schedule.mode === 'normal') {
    scheduleParameters.set('endAt', String(requestSet.schedule.endAt))
    scheduleParameters.set('isHalfWidth', String(requestSet.schedule.isHalfWidth))
    appendBooleanFilter(scheduleParameters, 'isFree', requestSet.schedule.isFree)
    scheduleParameters.set('GR', String(requestSet.schedule.GR))
    scheduleParameters.set('BS', String(requestSet.schedule.BS))
    scheduleParameters.set('CS', String(requestSet.schedule.CS))
    scheduleParameters.set('SKY', String(requestSet.schedule.SKY))
    scheduleParameters.set('BS4K', String(requestSet.schedule.BS4K))
  } else {
    scheduleParameters.set('days', String(requestSet.schedule.days))
    scheduleParameters.set('isHalfWidth', String(requestSet.schedule.isHalfWidth))
    appendBooleanFilter(scheduleParameters, 'isFree', requestSet.schedule.isFree)
  }

  const reserveParameters = new URLSearchParams()
  reserveParameters.set('startAt', String(requestSet.reserveIndex.startAt))
  reserveParameters.set('endAt', String(requestSet.reserveIndex.endAt))

  return {
    schedule: buildEndpointUrl(
      basePath,
      requestSet.schedule.mode === 'normal'
        ? '/schedules'
        : `/schedules/${requestSet.schedule.channelId}`,
      scheduleParameters,
    ),
    reserveIndex: buildEndpointUrl(basePath, '/reserves/lists', reserveParameters),
  }
}

export function buildGuideProgramSearchPath({
  program,
  settings,
}: {
  program: GuideProgramDialogSearchSource
  settings: SettingsConsumerValue
}): string {
  const parameters = new URLSearchParams()
  const keyword = createGuideProgramSearchKeyword(program.name)

  if (keyword !== '') {
    parameters.set('keyword', keyword)
  }
  if (settings.isIncludeChannelIdWhenSearching) {
    appendPathNumber(parameters, 'channelId', program.channelId)
  }
  if (settings.isIncludeGenreWhenSearching) {
    const genre = firstGuideProgramGenre(program)

    appendPathNumber(parameters, 'genre', genre?.genre)
    appendPathNumber(parameters, 'subGenre', genre?.subGenre)
  }

  return buildPath('/search', parameters)
}

export function buildGuideProgramAddReservePayload({
  programId,
  encode,
  isDeleteOriginalAfterEncode,
}: {
  programId: number
  encode: string
  isDeleteOriginalAfterEncode: boolean
}): GuideProgramAddReservePayload {
  const payload: GuideProgramAddReservePayload = {
    programId,
    allowEndLack: true,
  }

  if (encode !== 'TS') {
    payload.encodeOption = {
      mode1: encode,
      isDeleteOriginalAfterEncode,
    }
  }

  return payload
}
