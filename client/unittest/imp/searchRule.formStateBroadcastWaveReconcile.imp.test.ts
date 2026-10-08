import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { createScrollHistory } from '@/app/scrollHistory'
import type { BroadcastWave } from '@/app/navigation'
import { useSearchRuleFormState } from '@/features/search/rule/hooks/useSearchRuleFormState'
import type { SearchRouteState } from '@/features/search/rule/query'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

const routeState: SearchRouteState = { mode: 'search', shouldAutoSearch: false, query: {} }
const sharedSettings = new DefaultSettingsFactory().create()

function useHarness(enabledBroadcastWaves: readonly BroadcastWave[]) {
  const [scrollHistory] = useState(() => createScrollHistory({ shouldRestoreHistory: false }))

  return useSearchRuleFormState({
    routeState,
    routeSearch: '',
    enabledBroadcastWaves,
    encodeModes: [],
    settings: sharedSettings,
    scrollHistory,
  })
}

describe('useSearchRuleFormState broadcast wave set reconciliation', () => {
  it('defaults a newly-visible wave to checked while keeping an already-unchecked wave unchecked', () => {
    // The reconciliation effect (useSearchRuleFormState.ts, 137-144 行目) only reconciles the
    // *key set* of broadcastWaves, not the checked values users already set: an existing wave's
    // value is read back with `current.broadcastWaves[wave] ?? true`, so a wave already present
    // keeps whatever the user chose, and only a wave absent until now (undefined) falls back to
    // checked, matching v2's default of every wave enabled.
    const { result, rerender } = renderHook(
      ({ enabledBroadcastWaves }: { enabledBroadcastWaves: readonly BroadcastWave[] }) =>
        useHarness(enabledBroadcastWaves),
      { initialProps: { enabledBroadcastWaves: ['GR'] as readonly BroadcastWave[] } },
    )

    expect(result.current.form.broadcastWaves).toEqual({ GR: true })

    act(() => {
      result.current.setForm((current) => ({
        ...current,
        broadcastWaves: { ...current.broadcastWaves, GR: false },
      }))
    })
    expect(result.current.form.broadcastWaves.GR).toBe(false)

    rerender({ enabledBroadcastWaves: ['GR', 'BS'] })

    expect(result.current.form.broadcastWaves).toEqual({ GR: false, BS: true })
  })
})
