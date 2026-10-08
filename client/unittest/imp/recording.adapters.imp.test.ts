import { describe, expect, it, vi } from 'vitest'
import { createFetchRecordingApiRepository } from '@/features/recording/recordingApi'

const request = { isHalfWidth: false, limit: 12, offset: 0, page: 1 }

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body))
}

describe('Recording API adapter branches', () => {
  it('adapts every recording field, dropping values of the wrong type', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith('/channels')
        ? jsonResponse([])
        : jsonResponse({
            total: 2,
            records: [
              {
                id: 1,
                name: 'full',
                channelId: 10,
                channelName: 'ch',
                startAt: 100,
                endAt: 200,
                description: 'd',
                extended: 'e',
                ruleId: 5,
                isProtected: true,
                isRecording: true,
                isEncoding: false,
                thumbnails: [1, 'x', 2],
                dropLogFile: { id: 3, dropCnt: 1, errorCnt: 2, scramblingCnt: 3 },
                videoFiles: [
                  { id: 7, name: 'v', filename: 'v.ts', size: 9, type: 'ts', isOriginal: true },
                  'bad',
                  { id: 'x', name: 1, filename: 2, size: '9', type: 3, isOriginal: 'yes' },
                ],
              },
              {
                id: 'bad',
                name: 2,
                channelId: 'x',
                channelName: 3,
                startAt: 'a',
                endAt: 'b',
                description: 4,
                extended: 5,
                ruleId: 'r',
                isProtected: 'p',
                isRecording: 'r',
                isEncoding: 'e',
                thumbnails: 'none',
                dropLogFile: { dropCnt: 1, errorCnt: 2 },
                videoFiles: 'none',
              },
              'not-a-record',
              { id: 3, dropLogFile: { dropCnt: 0, errorCnt: 0, scramblingCnt: 0 } },
            ],
          }),
    )
    const repository = createFetchRecordingApiRepository({ fetcher, basePath: '/api/' })

    const result = await repository.fetchRecording(request)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.records[0]).toStrictEqual({
      id: 1,
      name: 'full',
      channelId: 10,
      channelName: 'ch',
      startAt: 100,
      endAt: 200,
      description: 'd',
      extended: 'e',
      ruleId: 5,
      isProtected: true,
      isRecording: true,
      isEncoding: false,
      thumbnails: [1, 2],
      dropLogFile: { id: 3, dropCnt: 1, errorCnt: 2, scramblingCnt: 3 },
      videoFiles: [
        { id: 7, name: 'v', filename: 'v.ts', size: 9, type: 'ts', isOriginal: true },
        {},
        {
          id: undefined,
          name: undefined,
          filename: undefined,
          size: undefined,
          type: undefined,
          isOriginal: undefined,
        },
      ],
    })
    expect(result.value.records[1]).toStrictEqual({
      id: undefined,
      name: undefined,
      channelId: undefined,
      channelName: undefined,
      startAt: undefined,
      endAt: undefined,
      description: undefined,
      extended: undefined,
      ruleId: undefined,
      isProtected: undefined,
      isRecording: undefined,
      isEncoding: undefined,
      thumbnails: undefined,
      dropLogFile: undefined,
      videoFiles: undefined,
    })
    expect(result.value.records[2]).toStrictEqual({})
    expect(result.value.records[3]?.dropLogFile).toStrictEqual({
      id: undefined,
      dropCnt: 0,
      errorCnt: 0,
      scramblingCnt: 0,
    })
    expect(fetcher).toHaveBeenCalledWith('/api/channels')
  })

  it('rejects non-object, non-ok, throwing and malformed list responses', async () => {
    const fetcher = vi.fn<(url: RequestInfo | URL) => Promise<Response>>()
    const repository = createFetchRecordingApiRepository({ fetcher, basePath: '/api' })
    const failure = { ok: false, error: 'recording-fetch-failed', message: '録画データ取得に失敗' }

    fetcher.mockResolvedValueOnce(jsonResponse('text'))
    await expect(repository.fetchRecording(request)).resolves.toStrictEqual(failure)
    fetcher.mockResolvedValueOnce(new Response(null, { status: 500 }))
    await expect(repository.fetchRecording(request)).resolves.toStrictEqual(failure)
    fetcher.mockRejectedValueOnce(new Error('network'))
    await expect(repository.fetchRecording(request)).resolves.toStrictEqual(failure)
    fetcher.mockResolvedValueOnce(jsonResponse({ records: [], total: 'x' }))
    await expect(repository.fetchRecording(request)).resolves.toStrictEqual(failure)
  })

  it('builds the channel index per half-width mode, caches it, and ignores malformed channels', async () => {
    const channels = [
      { id: 1, name: 'Full', halfWidthName: 'Half' },
      { id: 2, name: 'OnlyFull' },
      { id: 3, halfWidthName: 'OnlyHalf' },
      { id: 4 },
      { id: 'bad', name: 'x' },
      'not-a-record',
    ]
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      String(url) === '/api/channels'
        ? jsonResponse(channels)
        : jsonResponse({
            total: 5,
            records: [
              { id: 11, channelId: 1 },
              { id: 12, channelId: 2 },
              { id: 13, channelId: 3 },
              { id: 14, channelId: 4 },
              { id: 15, channelId: 1, channelName: 'Given' },
              { id: 16 },
            ],
          }),
    )
    const repository = createFetchRecordingApiRepository({ fetcher, basePath: '/api' })

    const half = await repository.fetchRecording({ ...request, isHalfWidth: true })
    expect(half.ok && half.value.records.map((item) => item.channelName)).toStrictEqual([
      'Half',
      'OnlyFull',
      'OnlyHalf',
      undefined,
      'Given',
      undefined,
    ])
    const full = await repository.fetchRecording({ ...request, isHalfWidth: false })
    expect(full.ok && full.value.records.map((item) => item.channelName)).toStrictEqual([
      'Full',
      'OnlyFull',
      'OnlyHalf',
      undefined,
      'Given',
      undefined,
    ])
    await repository.fetchRecording({ ...request, isHalfWidth: true })
    expect(fetcher.mock.calls.filter(([url]) => String(url) === '/api/channels')).toHaveLength(2)
  })

  it('uses an empty channel index when the channel list is not an array', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) =>
      String(url) === '/api/channels'
        ? jsonResponse({ not: 'array' })
        : jsonResponse({ total: 1, records: [{ id: 1, channelId: 5 }] }),
    )
    const repository = createFetchRecordingApiRepository({ fetcher, basePath: '/api' })

    const result = await repository.fetchRecording(request)
    expect(result.ok && result.value.records[0]?.channelName).toBeUndefined()
  })

  it('falls back to the global fetch when no fetcher is injected', async () => {
    const globalFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ records: [], total: 0 }))
    const repository = createFetchRecordingApiRepository()

    await expect(repository.fetchRecording(request)).resolves.toStrictEqual({
      ok: true,
      value: { records: [], total: 0 },
    })
    expect(globalFetch).toHaveBeenCalledWith('./api/recording?isHalfWidth=false&limit=12&offset=0')
    globalFetch.mockRestore()
  })
})
