import { z } from 'zod'
import { SUB_GENRE_NAMES } from '@/features/search/rule/genreLabels'
import type { AppSelectOption } from '@/shared/AppSelect'
import type { RecordedSearchOptions } from '../../../recorded/recordedApi'
import type {
  RecordedUploadFormState,
  RecordedUploadVideoBlockState,
  RecordedUploadVideoRequest,
} from '../../../recorded/recordedRequests'

const REQUIRED_UPLOAD_SCHEMA = z.object({
  channelId: z.number(),
  startAt: z.number(),
  duration: z.number().positive(),
  name: z.string().trim().min(1),
})

export function nullableString(value: string): string | null {
  return value === '' ? null : value
}

export function valueFromNullableNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}

export function parseNullableNumber(value: string): number | null {
  if (value === '') {
    return null
  }

  const parsed = Number(value)

  return Number.isSafeInteger(parsed) ? parsed : null
}

export function parseDatetimeLocalValue(value: string): number | null {
  if (value === '') {
    return null
  }

  const parsed = new Date(value).getTime()

  return Number.isFinite(parsed) ? parsed : null
}

export function formatDatetimeLocalValue(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return ''
  }

  const date = new Date(value)
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${year}-${month}-${day}T${hours}:${minutes}`
}

export function createSubGenreItems(
  genre: number | null,
): readonly RecordedSearchOptions['genres'][number][] {
  if (genre === null) {
    return []
  }

  return Object.entries(SUB_GENRE_NAMES[genre] ?? {}).map(([id, name]) => ({
    id: Number(id),
    name,
  }))
}

function resolveChannelDisplayName(
  channel: RecordedSearchOptions['channels'][number],
  isHalfWidthDisplayed: boolean,
): string {
  return isHalfWidthDisplayed ? (channel.halfWidthName ?? channel.name) : channel.name
}

function removeRecordedSearchCountSuffix(label: string): string {
  return label.replace(/\(\d+\)$/u, '')
}

export function createUploadChannelOption(
  channel: RecordedSearchOptions['channels'][number],
  isHalfWidthDisplayed: boolean,
): AppSelectOption | null {
  const label = removeRecordedSearchCountSuffix(
    resolveChannelDisplayName(channel, isHalfWidthDisplayed),
  )

  if (/^\d+$/u.test(label)) {
    return null
  }

  return { value: channel.id, label }
}

export function createUploadGenreOption(
  genre: RecordedSearchOptions['genres'][number],
): AppSelectOption {
  return { value: genre.id, label: removeRecordedSearchCountSuffix(genre.name) }
}

export function createValidatedRequiredState(formState: RecordedUploadFormState) {
  return REQUIRED_UPLOAD_SCHEMA.safeParse({
    channelId: formState.channelId,
    startAt: formState.startAt,
    duration: formState.duration,
    name: formState.name,
  })
}

export function createValidatedVideoUploadRequests({
  recordedId,
  videoBlocks,
}: {
  recordedId: number
  videoBlocks: readonly RecordedUploadVideoBlockState[]
}): RecordedUploadVideoRequest[] {
  return videoBlocks.flatMap((block): RecordedUploadVideoRequest[] => {
    if (block.viewName === null && block.file === null) {
      return []
    }

    if (
      block.viewName === null ||
      block.viewName.trim() === '' ||
      block.fileType === undefined ||
      block.parentDirectoryName.trim() === '' ||
      block.file === null
    ) {
      return []
    }

    const request: RecordedUploadVideoRequest = {
      recordedId,
      parentDirectoryName: block.parentDirectoryName,
      viewName: block.viewName,
      fileType: block.fileType,
      file: block.file,
    }

    if (typeof block.subDirectory === 'string' && block.subDirectory.trim() !== '') {
      request.subDirectory = block.subDirectory
    }

    return [request]
  })
}
