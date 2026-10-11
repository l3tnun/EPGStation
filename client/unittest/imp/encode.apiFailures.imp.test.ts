import { describe, expect, it } from 'vitest'
import { createFetchEncodeApiRepository } from '@/features/encode/encodeApi'
import { ENCODE_FAILURE_MESSAGE } from '@/features/encode/encodeRequests'

const emptyQueue = { runningItems: [], waitItems: [] }

describe('Encode API failures and cancel request', () => {
  it('reports a list failure for a non-success status even when the body looks valid', async () => {
    const repository = createFetchEncodeApiRepository({
      fetcher: async () => new Response(JSON.stringify(emptyQueue), { status: 500 }),
    })

    await expect(repository.fetchEncode({ isHalfWidth: true })).resolves.toStrictEqual({
      ok: false,
      error: 'encode-fetch-failed',
      message: ENCODE_FAILURE_MESSAGE,
    })
  })

  it('reports a list failure instead of rejecting when the network request throws', async () => {
    const repository = createFetchEncodeApiRepository({
      fetcher: async () => {
        throw new Error('network')
      },
    })

    await expect(repository.fetchEncode({ isHalfWidth: true })).resolves.toMatchObject({
      ok: false,
      error: 'encode-fetch-failed',
    })
  })

  it('cancels with DELETE under the base path without a doubled slash and reports success', async () => {
    const calls: Array<{ url: string; method: string | undefined }> = []
    const repository = createFetchEncodeApiRepository({
      basePath: '/api/',
      fetcher: async (url, init) => {
        calls.push({ url: String(url), method: init?.method })

        return new Response(null, { status: 200 })
      },
    })

    await expect(repository.cancelEncode(5)).resolves.toStrictEqual({
      ok: true,
      value: undefined,
    })
    expect(calls).toStrictEqual([{ url: '/api/encode/5', method: 'DELETE' }])
  })

  it('reports a cancel failure for a rejected request and for a non-success status', async () => {
    const failure = {
      ok: false,
      error: 'encode-cancel-failed',
      message: 'エンコード停止に失敗',
    }

    await expect(
      createFetchEncodeApiRepository({
        fetcher: async () => {
          throw new Error('network')
        },
      }).cancelEncode(5),
    ).resolves.toStrictEqual(failure)
    await expect(
      createFetchEncodeApiRepository({
        fetcher: async () => new Response(null, { status: 500 }),
      }).cancelEncode(5),
    ).resolves.toStrictEqual(failure)
  })
})
