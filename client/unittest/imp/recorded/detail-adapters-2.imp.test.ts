import { describe, expect, it, vi } from 'vitest'
import { createFetchRecordedApiRepository } from '@/features/recorded/recordedApi'

describe('Recorded detail implementation edges', () => {
  it('adapts recorded list/detail payloads, hydrates channel names, and handles upload/action endpoints', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url)
      if (href === '/api/channels') {
        return new Response(
          JSON.stringify([
            { id: 101, name: 'Full Channel', halfWidthName: 'Half Channel' },
            { id: 'bad', name: 'Bad Channel' },
          ]),
        )
      }
      if (href.startsWith('/api/recorded?')) {
        return new Response(
          JSON.stringify({
            total: 1,
            records: [
              {
                id: 1,
                name: 'Recorded',
                channelId: 101,
                genres: ['genre text', 1],
                genre1: 7,
                subGenre1: 1,
                genre2: 8,
                subGenre2: 2,
                genre3: 9,
                subGenre3: 3,
                startAt: 1_000,
                endAt: 2_000,
                description: 'description',
                extended: 'extended',
                ruleId: 55,
                isProtected: true,
                isRecording: false,
                isEncoding: true,
                thumbnails: [10, 'bad', 11],
                dropLogFile: {
                  id: 12,
                  dropCnt: 0,
                  errorCnt: 1,
                  scramblingCnt: 2,
                },
                videoFiles: [
                  {
                    id: 20,
                    name: 'video',
                    filename: 'video.ts',
                    size: 1234,
                    type: 'ts',
                    isOriginal: true,
                  },
                  'bad',
                ],
              },
              {
                genre: 'legacy genre',
              },
            ],
          }),
        )
      }
      if (href.startsWith('/api/recorded/1?')) {
        return new Response(
          JSON.stringify({
            id: 1,
            name: 'Detail',
            channelId: 101,
            videoFiles: [],
          }),
        )
      }
      if (href === '/api/videos/20/duration') {
        return new Response(JSON.stringify({ duration: 123.5 }))
      }
      if (href === '/api/dropLogs/12?maxsize=1024') {
        return new Response('drop log body')
      }
      if (href === '/api/recorded' && init?.method === 'POST') {
        return new Response(JSON.stringify({ recordedId: 500 }))
      }
      return new Response(null, { status: 204 })
    })
    const repository = createFetchRecordedApiRepository({ fetcher, basePath: '/api/' })

    await expect(
      repository.fetchRecorded({
        isHalfWidth: true,
        limit: 24,
        offset: 0,
        page: 1,
        keyword: 'keyword',
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        total: 1,
        records: [
          {
            id: 1,
            name: 'Recorded',
            channelId: 101,
            channelName: 'Half Channel',
            genres: ['genre text'],
            thumbnails: [10, 11],
            dropLogFile: { id: 12, dropCnt: 0, errorCnt: 1, scramblingCnt: 2 },
            videoFiles: [
              {
                id: 20,
                name: 'video',
                filename: 'video.ts',
                size: 1234,
                type: 'ts',
                isOriginal: true,
              },
              {},
            ],
          },
          {
            genres: ['legacy genre'],
          },
        ],
      },
    })
    await expect(
      repository.fetchRecordedDetail({ recordedId: 1, isHalfWidth: true }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        id: 1,
        name: 'Detail',
        channelId: 101,
        channelName: 'Half Channel',
        videoFiles: [],
      },
    })
    await expect(repository.fetchVideoDuration?.(20)).resolves.toEqual({ ok: true, value: 123.5 })
    await expect(repository.fetchDropLog({ dropLogFileId: 12, maxsize: 1024 })).resolves.toEqual({
      ok: true,
      value: 'drop log body',
    })
    await expect(
      repository.createRecorded({ channelId: 101, startAt: 1_000, endAt: 2_000, name: 'Uploaded' }),
    ).resolves.toEqual({
      ok: true,
      value: { recordedId: 500 },
    })
    await expect(
      repository.uploadVideoFile({
        recordedId: 500,
        parentDirectoryName: '/tmp',
        viewName: 'video',
        fileType: 'ts',
        file: new File(['body'], 'video.ts'),
      }),
    ).resolves.toEqual({ ok: true, value: undefined })
    await expect(repository.protectRecorded(1)).resolves.toEqual({ ok: true, value: undefined })
    await expect(repository.unprotectRecorded(1)).resolves.toEqual({ ok: true, value: undefined })
    await expect(repository.deleteRecorded(1)).resolves.toEqual({ ok: true, value: undefined })
    await expect(repository.deleteVideoFile(20)).resolves.toEqual({ ok: true, value: undefined })
    await expect(repository.cleanupRecorded()).resolves.toEqual({ ok: true, value: undefined })
    await expect(repository.cleanupThumbnails()).resolves.toEqual({ ok: true, value: undefined })
    await expect(
      repository.addEncode({
        recordedId: 1,
        sourceVideoFileId: 20,
        mode: 'H.264',
        removeOriginal: false,
        isSaveSameDirectory: true,
      }),
    ).resolves.toEqual({
      ok: true,
      value: undefined,
    })
    await expect(repository.stopEncode(1)).resolves.toEqual({ ok: true, value: undefined })
    await expect(
      repository.sendVideoFileToKodi({ videoFileId: 20, kodiName: 'kodi' }),
    ).resolves.toEqual({
      ok: true,
      value: undefined,
    })
  })
})
