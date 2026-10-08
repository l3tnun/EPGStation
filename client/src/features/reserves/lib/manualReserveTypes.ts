import { z } from 'zod'

export const MANUAL_RESERVE_ADD_SUCCESS_MESSAGE = '予約を追加しました。'
export const MANUAL_RESERVE_ADD_FAILURE_MESSAGE = '予約の追加に失敗しました。'
export const MANUAL_RESERVE_UPDATE_SUCCESS_MESSAGE = '予約を更新しました。'
export const MANUAL_RESERVE_UPDATE_FAILURE_MESSAGE = '予約の更新に失敗しました。'
export const MANUAL_RESERVE_FETCH_FAILURE_MESSAGE = '予約情報取得に失敗'
export const MANUAL_PROGRAM_FETCH_FAILURE_MESSAGE = '番組情報取得に失敗'
export const MANUAL_RESERVE_SUCCESS_BACK_DELAY_MS = 800
export const MANUAL_RESERVE_OPEN_OPTION_PANELS = [0, 1, 2, 3, 6] as const
export const MAX_VALID_DATE_TIMESTAMP = 8_640_000_000_000_000

export type ManualReserveMode =
  { kind: 'add' } | { kind: 'program'; programId: number } | { kind: 'edit'; reserveId: number }

export interface ManualTimeSpecifiedOption {
  name: string | null
  channelId: number | null
  startAt: number | null
  endAt: number | null
}

export interface ManualReserveOption {
  allowEndLack: boolean
}

export interface ManualSaveOption {
  parentDirectoryName?: string | null
  directory?: string | null
  recordedFormat?: string | null
}

export interface ManualEncodeOption {
  mode1?: string | null
  encodeParentDirectoryName1?: string | null
  directory1?: string | null
  mode2?: string | null
  encodeParentDirectoryName2?: string | null
  directory2?: string | null
  mode3?: string | null
  encodeParentDirectoryName3?: string | null
  directory3?: string | null
  isDeleteOriginalAfterEncode: boolean
}

export interface ManualReservePageInfo {
  isTimeSpecification: boolean
  timeSpecifiedOption: ManualTimeSpecifiedOption
  reserveOption: ManualReserveOption
  saveOption?: ManualSaveOption
  encodeOption: ManualEncodeOption
}

export interface ManualReservePayload {
  allowEndLack: boolean
  programId?: number
  timeSpecifiedOption?: {
    name: string
    channelId: number
    startAt: number
    endAt: number
  }
  saveOption?: Record<string, string>
  encodeOption?: Record<string, string | boolean>
}

export type ManualReservePayloadResult =
  | { ok: true; value: ManualReservePayload }
  | { ok: false; error: 'manual-reserve-invalid'; message: string }

const manualTimestampSchema = z
  .number()
  .refine(Number.isSafeInteger)
  .refine((value) => Math.abs(value) <= MAX_VALID_DATE_TIMESTAMP)

export const manualTimeSpecifiedOptionSchema = z
  .object({
    name: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(1)),
    channelId: z
      .number()
      .refine(Number.isSafeInteger)
      .refine((value) => value >= 0),
    startAt: manualTimestampSchema,
    endAt: manualTimestampSchema,
  })
  .refine((value) => value.endAt >= value.startAt, {
    path: ['endAt'],
  })
