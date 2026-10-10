import { describe, expect, it } from 'vitest'
import {
  RECORDED_FAILURE_MESSAGE,
  buildRecordedListRequest,
  buildRecordedListRequestUrl,
  buildRecordedPageSearch,
  createRecordedQueryKey,
} from '@/features/recorded/recordedRequests'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

describe('Recorded list request implementation edges', () => {
  it('[AC frontend-app-shell 5.17] [AC 1.3] builds GET /recorded parameters from settings and route query', () => {
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isHalfWidthDisplayed: false,
      recordedLength: 30,
    }

    expect(
      buildRecordedListRequest({
        settings,
        search:
          '?page=3&keyword=alpha&ruleId=0&channelId=34&genre=5&hasOriginalFile=true&timestamp=999',
      }),
    ).toStrictEqual({
      isHalfWidth: false,
      limit: 30,
      offset: 60,
      page: 3,
      keyword: 'alpha',
      ruleId: 0,
      channelId: 34,
      genre: 5,
      hasOriginalFile: true,
    })
  })

  it('[AC 1.3] normalizes invalid page to page 1 and ignores malformed optional filters', () => {
    const settings = new DefaultSettingsFactory().create()

    expect(
      buildRecordedListRequest({
        settings,
        search:
          '?page=-2&ruleId=abc&channelId=&genre=1.5&hasOriginalFile=false&keyword=&timestamp=999',
      }),
    ).toStrictEqual({
      isHalfWidth: true,
      limit: 24,
      offset: 0,
      page: 1,
      keyword: '',
    })
  })

  it('includes only true hasOriginalFile, preserves query on page changes, and omits timestamp', () => {
    const settings = new DefaultSettingsFactory().create()

    expect(
      buildRecordedListRequestUrl({
        settings,
        search: '?keyword=alpha&hasOriginalFile=true&page=2&timestamp=999',
        basePath: '/api',
      }),
    ).toBe('/api/recorded?isHalfWidth=true&limit=24&offset=24&keyword=alpha&hasOriginalFile=true')
    expect(
      buildRecordedPageSearch({
        search: '?keyword=alpha&ruleId=0&timestamp=999',
        page: 4,
      }),
    ).toBe('?keyword=alpha&ruleId=0&page=4')
    expect(
      createRecordedQueryKey({
        settings,
        search: '?keyword=alpha&timestamp=999',
      }),
    ).toStrictEqual([
      'recorded',
      'list',
      '?keyword=alpha&timestamp=999',
      {
        isHalfWidth: true,
        limit: 24,
        offset: 0,
        page: 1,
        keyword: 'alpha',
      },
    ])
    expect(RECORDED_FAILURE_MESSAGE).toBe('録画データ取得に失敗')
  })
})
