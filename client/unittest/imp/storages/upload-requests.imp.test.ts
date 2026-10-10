import { describe, expect, it, vi } from 'vitest'
import { createFetchRecordedApiRepository } from '@/features/recorded/recordedApi'
import {
  buildRuleKeywordRequestUrl,
  buildRecordedUploadMetadataBody,
  buildRecordedUploadVideoFormData,
  createInitialRecordedUploadFormState,
  validateRecordedUploadForm,
} from '@/features/recorded/recordedRequests'

describe('Recorded upload request and form state implementation edges', () => {
  it('builds rule keyword autocomplete URLs with limit and optional keyword only for non-null values', () => {
    expect(buildRuleKeywordRequestUrl({ basePath: '/api' })).toBe('/api/rules/keyword?limit=1000')
    expect(buildRuleKeywordRequestUrl({ basePath: '/api', keyword: null })).toBe(
      '/api/rules/keyword?limit=1000',
    )
    expect(buildRuleKeywordRequestUrl({ basePath: '/api', keyword: '' })).toBe(
      '/api/rules/keyword?limit=1000&keyword=',
    )
    expect(buildRuleKeywordRequestUrl({ basePath: '/api', keyword: 'alpha beta' })).toBe(
      '/api/rules/keyword?limit=1000&keyword=alpha+beta',
    )
  })

  it('creates route-init and FAB video block defaults from the first configured recorded directory', () => {
    const state = createInitialRecordedUploadFormState(['archive-root', 'backup-root'])

    expect(state.videoBlocks).toHaveLength(1)
    expect(state.videoBlocks[0]).toStrictEqual({
      id: 0,
      parentDirectoryName: 'archive-root',
      subDirectory: null,
      viewName: null,
      fileType: undefined,
      file: null,
    })
    expect(createInitialRecordedUploadFormState([]).videoBlocks[0]?.parentDirectoryName).toBe('')
  })

  it('validates required metadata and video block fields before the upload sequence runs', () => {
    expect(validateRecordedUploadForm(createInitialRecordedUploadFormState(['root']))).toBe(false)
    const validVideoFile = new File(['synthetic'], 'synthetic-upload.ts')
    expect(
      validateRecordedUploadForm({
        ...createInitialRecordedUploadFormState(['root']),
        channelId: 12,
        startAt: 1_700_000_000_000,
        duration: 1800,
        name: 'Synthetic program',
        videoBlocks: [
          {
            id: 0,
            parentDirectoryName: 'root',
            subDirectory: null,
            viewName: 'Synthetic upload',
            fileType: 'ts',
            file: validVideoFile,
          },
        ],
      }),
    ).toBe(true)
    expect(
      validateRecordedUploadForm({
        ...createInitialRecordedUploadFormState(['root']),
        channelId: 12,
        startAt: 1_700_000_000_000,
        duration: 1800,
        name: '   ',
      }),
    ).toBe(false)
    expect(
      validateRecordedUploadForm({
        ...createInitialRecordedUploadFormState(['root']),
        channelId: 12,
        startAt: 1_700_000_000_000,
        duration: 0,
        name: 'Synthetic program',
        videoBlocks: [
          {
            id: 0,
            parentDirectoryName: 'root',
            subDirectory: null,
            viewName: 'Synthetic upload',
            fileType: 'ts',
            file: validVideoFile,
          },
        ],
      }),
    ).toBe(false)
    expect(
      validateRecordedUploadForm({
        ...createInitialRecordedUploadFormState(['root']),
        channelId: 12,
        startAt: 1_700_000_000_000,
        duration: 1800,
        name: 'Synthetic program',
        videoBlocks: [
          {
            id: 0,
            parentDirectoryName: 'root',
            subDirectory: null,
            viewName: 'Synthetic upload',
            fileType: 'ts',
            file: validVideoFile,
          },
          {
            id: 1,
            parentDirectoryName: 'root',
            subDirectory: null,
            viewName: 'Partial upload',
            fileType: undefined,
            file: null,
          },
        ],
      }),
    ).toBe(false)
  })

  it('[AC 3.7] rejects a form whose program fields are complete but has no complete video block', () => {
    const programFields = {
      ...createInitialRecordedUploadFormState(['root']),
      channelId: 12,
      startAt: 1_700_000_000_000,
      duration: 1800,
      name: 'Synthetic program',
    }

    // Only a completely empty video block.
    expect(validateRecordedUploadForm(programFields)).toBe(false)
    // No video block at all.
    expect(validateRecordedUploadForm({ ...programFields, videoBlocks: [] })).toBe(false)
  })

  it('builds the metadata body with computed endAt and only populated optional fields', () => {
    expect(
      buildRecordedUploadMetadataBody({
        channelId: 12,
        genre: 5,
        subGenre: 2,
        ruleId: 77,
        startAt: 1_700_000_000_000,
        duration: 30,
        name: 'Synthetic program',
        description: 'Synthetic summary',
        extended: 'Synthetic extended',
        videoBlocks: [],
      }),
    ).toStrictEqual({
      channelId: 12,
      startAt: 1_700_000_000_000,
      endAt: 1_700_001_800_000,
      name: 'Synthetic program',
      ruleId: 77,
      description: 'Synthetic summary',
      extended: 'Synthetic extended',
      genre1: 5,
      subGenre1: 2,
    })
    expect(
      buildRecordedUploadMetadataBody({
        channelId: 12,
        genre: null,
        subGenre: null,
        ruleId: null,
        startAt: 1_700_000_000_000,
        duration: 30,
        name: 'Synthetic program',
        description: null,
        extended: '',
        videoBlocks: [],
      }),
    ).toStrictEqual({
      channelId: 12,
      startAt: 1_700_000_000_000,
      endAt: 1_700_001_800_000,
      name: 'Synthetic program',
    })
  })

  it('builds the multipart video upload form data without forcing Content-Type headers', () => {
    const file = new File(['synthetic'], 'synthetic-upload.ts')
    const formData = buildRecordedUploadVideoFormData({
      recordedId: 901,
      parentDirectoryName: 'archive-root',
      subDirectory: 'season-one',
      viewName: 'Synthetic upload',
      fileType: 'ts',
      file,
    })

    expect(formData.get('recordedId')).toBe('901')
    expect(formData.get('parentDirectoryName')).toBe('archive-root')
    expect(formData.get('subDirectory')).toBe('season-one')
    expect(formData.get('viewName')).toBe('Synthetic upload')
    expect(formData.get('fileType')).toBe('ts')
    expect(formData.get('file')).toBe(file)
    expect(
      buildRecordedUploadVideoFormData({
        recordedId: 901,
        parentDirectoryName: 'archive-root',
        subDirectory: '   ',
        viewName: 'Synthetic upload',
        fileType: 'encoded',
        file,
      }).has('subDirectory'),
    ).toBe(false)
  })

  it('posts metadata and multipart upload requests through the recorded repository endpoints', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === '/api/recorded') {
        return new Response(JSON.stringify({ recordedId: 901 }))
      }

      return new Response(JSON.stringify({ result: 'ok' }))
    })
    const repository = createFetchRecordedApiRepository({ fetcher, basePath: '/api' })
    const file = new File(['synthetic'], 'synthetic-upload.ts')

    await expect(
      repository.createRecorded({
        channelId: 12,
        startAt: 1_700_000_000_000,
        endAt: 1_700_001_800_000,
        name: 'Synthetic program',
      }),
    ).resolves.toStrictEqual({ ok: true, value: { recordedId: 901 } })
    await expect(
      repository.uploadVideoFile({
        recordedId: 901,
        parentDirectoryName: 'archive-root',
        viewName: 'Synthetic upload',
        fileType: 'ts',
        file,
      }),
    ).resolves.toStrictEqual({ ok: true, value: undefined })

    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/recorded', {
      body: JSON.stringify({
        channelId: 12,
        startAt: 1_700_000_000_000,
        endAt: 1_700_001_800_000,
        name: 'Synthetic program',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/videos/upload', {
      body: expect.any(FormData),
      method: 'POST',
    })
  })
})
