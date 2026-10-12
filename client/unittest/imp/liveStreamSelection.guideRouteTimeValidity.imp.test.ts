import { describe, expect, it } from 'vitest'
import { isGuideRouteTimeValue } from '@/features/onair/lib/liveStreamSelection'

describe('isGuideRouteTimeValue calendar validity', () => {
  it('accepts real dates including the first and last hour of the year', () => {
    expect(isGuideRouteTimeValue('26010100')).toBe(true)
    expect(isGuideRouteTimeValue('26123123')).toBe(true)
    expect(isGuideRouteTimeValue('24022912')).toBe(true)
  })

  it('rejects dates that roll over into another month, day or hour', () => {
    expect(isGuideRouteTimeValue('26023001')).toBe(false)
    expect(isGuideRouteTimeValue('25022912')).toBe(false)
    expect(isGuideRouteTimeValue('26043100')).toBe(false)
    expect(isGuideRouteTimeValue('26010125')).toBe(false)
    expect(isGuideRouteTimeValue('26010124')).toBe(false)
    expect(isGuideRouteTimeValue('26133101')).toBe(false)
    expect(isGuideRouteTimeValue('26000101')).toBe(false)
    expect(isGuideRouteTimeValue('26013200')).toBe(false)
    expect(isGuideRouteTimeValue('26010100x')).toBe(false)
  })
})
