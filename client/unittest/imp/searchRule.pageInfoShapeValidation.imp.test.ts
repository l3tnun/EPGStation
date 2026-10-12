import { describe, expect, it } from 'vitest'
import { resolveSearchPageInfoForRoute } from '@/features/search/rule/lib/searchPageInfo'

function validInfo(): Record<string, unknown> {
  return {
    form: { keyword: 'k' },
    isTimeSpecification: false,
    timeReserveForm: {},
    optionDraft: {},
    isSearched: true,
  }
}

function resolve(pageInfo: unknown) {
  return resolveSearchPageInfoForRoute({ mode: 'search', shouldRestoreHistory: true, pageInfo })
}

describe('searchRule restored page info shape validation', () => {
  it('returns the stored object itself when its shape is valid', () => {
    const info = validInfo()
    expect(resolve(info)).toBe(info)
  })

  it.each([null, undefined, 'text', 5, true])('rejects non-object value %s', (value) => {
    expect(resolve(value)).toBeNull()
  })

  it.each([
    ['form missing', { form: undefined }],
    ['form null', { form: null }],
    ['form string', { form: 'x' }],
    ['form keyword missing', { form: {} }],
    ['form keyword number', { form: { keyword: 1 } }],
    ['isTimeSpecification missing', { isTimeSpecification: undefined }],
    ['isTimeSpecification string', { isTimeSpecification: 'false' }],
    ['timeReserveForm missing', { timeReserveForm: undefined }],
    ['timeReserveForm null', { timeReserveForm: null }],
    ['timeReserveForm string', { timeReserveForm: 'x' }],
    ['optionDraft missing', { optionDraft: undefined }],
    ['optionDraft null', { optionDraft: null }],
    ['optionDraft string', { optionDraft: 'x' }],
    ['isSearched missing', { isSearched: undefined }],
    ['isSearched string', { isSearched: 'true' }],
  ])('rejects when %s', (_name, override) => {
    expect(resolve({ ...validInfo(), ...override })).toBeNull()
  })

  it('rejects a Guide-like scroll record', () => {
    expect(resolve({ scrollLeft: 0, scrollTop: 0 })).toBeNull()
  })

  it('returns null outside search mode or without history restore', () => {
    const info = validInfo()
    expect(
      resolveSearchPageInfoForRoute({
        mode: 'search',
        shouldRestoreHistory: false,
        pageInfo: info,
      }),
    ).toBeNull()
    expect(
      resolveSearchPageInfoForRoute({
        mode: 'edit' as never,
        shouldRestoreHistory: true,
        pageInfo: info,
      }),
    ).toBeNull()
  })
})
