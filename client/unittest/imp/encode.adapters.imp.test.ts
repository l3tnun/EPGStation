import { describe, expect, it, vi } from 'vitest'
import { createFetchEncodeApiRepository } from '@/features/encode/encodeApi'
import { createEncodeSectionItems } from '@/features/encode/encodeRequests'

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body))
}

const failure = { ok: false, error: 'encode-fetch-failed', message: 'エンコード情報取得に失敗' }

describe('Encode API adapter branches', () => {
  it('adapts recorded fields and video files, dropping wrongly typed values', async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({
        runningItems: [
          {
            id: 1,
            mode: 'm',
            percent: 'not-number',
            log: 42,
            recorded: {
              id: 'x',
              name: 1,
              channelId: 'c',
              channelName: 2,
              startAt: 's',
              endAt: 'e',
              description: 3,
              extended: 4,
              ruleId: 'r',
              isProtected: 'p',
              isRecording: 'r',
              isEncoding: 'e',
              thumbnails: 'none',
              videoFiles: [
                { id: 'x', name: 1, filename: 2, size: '9', type: 3, isOriginal: 'yes' },
                'bad',
              ],
            },
          },
        ],
        waitItems: [{ id: 2, mode: 'w', recorded: 'not-a-record' }],
      }),
    )
    const repository = createFetchEncodeApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.fetchEncode({ isHalfWidth: false })).resolves.toStrictEqual({
      ok: true,
      value: {
        runningItems: [
          {
            id: 1,
            mode: 'm',
            recorded: {
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
              videoFiles: [
                {
                  id: undefined,
                  name: undefined,
                  filename: undefined,
                  size: undefined,
                  type: undefined,
                  isOriginal: undefined,
                },
                {},
              ],
            },
          },
        ],
        waitItems: [{ id: 2, mode: 'w', recorded: {} }],
      },
    })
  })

  it('rejects lists whose items lack an id or mode, and transport failures', async () => {
    const fetcher = vi.fn<(url: RequestInfo | URL) => Promise<Response>>()
    const repository = createFetchEncodeApiRepository({ fetcher, basePath: '/api' })
    const request = { isHalfWidth: true }

    fetcher.mockResolvedValueOnce(
      jsonResponse({ runningItems: [{ id: 1, mode: 'm', recorded: {} }], waitItems: ['bad'] }),
    )
    await expect(repository.fetchEncode(request)).resolves.toStrictEqual(failure)
    fetcher.mockResolvedValueOnce(
      jsonResponse({ runningItems: [{ id: 'x', mode: 'm' }], waitItems: [] }),
    )
    await expect(repository.fetchEncode(request)).resolves.toStrictEqual(failure)
    fetcher.mockResolvedValueOnce(
      jsonResponse({ runningItems: [{ id: 1, mode: 2 }], waitItems: [] }),
    )
    await expect(repository.fetchEncode(request)).resolves.toStrictEqual(failure)
    fetcher.mockResolvedValueOnce(jsonResponse('text'))
    await expect(repository.fetchEncode(request)).resolves.toStrictEqual(failure)
    fetcher.mockResolvedValueOnce(jsonResponse({ runningItems: [], waitItems: 'x' }))
    await expect(repository.fetchEncode(request)).resolves.toStrictEqual(failure)
    fetcher.mockResolvedValueOnce(new Response(null, { status: 500 }))
    await expect(repository.fetchEncode(request)).resolves.toStrictEqual(failure)
    fetcher.mockRejectedValueOnce(new Error('network'))
    await expect(repository.fetchEncode(request)).resolves.toStrictEqual(failure)
  })

  it('falls back to the global fetch when no fetcher is injected', async () => {
    const globalFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ runningItems: [], waitItems: [] }))
    const repository = createFetchEncodeApiRepository()

    await expect(repository.fetchEncode({ isHalfWidth: true })).resolves.toStrictEqual({
      ok: true,
      value: { runningItems: [], waitItems: [] },
    })
    expect(globalFetch).toHaveBeenCalledWith('./api/encode?isHalfWidth=true')
    globalFetch.mockRestore()
  })

  it('titles a section item by its id when the recorded name is missing', () => {
    const sections = createEncodeSectionItems({
      runningItems: [{ id: 9, mode: 'm', recorded: {} }],
      waitItems: [],
    })
    expect(sections.running[0]?.title).toBe('#9')
    expect(sections.running[0]?.thumbnailPath).toBeNull()
  })
})
