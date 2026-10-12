import { describe, expect, it, vi } from 'vitest'
import { DefaultSettingsFactory } from '@/shared/settings'
import {
  buildAddEncodeRequestBody,
  buildItemRecordedSearchPath,
  buildItemRuleSearchPath,
  buildRecordedPlaybackHandoffTarget,
  buildRecordedSearchPath,
  buildRecordedUploadMetadataBody,
  buildVideoUrlSchemeHandoffUrl,
  createInitialRecordedUploadFormState,
  createRecordedSearchKeyword,
  executeRecordedBulkDeleteAction,
  linkifyRecordedExtendedText,
  normalizeRecordedSelectStreamSetting,
  readAddEncodeSetting,
  readRecordedSelectStreamSetting,
  readSendVideoFileSelectHostSetting,
  resolveAddEncodeParentDirectory,
} from '@/features/recorded/recordedRequests'

const settings = new DefaultSettingsFactory().create()

function storageOf(raw: string | null) {
  return { getItem: () => raw, setItem: vi.fn() }
}

describe('recorded request builders: optional inputs', () => {
  it('omits empty directories from the add-encode body and falls back to no parent', () => {
    const body = buildAddEncodeRequestBody({
      recordedId: 1,
      sourceVideoFileId: 2,
      mode: 'm',
      removeOriginal: false,
      isSaveSameDirectory: false,
      parentDir: '',
      directory: null,
    })
    expect(body).toEqual({
      recordedId: 1,
      sourceVideoFileId: 2,
      mode: 'm',
      removeOriginal: false,
      isSaveSameDirectory: false,
    })
    expect(
      resolveAddEncodeParentDirectory({ storedParentDirectory: 'x', recordedDirectories: [] }),
    ).toBe('')
  })

  it('reports bulk delete failures for missing ids, skipped files and rejected deletes', async () => {
    const api = {
      deleteRecorded: vi.fn(async () => ({ ok: true })),
      deleteVideoFile: vi.fn(async (id: number) => ({ ok: id !== 3 })),
    }

    // v2 parity (5cf2ea383 RecordedState.ts:181-193): an item without
    // videoFiles is skipped entirely rather than treated as a failure, so selecting an item
    // with no videoFiles yields zero delete candidates and an overall success (not a failure).
    // `All` does not call the item-level deleteRecorded (which would fail for an id-less item).
    await expect(
      executeRecordedBulkDeleteAction({ apiRepository: api, items: [{}], option: 'All' }),
    ).resolves.toEqual({ status: 'success' })
    await expect(
      executeRecordedBulkDeleteAction({
        apiRepository: api,
        items: [{ id: 1, videoFiles: [{ type: 'ts' }, { id: 2, type: 'ts' }] }, { id: 9 }],
        option: 'OnlyOriginalFile',
      }),
    ).resolves.toEqual({ status: 'success' })
    expect(api.deleteVideoFile).toHaveBeenCalledTimes(1)
    await expect(
      executeRecordedBulkDeleteAction({
        apiRepository: api,
        items: [{ id: 1, videoFiles: [{ id: 3, type: 'encoded' }] }],
        option: 'OnlyEncodedFile',
      }),
    ).resolves.toEqual({ status: 'failure' })
  })

  it('linkifies leading, trailing and unparseable URLs', () => {
    expect(linkifyRecordedExtendedText('http://a.example/x tail')).toEqual([
      { type: 'link', text: 'http://a.example/x', href: 'http://a.example/x' },
      { type: 'text', text: ' tail' },
    ])
    expect(linkifyRecordedExtendedText('head http://[')).toEqual([
      { type: 'text', text: 'head ' },
      { type: 'text', text: 'http://[' },
    ])
    expect(linkifyRecordedExtendedText('')).toEqual([])
  })

  it('builds search paths and keywords from partial inputs', () => {
    expect(buildRecordedSearchPath({})).toBe('/recorded')
    expect(createRecordedSearchKeyword(undefined)).toBe('')
    expect(createRecordedSearchKeyword('「quoted」 rest')).toBe('「quoted」 rest')
    expect(createRecordedSearchKeyword('title #3')).toBe('title')
    expect(buildItemRuleSearchPath({})).toBe('/search')
    expect(buildItemRecordedSearchPath({})).toBe('/recorded')
    expect(buildItemRecordedSearchPath({ name: 'show' })).toBe('/recorded?keyword=show')
  })

  it('falls back to defaults for malformed stored settings', () => {
    expect(readAddEncodeSetting(storageOf('{"encodeMode":5}')).encodeMode).toBeNull()
    expect(readAddEncodeSetting(storageOf('not json'))).toEqual({
      encodeMode: null,
      parentDirectory: null,
      isSaveSameDirectory: false,
      removeOriginal: false,
    })
    expect(readSendVideoFileSelectHostSetting(storageOf('not json'))).toEqual({ hostName: null })
  })

  it('reads and normalizes the stream selection with a missing or invalid store', () => {
    expect(readRecordedSelectStreamSetting(undefined)).toEqual({ type: 'WebM', mode: 0 })
    expect(readRecordedSelectStreamSetting(storageOf(null))).toEqual({ type: 'WebM', mode: 0 })
    expect(readRecordedSelectStreamSetting(storageOf('not json'))).toEqual({
      type: 'WebM',
      mode: 0,
    })
    expect(readRecordedSelectStreamSetting(storageOf('{"type":"HLS","mode":1.5}'))).toEqual({
      type: 'HLS',
      mode: 0,
    })
    expect(
      normalizeRecordedSelectStreamSetting({ saved: { type: 'HLS', mode: 1 }, candidates: [] }),
    ).toEqual({ type: 'WebM', mode: 0 })
    expect(
      normalizeRecordedSelectStreamSetting({
        saved: { type: 'HLS', mode: 1 },
        candidates: [{ type: 'MP4', modes: ['a', 'b'] }],
      }),
    ).toEqual({ type: 'MP4', mode: 1 })
  })

  it('refuses to build upload metadata from an incomplete form', () => {
    const form = createInitialRecordedUploadFormState(['d'])
    expect(() => buildRecordedUploadMetadataBody(form)).toThrow(
      'Invalid recorded upload metadata state',
    )
  })
})

