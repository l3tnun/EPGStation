import { SEND_VIDEO_FILE_SELECT_HOST_SETTING_STORAGE_KEY } from './constants'

export interface AddEncodeSetting {
  encodeMode: string | null
  parentDirectory: string | null
  isSaveSameDirectory: boolean
  removeOriginal: boolean
}

export interface SendVideoFileSelectHostSetting {
  hostName: string | null
}

export interface RecordedLocalStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export const ADD_ENCODE_SETTING_STORAGE_KEY = 'AddEncodeSeting'

export const DEFAULT_ADD_ENCODE_SETTING: AddEncodeSetting = {
  encodeMode: null,
  parentDirectory: null,
  isSaveSameDirectory: false,
  removeOriginal: false,
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function readAddEncodeSetting(storage: RecordedLocalStorageLike): AddEncodeSetting {
  try {
    const raw = storage.getItem(ADD_ENCODE_SETTING_STORAGE_KEY)
    const parsed = raw === null ? null : JSON.parse(raw)

    if (!isRecord(parsed)) {
      return { ...DEFAULT_ADD_ENCODE_SETTING }
    }

    return {
      encodeMode:
        typeof parsed.encodeMode === 'string' || parsed.encodeMode === null
          ? parsed.encodeMode
          : null,
      parentDirectory:
        typeof parsed.parentDirectory === 'string' || parsed.parentDirectory === null
          ? parsed.parentDirectory
          : null,
      isSaveSameDirectory:
        typeof parsed.isSaveSameDirectory === 'boolean'
          ? parsed.isSaveSameDirectory
          : DEFAULT_ADD_ENCODE_SETTING.isSaveSameDirectory,
      removeOriginal:
        typeof parsed.removeOriginal === 'boolean'
          ? parsed.removeOriginal
          : DEFAULT_ADD_ENCODE_SETTING.removeOriginal,
    }
  } catch {
    return { ...DEFAULT_ADD_ENCODE_SETTING }
  }
}

export function writeAddEncodeSetting(
  storage: RecordedLocalStorageLike,
  setting: AddEncodeSetting,
): void {
  storage.setItem(ADD_ENCODE_SETTING_STORAGE_KEY, JSON.stringify(setting))
}

export function readSendVideoFileSelectHostSetting(
  storage: RecordedLocalStorageLike,
): SendVideoFileSelectHostSetting {
  try {
    const raw = storage.getItem(SEND_VIDEO_FILE_SELECT_HOST_SETTING_STORAGE_KEY)
    const parsed = raw === null ? null : JSON.parse(raw)

    if (!isRecord(parsed)) {
      return { hostName: null }
    }

    return {
      hostName:
        typeof parsed.hostName === 'string' || parsed.hostName === null ? parsed.hostName : null,
    }
  } catch {
    return { hostName: null }
  }
}

export function resolveKodiHostName({
  storedHostName,
  hosts,
}: {
  storedHostName?: string | null
  hosts: readonly string[]
}): string | null {
  if (storedHostName !== undefined && storedHostName !== null && hosts.includes(storedHostName)) {
    return storedHostName
  }

  return hosts[0] ?? null
}

export function writeSendVideoFileSelectHostSetting(
  storage: RecordedLocalStorageLike,
  setting: SendVideoFileSelectHostSetting,
): void {
  storage.setItem(SEND_VIDEO_FILE_SELECT_HOST_SETTING_STORAGE_KEY, JSON.stringify(setting))
}
