import { renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createScrollHistory } from '@/app/scrollHistory'
import type { SearchRuleApiRepository } from '@/features/search/rule/api'
import { useSearchRuleActions } from '@/features/search/rule/hooks/useSearchRuleActions'
import { useSearchRuleFormState } from '@/features/search/rule/hooks/useSearchRuleFormState'
import type { SearchRouteState } from '@/features/search/rule/query'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

function createApiRepositoryStub(): SearchRuleApiRepository {
  return {
    searchSchedules: vi.fn(),
    fetchReserveIndex: vi.fn(),
    addProgramReserve: vi.fn(),
    deleteReserve: vi.fn(),
    unlockSkipReserve: vi.fn(),
    unlockOverlapReserve: vi.fn(),
    addRule: vi.fn(),
    updateRule: vi.fn(),
    fetchRule: vi.fn(),
    fetchRuleReserves: vi.fn(),
    fetchRules: vi.fn(),
    enableRule: vi.fn(),
    disableRule: vi.fn(),
    deleteRule: vi.fn(),
  } as unknown as SearchRuleApiRepository
}

function useHarness(routeState: SearchRouteState) {
  const settings = new DefaultSettingsFactory().create()
  // Stable across rerenders of this hook instance, like the real app's context-provided
  // scrollHistory (see searchRule.routeEffectsReset.imp.test.ts for the same seeding pattern).
  const [scrollHistory] = useState(() => createScrollHistory({ shouldRestoreHistory: false }))
  const state = useSearchRuleFormState({
    routeState,
    routeSearch: '',
    enabledBroadcastWaves: ['GR'],
    encodeModes: [],
    settings,
    scrollHistory,
  })
  const onSnackbar = vi.fn()
  const actions = useSearchRuleActions({
    state,
    routeState,
    ruleDetail: null,
    isTimeSpecificationMode: false,
    enabledBroadcastWaves: ['GR'],
    encodeModes: [],
    settings,
    apiRepository: createApiRepositoryStub(),
    navigate: vi.fn(),
    onSnackbar,
  })

  return { state, actions, onSnackbar }
}

describe('useSearchRuleActions scrollToRuleOption', () => {
  it('reports the scroll failure snackbar when the rule-option target has not mounted', () => {
    // v2's `scrollToElementHead()` (Search.vue) reports a failure in exactly one case: the scroll
    // target's component is not mounted. `SearchResultSection`'s `ruleOptionRef` div only mounts
    // once a search result section renders; before that, this ref is still null.
    const routeState: SearchRouteState = { mode: 'search', shouldAutoSearch: false, query: {} }
    const { result } = renderHook(() => useHarness(routeState))
    expect(result.current.state.ruleOptionRef.current).toBeNull()

    result.current.actions.scrollToRuleOption()

    expect(result.current.onSnackbar).toHaveBeenCalledWith({
      text: 'スクロールに失敗',
      severity: 'error',
    })
  })

  it('stays silent once the rule-option target has mounted', () => {
    const routeState: SearchRouteState = { mode: 'search', shouldAutoSearch: false, query: {} }
    const { result } = renderHook(() => useHarness(routeState))

    const element = document.createElement('div')
    document.body.append(element)
    result.current.state.ruleOptionRef.current = element
    vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)

    result.current.actions.scrollToRuleOption()

    expect(result.current.onSnackbar).not.toHaveBeenCalled()
    element.remove()
  })
})
