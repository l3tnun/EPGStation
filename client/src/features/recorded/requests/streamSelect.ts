import type { LiveStreamConfig, RecordedStreamFileConfig } from '@/app/serverApi'
import {
  RECORDED_INVALID_HANDOFF_ID_MESSAGE,
  RECORDED_INVALID_STREAM_SETTING_MESSAGE,
  RECORDED_SELECT_STREAM_SETTING_STORAGE_KEY,
} from './constants'
import { isRecord } from './settingsStorage'
import type { RecordedLocalStorageLike } from './settingsStorage'

export type RecordedSelectStreamType = 'WebM' | 'MP4' | 'HLS'

export interface RecordedStreamCandidate {
  type: RecordedSelectStreamType
  modes: readonly string[]
}

export interface RecordedSelectStreamSetting {
  type: RecordedSelectStreamType
  mode: number
}

const DEFAULT_RECORDED_SELECT_STREAM_SETTING: RecordedSelectStreamSetting = {
  type: 'WebM',
  mode: 0,
}

const RECORDED_STREAM_TYPE_QUERY: Record<RecordedSelectStreamType, 'webm' | 'mp4' | 'hls'> = {
  WebM: 'webm',
  MP4: 'mp4',
  HLS: 'hls',
}

function isRecordedSelectStreamType(value: unknown): value is RecordedSelectStreamType {
  return value === 'WebM' || value === 'MP4' || value === 'HLS'
}

function appendRecordedStreamCandidate(
  candidates: RecordedStreamCandidate[],
  type: RecordedSelectStreamType,
  modes: readonly string[] | undefined,
): void {
  if (modes !== undefined && modes.length > 0) {
    candidates.push({ type, modes })
  }
}

function normalizeRecordedStreamMode(mode: unknown, maxLength: number): number {
  if (typeof mode !== 'number' || !Number.isSafeInteger(mode) || mode < 0 || mode >= maxLength) {
    return 0
  }

  return mode
}

function resolveRecordedStreamFileConfig({
  streamConfig,
  fileType,
}: {
  streamConfig?: LiveStreamConfig
  fileType?: string
}): RecordedStreamFileConfig | undefined {
  if (fileType !== 'ts' && fileType !== 'encoded') {
    return undefined
  }

  return streamConfig?.recorded?.[fileType]
}

export function resolveRecordedStreamCandidates({
  streamConfig,
  fileType,
}: {
  streamConfig?: LiveStreamConfig
  fileType?: string
}): RecordedStreamCandidate[] {
  const config = resolveRecordedStreamFileConfig({ streamConfig, fileType })
  const candidates: RecordedStreamCandidate[] = []

  appendRecordedStreamCandidate(candidates, 'WebM', config?.webm)
  appendRecordedStreamCandidate(candidates, 'MP4', config?.mp4)
  appendRecordedStreamCandidate(candidates, 'HLS', config?.hls)

  return candidates
}

export function readRecordedSelectStreamSetting(
  storage: RecordedLocalStorageLike | undefined,
): RecordedSelectStreamSetting {
  if (storage === undefined) {
    return { ...DEFAULT_RECORDED_SELECT_STREAM_SETTING }
  }

  try {
    const raw = JSON.parse(storage.getItem(RECORDED_SELECT_STREAM_SETTING_STORAGE_KEY) ?? 'null')
    if (!isRecord(raw) || !isRecordedSelectStreamType(raw.type)) {
      return { ...DEFAULT_RECORDED_SELECT_STREAM_SETTING }
    }

    return {
      type: raw.type,
      mode: typeof raw.mode === 'number' && Number.isSafeInteger(raw.mode) ? raw.mode : 0,
    }
  } catch {
    return { ...DEFAULT_RECORDED_SELECT_STREAM_SETTING }
  }
}

export function normalizeRecordedSelectStreamSetting({
  saved,
  candidates,
}: {
  saved: RecordedSelectStreamSetting
  candidates: readonly RecordedStreamCandidate[]
}): RecordedSelectStreamSetting {
  const selectedCandidate =
    candidates.find((candidate) => candidate.type === saved.type) ?? candidates[0]

  if (selectedCandidate === undefined) {
    return {
      ...DEFAULT_RECORDED_SELECT_STREAM_SETTING,
    }
  }

  return {
    type: selectedCandidate.type,
    mode: normalizeRecordedStreamMode(saved.mode, selectedCandidate.modes.length),
  }
}

export function writeRecordedSelectStreamSetting(
  storage: RecordedLocalStorageLike | undefined,
  setting: RecordedSelectStreamSetting,
): void {
  storage?.setItem(RECORDED_SELECT_STREAM_SETTING_STORAGE_KEY, JSON.stringify(setting))
}

export function buildRecordedStreamingRoute({
  recordedId,
  videoFileId,
  fileType,
  selection,
}: {
  recordedId?: number
  videoFileId?: number
  fileType?: string
  selection: RecordedSelectStreamSetting | null
}):
  | {
      ok: true
      to: string
    }
  | {
      ok: false
      message: string
    } {
  if (recordedId === undefined || videoFileId === undefined) {
    return {
      ok: false,
      message: RECORDED_INVALID_HANDOFF_ID_MESSAGE,
    }
  }

  if (
    selection === null ||
    !isRecordedSelectStreamType(selection.type) ||
    !Number.isSafeInteger(selection.mode) ||
    selection.mode < 0 ||
    (fileType !== 'ts' && fileType !== 'encoded')
  ) {
    return {
      ok: false,
      message: RECORDED_INVALID_STREAM_SETTING_MESSAGE,
    }
  }

  const parameters = new URLSearchParams()
  parameters.set('recordedId', String(recordedId))
  parameters.set('streamingType', RECORDED_STREAM_TYPE_QUERY[selection.type])
  parameters.set('mode', String(selection.mode))
  parameters.set('fileType', fileType)

  return {
    ok: true,
    to: `/recorded/streaming/${videoFileId}?${parameters.toString()}`,
  }
}
