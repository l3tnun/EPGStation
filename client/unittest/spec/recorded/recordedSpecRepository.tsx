import { vi } from 'vitest'
import type { RecordedApiRepository } from '@/features/recorded/recordedApi'

export function createRecordedRepository(): RecordedApiRepository {
  return {
    fetchRecorded: vi.fn(async () => ({
      ok: true as const,
      value: {
        records: [
          {
            id: 101,
            name: 'Synthetic recorded one',
            description: 'Synthetic description',
            dropLogFile: {
              dropCnt: 2,
              errorCnt: 1,
              scramblingCnt: 0,
            },
            videoFiles: [{ id: 201, name: 'synthetic-video-one', size: 1024 }],
          },
          {
            id: 102,
            name: 'Synthetic recorded two',
            description: 'Synthetic second description',
            thumbnails: [301],
            videoFiles: [{ id: 202, name: 'synthetic-video-two' }],
          },
        ],
        total: 50,
      },
    })),
    fetchRecordedOptions: vi.fn(async () => ({
      ok: true as const,
      value: {
        channels: [{ id: 34, name: 'Synthetic channel', halfWidthName: 'Synthetic half channel' }],
        genres: [{ id: 5, name: 'Synthetic genre' }],
      },
    })),
    fetchRuleKeywords: vi.fn(async () => ({
      ok: true as const,
      value: [{ id: 12, keyword: 'Synthetic rule' }],
    })),
    fetchRule: vi.fn(async () => ({
      ok: true as const,
      value: { id: 12, keyword: 'Synthetic rule' },
    })),
    createRecorded: vi.fn(async () => ({
      ok: true as const,
      value: { recordedId: 901 },
    })),
    uploadVideoFile: vi.fn(async () => ({ ok: true as const, value: undefined })),
    protectRecorded: vi.fn(async () => ({ ok: true as const, value: undefined })),
    unprotectRecorded: vi.fn(async () => ({ ok: true as const, value: undefined })),
    deleteRecorded: vi.fn(async () => ({ ok: true as const, value: undefined })),
    deleteVideoFile: vi.fn(async () => ({ ok: true as const, value: undefined })),
    cleanupRecorded: vi.fn(async () => ({ ok: true as const, value: undefined })),
    cleanupThumbnails: vi.fn(async () => ({ ok: true as const, value: undefined })),
    addEncode: vi.fn(async () => ({ ok: true as const, value: undefined })),
    stopEncode: vi.fn(async () => ({ ok: true as const, value: undefined })),
    fetchRecordedDetail: vi.fn(async () => ({
      ok: true as const,
      value: {
        id: 301,
        name: 'Synthetic detail target',
        channelId: 401,
        channelName: 'Synthetic channel',
        genres: ['Synthetic genre'],
        startAt: 1_700_000_000_000,
        endAt: 1_700_000_600_000,
        genre1: 0,
        description: 'Synthetic detail description',
        extended: 'Synthetic extended https://example.invalid/detail/path',
        ruleId: 55,
        isProtected: false,
        isRecording: false,
        isEncoding: true,
        thumbnails: [501],
        dropLogFile: {
          id: 601,
          dropCnt: 2,
          errorCnt: 1,
          scramblingCnt: 0,
        },
        videoFiles: [
          {
            id: 701,
            name: 'synthetic-original',
            filename: 'synthetic-original.ts',
            type: 'ts',
            size: 1024,
          },
          {
            id: 702,
            name: 'synthetic-encoded',
            filename: 'synthetic-encoded.mp4',
            type: 'encoded',
            size: 2048,
          },
        ],
        subGenre1: 1,
      },
    })),
    fetchVideoDuration: vi.fn(async () => ({
      ok: true as const,
      value: 600,
    })),
    fetchDropLog: vi.fn(async () => ({
      ok: true as const,
      value: 'synthetic drop log content',
    })),
    sendVideoFileToKodi: vi.fn(async () => ({ ok: true as const, value: undefined })),
  } as RecordedApiRepository
}
