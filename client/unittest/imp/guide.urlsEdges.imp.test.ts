import { describe, expect, it } from 'vitest'
import {
  appendPathNumber,
  buildEndpointUrl,
  buildGuideProgramSearchPath,
  buildPath,
  createGuideProgramSearchKeyword,
  firstGuideProgramGenre,
} from '@/features/guide/lib/guideUrls'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

describe('buildEndpointUrl', () => {
  it('omits the query string entirely when there are no parameters', () => {
    expect(buildEndpointUrl('/api', '/schedules', new URLSearchParams())).toBe('/api/schedules')
  })
})

describe('buildPath', () => {
  it('omits the query string entirely when there are no parameters', () => {
    expect(buildPath('/search', new URLSearchParams())).toBe('/search')
  })
})

describe('appendPathNumber', () => {
  it('does not set the key when the value is undefined', () => {
    const parameters = new URLSearchParams()
    appendPathNumber(parameters, 'channelId', undefined)
    expect(parameters.has('channelId')).toBe(false)
  })

  it('does not set the key when the value is negative', () => {
    const parameters = new URLSearchParams()
    appendPathNumber(parameters, 'channelId', -1)
    expect(parameters.has('channelId')).toBe(false)
  })

  it('does not set the key when the value is not a safe integer', () => {
    const parameters = new URLSearchParams()
    appendPathNumber(parameters, 'channelId', 1.5)
    expect(parameters.has('channelId')).toBe(false)
  })
})

describe('createGuideProgramSearchKeyword', () => {
  it('falls back to an empty base title when name is undefined', () => {
    expect(createGuideProgramSearchKeyword(undefined)).toBe('')
  })

  it('splits on a hashtag-style delimiter', () => {
    expect(createGuideProgramSearchKeyword('Synthetic Show #7 special')).toBe('Synthetic Show')
  })

  it('splits on a full-width bracket delimiter when there is no hashtag', () => {
    expect(createGuideProgramSearchKeyword('Synthetic「サブタイトル」')).toBe('Synthetic')
  })
})

describe('buildGuideProgramSearchPath', () => {
  it('omits the keyword parameter when the program name resolves to an empty keyword', () => {
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isIncludeChannelIdWhenSearching: false,
      isIncludeGenreWhenSearching: false,
    }

    expect(buildGuideProgramSearchPath({ program: {}, settings })).toBe('/search')
  })
})

describe('firstGuideProgramGenre', () => {
  it('falls back to genre3/subGenre3 when genre1 and genre2 are absent', () => {
    expect(firstGuideProgramGenre({ genre3: 9, subGenre3: 2 })).toStrictEqual({
      genre: 9,
      subGenre: 2,
    })
  })

  it('returns undefined when no genre field is present', () => {
    expect(firstGuideProgramGenre({})).toBeUndefined()
  })
})
