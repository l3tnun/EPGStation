import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveBrowserScrollPosition } from '@/app/scroll/sessionScrollHistory'
import { readCurrentRouteScrollPosition, useScrollHistory } from '@/app/scroll/scrollHistoryContext'

vi.mock('@/app/scroll/sessionScrollHistory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/scroll/sessionScrollHistory')>()),
  resolveBrowserScrollPosition: vi.fn(() => ({ x: 1, y: 2 })),
}))

function addShellMain(scrollLeft: number, scrollTop: number): HTMLElement {
  const element = document.createElement('div')
  element.setAttribute('data-testid', 'shell-main')
  Object.defineProperty(element, 'scrollLeft', { value: scrollLeft })
  Object.defineProperty(element, 'scrollTop', { value: scrollTop })
  document.body.append(element)

  return element
}

describe('current route scroll position', () => {
  beforeEach(() => {
    document.documentElement.classList.remove('fix-address-bar2')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.classList.remove('fix-address-bar2')
    document.querySelectorAll("[data-testid='shell-main']").forEach((element) => element.remove())
    vi.unstubAllGlobals()
  })

  it('reads the shell main element only while the address bar fix class is set', () => {
    addShellMain(30, 40)

    expect(readCurrentRouteScrollPosition()).toStrictEqual({ x: 1, y: 2 })

    document.documentElement.classList.add('fix-address-bar2')
    expect(readCurrentRouteScrollPosition()).toStrictEqual({ x: 30, y: 40 })
  })

  it('falls back to the window position when the fix class is set but there is no shell main', () => {
    document.documentElement.classList.add('fix-address-bar2')

    expect(readCurrentRouteScrollPosition()).toStrictEqual({ x: 1, y: 2 })
    expect(resolveBrowserScrollPosition).toHaveBeenCalled()
  })

  it('uses the window position without a document', () => {
    vi.stubGlobal('document', undefined)

    expect(readCurrentRouteScrollPosition()).toStrictEqual({ x: 1, y: 2 })
  })
})

describe('scroll history without a provider', () => {
  it('behaves as an empty history and refuses to record anything', async () => {
    const { result } = renderHook(() => useScrollHistory())
    const history = result.current

    expect(history.isNeedRestoreHistory()).toBe(false)
    expect(history.getScrollData()).toBeNull()
    expect(history.getHistoryPosition()).toBeNull()
    await expect(history.onDoneGetData()).resolves.toBeUndefined()
    expect(history.clearRestoreHistory()).toBeUndefined()
    expect(() => history.saveScrollData({ x: 0, y: 0 } as never)).toThrow(
      'ScrollHistoryProviderMissing',
    )
    expect(() => history.updateHistoryPosition(0 as never)).toThrow('ScrollHistoryProviderMissing')
    expect(() => history.emitDoneGetData()).toThrow('ScrollHistoryProviderMissing')
  })
})
