import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useShellSettings } from '@/app/hooks/useShellSettings'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import type { SettingsConsumerValue } from '@/shared/settings'

describe('useShellSettings activeDashboardSettings reference stability', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('[Fix #35] keeps the same activeDashboardSettings object across re-renders when nothing changed', () => {
    const settings = new DefaultSettingsFactory().create()

    const { result, rerender } = renderHook(
      (props: Parameters<typeof useShellSettings>[0]) => useShellSettings(props),
      { initialProps: { settings, navigationSettings: undefined } },
    )

    const firstDashboardSettings = result.current.activeDashboardSettings

    // Re-rendering with the exact same props object must not produce a new reference: an
    // unrelated ancestor re-render (e.g. AppRoot reacting to a scrollbar-driven viewport width
    // change via useResolvedViewportWidth) passes the same `settings` prop again, and any effect
    // that lists `activeDashboardSettings` in its dependency array must be able to rely on the
    // reference staying stable when the content has not changed.
    rerender({ settings, navigationSettings: undefined })
    expect(result.current.activeDashboardSettings).toBe(firstDashboardSettings)

    // A content-equal but distinct `settings` object (the shape a caller that builds a fresh
    // object literal every render would pass) must also resolve to the same cached reference.
    const contentEqualSettings = { ...settings }
    rerender({ settings: contentEqualSettings, navigationSettings: undefined })
    expect(result.current.activeDashboardSettings).toBe(firstDashboardSettings)
    expect(result.current.activeDashboardSettings).toEqual(settings)
  })

  it('[Fix #35] returns a new activeDashboardSettings object once the merged content actually changes', () => {
    const settings = new DefaultSettingsFactory().create()

    const { result, rerender } = renderHook(
      (props: Parameters<typeof useShellSettings>[0]) => useShellSettings(props),
      { initialProps: { settings, navigationSettings: undefined } },
    )

    const firstDashboardSettings = result.current.activeDashboardSettings

    const changedSettings = { ...settings, isHalfWidthDisplayed: !settings.isHalfWidthDisplayed }
    rerender({ settings: changedSettings, navigationSettings: undefined })

    expect(result.current.activeDashboardSettings).not.toBe(firstDashboardSettings)
    expect(result.current.activeDashboardSettings).toEqual(changedSettings)
  })

  it('[Fix #35] treats the merged dashboard settings as changed once they gain a key beyond the schema (extra-key defense)', () => {
    const settings = new DefaultSettingsFactory().create()

    const { result, rerender } = renderHook(
      (props: Parameters<typeof useShellSettings>[0]) => useShellSettings(props),
      { initialProps: { settings, navigationSettings: undefined } },
    )

    const firstDashboardSettings = result.current.activeDashboardSettings

    // The equality check inside useShellSettings only iterates the *previous* value's own keys
    // (see useShellSettings.ts), so it cannot notice an extra key by walking that key's value -
    // a key-count comparison is the only signal that catches the new value gaining a key the
    // previous value never had. Simulate that by merging in a key outside
    // `SettingsConsumerValue`'s schema; a type assertion is required because that schema has no
    // index signature, so TypeScript would otherwise reject the extra property.
    const settingsWithExtraKey = {
      ...settings,
      unexpectedExtraKey: 'unexpected-value',
    } as SettingsConsumerValue

    rerender({ settings: settingsWithExtraKey, navigationSettings: undefined })

    // If the key-count guard were missing, `keys.every` walking only the previous (33-key)
    // value's own keys would report "equal" and the stale, extra-key-free reference would be
    // kept even though the merged settings actually grew a key.
    expect(result.current.activeDashboardSettings).not.toBe(firstDashboardSettings)
    expect(result.current.activeDashboardSettings).toEqual(settingsWithExtraKey)
  })
})
