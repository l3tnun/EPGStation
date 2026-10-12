import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  findCandidate,
  getBrowserHref,
  getBrowserLocalStorage,
  isGuideRouteTimeValue,
  repairSelectionForCandidates,
} from '@/features/onair/lib/liveStreamSelection'

describe('liveStreamSelection browser accessors without a window', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fall back to undefined/placeholder values when no window exists', () => {
    vi.stubGlobal('window', undefined)

    expect(getBrowserLocalStorage()).toBeUndefined()
    expect(getBrowserHref()).toBe('http://localhost/')
  })

  it('read the real window when it exists', () => {
    expect(getBrowserLocalStorage()).toBe(window.localStorage)
    expect(getBrowserHref()).toBe(window.location.href)
  })
})

describe('isGuideRouteTimeValue', () => {
  it('rejects values that are not exactly 8 digits', () => {
    expect(isGuideRouteTimeValue('2605050')).toBe(false)
    expect(isGuideRouteTimeValue('260505091')).toBe(false)
    expect(isGuideRouteTimeValue('2605050a')).toBe(false)
  })

  it('rejects an 8-digit value that does not round-trip to a real date/hour', () => {
    expect(isGuideRouteTimeValue('26021924')).toBe(false)
    expect(isGuideRouteTimeValue('26131500')).toBe(false)
  })

  it('accepts an 8-digit value that round-trips to a real date/hour', () => {
    expect(isGuideRouteTimeValue('26050509')).toBe(true)
  })
})

describe('findCandidate and repairSelectionForCandidates', () => {
  it('findCandidate returns undefined when no candidate matches the type', () => {
    expect(findCandidate([{ type: 'HLS', modes: ['a'] }], 'MP4')).toBeUndefined()
  })

  it('repairSelectionForCandidates delegates to normalizeOnAirSelectStreamSetting', () => {
    expect(
      repairSelectionForCandidates({ useURLScheme: false, type: 'HLS', mode: 5 }, [
        { type: 'HLS', modes: ['a'] },
      ]),
    ).toStrictEqual({ useURLScheme: false, type: 'HLS', mode: 0 })
  })
})
