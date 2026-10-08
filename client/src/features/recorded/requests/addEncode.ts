export interface AddEncodeRequestBodyInput {
  recordedId: number
  sourceVideoFileId: number
  mode: string
  removeOriginal: boolean
  isSaveSameDirectory: boolean
  parentDir?: string | null
  directory?: string | null
}

export interface AddEncodeRequestBody {
  recordedId: number
  sourceVideoFileId: number
  mode: string
  removeOriginal: boolean
  isSaveSameDirectory: boolean
  parentDir?: string
  directory?: string
}

export function buildAddEncodeRequestBody(input: AddEncodeRequestBodyInput): AddEncodeRequestBody {
  const body: AddEncodeRequestBody = {
    recordedId: input.recordedId,
    sourceVideoFileId: input.sourceVideoFileId,
    mode: input.mode,
    removeOriginal: input.removeOriginal,
    isSaveSameDirectory: input.isSaveSameDirectory,
  }

  if (!input.isSaveSameDirectory) {
    if (input.parentDir !== undefined && input.parentDir !== null && input.parentDir !== '') {
      body.parentDir = input.parentDir
    }
    if (input.directory !== undefined && input.directory !== null && input.directory !== '') {
      body.directory = input.directory
    }
  }

  return body
}

export function resolveAddEncodeParentDirectory({
  storedParentDirectory,
  recordedDirectories,
}: {
  storedParentDirectory?: string | null
  recordedDirectories: readonly string[]
}): string {
  if (
    storedParentDirectory !== undefined &&
    storedParentDirectory !== null &&
    recordedDirectories.includes(storedParentDirectory)
  ) {
    return storedParentDirectory
  }

  return recordedDirectories[0] ?? ''
}
