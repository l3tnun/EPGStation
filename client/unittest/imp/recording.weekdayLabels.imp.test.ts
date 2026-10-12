import { describe, expect, it } from 'vitest'
import {
  RECORDING_CARD_LAYOUT_MEDIA_QUERY,
  formatFullTime,
  formatShortTime,
} from '@/features/recording/lib/recordingFormat'

describe('Recording weekday labels', () => {
  const labels = ['日', '月', '火', '水', '木', '金', '土']

  it('labels each JST weekday from Sunday to Saturday', () => {
    labels.forEach((label, offset) => {
      const startAt = Date.UTC(2026, 0, 4 + offset, 3, 0)
      const endAt = startAt + 30 * 60 * 1000
      const day = String(4 + offset).padStart(2, '0')

      expect(formatShortTime({ startAt, endAt })).toBe(`01/${day}(${label}) 12:00 (30 m)`)
      expect(formatFullTime({ startAt, endAt })).toBe(`01/${day}(${label}) 12:00 ~ 12:30 (30 m)`)
    })
  })

  it('uses the card layout media query at the maximum width', () => {
    expect(RECORDING_CARD_LAYOUT_MEDIA_QUERY).toBe('(max-width: 600px)')
  })
})
