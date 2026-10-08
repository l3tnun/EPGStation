import { describe, expect, it } from 'vitest'
import { resolveBrowserTitle, resolveDashboardTitle } from '@/app/titleBar'

describe('Title bar title resolver implementation edges', () => {
  it('uses the Dashboard version string for the Dashboard title contract', () => {
    expect(resolveDashboardTitle({ version: '1.2.3' })).toBe('EPGStation v1.2.3')
    expect(resolveDashboardTitle({ version: null })).toBe('EPGStation')
  })

  it('keeps non-Dashboard browser titles owned by the routed screen title', () => {
    expect(resolveBrowserTitle({ routeKind: 'screen', title: '予約' })).toBe('予約')
    expect(resolveBrowserTitle({ routeKind: 'dashboard', version: '2.0.0' })).toBe(
      'EPGStation v2.0.0',
    )
  })
})
