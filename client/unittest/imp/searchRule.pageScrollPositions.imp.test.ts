import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { scrollActivePageToTop, scrollToElementHead } from '@/features/search/rule/lib/pageScroll'

function rectAt(top: number): HTMLElement {
  const element = document.createElement('div')
  element.getBoundingClientRect = () => ({ top }) as DOMRect
  return element
}

function addTitleBar(height: number): void {
  const titleBar = document.createElement('div')
  titleBar.setAttribute('data-testid', 'title-bar')
  Object.defineProperty(titleBar, 'clientHeight', { value: height, configurable: true })
  document.body.appendChild(titleBar)
}

function addShellMain(top: number, scrollTop: number): HTMLElement {
  const shell = document.createElement('div')
  shell.setAttribute('data-testid', 'shell-main')
  shell.getBoundingClientRect = () => ({ top }) as DOMRect
  Object.defineProperty(shell, 'scrollTop', { value: scrollTop, configurable: true })
  shell.scrollTo = vi.fn() as never
  document.body.appendChild(shell)
  document.documentElement.classList.add('fix-address-bar2')
  return shell
}

describe('searchRule page scroll positions', () => {
  let windowScrollTo: ReturnType<typeof vi.fn>

  beforeEach(() => {
    windowScrollTo = vi.fn()
    window.scrollTo = windowScrollTo as never
    Object.defineProperty(window, 'pageYOffset', { value: 100, configurable: true })
  })

  afterEach(() => {
    document.body.innerHTML = ''
    document.documentElement.classList.remove('fix-address-bar2')
  })

  it('scrolls the window to the element minus title bar and offset, adding the page offset', () => {
    addTitleBar(20)

    expect(scrollToElementHead(rectAt(300), { offset: 10, behavior: 'auto' })).toBe(true)

    expect(windowScrollTo).toHaveBeenCalledTimes(1)
    expect(windowScrollTo).toHaveBeenCalledWith({ top: 370, behavior: 'auto' })
  })

  it('scrolls the fixed shell container relative to its own position', () => {
    addTitleBar(20)
    const shell = addShellMain(50, 100)

    expect(scrollToElementHead(rectAt(300), { offset: 10, behavior: 'auto' })).toBe(true)

    expect(shell.scrollTo).toHaveBeenCalledTimes(1)
    expect(shell.scrollTo).toHaveBeenCalledWith({ top: 320, behavior: 'auto' })
    expect(windowScrollTo).not.toHaveBeenCalled()
  })

  it('scrolls the fixed shell container to the top rather than the window', () => {
    const shell = addShellMain(0, 40)

    expect(scrollActivePageToTop('auto')).toBe(true)

    expect(shell.scrollTo).toHaveBeenCalledTimes(1)
    expect(shell.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
    expect(windowScrollTo).not.toHaveBeenCalled()
  })

  it('scrolls the window to the top when there is no fixed shell', () => {
    expect(scrollActivePageToTop('auto')).toBe(true)

    expect(windowScrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
  })
})
