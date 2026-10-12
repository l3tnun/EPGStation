import { describe, expect, it, vi } from 'vitest'
import { createFetchRecordedApiRepository } from '@/features/recorded/recordedApi'

describe('Recorded detail implementation edges', () => {
  it('returns typed failures for recorded repository transport and malformed payload cases', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({}), { status: 500 }))
    const repository = createFetchRecordedApiRepository({ fetcher, basePath: '/api' })

    await expect(
      repository.fetchRecorded({ isHalfWidth: true, limit: 1, offset: 0, page: 1 }),
    ).resolves.toMatchObject({
      ok: false,
      error: 'recorded-fetch-failed',
    })
    await expect(repository.fetchRecordedOptions()).resolves.toMatchObject({
      ok: false,
      error: 'recorded-options-failed',
    })
    await expect(repository.fetchRuleKeywords('keyword')).resolves.toMatchObject({
      ok: false,
      error: 'rule-keywords-failed',
    })
    await expect(repository.fetchRule(1)).resolves.toMatchObject({
      ok: false,
      error: 'rule-fetch-failed',
    })
    await expect(repository.fetchVideoDuration?.(1)).resolves.toMatchObject({
      ok: false,
      error: 'video-duration-fetch-failed',
    })
    await expect(repository.fetchDropLog({ dropLogFileId: 1, maxsize: 1 })).resolves.toMatchObject({
      ok: false,
      error: 'drop-log-fetch-failed',
    })
    await expect(
      repository.createRecorded({ channelId: 101, startAt: 1_000, endAt: 2_000, name: 'x' }),
    ).resolves.toMatchObject({
      ok: false,
      error: 'recorded-create-failed',
    })
    await expect(
      repository.uploadVideoFile({
        recordedId: 1,
        parentDirectoryName: '/tmp',
        viewName: 'video',
        fileType: 'ts',
        file: new File(['body'], 'video.ts'),
      }),
    ).resolves.toMatchObject({ ok: false, error: 'video-upload-failed' })
    await expect(repository.protectRecorded(1)).resolves.toMatchObject({
      ok: false,
      error: 'protect-failed',
    })
    await expect(repository.unprotectRecorded(1)).resolves.toMatchObject({
      ok: false,
      error: 'unprotect-failed',
    })
    await expect(repository.deleteRecorded(1)).resolves.toMatchObject({
      ok: false,
      error: 'delete-failed',
    })
    await expect(repository.deleteVideoFile(1)).resolves.toMatchObject({
      ok: false,
      error: 'delete-failed',
    })
    await expect(repository.cleanupRecorded()).resolves.toMatchObject({
      ok: false,
      error: 'cleanup-failed',
    })
    await expect(repository.cleanupThumbnails()).resolves.toMatchObject({
      ok: false,
      error: 'cleanup-failed',
    })
    await expect(
      repository.addEncode({
        recordedId: 1,
        sourceVideoFileId: 20,
        mode: 'H.264',
        removeOriginal: false,
        isSaveSameDirectory: true,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: 'add-encode-failed',
    })
    await expect(repository.stopEncode(1)).resolves.toMatchObject({
      ok: false,
      error: 'stop-encode-failed',
    })
    await expect(
      repository.sendVideoFileToKodi({ videoFileId: 1, kodiName: 'kodi' }),
    ).resolves.toMatchObject({
      ok: false,
      error: 'send-video-file-to-kodi-failed',
    })
  })
})
