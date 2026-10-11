import { describe, expect, it } from 'vitest'
import { createFetchRecordingApiRepository } from '@/features/recording/recordingApi'

const request = { isHalfWidth: false, limit: 12, offset: 0, page: 1 }

function createRepository(records: unknown[], channels: unknown) {
  return createFetchRecordingApiRepository({
    basePath: '/api',
    fetcher: async (url) =>
      new Response(
        JSON.stringify(
          String(url) === '/api/channels' ? channels : { records, total: records.length },
        ),
      ),
  })
}

describe('Recording API edge cases', () => {
  it('rejects a failure status or a rejected request even when the body looks valid', async () => {
    const failure = {
      ok: false,
      error: 'recording-fetch-failed',
      message: expect.any(String),
    }

    await expect(
      createFetchRecordingApiRepository({
        fetcher: async () =>
          new Response(JSON.stringify({ records: [], total: 0 }), { status: 500 }),
      }).fetchRecording(request),
    ).resolves.toStrictEqual(failure)
    await expect(
      createFetchRecordingApiRepository({
        fetcher: async () => {
          throw new Error('network')
        },
      }).fetchRecording(request),
    ).resolves.toStrictEqual(failure)
  })

  it('keeps a drop log only when all three counters are numbers and its id only when numeric', async () => {
    const dropLog = (extra: Record<string, unknown>) => ({
      dropCnt: 1,
      errorCnt: 2,
      scramblingCnt: 3,
      ...extra,
    })
    const result = await createRepository(
      [
        { dropLogFile: dropLog({ id: 9 }) },
        { dropLogFile: dropLog({ id: 'x' }) },
        { dropLogFile: dropLog({ dropCnt: '1' }) },
        { dropLogFile: dropLog({ errorCnt: '2' }) },
        { dropLogFile: dropLog({ scramblingCnt: '3' }) },
      ],
      [],
    ).fetchRecording(request)

    expect(result.ok && result.value.records.map((item) => item.dropLogFile)).toStrictEqual([
      { id: 9, dropCnt: 1, errorCnt: 2, scramblingCnt: 3 },
      { id: undefined, dropCnt: 1, errorCnt: 2, scramblingCnt: 3 },
      undefined,
      undefined,
      undefined,
    ])
  })

  it('names channels from the index, skipping malformed entries, and keeps a name the server gave', async () => {
    const channels = [
      null,
      'text',
      { id: 'x', name: 'string id' },
      { id: 1, halfWidthName: 'OnlyHalf' },
      { id: 2, halfWidthName: 5 },
      { id: 3, name: 'Named' },
    ]
    const result = await createRepository(
      [
        { channelId: 1 },
        { channelId: 2 },
        { channelId: 3 },
        { channelId: 3, channelName: 'Given' },
        { name: 'no channel id' },
      ],
      channels,
    ).fetchRecording(request)

    expect(result.ok && result.value.records.map((item) => item.channelName)).toStrictEqual([
      'OnlyHalf',
      undefined,
      'Named',
      'Given',
      undefined,
    ])
  })
})
