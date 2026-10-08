import { buildReserveEndpointUrl } from './reserveEndpoint'
import {
  MANUAL_RESERVE_ADD_FAILURE_MESSAGE,
  manualTimeSpecifiedOptionSchema,
  type ManualEncodeOption,
  type ManualReserveMode,
  type ManualReserveOption,
  type ManualReservePageInfo,
  type ManualReservePayload,
  type ManualReservePayloadResult,
  type ManualSaveOption,
  type ManualTimeSpecifiedOption,
} from './manualReserveTypes'

function parseManualId(value: string | null): number | null {
  if (value === null || value === '') {
    return null
  }

  const parsed = Number(value)

  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null
}

export function parseManualReserveMode(search: string): ManualReserveMode {
  const parameters = new URLSearchParams(search)
  const reserveId = parseManualId(parameters.get('reserveId'))

  if (reserveId !== null) {
    return {
      kind: 'edit',
      reserveId,
    }
  }

  const programId = parseManualId(parameters.get('programId'))

  if (programId !== null) {
    return {
      kind: 'program',
      programId,
    }
  }

  return { kind: 'add' }
}

export function buildManualReserveDetailRequestUrl({
  reserveId,
  isHalfWidth,
  basePath = './api',
}: {
  reserveId: number
  isHalfWidth: boolean
  basePath?: string
}): string {
  const parameters = new URLSearchParams()
  parameters.set('isHalfWidth', String(isHalfWidth))

  return buildReserveEndpointUrl(basePath, `/reserves/${reserveId}`, parameters)
}

export function buildManualProgramDetailRequestUrl({
  programId,
  isHalfWidth,
  basePath = './api',
}: {
  programId: number
  isHalfWidth: boolean
  basePath?: string
}): string {
  const parameters = new URLSearchParams()
  parameters.set('isHalfWidth', String(isHalfWidth))

  return buildReserveEndpointUrl(basePath, `/schedules/detail/${programId}`, parameters)
}

function appendStringOption(
  target: Record<string, string>,
  key: string,
  value: string | null | undefined,
): void {
  if (value !== null && value !== undefined) {
    target[key] = value
  }
}

function buildManualSavePayload(
  saveOption: ManualSaveOption | undefined,
): Record<string, string> | undefined {
  if (saveOption === undefined) {
    return undefined
  }

  const payload: Record<string, string> = {}
  appendStringOption(payload, 'parentDirectoryName', saveOption.parentDirectoryName)
  appendStringOption(payload, 'directory', saveOption.directory)
  appendStringOption(payload, 'recordedFormat', saveOption.recordedFormat)

  return payload
}

function buildManualEncodePayload(
  encodeOption: ManualEncodeOption | undefined,
): Record<string, string | boolean> | undefined {
  if (encodeOption === undefined) {
    return undefined
  }

  const payload: Record<string, string | boolean> = {}
  const appendMode = (
    modeKey: 'mode1' | 'mode2' | 'mode3',
    parentKey:
      'encodeParentDirectoryName1' | 'encodeParentDirectoryName2' | 'encodeParentDirectoryName3',
    directoryKey: 'directory1' | 'directory2' | 'directory3',
  ) => {
    const mode = encodeOption[modeKey]
    if (mode === null || mode === undefined) {
      return
    }

    payload[modeKey] = mode
    appendStringOption(payload as Record<string, string>, parentKey, encodeOption[parentKey])
    appendStringOption(payload as Record<string, string>, directoryKey, encodeOption[directoryKey])
  }

  appendMode('mode1', 'encodeParentDirectoryName1', 'directory1')
  appendMode('mode2', 'encodeParentDirectoryName2', 'directory2')
  appendMode('mode3', 'encodeParentDirectoryName3', 'directory3')

  if (Object.keys(payload).length === 0) {
    return undefined
  }

  payload.isDeleteOriginalAfterEncode = encodeOption.isDeleteOriginalAfterEncode

  return payload
}

