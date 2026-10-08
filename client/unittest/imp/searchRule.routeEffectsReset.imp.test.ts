import { renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { createScrollHistory } from '@/app/scrollHistory'
import { useSearchRuleFormState } from '@/features/search/rule/hooks/useSearchRuleFormState'
import { useSearchRuleRouteEffects } from '@/features/search/rule/hooks/useSearchRuleRouteEffects'
import type { SearchRouteState } from '@/features/search/rule/query'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

function useHarness(routeState: SearchRouteState, routeSearch: string) {
  const settings = new DefaultSettingsFactory().create()
  // Stable across rerenders of this hook instance, like the real app's context-provided
  // scrollHistory - a fresh instance per render would make the page-info save effect's
  // `[scrollHistory]` dependency see a new identity on every rerender.
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

describe('useSearchRuleRouteEffects reset behavior across route changes', () => {
  it('[AC 2.7] resets time-specification state and the rule-edit active request when the rule id changes', () => {
    const { result, rerender } = renderHook(
      ({ routeState, routeSearch }: { routeState: SearchRouteState; routeSearch: string }) =>
        useHarness(routeState, routeSearch),
      {
        initialProps: {
          routeState: { mode: 'rule-edit', ruleId: 55 } as SearchRouteState,
          routeSearch: '?rule=55',
        },
      },
    )

    expect(result.current.isTimeSpecification).toBe(false)
    expect(result.current.initializedRuleEditKeyRef.current).toBeNull()

    rerender({
      routeState: { mode: 'rule-edit', ruleId: 55 } as SearchRouteState,
      routeSearch: '?rule=55',
    })
    expect(result.current.isTimeSpecification).toBe(false)

    result.current.initializedRuleEditKeyRef.current = 'rule-55'
    result.current.setActiveRequest(() => ({
      body: { option: { times: [{ week: 0x7f }] }, isHalfWidth: true, limit: 300 },
      serial: 1,
      source: 'rule-edit-preload',
    }))

    rerender({
      routeState: { mode: 'rule-edit', ruleId: 56 } as SearchRouteState,
      routeSearch: '?rule=56',
    })

    expect(result.current.initializedRuleEditKeyRef.current).toBeNull()
    expect(result.current.activeRequest).toBeNull()

    result.current.setActiveRequest(() => ({
      body: { option: { times: [{ week: 0x7f }] }, isHalfWidth: true, limit: 300 },
      serial: 2,
      source: 'rule-edit-preload',
    }))
    rerender({
      routeState: { mode: 'rule-edit', ruleId: 56 } as SearchRouteState,
      routeSearch: '?rule=56',
    })
    expect(result.current.activeRequest).not.toBeNull()
  })
})
