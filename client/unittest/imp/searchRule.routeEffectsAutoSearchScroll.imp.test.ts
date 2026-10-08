import { renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { createScrollHistory } from '@/app/scrollHistory'
import { useSearchRuleFormState } from '@/features/search/rule/hooks/useSearchRuleFormState'
import { useSearchRuleRouteEffects } from '@/features/search/rule/hooks/useSearchRuleRouteEffects'
import type { SearchRouteState } from '@/features/search/rule/query'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

// Mirrors the harness in searchRule.routeEffectsReset.imp.test.ts / .routeEffectsSearchModeChurn.
function useHarness(routeState: SearchRouteState, routeSearch: string) {
  const settings = new DefaultSettingsFactory().create()
  const [scrollHistory] = useState(() => createScrollHistory({ shouldRestoreHistory: false }))
  const state = useSearchRuleFormState({
    routeState,
    routeSearch,
    enabledBroadcastWaves: ['GR', 'BS'],
    encodeModes: [],
    settings,
    scrollHistory,
  })

  useSearchRuleRouteEffects({
    state,
    routeState,
    routeSearch,
    ruleDetail: null,
    enabledBroadcastWaves: ['GR', 'BS'],
    encodeModes: [],
    settings,
  })

  return state
}

describe('useSearchRuleRouteEffects query-driven auto-search scroll flag', () => {
  it('[AC 2.22] requests a result scroll when a genuine route change lands on an auto-searching query, independent of the rule-edit auto-scroll setting', () => {
    // v2's `isQuerySearch` branch (Search.vue, ~line 379) calls `this.search(true)`
    // unconditionally on a real route change and never reads
    // `isEnableAutoScrollWhenEditingRule` - that setting only gates the separate rule-edit preload
    // branch below it in the same hook. Starting this route on a non-auto-searching query keeps
    // `needsResultScrollRef` false at mount, so a later flip to true can only come from the
    // `didRouteSearchChange && routeState.shouldAutoSearch` branch under test
    // (useSearchRuleRouteEffects.ts, 85-87 行目), not from the initial-mount seeding in
    // useSearchRuleFormState.ts.
    const { result, rerender } = renderHook(
      ({ routeState, routeSearch }: { routeState: SearchRouteState; routeSearch: string }) =>
        useHarness(routeState, routeSearch),
      {
        initialProps: {
          routeState: { mode: 'search', shouldAutoSearch: false, query: {} } as SearchRouteState,
          routeSearch: '',
        },
      },
    )

    expect(result.current.needsResultScrollRef.current).toBe(false)

    rerender({
      routeState: {
        mode: 'search',
        shouldAutoSearch: true,
        query: { keyword: 'owner-typed-keyword' },
      } as SearchRouteState,
      routeSearch: '?keyword=owner-typed-keyword',
    })

    expect(result.current.needsResultScrollRef.current).toBe(true)
    expect(result.current.activeRequest?.source).toBe('route-search')
  })
})
