import type { GuideGenreVisibility } from './GuideGridRenderer'

const GUIDE_GENRE_SETTING_STORAGE_KEY = 'GuideGenreSetting'
const GUIDE_SIZE_SETTING_STORAGE_KEY = 'GuideSizeSetting'
const GUIDE_GENRE_IDS = Array.from({ length: 16 }, (_, index) => index)
const GUIDE_SIZE_FIELD_LIMITS = {
  channelHeight: { min: 10, max: 100, step: 10 },
  channelWidth: { min: 0, max: 600, step: 10 },
  channelFontsize: { min: 0.5, max: 40, step: 0.5 },
  timescaleHeight: { min: 10, max: 400, step: 10 },
  timescaleWidth: { min: 10, max: 100, step: 10 },
  timescaleFontsize: { min: 0.5, max: 40, step: 0.5 },
  programFontSize: { min: 0.5, max: 40, step: 0.5 },
} satisfies Record<string, { min: number; max: number; step: number }>

export interface GuideSizeValue {
  channelHeight: number
  channelWidth: number
  channelFontsize: number
  timescaleHeight: number
  timescaleWidth: number
  timescaleFontsize: number
  programFontSize: number
}

export interface GuideSizeSetting {
  tablet: GuideSizeValue
  mobile: GuideSizeValue
}

export const DEFAULT_GUIDE_SIZE_SETTING: GuideSizeSetting = {
  tablet: {
    channelHeight: 30,
    channelWidth: 140,
    channelFontsize: 14,
    timescaleHeight: 180,
    timescaleWidth: 30,
    timescaleFontsize: 16,
    programFontSize: 10,
  },
  mobile: {
    channelHeight: 20,
    channelWidth: 100,
    channelFontsize: 12,
    timescaleHeight: 120,
    timescaleWidth: 20,
    timescaleFontsize: 12,
    programFontSize: 7.5,
  },
}

export interface GuideStorageReader {
  getItem(key: string): string | null
}

export interface GuideStorageWriter extends GuideStorageReader {
  setItem(key: string, value: string): void
}

export function createDefaultGuideGenreVisibility(): GuideGenreVisibility {
  return Object.fromEntries(GUIDE_GENRE_IDS.map((genreId) => [genreId, true]))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function readGuideGenreVisibility(
  storage: GuideStorageReader | undefined,
): GuideGenreVisibility {
  const defaultVisibility = createDefaultGuideGenreVisibility()

  if (storage === undefined) {
    return defaultVisibility
  }

  try {
    const parsed = JSON.parse(storage.getItem(GUIDE_GENRE_SETTING_STORAGE_KEY) ?? 'null')

    if (!isRecord(parsed)) {
      return defaultVisibility
    }

    return Object.fromEntries(
      GUIDE_GENRE_IDS.map((genreId) => {
        const rawValue = parsed[String(genreId)]

        return [genreId, typeof rawValue === 'boolean' ? rawValue : true]
      }),
    )
  } catch {
    return defaultVisibility
  }
}

export function writeGuideGenreVisibility(
  storage: GuideStorageWriter | undefined,
  visibility: GuideGenreVisibility,
): void {
  if (storage === undefined) {
    return
  }

  const value = Object.fromEntries(
    GUIDE_GENRE_IDS.map((genreId) => [genreId, visibility[genreId] ?? true]),
  )
  storage.setItem(GUIDE_GENRE_SETTING_STORAGE_KEY, JSON.stringify(value))
}

export function isGuideGenreStorageKey(key: string | null): boolean {
  return key === GUIDE_GENRE_SETTING_STORAGE_KEY
}

function cloneGuideSizeSetting(setting: GuideSizeSetting): GuideSizeSetting {
  return {
    tablet: { ...setting.tablet },
    mobile: { ...setting.mobile },
  }
}

function normalizeNumber(
  value: unknown,
  fallback: number,
  limit: { min: number; max: number; step: number },
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  const clamped = Math.min(limit.max, Math.max(limit.min, value))
  const stepped = Math.round((clamped - limit.min) / limit.step) * limit.step + limit.min

  return Number(Math.min(limit.max, Math.max(limit.min, stepped)).toFixed(1))
}

function readSizeValue(raw: unknown, defaults: GuideSizeValue): GuideSizeValue {
  const source = isRecord(raw) ? raw : {}

  return {
    channelHeight: normalizeNumber(
      source.channelHeight,
      defaults.channelHeight,
      GUIDE_SIZE_FIELD_LIMITS.channelHeight,
    ),
    channelWidth: normalizeNumber(
      source.channelWidth,
      defaults.channelWidth,
      GUIDE_SIZE_FIELD_LIMITS.channelWidth,
    ),
    channelFontsize: normalizeNumber(
      source.channelFontsize,
      defaults.channelFontsize,
      GUIDE_SIZE_FIELD_LIMITS.channelFontsize,
    ),
    timescaleHeight: normalizeNumber(
      source.timescaleHeight,
      defaults.timescaleHeight,
      GUIDE_SIZE_FIELD_LIMITS.timescaleHeight,
    ),
    timescaleWidth: normalizeNumber(
      source.timescaleWidth,
      defaults.timescaleWidth,
      GUIDE_SIZE_FIELD_LIMITS.timescaleWidth,
    ),
    timescaleFontsize: normalizeNumber(
      source.timescaleFontsize,
      defaults.timescaleFontsize,
      GUIDE_SIZE_FIELD_LIMITS.timescaleFontsize,
    ),
    programFontSize: normalizeNumber(
      source.programFontSize,
      defaults.programFontSize,
      GUIDE_SIZE_FIELD_LIMITS.programFontSize,
    ),
  }
}

export function normalizeGuideSizeSetting(setting: GuideSizeSetting): GuideSizeSetting {
  return {
    tablet: readSizeValue(setting.tablet, DEFAULT_GUIDE_SIZE_SETTING.tablet),
    mobile: readSizeValue(setting.mobile, DEFAULT_GUIDE_SIZE_SETTING.mobile),
  }
}

export function readGuideSizeSetting(storage: GuideStorageReader | undefined): GuideSizeSetting {
  const defaults = DEFAULT_GUIDE_SIZE_SETTING

  if (storage === undefined) {
    return cloneGuideSizeSetting(defaults)
  }

  try {
    const parsed = JSON.parse(storage.getItem(GUIDE_SIZE_SETTING_STORAGE_KEY) ?? 'null')

    if (!isRecord(parsed)) {
      return cloneGuideSizeSetting(defaults)
    }

    return {
      tablet: readSizeValue(parsed.tablet, defaults.tablet),
      mobile: readSizeValue(parsed.mobile, defaults.mobile),
    }
  } catch {
    return cloneGuideSizeSetting(defaults)
  }
}

export function writeGuideSizeSetting(
  storage: GuideStorageWriter | undefined,
  setting: GuideSizeSetting,
): void {
  if (storage === undefined) {
    return
  }

  storage.setItem(
    GUIDE_SIZE_SETTING_STORAGE_KEY,
    JSON.stringify(normalizeGuideSizeSetting(setting)),
  )
}
