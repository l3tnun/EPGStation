import { describe, expect, it } from 'vitest'
import { createRecordedActionMethods } from '@/features/recorded/api/createRecordedActionMethods'

const jsonHeaders = { 'Content-Type': 'application/json' }

interface ActionCase {
  name: string
  run: (methods: ReturnType<typeof createRecordedActionMethods>) => Promise<unknown>
  url: string
  method: string
  headers?: unknown
  body?: unknown
  failure: { error: string; message: string }
}

const cases: ActionCase[] = [
  {
    name: 'protectRecorded',
    run: (m) => m.protectRecorded(3),
    url: '/api/recorded/3/protect',
    method: 'PUT',
    failure: { error: 'protect-failed', message: '保護に失敗' },
  },
  {
    name: 'unprotectRecorded',
    run: (m) => m.unprotectRecorded(3),
    url: '/api/recorded/3/unprotect',
    method: 'PUT',
    failure: { error: 'unprotect-failed', message: '保護解除に失敗' },
  },
  {
    name: 'deleteRecorded',
    run: (m) => m.deleteRecorded(3),
    url: '/api/recorded/3',
    method: 'DELETE',
    failure: { error: 'delete-failed', message: '削除に失敗' },
  },
  {
    name: 'deleteVideoFile',
    run: (m) => m.deleteVideoFile(4),
    url: '/api/videos/4',
    method: 'DELETE',
    failure: { error: 'delete-failed', message: '削除に失敗' },
  },
  {
    name: 'cleanupRecorded',
    run: (m) => m.cleanupRecorded(),
    url: '/api/recorded/cleanup',
    method: 'POST',
    failure: { error: 'cleanup-failed', message: 'クリーンアップに失敗' },
  },
  {
    name: 'cleanupThumbnails',
    run: (m) => m.cleanupThumbnails(),
    url: '/api/thumbnails/cleanup',
    method: 'POST',
    failure: { error: 'cleanup-failed', message: 'クリーンアップに失敗' },
  },
  {
    name: 'addEncode',
    run: (m) =>
      m.addEncode({
        recordedId: 1,
        sourceVideoFileId: 2,
        mode: 'H.264',
        removeOriginal: false,
        isSaveSameDirectory: true,
      }),
    url: '/api/encode',
    method: 'POST',
    headers: jsonHeaders,
    body: {
      recordedId: 1,
      sourceVideoFileId: 2,
      mode: 'H.264',
      removeOriginal: false,
      isSaveSameDirectory: true,
    },
    failure: { error: 'add-encode-failed', message: 'エンコード追加に失敗しました' },
  },
  {
    name: 'stopEncode',
    run: (m) => m.stopEncode(3),
    url: '/api/recorded/3/encode',
    method: 'DELETE',
    failure: { error: 'stop-encode-failed', message: 'エンコード停止に失敗' },
  },
  {
    name: 'sendVideoFileToKodi',
    run: (m) => m.sendVideoFileToKodi({ videoFileId: 5, kodiName: 'kodi' }),
    url: '/api/videos/5/kodi',
    method: 'POST',
    headers: jsonHeaders,
    body: { kodiName: 'kodi' },
    failure: { error: 'send-video-file-to-kodi-failed', message: '送信に失敗しました' },
  },
]

describe('Recorded action methods', () => {
  it.each(cases)(
    '$name sends its request and reports success without a value',
    async (testCase) => {
      const calls: Array<{ url: string; init?: RequestInit }> = []
      const methods = createRecordedActionMethods({
        basePath: '/api',
        fetcher: async (url, init) => {
          calls.push({ url: String(url), init })

          return new Response(null, { status: 200 })
        },
      })

      await expect(testCase.run(methods)).resolves.toStrictEqual({ ok: true, value: undefined })
      expect(calls).toHaveLength(1)
      expect(calls[0]?.url).toBe(testCase.url)
      expect(calls[0]?.init?.method).toBe(testCase.method)
      expect(calls[0]?.init?.headers).toStrictEqual(testCase.headers)
      expect(
        calls[0]?.init?.body === undefined ? undefined : JSON.parse(String(calls[0].init.body)),
      ).toStrictEqual(testCase.body)
    },
  )

  it.each(cases)('$name reports its own failure', async (testCase) => {
    const methods = createRecordedActionMethods({
      basePath: '/api',
      fetcher: async () => new Response(null, { status: 500 }),
    })

    await expect(testCase.run(methods)).resolves.toStrictEqual({ ok: false, ...testCase.failure })
  })
})
