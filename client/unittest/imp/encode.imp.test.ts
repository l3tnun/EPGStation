import { describe, expect, it, vi } from 'vitest'
import { createFetchEncodeApiRepository } from '@/features/encode/encodeApi'
import {
  ENCODE_FAILURE_MESSAGE,
  buildEncodeListRequest,
  buildEncodeListRequestUrl,
  cancelSelectedEncodeJobs,
  createEncodeQueryKey,
  createEncodeSectionItems,
  isSameEncodeSelection,
  toggleVisibleEncodeSelection,
} from '@/features/encode/encodeRequests'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

describe('encode selection equality', () => {
  it('treats two selections with the same ids as unchanged', () => {
    expect(isSameEncodeSelection(new Set([1, 2]), new Set([2, 1]))).toBe(true)
  })

  it('treats a different size as changed', () => {
    expect(isSameEncodeSelection(new Set([1, 2]), new Set([1]))).toBe(false)
  })

  it('treats the same size with a different id as changed', () => {
    expect(isSameEncodeSelection(new Set([1, 2]), new Set([1, 3]))).toBe(false)
  })
})

describe('Encode list request and action implementation edges', () => {
  it('builds GET /encode with only isHalfWidth and uses the feature query key', () => {
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isHalfWidthDisplayed: false,
    }

    expect(buildEncodeListRequest({ settings })).toStrictEqual({
      isHalfWidth: false,
    })
    expect(buildEncodeListRequestUrl({ request: { isHalfWidth: false }, basePath: '/api' })).toBe(
      '/api/encode?isHalfWidth=false',
    )
    expect(createEncodeQueryKey({ settings })).toStrictEqual([
      'encode',
      'list',
      {
        isHalfWidth: false,
      },
    ])
    expect(ENCODE_FAILURE_MESSAGE).toBe('エンコード情報取得に失敗')
  })

  it('shows running progress only when percent and log are both present', () => {
    const sections = createEncodeSectionItems({
      runningItems: [
        {
          id: 301,
          mode: 'running-mode',
          percent: 0.456,
          log: 'frame=456',
          recorded: {
            id: 501,
            name: 'Synthetic running encode',
            channelName: 'Synthetic channel',
            startAt: 1700000000000,
            endAt: 1700003600000,
          },
        },
        {
          id: 302,
          mode: 'percent-only',
          percent: 0.5,
          recorded: {
            id: 502,
            name: 'Synthetic percent only',
          },
        },
      ],
      waitItems: [
        {
          id: 401,
          mode: 'waiting-mode',
          recorded: {
            id: 601,
            name: 'Synthetic waiting encode',
          },
        },
      ],
    })

    expect(sections.running[0]).toMatchObject({
      id: 301,
      title: 'Synthetic running encode',
      mode: 'running-mode',
      progressText: '45% frame=456',
      progressValue: 45.6,
    })
    expect(sections.running[1]).toMatchObject({
      id: 302,
      title: 'Synthetic percent only',
    })
    expect(sections.running[1].progressText).toBeUndefined()
    expect(sections.running[1].progressValue).toBeUndefined()
    expect(sections.waiting[0]).toMatchObject({
      id: 401,
      title: 'Synthetic waiting encode',
      mode: 'waiting-mode',
    })
  })

  it('toggles visible running and waiting selection and preserves visible ids on refetch', () => {
    expect(
      toggleVisibleEncodeSelection({
        currentSelectedIds: new Set([301, 999]),
        visibleEncodeIds: [301, 401],
        action: 'preserve-visible',
      }),
    ).toStrictEqual(new Set([301]))
    expect(
      toggleVisibleEncodeSelection({
        currentSelectedIds: new Set([301]),
        visibleEncodeIds: [301, 401],
        action: 'select-all',
      }),
    ).toStrictEqual(new Set([301, 401]))
    expect(
      toggleVisibleEncodeSelection({
        currentSelectedIds: new Set([301, 401]),
        visibleEncodeIds: [301, 401],
        action: 'select-all',
      }),
    ).toStrictEqual(new Set())
  })

  it('adapts /encode API responses, rejects malformed payloads, and deletes selected ids after failures', async () => {
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ runningItems: [], waitItems: [] })),
    )
    const repository = createFetchEncodeApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.fetchEncode({ isHalfWidth: true })).resolves.toStrictEqual({
      ok: true,
      value: {
        runningItems: [],
        waitItems: [],
      },
    })
    expect(fetcher).toHaveBeenCalledWith('/api/encode?isHalfWidth=true')

    vi.mocked(fetcher).mockResolvedValueOnce(new Response(JSON.stringify({ runningItems: [] })))
    await expect(repository.fetchEncode({ isHalfWidth: false })).resolves.toStrictEqual({
      ok: false,
      error: 'encode-fetch-failed',
      message: 'エンコード情報取得に失敗',
    })

    vi.mocked(fetcher)
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(
      cancelSelectedEncodeJobs({ apiRepository: repository, encodeIds: [301, 401] }),
    ).resolves.toBe(false)
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/encode?isHalfWidth=false')
    expect(fetcher).toHaveBeenNthCalledWith(3, '/api/encode/301', { method: 'DELETE' })
    expect(fetcher).toHaveBeenNthCalledWith(4, '/api/encode/401', { method: 'DELETE' })
  })

  it('adapts optional encode fields and handles transport/action failures', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).startsWith('/api/encode?')) {
        return new Response(
          JSON.stringify({
            runningItems: [
              {
                id: 1,
                mode: 'H.264',
                percent: 0.25,
                log: 'encoding',
                recorded: {
                  id: 10,
                  name: 'Recorded',
                  filename: 'ignored',
                  channelId: 20,
                  channelName: 'Channel',
                  startAt: 1000,
                  endAt: 2000,
                  description: 'description',
                  extended: 'extended',
                  ruleId: 30,
                  isProtected: true,
                  isRecording: false,
                  isEncoding: true,
                  thumbnails: [1, 'bad', 2],
                  videoFiles: [
                    {
                      id: 40,
                      name: 'video',
                      filename: 'video.ts',
                      size: 123,
                      type: 'ts',
                      isOriginal: true,
                    },
                    'bad',
                  ],
                },
              },
            ],
            waitItems: [
              {
                id: 2,
                mode: 'TS',
                recorded: null,
              },
            ],
          }),
        )
      }

      return new Response(null, { status: 500 })
    })
    const repository = createFetchEncodeApiRepository({ fetcher, basePath: '/api/' })

    await expect(repository.fetchEncode({ isHalfWidth: false })).resolves.toStrictEqual({
      ok: true,
      value: {
        runningItems: [
          {
            id: 1,
            mode: 'H.264',
            percent: 0.25,
            log: 'encoding',
            recorded: {
              id: 10,
              name: 'Recorded',
              channelId: 20,
              channelName: 'Channel',
              startAt: 1000,
              endAt: 2000,
              description: 'description',
              extended: 'extended',
              ruleId: 30,
              isProtected: true,
              isRecording: false,
              isEncoding: true,
              thumbnails: [1, 2],
              videoFiles: [
                {
                  id: 40,
                  name: 'video',
                  filename: 'video.ts',
                  size: 123,
                  type: 'ts',
                  isOriginal: true,
                },
                {},
              ],
            },
          },
        ],
        waitItems: [{ id: 2, mode: 'TS', recorded: {} }],
      },
    })

    vi.mocked(fetcher).mockRejectedValueOnce(new Error('network'))
    await expect(repository.fetchEncode({ isHalfWidth: false })).resolves.toStrictEqual({
      ok: false,
      error: 'encode-fetch-failed',
      message: 'エンコード情報取得に失敗',
    })

    vi.mocked(fetcher).mockRejectedValueOnce(new Error('network'))
    await expect(repository.cancelEncode(1)).resolves.toStrictEqual({
      ok: false,
      error: 'encode-cancel-failed',
      message: 'エンコード停止に失敗',
    })
  })
})
