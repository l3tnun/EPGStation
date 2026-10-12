import { describe, expect, it, vi } from 'vitest'
import { createFetchRecordingApiRepository } from '@/features/recording/recordingApi'
import {
  RECORDING_FAILURE_MESSAGE,
  buildRecordingListRequest,
  buildRecordingListRequestUrl,
  buildRecordingListRequestUrlFromRequest,
  createRecordingQueryKey,
  toggleVisibleRecordingSelection,
} from '@/features/recording/recordingRequests'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

describe('Recording list request implementation edges', () => {
  it('builds GET /recording parameters from settings and route query', () => {
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isHalfWidthDisplayed: false,
      recordingLength: 12,
    }

    expect(buildRecordingListRequest({ settings, search: '?page=3&timestamp=999' })).toStrictEqual({
      isHalfWidth: false,
      limit: 12,
      offset: 24,
      page: 3,
    })
    expect(
      buildRecordingListRequestUrl({
        settings,
        search: '?page=3&timestamp=999',
        basePath: '/api',
      }),
    ).toBe('/api/recording?isHalfWidth=false&limit=12&offset=24')
    expect(
      buildRecordingListRequestUrlFromRequest({
        request: {
          isHalfWidth: false,
          limit: 12,
          offset: 36,
          page: 3,
        },
        basePath: '/api',
      }),
    ).toBe('/api/recording?isHalfWidth=false&limit=12&offset=36')
    expect(createRecordingQueryKey({ settings, search: '?page=3&timestamp=999' })).toStrictEqual([
      'recording',
      'list',
      '?page=3&timestamp=999',
      {
        isHalfWidth: false,
        limit: 12,
        offset: 24,
        page: 3,
      },
    ])
    expect(RECORDING_FAILURE_MESSAGE).toBe('録画データ取得に失敗')
  })

  it('normalizes invalid page and preserves visible selection on refetch', () => {
    const settings = new DefaultSettingsFactory().create()

    expect(
      buildRecordingListRequest({ settings, search: '?page=-2&keyword=ignored' }),
    ).toStrictEqual({
      isHalfWidth: true,
      limit: 24,
      offset: 0,
      page: 1,
    })
    expect(
      toggleVisibleRecordingSelection({
        currentSelectedIds: new Set([101, 999]),
        visibleRecordingIds: [101, 102],
        action: 'preserve-visible',
      }),
    ).toStrictEqual(new Set([101]))
  })

  it('adapts /recording API responses and rejects malformed payloads', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ records: [], total: 0 })))
    const repository = createFetchRecordingApiRepository({ fetcher, basePath: '/api' })

    await expect(
      repository.fetchRecording({
        isHalfWidth: false,
        limit: 12,
        offset: 24,
        page: 3,
      }),
    ).resolves.toStrictEqual({
      ok: true,
      value: {
        records: [],
        total: 0,
      },
    })
    expect(fetcher).toHaveBeenCalledWith('/api/recording?isHalfWidth=false&limit=12&offset=24')

    vi.mocked(fetcher).mockResolvedValueOnce(new Response(JSON.stringify({ records: [] })))
    await expect(
      repository.fetchRecording({
        isHalfWidth: true,
        limit: 24,
        offset: 0,
        page: 1,
      }),
    ).resolves.toStrictEqual({
      ok: false,
      error: 'recording-fetch-failed',
      message: '録画データ取得に失敗',
    })
  })

  it('hydrates recording channel names from the shared channel index', async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === '/api/channels') {
        return new Response(
          JSON.stringify([
            {
              id: 7101,
              name: 'Synthetic Recording Channel',
              halfWidthName: 'Synthetic Recording HW',
            },
          ]),
        )
      }

      return new Response(
        JSON.stringify({
          records: [{ id: 9101, name: 'Synthetic Recording', channelId: 7101 }],
          total: 1,
        }),
      )
    })
    const repository = createFetchRecordingApiRepository({ fetcher, basePath: '/api' })

    await expect(
      repository.fetchRecording({
        isHalfWidth: true,
        limit: 12,
        offset: 0,
        page: 1,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        records: [{ channelName: 'Synthetic Recording HW' }],
      },
    })
  })
})