describe('recorded video handoff: url scheme variants', () => {
  it('builds view-mode url scheme handoffs without a filename', () => {
    expect(
      buildVideoUrlSchemeHandoffUrl({
        shouldUseUrlScheme: true,
        urlScheme: 'vlc-x-callback://x-callback-url/stream?url=PROTOCOL://ADDRESS&name=FILENAME',
        videoFileId: 5,
        mode: 'view',
        origin: 'https://host.example',
      }),
    ).toBe(
      'vlc-x-callback://x-callback-url/stream?url=https://host.example%2Fapi%2Fvideos%2F5&name=',
    )
  })

  it('rejects handoffs without ids and honours the view scheme flags', () => {
    expect(
      buildRecordedPlaybackHandoffTarget({
        file: { id: 1 },
        settings,
        browserHref: 'https://host.example/app/',
      }),
    ).toEqual({ ok: false, message: '番組 ID が不正です' })

    const withScheme = buildRecordedPlaybackHandoffTarget({
      recordedId: 2,
      file: { id: 1, name: 'named' },
      settings: {
        ...settings,
        shouldUseRecordedViewURLScheme: true,
        recordedViewURLScheme: 'vlc-x-callback://x?url=PROTOCOL://ADDRESS&name=FILENAME',
      },
      browserHref: 'https://host.example/app/',
      recordedViewUrlScheme: null,
    })
    expect(withScheme).toEqual({
      ok: true,
      kind: 'href',
      href: 'vlc-x-callback://x?url=https://host.example%2Fapp%2Fapi%2Fvideos%2F1&name=named',
    })

    const withoutName = buildRecordedPlaybackHandoffTarget({
      recordedId: 2,
      file: { id: 1 },
      settings: {
        ...settings,
        shouldUseRecordedViewURLScheme: true,
        recordedViewURLScheme: 'scheme://PROTOCOL/ADDRESS/FILENAME',
      },
      browserHref: 'https://host.example/app/',
      recordedViewUrlScheme: null,
    })
    expect(withoutName).toEqual({
      ok: true,
      kind: 'href',
      href: 'scheme://https/host.example/app/api/videos/1/',
    })

    const disabled = buildRecordedPlaybackHandoffTarget({
      recordedId: 2,
      file: { id: 1 },
      settings: { ...settings, shouldUseRecordedViewURLScheme: false },
      browserHref: 'https://host.example/app/',
    })
    expect(disabled).toEqual({ ok: true, kind: 'href', href: './api/videos/1/playlist' })
  })
})
