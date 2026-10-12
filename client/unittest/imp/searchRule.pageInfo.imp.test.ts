import { describe, expect, it } from 'vitest'
import {
  createSearchPageInfoFromState,
  resolveSearchPageInfoForRoute,
  shouldSaveSearchPageInfo,
  type SearchPageInfo,
} from '@/features/search/rule/lib/searchPageInfo'
import {
  createDefaultSearchFormState,
  createDefaultSearchTimeReserveFormState,
} from '@/features/search/rule/query'

function createSamplePageInfo(overrides: Partial<SearchPageInfo> = {}): SearchPageInfo {
  return {
    form: { ...createDefaultSearchFormState(['GR', 'BS']), keyword: 'Sample keyword' },
    isTimeSpecification: false,
    timeReserveForm: createDefaultSearchTimeReserveFormState(),
    optionDraft: {
      reserveOption: {
        enable: true,
        allowEndLack: true,
        avoidDuplicate: false,
        periodToAvoidDuplicate: null,
      },
      saveOption: { parentDirectoryName: null, directory: null, recordedFormat: null },
    },
    isSearched: false,
    ...overrides,
  }
}

describe('search rule page info direct unit edges', () => {
  it('[AC 1.18] builds a page info snapshot from the current form/time-reserve/option/search state', () => {
    const form = { ...createDefaultSearchFormState(['GR']), keyword: 'Typed keyword' }
    const timeReserveForm = createDefaultSearchTimeReserveFormState()
    const optionDraft = {
      reserveOption: {
        enable: true,
        allowEndLack: true,
        avoidDuplicate: false,
        periodToAvoidDuplicate: null,
      },
      saveOption: { parentDirectoryName: null, directory: null, recordedFormat: null },
    }

    expect(
      createSearchPageInfoFromState({
        form,
        isTimeSpecification: true,
        timeReserveForm,
        optionDraft,
        isSearched: true,
      }),
    ).toStrictEqual({
      form,
      isTimeSpecification: true,
      timeReserveForm,
      optionDraft,
      isSearched: true,
    })
  })

  it('[AC 1.18] saves page info only when leaving the plain search route, never the rule-edit route', () => {
    expect(shouldSaveSearchPageInfo({ mode: 'search' })).toBe(true)
    expect(shouldSaveSearchPageInfo({ mode: 'rule-edit' })).toBe(false)
  })

  it('[AC 1.18] resolves no restore data outside of a genuine history restore', () => {
    const pageInfo = createSamplePageInfo()

    expect(
      resolveSearchPageInfoForRoute({ mode: 'search', shouldRestoreHistory: false, pageInfo }),
    ).toBeNull()
  })

  it('[AC 1.18] resolves no restore data for the rule-edit route even during a history restore', () => {
    const pageInfo = createSamplePageInfo()

    expect(
      resolveSearchPageInfoForRoute({ mode: 'rule-edit', shouldRestoreHistory: true, pageInfo }),
    ).toBeNull()
  })

  it('[AC 1.18] resolves the saved page info for the plain search route during a genuine history restore', () => {
    const pageInfo = createSamplePageInfo()

    expect(
      resolveSearchPageInfoForRoute({ mode: 'search', shouldRestoreHistory: true, pageInfo }),
    ).toStrictEqual(pageInfo)
  })

  it('[AC 1.18] resolves null when a history restore has no saved page info to restore', () => {
    expect(
      resolveSearchPageInfoForRoute({ mode: 'search', shouldRestoreHistory: true, pageInfo: null }),
    ).toBeNull()
  })

  it("resolves null when the history entry holds another route's scroll data instead of a SearchPageInfo", () => {
    // `ScrollHistoryState.getScrollData` is one per-URL slot shared by every route; a stale
    // `shouldRestoreHistory` reading the current entry before this route's own history bookkeeping
    // has run can hand this function another screen's shape (e.g. Guide's `{scrollLeft,
    // scrollTop}`). Trusting it as-is crashes downstream consumers that read `pageInfo.form.*`.
    const foreignPageInfo = { scrollLeft: 0, scrollTop: 0 }

    expect(
      resolveSearchPageInfoForRoute({
        mode: 'search',
        shouldRestoreHistory: true,
        pageInfo: foreignPageInfo,
      }),
    ).toBeNull()
  })

  it('resolves null when the history entry holds a non-object value', () => {
    expect(
      resolveSearchPageInfoForRoute({
        mode: 'search',
        shouldRestoreHistory: true,
        pageInfo: 'not-an-object',
      }),
    ).toBeNull()
  })
})
