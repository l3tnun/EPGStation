export type RecordedBulkDeleteOption = 'All' | 'OnlyOriginalFile' | 'OnlyEncodedFile'

export type RecordedBulkDeleteActionResult =
  { status: 'zero-selection' } | { status: 'success' } | { status: 'failure' }

export interface RecordedBulkDeleteApi {
  deleteRecorded(recordedId: number): Promise<{ ok: boolean }>
  deleteVideoFile(videoFileId: number): Promise<{ ok: boolean }>
}

export interface RecordedBulkDeleteItem {
  id?: number
  videoFiles?: readonly {
    id?: number
    type?: string
  }[]
}

// Source: v2 5cf2ea383 client/src/model/state/recorded/RecordedState.ts:176-212
// (multiplueDeletion). v2 treats all three options (All / OnlyOriginalFile / OnlyEncodedFile)
// identically: it always deletes by video file id via DELETE /videos/:videoFileId, never by
// recorded item id. `All` simply means "every video file of the item is a candidate", not
// "call the item-level delete endpoint".
function selectRecordedBulkDeleteFiles(
  item: RecordedBulkDeleteItem,
  option: RecordedBulkDeleteOption,
) {
  return (item.videoFiles ?? []).filter((file) => {
    if (option === 'All') {
      return true
    }
    if (option === 'OnlyOriginalFile') {
      return file.type === 'ts'
    }

    return file.type === 'encoded'
  })
}

export async function executeRecordedBulkDeleteAction({
  apiRepository,
  items,
  option,
}: {
  apiRepository: RecordedBulkDeleteApi
  items: readonly RecordedBulkDeleteItem[]
  option: RecordedBulkDeleteOption
}): Promise<RecordedBulkDeleteActionResult> {
  if (items.length === 0) {
    return { status: 'zero-selection' }
  }

  // Source: v2 5cf2ea383 client/src/model/state/recorded/RecordedState.ts:181-193
  // Items without videoFiles are skipped entirely (not treated as a failure), and the target
  // video file ids are collected across every item up front before any delete is attempted.
  const videoFileIds = items.flatMap((item) =>
    selectRecordedBulkDeleteFiles(item, option).flatMap((file) =>
      file.id === undefined ? [] : [file.id],
    ),
  )

  // Source: v2 5cf2ea383 client/src/model/state/recorded/RecordedState.ts:199-211
  // Every collected video file is attempted even after an earlier one fails (caught, not
  // rethrown), and only the aggregate hasError flag after the full pass determines the result.
  let hasFailure = false
  for (const videoFileId of videoFileIds) {
    const result = await apiRepository.deleteVideoFile(videoFileId)
    if (!result.ok) {
      hasFailure = true
    }
  }

  return hasFailure ? { status: 'failure' } : { status: 'success' }
}
