import { describe, expect, it } from 'vitest'
import {
  createRouteHistoryUrl,
  findGuideDialogProgram,
  getBrowserLocalStorage,
  hasTimestampHistoryKey,
} from '@/features/guide/lib/guidePageState'

describe('getBrowserLocalStorage', () => {
  it('returns undefined instead of window.localStorage when window is unavailable', () => {
    const original = globalThis.window

    // @ts-expect-error simulating a non-browser runtime for this assertion only
    globalThis.window = undefined
    try {
      expect(getBrowserLocalStorage()).toBeUndefined()
    } finally {
      globalThis.window = original
    }
  })
})

describe('findGuideDialogProgram', () => {
  it('returns null when no schedule contains a program with the requested id', () => {
    expect(
      findGuideDialogProgram([{ channel: { id: 1 }, programs: [{ id: 10, name: 'other' }] }], 999),
    ).toBeNull()
  })

  it('omits channelId and channelName when neither the program nor schedule provides them', () => {
    expect(
      findGuideDialogProgram([{ programs: [{ id: 10, name: 'no channel info' }] }], 10),
    ).toStrictEqual({ id: 10, name: 'no channel info' })
  })
})

describe('createRouteHistoryUrl', () => {
  it('returns undefined instead of a URL when window is unavailable', () => {
    const original = globalThis.window

    // @ts-expect-error simulating a non-browser runtime for this assertion only
    globalThis.window = undefined
    try {
      expect(createRouteHistoryUrl({ pathname: '/guide', search: '', hash: '' })).toBeUndefined()
    } finally {
      globalThis.window = original
    }
  })
})

describe('hasTimestampHistoryKey', () => {
  it('returns false when there is no route history url at all', () => {
    expect(hasTimestampHistoryKey(undefined)).toBe(false)
  })

  it('reads the query string directly when the url has no hash segment', () => {
    expect(hasTimestampHistoryKey('https://example.test/?timestamp=1')).toBe(true)
  })

  it('returns false when the url has no query string to inspect', () => {
    expect(hasTimestampHistoryKey('https://example.test/#/guide')).toBe(false)
  })
})