function isValidManualTimeSpecifiedOption(option: ManualTimeSpecifiedOption): option is {
  name: string
  channelId: number
  startAt: number
  endAt: number
} {
  return manualTimeSpecifiedOptionSchema.safeParse(option).success
}
function parseManualTimeSpecifiedOption(option: ManualTimeSpecifiedOption) {
  return manualTimeSpecifiedOptionSchema.safeParse(option)
}

export function canSaveManualReserveAdd({
  mode,
  isTimeSpecification,
  timeSpecifiedOption,
}: {
  mode: ManualReserveMode
  isTimeSpecification: boolean
  timeSpecifiedOption: ManualTimeSpecifiedOption
}): boolean {
  if (isTimeSpecification) {
    return isValidManualTimeSpecifiedOption(timeSpecifiedOption)
  }

  return mode.kind === 'program'
}

export function buildManualReserveAddPayload({
  mode,
  isTimeSpecification,
  timeSpecifiedOption,
  reserveOption,
  saveOption,
  encodeOption,
}: {
  mode: ManualReserveMode
  isTimeSpecification: boolean
  timeSpecifiedOption: ManualTimeSpecifiedOption
  reserveOption: ManualReserveOption
  saveOption: ManualSaveOption | undefined
  encodeOption: ManualEncodeOption | undefined
}): ManualReservePayloadResult {
  const parsedTimeSpecifiedOption = isTimeSpecification
    ? parseManualTimeSpecifiedOption(timeSpecifiedOption)
    : null

  if (
    isTimeSpecification
      ? parsedTimeSpecifiedOption?.success !== true
      : !canSaveManualReserveAdd({ mode, isTimeSpecification, timeSpecifiedOption })
  ) {
    return {
      ok: false,
      error: 'manual-reserve-invalid',
      message: MANUAL_RESERVE_ADD_FAILURE_MESSAGE,
    }
  }

  const value: ManualReservePayload = {
    allowEndLack: reserveOption.allowEndLack,
  }

  if (isTimeSpecification && parsedTimeSpecifiedOption?.success === true) {
    value.timeSpecifiedOption = {
      name: parsedTimeSpecifiedOption.data.name,
      channelId: parsedTimeSpecifiedOption.data.channelId,
      startAt: parsedTimeSpecifiedOption.data.startAt,
      endAt: parsedTimeSpecifiedOption.data.endAt,
    }
  } else {
    // Reaching this branch with isTimeSpecification === false implies mode.kind === 'program':
    // the guard above already returns a failure result via canSaveManualReserveAdd otherwise.
    value.programId = (mode as { kind: 'program'; programId: number }).programId
  }
  const savePayload = buildManualSavePayload(saveOption)
  if (savePayload !== undefined) {
    value.saveOption = savePayload
  }

  const encodePayload = buildManualEncodePayload(encodeOption)
  if (encodePayload !== undefined) {
    value.encodeOption = encodePayload
  }

  return { ok: true, value }
}

export function buildManualReserveEditPayload({
  reserveOption,
  saveOption,
  encodeOption,
}: {
  reserveOption: ManualReserveOption
  saveOption: ManualSaveOption | undefined
  encodeOption: ManualEncodeOption | undefined
}): ManualReservePayload {
  const value: ManualReservePayload = {
    allowEndLack: reserveOption.allowEndLack,
  }
  const savePayload = buildManualSavePayload(saveOption)
  if (savePayload !== undefined) {
    value.saveOption = savePayload
  }

  const encodePayload = buildManualEncodePayload(encodeOption)
  if (encodePayload !== undefined) {
    value.encodeOption = encodePayload
  }

  return value
}

export function resolveManualReservePageInfoForRoute({
  mode,
  shouldRestoreHistory,
  pageInfo,
}: {
  mode: ManualReserveMode
  shouldRestoreHistory: boolean
  pageInfo: ManualReservePageInfo | null
}): ManualReservePageInfo | null {
  if (mode.kind !== 'program' || !shouldRestoreHistory) {
    return null
  }

  return pageInfo
}

export function shouldSaveManualReservePageInfo({ mode }: { mode: ManualReserveMode }): boolean {
  return mode.kind !== 'edit'
}
