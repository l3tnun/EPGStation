import { describe, expect, it, vi } from 'vitest'
import {
  buildDashboardConflictTarget,
  buildDashboardMoreTarget,
  formatDashboardReserveTimeRange,
  formatDashboardTimeRange,
  itemLabel,
  preventIOSScrollChainAtBounds,
  recordedMetadataLines,
  recordedSecondaryText,
  reserveChannelLine,
} from '@/features/dashboard/lib/dashboardFormat'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

function touchMove(element: HTMLElement, clientY: number, cancelable = true) {
  const event = new Event('touchmove', { cancelable, bubbles: true })
  Object.defineProperty(event, 'touches', { value: [{ clientY }] })
  const preventDefault = vi.spyOn(event, 'preventDefault')
  element.dispatchEvent(event)
  return preventDefault
}

function touchStart(element: HTMLElement, clientY?: number) {
  const event = new Event('touchstart', { bubbles: true })
  Object.defineProperty(event, 'touches', { value: clientY === undefined ? [] : [{ clientY }] })
  element.dispatchEvent(event)
}

describe('Dashboard iOS scroll chain guard', () => {
  it('prevents overscroll only inside the fixed shell at the list bounds', () => {
    const element = document.createElement('ul')
    document.body.appendChild(element)
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 300 })
    Object.defineProperty(element, 'clientHeight', { configurable: true, value: 100 })
    const dispose = preventIOSScrollChainAtBounds(element)

    touchStart(element, 100)
    expect(touchMove(element, 150)).not.toHaveBeenCalled()

    document.documentElement.classList.add('fix-address-bar2')
    element.scrollTop = 0
    expect(touchMove(element, 150)).toHaveBeenCalledTimes(1)
    expect(touchMove(element, 50)).not.toHaveBeenCalled()
    expect(touchMove(element, 150, false)).not.toHaveBeenCalled()

    element.scrollTop = 200
    expect(touchMove(element, 50)).toHaveBeenCalledTimes(1)
    expect(touchMove(element, 150)).not.toHaveBeenCalled()

    element.scrollTop = 100
    expect(touchMove(element, 150)).not.toHaveBeenCalled()

    touchStart(element)
    const noTouches = new Event('touchmove', { cancelable: true })
    Object.defineProperty(noTouches, 'touches', { value: [] })
    const preventDefault = vi.spyOn(noTouches, 'preventDefault')
    element.dispatchEvent(noTouches)
    expect(preventDefault).not.toHaveBeenCalled()

    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 100 })
    expect(touchMove(element, 150)).not.toHaveBeenCalled()

    dispose()
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 300 })
    element.scrollTop = 0
    expect(touchMove(element, 150)).not.toHaveBeenCalled()
    document.documentElement.classList.remove('fix-address-bar2')
    element.remove()
  })
})

describe('Dashboard formatting helpers', () => {
  it('builds more and conflict targets with a timestamp', () => {
    expect(buildDashboardMoreTarget('/recorded')).toMatch(/^\/recorded\?page=2&timestamp=\d+$/)
    expect(buildDashboardConflictTarget()).toMatch(/^\/reserves\?type=conflict&timestamp=\d+$/)
  })

  it('labels items and channels with fallbacks', () => {
    expect(itemLabel({ name: 'n', id: 1 }, 0)).toBe('n')
    expect(itemLabel({ id: 2 }, 0)).toBe('#2')
    expect(itemLabel({}, 4)).toBe('#5')
    expect(reserveChannelLine({ id: 1, channelName: 'c' })).toBe('c')
    expect(reserveChannelLine({ id: 1, channelId: 9 })).toBe('channel 9')
    expect(reserveChannelLine({ id: 1 })).toBeUndefined()
  })

  it('formats ranges only when both ends exist', () => {
    const startAt = Date.parse('2026-05-05T10:15:00+09:00')
    const endAt = Date.parse('2026-05-05T10:45:00+09:00')
    expect(formatDashboardTimeRange({ startAt, endAt })).toBe('05/05(火) 10:15 ~ 10:45 (30 m)')
    expect(formatDashboardTimeRange({ startAt })).toBeUndefined()
    expect(formatDashboardTimeRange({ endAt })).toBeUndefined()
    expect(formatDashboardReserveTimeRange({ id: 1, startAt, endAt })).toBe(
      '05/05(火) 10:15 ~ 10:45 (30分)',
    )
    expect(formatDashboardReserveTimeRange({ id: 1, startAt })).toBeUndefined()
    expect(formatDashboardReserveTimeRange({ id: 1, endAt })).toBeUndefined()
  })

  it('shows drop counts with the total size instead of the description when configured', () => {
    const settings = new DefaultSettingsFactory().create()
    const dropInfo = { ...settings, isShowDropInfoInsteadOfDescription: true }
    const dropLogFile = { dropCnt: 1, errorCnt: 2, scramblingCnt: 3 }
    expect(
      recordedSecondaryText(
        { dropLogFile, videoFiles: [{ size: 10 }, { size: 5 }, {}], description: 'd' },
        dropInfo,
      ),
    ).toBe('1/2/3 15 bytes')
    expect(recordedSecondaryText({ dropLogFile, videoFiles: [{}] }, dropInfo)).toBe('1/2/3')
    expect(recordedSecondaryText({ dropLogFile }, dropInfo)).toBe('1/2/3')
    expect(recordedSecondaryText({ description: 'd', extended: 'e' }, dropInfo)).toBe('d')
    expect(recordedSecondaryText({ dropLogFile, extended: 'e' }, settings)).toBe('e')
    expect(recordedSecondaryText({}, settings)).toBe('')
  })

  it('lists channel and time metadata that exist', () => {
    const startAt = Date.parse('2026-05-05T10:15:00+09:00')
    const endAt = Date.parse('2026-05-05T10:45:00+09:00')
    expect(recordedMetadataLines({ channelName: 'c', startAt, endAt })).toStrictEqual([
      'c',
      '05/05(火) 10:15 ~ 10:45 (30 m)',
    ])
    expect(recordedMetadataLines({ channelId: 4 })).toStrictEqual(['channel 4'])
    expect(recordedMetadataLines({})).toStrictEqual([])
  })

  it('[AC dashboard.format] falls back to an empty date part when the formatter omits it', () => {
    const startAt = Date.parse('2026-05-05T10:15:00+09:00')
    const endAt = Date.parse('2026-05-05T10:45:00+09:00')
    const original = Intl.DateTimeFormat.prototype.formatToParts
    Intl.DateTimeFormat.prototype.formatToParts = function (...args) {
      return original.apply(this, args).filter((part) => part.type !== 'minute')
    }

    try {
      expect(formatDashboardTimeRange({ startAt, endAt })).toBe('05/05(火) 10:00 ~ 10:00 (30 m)')
    } finally {
      Intl.DateTimeFormat.prototype.formatToParts = original
    }
  })
})
