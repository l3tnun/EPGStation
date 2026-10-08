import { describe, expect, it } from 'vitest'
import {
  buildAddEncodeRequestBody,
  buildItemRecordedSearchPath,
  buildItemRuleSearchPath,
  buildRecordedSearchPath,
  createRecordedSearchKeyword,
  executeRecordedBulkDeleteAction,
  formatRecordedFileSize,
  readAddEncodeSetting,
  resolveAddEncodeParentDirectory,
  writeAddEncodeSetting,
  toggleVisibleRecordedSelection,
} from '@/features/recorded/recordedRequests'

describe('Recorded action request implementation edges', () => {
  it('builds search menu routes from non-empty conditions while preserving ruleId=0', () => {
    expect(
      buildRecordedSearchPath({
        keyword: '  alpha  ',
        ruleId: 0,
        channelId: undefined,
        genre: null,
        hasOriginalFile: false,
      }),
    ).toBe('/recorded?keyword=alpha&ruleId=0')
    expect(
      buildRecordedSearchPath({
        keyword: '',
        ruleId: null,
        channelId: 12,
        genre: 4,
        hasOriginalFile: true,
      }),
    ).toBe('/recorded?channelId=12&genre=4&hasOriginalFile=true')
  })

  it('builds item menu search routes from rule id or program keyword', () => {
    expect(buildItemRuleSearchPath({ ruleId: 77 })).toBe('/search?rule=77')
    expect(buildItemRecordedSearchPath({ ruleId: 77, name: 'Unused title' })).toBe(
      '/recorded?ruleId=77',
    )
    expect(
      buildItemRecordedSearchPath({
        name: '[Synthetic] Program title #01',
      }),
    ).toBe('/recorded?keyword=Program+title')
    expect(createRecordedSearchKeyword('Synthetic「Subtitle」 Extra')).toBe('Synthetic')
  })

  it('builds add encode request bodies and omits directory fields for same-directory saves', () => {
    expect(
      buildAddEncodeRequestBody({
        recordedId: 101,
        sourceVideoFileId: 201,
        mode: 'encoded-default',
        removeOriginal: true,
        isSaveSameDirectory: true,
        parentDir: 'root',
        directory: 'sub',
      }),
    ).toStrictEqual({
      recordedId: 101,
      sourceVideoFileId: 201,
      mode: 'encoded-default',
      removeOriginal: true,
      isSaveSameDirectory: true,
    })
    expect(
      buildAddEncodeRequestBody({
        recordedId: 101,
        sourceVideoFileId: 201,
        mode: 'encoded-default',
        removeOriginal: false,
        isSaveSameDirectory: false,
        parentDir: 'root',
        directory: 'sub',
      }),
    ).toStrictEqual({
      recordedId: 101,
      sourceVideoFileId: 201,
      mode: 'encoded-default',
      removeOriginal: false,
      isSaveSameDirectory: false,
      parentDir: 'root',
      directory: 'sub',
    })
  })

  it('resolves AddEncode parent directory from valid storage or first recorded config directory', () => {
    expect(
      resolveAddEncodeParentDirectory({
        storedParentDirectory: 'archive-root',
        recordedDirectories: ['archive-root', 'backup-root'],
      }),
    ).toBe('archive-root')
    expect(
      resolveAddEncodeParentDirectory({
        storedParentDirectory: 'stale-root',
        recordedDirectories: ['archive-root', 'backup-root'],
      }),
    ).toBe('archive-root')
    expect(
      resolveAddEncodeParentDirectory({
        storedParentDirectory: null,
        recordedDirectories: ['archive-root'],
      }),
    ).toBe('archive-root')
  })

  it('restores and saves AddEncodeSeting adjacent storage with backfilled defaults', () => {
    const storage = new Map<string, string>()
    const localStorageLike = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    }

    expect(readAddEncodeSetting(localStorageLike)).toStrictEqual({
      encodeMode: null,
      parentDirectory: null,
      isSaveSameDirectory: false,
      removeOriginal: false,
    })

    storage.set('AddEncodeSeting', JSON.stringify({ encodeMode: 'stored-mode' }))
    expect(readAddEncodeSetting(localStorageLike)).toStrictEqual({
      encodeMode: 'stored-mode',
      parentDirectory: null,
      isSaveSameDirectory: false,
      removeOriginal: false,
    })

    writeAddEncodeSetting(localStorageLike, {
      encodeMode: 'next-mode',
      parentDirectory: 'archive',
      isSaveSameDirectory: true,
      removeOriginal: true,
    })
    expect(JSON.parse(storage.get('AddEncodeSeting') ?? '{}')).toStrictEqual({
      encodeMode: 'next-mode',
      parentDirectory: 'archive',
      isSaveSameDirectory: true,
      removeOriginal: true,
    })
  })

  it('formats delete labels and edit title file sizes with legacy units', () => {
    expect(formatRecordedFileSize(512)).toBe('512.0B')
    expect(formatRecordedFileSize(2048)).toBe('2.0KB')
  })

  it('toggles visible recorded selection with the shared edit-title semantics', () => {
    expect(
      toggleVisibleRecordedSelection({
        currentSelectedIds: new Set([101]),
        visibleRecordedIds: [101, 102],
        action: 'select-all',
      }),
    ).toStrictEqual(new Set([101, 102]))
    expect(
      toggleVisibleRecordedSelection({
        currentSelectedIds: new Set([101, 102, 999]),
        visibleRecordedIds: [101, 102],
        action: 'select-all',
      }),
    ).toStrictEqual(new Set([999]))
    expect(
      toggleVisibleRecordedSelection({
        currentSelectedIds: new Set([101, 999]),
        visibleRecordedIds: [101, 102],
        action: 'preserve-visible',
      }),
    ).toStrictEqual(new Set([101]))
  })

  it('executes shared bulk delete actions and excludes unknown file types from partial options', async () => {
    const calls: Array<['recorded' | 'video', number]> = []
    const apiRepository = {
      deleteRecorded: async (id: number) => {
        calls.push(['recorded', id])
        return { ok: true as const, value: undefined }
      },
      deleteVideoFile: async (id: number) => {
        calls.push(['video', id])
        return { ok: true as const, value: undefined }
      },
    }
    const items = [
      {
        id: 101,
        name: 'Synthetic bulk target',
        videoFiles: [
          { id: 201, type: 'ts', size: 100 },
          { id: 202, type: 'encoded', size: 100 },
          { id: 203, type: 'mystery', size: 100 },
          { id: 204, size: 100 },
        ],
      },
    ]

    await expect(
      executeRecordedBulkDeleteAction({
        apiRepository,
        items: [],
        option: 'All',
      }),
    ).resolves.toStrictEqual({ status: 'zero-selection' })
    expect(calls).toStrictEqual([])

    await expect(
      executeRecordedBulkDeleteAction({
        apiRepository,
        items,
        option: 'OnlyOriginalFile',
      }),
    ).resolves.toStrictEqual({ status: 'success' })
    expect(calls).toStrictEqual([['video', 201]])

    calls.length = 0
    await expect(
      executeRecordedBulkDeleteAction({
        apiRepository,
        items,
        option: 'OnlyEncodedFile',
      }),
    ).resolves.toStrictEqual({ status: 'success' })
    expect(calls).toStrictEqual([['video', 202]])

    // v2 parity: `All` targets every video file of the item (not the item id), so all four
    // files are deleted via deleteVideoFile and deleteRecorded is never invoked.
    calls.length = 0
    await expect(
      executeRecordedBulkDeleteAction({
        apiRepository,
        items,
        option: 'All',
      }),
    ).resolves.toStrictEqual({ status: 'success' })
    expect(calls).toStrictEqual([
      ['video', 201],
      ['video', 202],
      ['video', 203],
      ['video', 204],
    ])

    // A failing deleteRecorded mock cannot produce a bulk-delete failure under `All`
    // since the item-level endpoint is not called; deleteVideoFile must fail instead.
    calls.length = 0
    await expect(
      executeRecordedBulkDeleteAction({
        apiRepository: {
          deleteRecorded: apiRepository.deleteRecorded,
          deleteVideoFile: async (id: number) => {
            calls.push(['video', id])
            return { ok: false as const, error: 'delete-failed' as const, message: 'delete failed' }
          },
        },
        items,
        option: 'All',
      }),
    ).resolves.toStrictEqual({ status: 'failure' })
    expect(calls).toStrictEqual([
      ['video', 201],
      ['video', 202],
      ['video', 203],
      ['video', 204],
    ])

    // A failure on the first file must not stop later files in the same run from being
    // attempted (flat continue-on-failure loop, v2 parity).
    calls.length = 0
    await expect(
      executeRecordedBulkDeleteAction({
        apiRepository: {
          deleteRecorded: apiRepository.deleteRecorded,
          deleteVideoFile: async (id: number) => {
            calls.push(['video', id])
            return { ok: id !== 201 }
          },
        },
        items,
        option: 'All',
      }),
    ).resolves.toStrictEqual({ status: 'failure' })
    expect(calls).toStrictEqual([
      ['video', 201],
      ['video', 202],
      ['video', 203],
      ['video', 204],
    ])
  })

  it('continues deleting the next item after an earlier item fails (v2 parity, no early return)', async () => {
    const calls: number[] = []
    const items = [
      { id: 101, videoFiles: [{ id: 11, type: 'ts' }] },
      { id: 102, videoFiles: [{ id: 12, type: 'ts' }] },
    ]

    const result = await executeRecordedBulkDeleteAction({
      apiRepository: {
        deleteRecorded: async () => ({ ok: true }),
        deleteVideoFile: async (id: number) => {
          calls.push(id)
          return { ok: id !== 11 }
        },
      },
      items,
      option: 'OnlyOriginalFile',
    })

    expect(result).toStrictEqual({ status: 'failure' })
    // The first item's video file (11) fails, but the second item's video file (12) is still
    // attempted -- a single item failing must not stop the remaining items from being processed.
    expect(calls).toStrictEqual([11, 12])
  })
})
