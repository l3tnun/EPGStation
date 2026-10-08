export type RecordedUploadVideoFileType = 'ts' | 'encoded'

export interface RecordedUploadVideoBlockState {
  id: number
  viewName: string | null
  fileType?: RecordedUploadVideoFileType
  parentDirectoryName: string
  subDirectory: string | null
  file: File | null
}

export interface RecordedUploadFormState {
  channelId: number | null
  genre: number | null
  subGenre: number | null
  ruleId: number | null
  startAt: number | null
  duration: number | null
  name: string | null
  description: string | null
  extended: string | null
  videoBlocks: RecordedUploadVideoBlockState[]
}

export interface RecordedUploadMetadataBody {
  channelId: number
  startAt: number
  endAt: number
  name: string
  ruleId?: number
  description?: string
  extended?: string
  genre1?: number
  subGenre1?: number
}

export interface RecordedUploadVideoRequest {
  recordedId: number
  parentDirectoryName: string
  subDirectory?: string
  viewName: string
  fileType: RecordedUploadVideoFileType
  file: File
}

function appendMetadataString(
  target: RecordedUploadMetadataBody,
  key: 'description' | 'extended',
  value: string | null | undefined,
): void {
  if (typeof value === 'string' && value.trim() !== '') {
    target[key] = value
  }
}

export function createRecordedUploadVideoBlock({
  id,
  recordedDirectories,
}: {
  id: number
  recordedDirectories: readonly string[]
}): RecordedUploadVideoBlockState {
  return {
    id,
    parentDirectoryName: recordedDirectories[0] ?? '',
    subDirectory: null,
    viewName: null,
    fileType: undefined,
    file: null,
  }
}

export function createInitialRecordedUploadFormState(
  recordedDirectories: readonly string[],
): RecordedUploadFormState {
  return {
    channelId: null,
    genre: null,
    subGenre: null,
    ruleId: null,
    startAt: null,
    duration: null,
    name: null,
    description: null,
    extended: null,
    videoBlocks: [createRecordedUploadVideoBlock({ id: 0, recordedDirectories })],
  }
}

export function validateRecordedUploadForm(formState: RecordedUploadFormState): boolean {
  const isEmptyVideoBlock = (block: RecordedUploadVideoBlockState): boolean =>
    block.viewName === null && block.file === null
  const isCompleteVideoBlock = (block: RecordedUploadVideoBlockState): boolean =>
    block.viewName !== null &&
    block.viewName.trim() !== '' &&
    block.fileType !== undefined &&
    block.parentDirectoryName.trim() !== '' &&
    block.file !== null
  const hasCompleteVideoBlock = formState.videoBlocks.some(isCompleteVideoBlock)
  const hasOnlyEmptyOrCompleteVideoBlocks = formState.videoBlocks.every(
    (block) => isEmptyVideoBlock(block) || isCompleteVideoBlock(block),
  )

  return (
    formState.channelId !== null &&
    formState.startAt !== null &&
    formState.duration !== null &&
    formState.duration > 0 &&
    formState.name !== null &&
    formState.name.trim() !== '' &&
    hasCompleteVideoBlock &&
    hasOnlyEmptyOrCompleteVideoBlocks
  )
}

export function buildRecordedUploadMetadataBody(
  formState: RecordedUploadFormState,
): RecordedUploadMetadataBody {
  if (
    formState.channelId === null ||
    formState.startAt === null ||
    formState.duration === null ||
    formState.name === null ||
    formState.name.trim() === ''
  ) {
    throw new Error('Invalid recorded upload metadata state')
  }

  const body: RecordedUploadMetadataBody = {
    channelId: formState.channelId,
    startAt: formState.startAt,
    endAt: formState.startAt + formState.duration * 60 * 1000,
    name: formState.name,
  }

  if (formState.ruleId !== null) {
    body.ruleId = formState.ruleId
  }
  appendMetadataString(body, 'description', formState.description)
  appendMetadataString(body, 'extended', formState.extended)
  if (formState.genre !== null) {
    body.genre1 = formState.genre
  }
  if (formState.subGenre !== null) {
    body.subGenre1 = formState.subGenre
  }

  return body
}

export function buildRecordedUploadVideoFormData(request: RecordedUploadVideoRequest): FormData {
  const formData = new FormData()

  formData.append('recordedId', String(request.recordedId))
  formData.append('parentDirectoryName', request.parentDirectoryName)
  if (typeof request.subDirectory === 'string' && request.subDirectory.trim() !== '') {
    formData.append('subDirectory', request.subDirectory)
  }
  formData.append('viewName', request.viewName)
  formData.append('fileType', request.fileType)
  formData.append('file', request.file)

  return formData
}
