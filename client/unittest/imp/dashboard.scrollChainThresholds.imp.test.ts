import { describe, expect, it, vi } from 'vitest'
import {
  preventIOSScrollChainAtBounds,
  recordedMetadataLines,
} from '@/features/dashboard/lib/dashboardFormat'

function setHeights(element: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: scrollHeight })
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: clientHeight })
}

function touchMove(element: HTMLElement, clientY: number) {
  const event = new Event('touchmove', { cancelable: true, bubbles: true })
  Object.defineProperty(event, 'touches', { value: [{ clientY }] })
  const preventDefault = vi.spyOn(event, 'preventDefault')
  element.dispatchEvent(event)
  return preventDefault
}

function touchStart(element: HTMLElement, clientY: number) {
  const event = new Event('touchstart', { bubbles: true })
  Object.defineProperty(event, 'touches', { value: [{ clientY }] })
  element.dispatchEvent(event)
}

describe('Dashboard iOS scroll chain thresholds', () => {
  it('treats a list as scrollable only when it overflows by more than one pixel', () => {
    document.documentElement.classList.add('fix-address-bar2')
    const element = document.createElement('ul')
    const dispose = preventIOSScrollChainAtBounds(element)

    try {
      touchStart(element, 100)
      element.scrollTop = 0

      setHeights(element, 100, 100)
      expect(touchMove(element, 150)).not.toHaveBeenCalled()
      setHeights(element, 101, 100)
      expect(touchMove(element, 150)).not.toHaveBeenCalled()
      setHeights(element, 102, 100)
      expect(touchMove(element, 150)).toHaveBeenCalledTimes(1)
    } finally {
      dispose()
      document.documentElement.classList.remove('fix-address-bar2')
    }
  })

  it('does not prevent a move that has no vertical delta', () => {
    document.documentElement.classList.add('fix-address-bar2')
    const element = document.createElement('ul')
    setHeights(element, 300, 100)
    const dispose = preventIOSScrollChainAtBounds(element)

    try {
      touchStart(element, 100)

      element.scrollTop = 0
      expect(touchMove(element, 100)).not.toHaveBeenCalled()

      element.scrollTop = 200
      expect(touchMove(element, 100)).not.toHaveBeenCalled()
    } finally {
      dispose()
      document.documentElement.classList.remove('fix-address-bar2')
    }
  })

  it('treats one pixel short of the end as the bottom', () => {
    document.documentElement.classList.add('fix-address-bar2')
    const element = document.createElement('ul')
    setHeights(element, 300, 100)
    const dispose = preventIOSScrollChainAtBounds(element)

    try {
      touchStart(element, 100)

      element.scrollTop = 199
      expect(touchMove(element, 50)).toHaveBeenCalledTimes(1)
      element.scrollTop = 198
      expect(touchMove(element, 50)).not.toHaveBeenCalled()
    } finally {
      dispose()
      document.documentElement.classList.remove('fix-address-bar2')
    }
  })

  it('registers a passive touchstart and a non-passive touchmove, and removes both', () => {
    const element = document.createElement('ul')
    const add = vi.spyOn(element, 'addEventListener')
    const remove = vi.spyOn(element, 'removeEventListener')

    const dispose = preventIOSScrollChainAtBounds(element)

    expect(add).toHaveBeenCalledTimes(2)
    expect(add).toHaveBeenCalledWith('touchstart', expect.any(Function), { passive: true })
    expect(add).toHaveBeenCalledWith('touchmove', expect.any(Function), { passive: false })

    dispose()

    const startHandler = add.mock.calls.find(([type]) => type === 'touchstart')?.[1]
    const moveHandler = add.mock.calls.find(([type]) => type === 'touchmove')?.[1]
    expect(remove).toHaveBeenCalledTimes(2)
    expect(remove).toHaveBeenCalledWith('touchstart', startHandler)
    expect(remove).toHaveBeenCalledWith('touchmove', moveHandler)
  })
})

describe('Dashboard recorded metadata lines', () => {
  it('drops an empty channel name', () => {
    const startAt = Date.parse('2026-05-05T10:15:00+09:00')
    const endAt = Date.parse('2026-05-05T10:45:00+09:00')

    expect(recordedMetadataLines({ channelName: '' })).toStrictEqual([])
    expect(recordedMetadataLines({ channelName: '', startAt, endAt })).toStrictEqual([
      '05/05(火) 10:15 ~ 10:45 (30 m)',
    ])
  })
})
