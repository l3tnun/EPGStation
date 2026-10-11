import { describe, expect, it } from 'vitest'
import { createFetchRecordedApiRepository } from '@/features/recorded/recordedApi'

const channels = [{ id: 7, name: 'Full name', halfWidthName: 'Half name' }]
const recordedBody = { records: [{ id: 1, channelId: 7 }], total: 1 }

function createRepositoryWithCounter() {
  const urls: string[] = []
  const repository = createFetchRecordedApiRepository({
    basePath: '/api',
    fetcher: async (input) => {
      const url = String(input)
      urls.push(url)

      return new Response(JSON.stringify(url.startsWith('/api/channels') ? channels : recordedBody))
    },
  })

  return { repository, urls }
}

describe('Recorded API channel name index', () => {
  it('fetches the channel list once per width setting and reuses it', async () => {
    const { repository, urls } = createRepositoryWithCounter()
    const request = { isHalfWidth: true, limit: 1, offset: 0, page: 1 }

    const first = await repository.fetchRecorded(request)
    await repository.fetchRecorded(request)
    expect(urls.filter((url) => url === '/api/channels')).toHaveLength(1)
    expect(first).toMatchObject({ value: { records: [{ channelName: 'Half name' }] } })

    const full = await repository.fetchRecorded({ ...request, isHalfWidth: false })
    expect(urls.filter((url) => url === '/api/channels')).toHaveLength(2)
    expect(full).toMatchObject({ value: { records: [{ channelName: 'Full name' }] } })
  })

  it('uses a primed channel list for both widths and for the search options without fetching it', async () => {
    const { repository, urls } = createRepositoryWithCounter()

    repository.primeChannelIndex?.(Promise.resolve(channels))
    const half = await repository.fetchRecorded({ isHalfWidth: true, limit: 1, offset: 0, page: 1 })
    const full = await repository.fetchRecorded({
      isHalfWidth: false,
      limit: 1,
      offset: 0,
      page: 1,
    })
    const uploadOptions = await repository.fetchRecordedUploadOptions?.()

    expect(urls.some((url) => url.startsWith('/api/channels'))).toBe(false)
    expect(half).toMatchObject({ value: { records: [{ channelName: 'Half name' }] } })
    expect(full).toMatchObject({ value: { records: [{ channelName: 'Full name' }] } })
    expect(uploadOptions).toMatchObject({
      ok: true,
      value: { channels: [{ id: 7, name: 'Full name', halfWidthName: 'Half name' }] },
    })
  })
})

describe('Recorded API failure results', () => {
  const failingRepository = createFetchRecordedApiRepository({
    fetcher: async () => new Response(JSON.stringify({ id: 1 }), { status: 500 }),
  })

  it('reports each failure with its own message', async () => {
    await expect(failingRepository.fetchRule(1)).resolves.toStrictEqual({
      ok: false,
      error: 'rule-fetch-failed',
      message: 'rule fetch failed',
    })
    await expect(failingRepository.fetchVideoDuration?.(1)).resolves.toStrictEqual({
      ok: false,
      error: 'video-duration-fetch-failed',
      message: '動画長の取得に失敗しました',
    })
    await expect(
      failingRepository.fetchDropLog({ dropLogFileId: 1, maxsize: 1 }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'drop-log-fetch-failed',
      message: 'ログファイル取得に失敗しました',
    })
    await expect(
      failingRepository.createRecorded({ channelId: 101, startAt: 1_000, endAt: 2_000, name: 'x' }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'recorded-create-failed',
      message: 'アップロードに失敗',
    })
    await expect(
      failingRepository.uploadVideoFile({
        recordedId: 1,
        parentDirectoryName: '/tmp',
        viewName: 'video',
        fileType: 'ts',
        file: new File(['body'], 'video.ts'),
      }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'video-upload-failed',
      message: 'アップロードに失敗',
    })
  })

  it('reports the create failure for a failure status even when the body names a recorded id', async () => {
    const repository = createFetchRecordedApiRepository({
      fetcher: async () => new Response(JSON.stringify({ recordedId: 1 }), { status: 500 }),
    })

    await expect(
      repository.createRecorded({ channelId: 101, startAt: 1_000, endAt: 2_000, name: 'x' }),
    ).resolves.toMatchObject({ ok: false, error: 'recorded-create-failed' })
  })

  it('rejects a recorded detail answered with a failure status, a non-object body or no numeric id', async () => {
    const request = { recordedId: 1, isHalfWidth: true }
    const answer = (body: unknown, status = 200) =>
      createFetchRecordedApiRepository({
        fetcher: async () => new Response(JSON.stringify(body), { status }),
      }).fetchRecordedDetail(request)

    await expect(answer({ id: 1 }, 500)).resolves.toMatchObject({ ok: false })
    await expect(answer('text')).resolves.toMatchObject({ ok: false })
    await expect(answer(null)).resolves.toMatchObject({ ok: false })
    await expect(answer({ id: 'x' })).resolves.toMatchObject({ ok: false })
    await expect(answer({ id: 1 })).resolves.toMatchObject({ ok: true })
  })
})
