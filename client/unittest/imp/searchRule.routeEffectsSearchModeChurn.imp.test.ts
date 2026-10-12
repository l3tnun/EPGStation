import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { createScrollHistory } from '@/app/scrollHistory'
import { useSearchRuleFormState } from '@/features/search/rule/hooks/useSearchRuleFormState'
import { useSearchRuleRouteEffects } from '@/features/search/rule/hooks/useSearchRuleRouteEffects'
import type { SearchRouteState } from '@/features/search/rule/query'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

// Regression coverage for the bugs where typed keyword/channel selections
// disappear after touching an unrelated control (channel select, time/period fields, encode
// option pulldowns). The route-effects hook already guards the rule-edit preload branch against
// this class of bug (see searchRule.routeEffectsReset.imp.test.ts / [AC 2.9] in
// searchRule.routeEffectsReplay.spec.test.tsx: "a fresh array literal of identical content
// changes the prop reference ... without changing anything the ... initialization key is derived
// from"), but the plain 'search' mode branch has no equivalent guard: it unconditionally calls
// setForm()/setActiveRequest() whenever the effect re-runs, even when the route itself (routeSearch)
// never changed.
// Created once per test and reused across rerenders: in the real app this is the
// `settings`/`dashboardSettings` object, which only changes reference when an *ancestor*
// (e.g. AppRoot) re-renders, not on every re-render of SearchRulePage's own local state.
// Recreating it on every hook invocation here would make the harness diverge from the app and
// self-trigger runaway re-renders unrelated to the bug under test.
const sharedSettings = new DefaultSettingsFactory().create()

function useHarness(
  routeState: SearchRouteState,
  routeSearch: string,
  enabledBroadcastWaves: readonly ('GR' | 'BS' | 'CS' | 'SKY')[],
) {
  const settings = sharedSettings
  // Stable across rerenders of this hook instance, like the real app's context-provided
  // scrollHistory - a fresh instance per render would make the page-info save effect's
  // `[scrollHistory]` dependency see a new identity on every rerender.
  const [scrollHistory] = useState(() => createScrollHistory({ shouldRestoreHistory: false }))
  const state = useSearchRuleFormState({
    routeState,
    routeSearch,
    enabledBroadcastWaves,
    encodeModes: [],
    settings,
    scrollHistory,
  })

  useSearchRuleRouteEffects({
    state,
    routeState,
    routeSearch,
    ruleDetail: null,
    enabledBroadcastWaves,
    encodeModes: [],
    settings,
  })

  return state
}

describe('useSearchRuleRouteEffects search-mode churn regression', () => {
  it('keeps a typed keyword when an unrelated re-render replays an unchanged search route', () => {
    const routeState: SearchRouteState = { mode: 'search', shouldAutoSearch: false, query: {} }

    const { result, rerender } = renderHook(
      ({
        enabledBroadcastWaves,
      }: {
        enabledBroadcastWaves: readonly ('GR' | 'BS' | 'CS' | 'SKY')[]
      }) => useHarness(routeState, '', enabledBroadcastWaves),
      { initialProps: { enabledBroadcastWaves: ['GR', 'BS'] as const } },
    )

    act(() => {
      result.current.setForm((current) => ({ ...current, keyword: 'owner-typed-keyword' }))
    })
    act(() => {
      result.current.setForm((current) => ({ ...current, channelIds: [12] }))
    })

    expect(result.current.form.keyword).toBe('owner-typed-keyword')
    expect(result.current.form.channelIds).toEqual([12])

    // A fresh array literal with identical content: routeSearch is unchanged, so this must be a
    // no-op for the form, exactly like the rule-edit branch already guarantees for its preload.
    rerender({ enabledBroadcastWaves: ['GR', 'BS'] })

    expect(result.current.form.keyword).toBe('owner-typed-keyword')
    expect(result.current.form.channelIds).toEqual([12])
  })

  it('keeps an in-progress activeRequest when an unrelated re-render replays an unchanged search route', () => {
    const routeState: SearchRouteState = { mode: 'search', shouldAutoSearch: false, query: {} }

    const { result, rerender } = renderHook(
      ({
        enabledBroadcastWaves,
      }: {
        enabledBroadcastWaves: readonly ('GR' | 'BS' | 'CS' | 'SKY')[]
      }) => useHarness(routeState, '', enabledBroadcastWaves),
      { initialProps: { enabledBroadcastWaves: ['GR', 'BS'] as const } },
    )

    act(() => {
      result.current.setActiveRequest({
        body: { option: { times: [{ week: 0x7f }] }, isHalfWidth: false, limit: 100 },
        serial: 1,
        source: 'search-submit',
      })
    })

    expect(result.current.activeRequest?.source).toBe('search-submit')

    rerender({ enabledBroadcastWaves: ['GR', 'BS'] })

    expect(result.current.activeRequest?.source).toBe('search-submit')
  })
})
