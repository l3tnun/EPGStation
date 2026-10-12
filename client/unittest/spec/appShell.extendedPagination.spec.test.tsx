import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExtendedPagination } from '@/shared/ExtendedPagination'

// jsdom has no layout engine and no ResizeObserver. These stubs describe a real browser's
// measurement: the `<nav>` is `navWidth` wide and every button is 34px wide with 3px margins on
// both sides, so neighbouring buttons sit 40px apart.
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  disconnected = false

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this)
  }

  observe() {
    this.callback([], this as unknown as ResizeObserver)
  }

  unobserve() {}

  disconnect() {
    this.disconnected = true
  }

  trigger() {
    this.callback([], this as unknown as ResizeObserver)
  }
}

interface LayoutOptions {
  navWidth: number
  buttonWidth?: number
  pitch?: number
}

function stubLayout({ navWidth, buttonWidth = 34, pitch = 40 }: LayoutOptions) {
  const state = { navWidth, buttonWidth, pitch }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
    return this.tagName === 'NAV' ? state.navWidth : 0
  })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.tagName === 'BUTTON' && this.closest('nav') !== null ? state.buttonWidth : 0
  })
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.parentElement === null
      ? 0
      : Array.prototype.indexOf.call(this.parentElement.children, this) * state.pitch
  })

  return {
    resize(width: number) {
      state.navWidth = width
      act(() => FakeResizeObserver.instances.forEach((observer) => observer.trigger()))
    },
  }
}

function renderPagination(
  props: Partial<{ page: number; pageSize: number; total: number }> = {},
  onPageChange = vi.fn(),
) {
  const view = render(
    <ExtendedPagination
      page={props.page ?? 24}
      pageSize={props.pageSize ?? 24}
      total={props.total ?? 1125}
      onPageChange={onPageChange}
    />,
  )

  return { ...view, onPageChange }
}

function navButtons() {
  return within(screen.getByRole('navigation', { name: 'ページ' })).getAllByRole('button')
}

function visibleNumbers() {
  return navButtons()
    .map((button) => button.textContent ?? '')
    .filter((text) => /^[0-9]+$/.test(text))
    .map(Number)
}

function setVisualViewport(initial: { height: number; offsetTop: number }) {
  const target = new EventTarget() as EventTarget & { height: number; offsetTop: number }
  target.height = initial.height
  target.offsetTop = initial.offsetTop
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: target })

  return target
}

function setInnerHeight(height: number) {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
}

describe('ExtendedPagination display (Requirements 8.33-8.38)', () => {
  beforeEach(() => {
    FakeResizeObserver.instances = []
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('[AC 8.33] renders nothing when everything fits on one page', () => {
    const { container } = renderPagination({ total: 24, pageSize: 24 })

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('[AC 8.33] renders nothing for an empty list', () => {
    const { container } = renderPagination({ total: 0, pageSize: 24 })

    expect(container).toBeEmptyDOMElement()
  })

  it('[AC 8.33][AC 8.34] lists ≪, the page numbers, then ≫ in one row with their accessible names', () => {
    stubLayout({ navWidth: 360 })
    renderPagination({ page: 24 })

    expect(navButtons().map((button) => button.getAttribute('aria-label'))).toStrictEqual([
      '最初のページへ移動',
      'ページ21へ移動',
      'ページ22へ移動',
      'ページ23へ移動',
      'ページ数を入力して移動',
      'ページ25へ移動',
      'ページ26へ移動',
      'ページ27へ移動',
      '最後のページへ移動',
    ])
    expect(screen.getByRole('button', { name: 'ページ数を入力して移動' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(navButtons().filter((button) => button.hasAttribute('aria-current'))).toHaveLength(1)
  })

  it('[AC 8.34] moves with the number buttons and with ≪ and ≫', () => {
    stubLayout({ navWidth: 360 })
    const { onPageChange } = renderPagination({ page: 24 })

    fireEvent.click(screen.getByRole('button', { name: 'ページ26へ移動' }))
    fireEvent.click(screen.getByRole('button', { name: 'ページ21へ移動' }))
    fireEvent.click(screen.getByRole('button', { name: '最初のページへ移動' }))
    fireEvent.click(screen.getByRole('button', { name: '最後のページへ移動' }))

    expect(onPageChange.mock.calls).toStrictEqual([[26], [21], [1], [47]])
  })

  it('[AC 8.34] disables ≪ on the first page and ≫ on the last page, and does not move from them', () => {
    stubLayout({ navWidth: 360 })
    const first = renderPagination({ page: 1 })

    const firstButton = screen.getByRole('button', { name: '最初のページへ移動' })
    const lastButton = screen.getByRole('button', { name: '最後のページへ移動' })
    expect(firstButton).toBeDisabled()
    expect(lastButton).toBeEnabled()
    fireEvent.click(firstButton)
    expect(first.onPageChange).not.toHaveBeenCalled()
    first.unmount()

    const last = renderPagination({ page: 47 })
    expect(screen.getByRole('button', { name: '最初のページへ移動' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '最後のページへ移動' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '最後のページへ移動' }))
    expect(last.onPageChange).not.toHaveBeenCalled()
  })

  it('[AC 8.34] keeps both ends enabled in the middle', () => {
    stubLayout({ navWidth: 360 })
    renderPagination({ page: 10 })

    expect(screen.getByRole('button', { name: '最初のページへ移動' })).toBeEnabled()
    expect(screen.getByRole('button', { name: '最後のページへ移動' })).toBeEnabled()
  })

  it.each([
    [279, 7],
    [320, 7],
    [359, 7],
    [360, 9],
    [440, 11],
    [520, 13],
    [600, 15],
    [680, 17],
    [1200, 17],
  ])(
    '[AC 8.35] at a measured width of %ipx the row has %i elements including ≪ and ≫',
    (width, expected) => {
      stubLayout({ navWidth: width })
      renderPagination({ page: 24 })

      expect(navButtons()).toHaveLength(expected)
    },
  )

  it('[AC 8.35] keeps the 7-element minimum before anything is measured', () => {
    // No ResizeObserver in jsdom: nothing is ever measured.
    renderPagination({ page: 24 })

    expect(navButtons()).toHaveLength(7)
  })

  it('[AC 8.35] re-selects the element count when the measured width changes', () => {
    const layout = stubLayout({ navWidth: 320 })
    renderPagination({ page: 24 })
    expect(navButtons()).toHaveLength(7)

    layout.resize(700)
    expect(navButtons()).toHaveLength(17)

    layout.resize(400)
    expect(navButtons()).toHaveLength(9)
  })

  it('[AC 8.35] uses the measured button width and margin instead of fixed sizes', () => {
    stubLayout({ navWidth: 400, buttonWidth: 40, pitch: 48 })
    renderPagination({ page: 24 })

    // 9 * 48 = 432 > 400, so only 7 fit.
    expect(navButtons()).toHaveLength(7)
  })

  it('[AC 8.35] falls back to the default button size when the buttons cannot be measured', () => {
    stubLayout({ navWidth: 360, buttonWidth: 0 })
    renderPagination({ page: 24 })

    // default 34px + 6px = 40px per element: 9 * 40 = 360 fits.
    expect(navButtons()).toHaveLength(9)
  })

  it('[AC 8.35] falls back to the default margin when the distance between buttons cannot be measured', () => {
    stubLayout({ navWidth: 360, pitch: 0 })
    renderPagination({ page: 24 })

    // default 34px button + 6px margins = 40px per element: 9 * 40 = 360 fits.
    expect(navButtons()).toHaveLength(9)
  })

  it('[AC 8.35] stops observing when it unmounts', () => {
    stubLayout({ navWidth: 360 })
    const { unmount } = renderPagination({ page: 24 })

    expect(FakeResizeObserver.instances.every((observer) => !observer.disconnected)).toBe(true)
    unmount()
    expect(FakeResizeObserver.instances.every((observer) => observer.disconnected)).toBe(true)
  })

  it('[AC 8.36] shows only the pages that exist when there are fewer pages than the row could hold', () => {
    stubLayout({ navWidth: 1200 })
    renderPagination({ page: 2, total: 72 })

    expect(visibleNumbers()).toStrictEqual([1, 2, 3])
    expect(navButtons()).toHaveLength(5)
  })

  it('[AC 8.36] shows two pages as ≪ 1 2 ≫', () => {
    stubLayout({ navWidth: 1200 })
    renderPagination({ page: 1, total: 30 })

    expect(visibleNumbers()).toStrictEqual([1, 2])
    expect(navButtons()).toHaveLength(4)
  })

  it('[AC 8.37] centers the current page and shifts the window at both ends without losing numbers', () => {
    stubLayout({ navWidth: 440 })

    const middle = renderPagination({ page: 24 })
    expect(visibleNumbers()).toStrictEqual([20, 21, 22, 23, 24, 25, 26, 27, 28])
    middle.unmount()

    const near = renderPagination({ page: 2 })
    expect(visibleNumbers()).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    near.unmount()

    const first = renderPagination({ page: 1 })
    expect(visibleNumbers()).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    first.unmount()

    const end = renderPagination({ page: 47 })
    expect(visibleNumbers()).toStrictEqual([39, 40, 41, 42, 43, 44, 45, 46, 47])
    end.unmount()

    renderPagination({ page: 46 })
    expect(visibleNumbers()).toStrictEqual([39, 40, 41, 42, 43, 44, 45, 46, 47])
  })

  it('[AC 8.37] clamps a page outside the range to the nearest real page', () => {
    stubLayout({ navWidth: 360 })
    renderPagination({ page: 999 })

    expect(visibleNumbers()).toStrictEqual([41, 42, 43, 44, 45, 46, 47])
    expect(screen.getByRole('button', { name: 'ページ数を入力して移動' })).toHaveTextContent('47')
  })

  it('[AC 8.38] marks only the current page with scale(1.1) without changing its box', () => {
    const css = readFileSync('src/shared/ExtendedPagination.module.css', 'utf8')
    const button = css.match(/\.pageButton\s*\{([^}]*)\}/s)?.[1] ?? ''
    const current = css.match(/\.pageButton\[aria-current='page'\]\s*\{([^}]*)\}/s)?.[1] ?? ''

    expect(button).toMatch(/width:\s*34px;/)
    expect(button).toMatch(/margin:\s*4px 3px;/)
    expect(button).toMatch(/flex:\s*0 0 auto;/)
    expect(button).toMatch(/transform:\s*scale\(1\);/)
    expect(current).not.toMatch(/color|background/)
    expect(current).toMatch(/transform:\s*scale\(1\.1\);/)
    // The enlarged page must not change the layout box: no width, height, margin or padding.
    expect(current).not.toMatch(/(?:^|[;\s])(?:min-|max-)?(?:width|height)\s*:/)
    expect(current).not.toMatch(/margin|padding|border-width|font-size/)
  })

  it('[AC 8.48] takes the colors from the module shared with LegacyPagination and defines none itself', () => {
    const css = readFileSync('src/shared/ExtendedPagination.module.css', 'utf8')
    const source = readFileSync('src/shared/ExtendedPagination.tsx', 'utf8')
    const legacy = readFileSync('src/shared/LegacyPagination.tsx', 'utf8')

    expect(css).not.toMatch(/(?:^|[;{\s])(?:background|color|box-shadow)\s*:/)
    expect(source).toContain("from './PaginationColors.module.css'")
    expect(legacy).toContain("from './PaginationColors.module.css'")
  })

  it('[AC 8.46] gives the row no horizontal padding and never lets it exceed its container', () => {
    const css = readFileSync('src/shared/ExtendedPagination.module.css', 'utf8')
    const pagination = css.match(/\.pagination\s*\{([^}]*)\}/s)?.[1] ?? ''

    expect(pagination).toMatch(/max-width:\s*100%;/)
    expect(pagination).toMatch(/min-width:\s*0;/)
    expect(pagination).toMatch(/flex-wrap:\s*nowrap;/)
    expect(pagination).not.toMatch(/padding:\s*0\s+[1-9]/)
    // 72px under the row keeps it clear of the fixed add button (56px + 16px) once scrolled to the end.
    expect(pagination).toMatch(/padding:\s*0 0 72px;/)
  })
})

describe('ExtendedPagination page input dialog (Requirements 8.39-8.45)', () => {
  beforeEach(() => {
    FakeResizeObserver.instances = []
    stubLayout({ navWidth: 360 })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(window, 'visualViewport')
  })

  async function openDialog(props: Partial<{ page: number; total: number }> = {}) {
    const rendered = renderPagination(props)
    fireEvent.click(screen.getByRole('button', { name: 'ページ数を入力して移動' }))
    const dialog = await screen.findByRole('dialog', { name: 'ページ数を入力' })

    return { ...rendered, dialog, input: within(dialog).getByRole('textbox', { name: 'ページ数' }) }
  }

  it('[AC 8.39] opens an empty, focused input dialog from the current page button', async () => {
    const { dialog, input, onPageChange } = await openDialog()

    expect(dialog).toBeVisible()
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('placeholder', '1 〜 47')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    expect(input).toHaveFocus()
    expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '移動' })).toBeVisible()
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('[AC 8.39] does not open from the other number buttons', () => {
    renderPagination()

    fireEvent.click(screen.getByRole('button', { name: 'ページ25へ移動' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('[AC 8.39] empties the input again every time the dialog is opened', async () => {
    const { input } = await openDialog()
    fireEvent.change(input, { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'ページ数を入力して移動' }))

    expect(await screen.findByRole('textbox', { name: 'ページ数' })).toHaveValue('')
  })

  it.each([
    ['', 'empty'],
    ['0', 'zero'],
    ['-3', 'negative'],
    ['2.5', 'decimal'],
    ['abc', 'non-digits'],
    ['１２', 'full-width digits'],
    ['1e1', 'exponent'],
    ['48', 'above the last page'],
    ['999', 'far above the last page'],
  ])('[AC 8.40] does not move for %j (%s) and shows the error without rounding', async (value) => {
    const { dialog, input, onPageChange } = await openDialog()
    fireEvent.change(input, { target: { value } })

    fireEvent.click(within(dialog).getByRole('button', { name: '移動' }))

    expect(onPageChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'ページ数を入力' })).toBeVisible()
    expect(within(dialog).getByText('1 〜 47 の整数を入力してください')).toBeVisible()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveValue(value)
  })

  it('[AC 8.40] rejects an invalid value on Enter too', async () => {
    const { dialog, input, onPageChange } = await openDialog()
    fireEvent.change(input, { target: { value: '48' } })

    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onPageChange).not.toHaveBeenCalled()
    expect(within(dialog).getByText('1 〜 47 の整数を入力してください')).toBeVisible()
  })

  it('[AC 8.40] clears the error message as soon as the input changes', async () => {
    const { dialog, input } = await openDialog()
    fireEvent.change(input, { target: { value: '99' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '移動' }))
    expect(within(dialog).getByText('1 〜 47 の整数を入力してください')).toBeVisible()

    fireEvent.change(input, { target: { value: '9' } })

    expect(within(dialog).queryByText('1 〜 47 の整数を入力してください')).not.toBeInTheDocument()
    expect(input).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('[AC 8.39][AC 8.40] empties the input and drops the error with the clear button', async () => {
    const { dialog, input } = await openDialog()
    fireEvent.change(input, { target: { value: '99' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '移動' }))
    expect(within(dialog).getByText('1 〜 47 の整数を入力してください')).toBeVisible()

    fireEvent.click(within(dialog).getByRole('button', { name: 'ページ数をクリア' }))

    expect(input).toHaveValue('')
    expect(within(dialog).queryByText('1 〜 47 の整数を入力してください')).not.toBeInTheDocument()
  })

  it.each([
    ['1', 1],
    ['47', 47],
    ['12', 12],
    ['007', 7],
  ])(
    '[AC 8.41] moves to page %s with the 移動 button and closes the dialog',
    async (value, expected) => {
      const { dialog, input, onPageChange } = await openDialog()
      fireEvent.change(input, { target: { value } })

      fireEvent.click(within(dialog).getByRole('button', { name: '移動' }))

      expect(onPageChange).toHaveBeenCalledExactlyOnceWith(expected)
      await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    },
  )

  it('[AC 8.41] moves on Enter in the input and closes the dialog', async () => {
    const { input, onPageChange } = await openDialog()
    fireEvent.change(input, { target: { value: '33' } })

    // fireEvent returns false when the default action was cancelled.
    expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false)

    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(33)
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('[AC 8.41] ignores Enter that confirms an IME composition and other keys', async () => {
    const { input, onPageChange } = await openDialog()
    fireEvent.change(input, { target: { value: '33' } })

    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(true)
    expect(fireEvent.keyDown(input, { key: 'a' })).toBe(true)

    expect(onPageChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'ページ数を入力' })).toBeVisible()
  })

  it('[AC 8.41] only closes when the typed page is the current page', async () => {
    const { dialog, input, onPageChange } = await openDialog()
    fireEvent.change(input, { target: { value: '24' } })

    fireEvent.click(within(dialog).getByRole('button', { name: '移動' }))

    expect(onPageChange).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('[AC 8.41] cancels without moving, from the button and from Escape', async () => {
    const first = await openDialog()
    fireEvent.change(first.input, { target: { value: '5' } })
    fireEvent.click(within(first.dialog).getByRole('button', { name: 'キャンセル' }))
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'ページ数を入力して移動' }))
    const dialog = await screen.findByRole('dialog', { name: 'ページ数を入力' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(first.onPageChange).not.toHaveBeenCalled()
  })

  it('[AC 8.45] fades out in 150ms instead of disappearing at once', async () => {
    const { dialog } = await openDialog()
    vi.useFakeTimers()

    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(screen.queryByRole('dialog')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('ExtendedPagination dialog placement (Requirements 8.42-8.44)', () => {
  beforeEach(() => {
    FakeResizeObserver.instances = []
    stubLayout({ navWidth: 360 })
    setInnerHeight(800)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(window, 'visualViewport')
    Reflect.deleteProperty(window, 'innerHeight')
  })

  async function openDialog() {
    renderPagination()
    fireEvent.click(screen.getByRole('button', { name: 'ページ数を入力して移動' }))

    return screen.findByRole('dialog', { name: 'ページ数を入力' })
  }

  const readVars = (dialog: HTMLElement) => ({
    active: dialog.getAttribute('data-visual-viewport'),
    keyboard: dialog.style.getPropertyValue('--extended-pagination-keyboard-height'),
    available: dialog.style.getPropertyValue('--extended-pagination-available-height'),
    offsetTop: dialog.style.getPropertyValue('--extended-pagination-offset-top'),
  })

  it('[AC 8.42] centers the dialog in the area above the software keyboard', async () => {
    setVisualViewport({ height: 500, offsetTop: 0 })

    const dialog = await openDialog()

    expect(readVars(dialog)).toStrictEqual({
      active: 'true',
      keyboard: '300px',
      available: '476px',
      offsetTop: '0px',
    })
  })

  it('[AC 8.42] follows visualViewport resize and scroll while the dialog is open', async () => {
    const viewport = setVisualViewport({ height: 800, offsetTop: 0 })
    const dialog = await openDialog()
    expect(readVars(dialog).keyboard).toBe('0px')

    viewport.height = 420
    act(() => {
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(readVars(dialog)).toMatchObject({ keyboard: '380px', available: '396px' })

    viewport.offsetTop = 64
    act(() => {
      viewport.dispatchEvent(new Event('scroll'))
    })
    expect(readVars(dialog).offsetTop).toBe('64px')
  })

  it('[AC 8.42] subscribes only while the dialog is open and keeps the position while it fades out', async () => {
    const viewport = setVisualViewport({ height: 500, offsetTop: 0 })
    const addListener = vi.spyOn(viewport, 'addEventListener')
    const removeListener = vi.spyOn(viewport, 'removeEventListener')
    renderPagination()
    expect(addListener).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'ページ数を入力して移動' }))
    const dialog = await screen.findByRole('dialog', { name: 'ページ数を入力' })
    expect(addListener.mock.calls.map((call) => call[0]).sort()).toStrictEqual(['resize', 'scroll'])

    fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    expect(removeListener.mock.calls.map((call) => call[0]).sort()).toStrictEqual([
      'resize',
      'scroll',
    ])

    // The keyboard goes away while the dialog is still fading out: it must not jump.
    viewport.height = 800
    act(() => {
      viewport.dispatchEvent(new Event('resize'))
    })
    expect(readVars(dialog).keyboard).toBe('300px')
  })

  it('[AC 8.42] unsubscribes when the page unmounts with the dialog open', async () => {
    const viewport = setVisualViewport({ height: 500, offsetTop: 0 })
    const removeListener = vi.spyOn(viewport, 'removeEventListener')
    const { unmount } = renderPagination()
    fireEvent.click(screen.getByRole('button', { name: 'ページ数を入力して移動' }))
    await screen.findByRole('dialog', { name: 'ページ数を入力' })

    unmount()

    expect(removeListener).toHaveBeenCalledTimes(2)
  })

  it('[AC 8.44] leaves placement to the CSS fallback without visualViewport', async () => {
    const dialog = await openDialog()
    const css = readFileSync('src/shared/ExtendedPagination.module.css', 'utf8')

    expect(readVars(dialog)).toStrictEqual({
      active: null,
      keyboard: '',
      available: '',
      offsetTop: '',
    })
    expect(css).toMatch(
      /@media \(max-width: 600px\)\s*\{[^@]*\.dialogPaper:global\(\.MuiPaper-root\)\s*\{[^}]*align-self:\s*flex-start;[^}]*margin-top:\s*12px;/s,
    )
    expect(css).toMatch(
      /@supports \(height: 100dvh\)\s*\{[^@]*\.dialogPaper:global\(\.MuiPaper-root\)\s*\{[^}]*max-height:\s*calc\(100dvh - 24px\);/s,
    )
  })

  it('[AC 8.42] places the dialog from the visual viewport instead of the CSS fallback', () => {
    const css = readFileSync('src/shared/ExtendedPagination.module.css', 'utf8')
    const block =
      css.match(
        /\.dialogPaper:global\(\.MuiPaper-root\)\[data-visual-viewport='true'\]\s*\{([^}]*)\}/s,
      )?.[1] ?? ''

    expect(block).toMatch(/align-self:\s*center;/)
    expect(block).toMatch(/margin:\s*0;/)
    expect(block).toMatch(/position:\s*relative;/)
    expect(block).toMatch(
      /top:\s*calc\(\s*var\(--extended-pagination-offset-top, 0px\) - var\(--extended-pagination-keyboard-height, 0px\) \/ 2\s*\);/,
    )
    expect(block).toMatch(/max-height:\s*var\(--extended-pagination-available-height/)
  })

  describe('scrolling the focused input into the visible area', () => {
    const scrollIntoView = vi.fn()

    beforeEach(() => {
      scrollIntoView.mockClear()
      Object.defineProperty(Element.prototype, 'scrollIntoView', {
        configurable: true,
        value: scrollIntoView,
      })
    })

    afterEach(() => {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
    })

    function placeInput(input: HTMLElement, top: number, bottom: number) {
      vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({
        top,
        bottom,
        left: 0,
        right: 0,
        width: 0,
        height: bottom - top,
        x: 0,
        y: top,
        toJSON: () => ({}),
      })
    }

    async function openWithFakeTimers() {
      const dialog = await openDialog()
      const input = within(dialog).getByRole('textbox', { name: 'ページ数' })
      vi.useFakeTimers()
      // The dialog focused the input when it opened; focus it again under the fake clock.
      fireEvent.blur(input)

      return { dialog, input }
    }

    it('[AC 8.43] scrolls 300ms after focus when the input is below the visible area', async () => {
      setVisualViewport({ height: 500, offsetTop: 0 })
      const { input } = await openWithFakeTimers()
      placeInput(input, 520, 560)

      fireEvent.focus(input)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(299)
      })
      expect(scrollIntoView).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' })
    })

    it('[AC 8.43] scrolls when the input is above the visible area', async () => {
      setVisualViewport({ height: 500, offsetTop: 100 })
      const { input } = await openWithFakeTimers()
      placeInput(input, 20, 60)

      fireEvent.focus(input)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })

      expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' })
    })

    it('[AC 8.43] does nothing when the input is already inside the visible area', async () => {
      setVisualViewport({ height: 500, offsetTop: 0 })
      const { input } = await openWithFakeTimers()
      placeInput(input, 100, 140)

      fireEvent.focus(input)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })

      expect(scrollIntoView).not.toHaveBeenCalled()
    })

    it('[AC 8.43] measures against the window when there is no visualViewport', async () => {
      const { input } = await openWithFakeTimers()
      placeInput(input, 790, 830)

      fireEvent.focus(input)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300)
      })

      expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' })
    })

    it('[AC 8.43] does nothing when the dialog was closed before the 300ms elapsed', async () => {
      setVisualViewport({ height: 500, offsetTop: 0 })
      const { dialog, input } = await openWithFakeTimers()
      placeInput(input, 520, 560)

      fireEvent.focus(input)
      fireEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })

      expect(scrollIntoView).not.toHaveBeenCalled()
    })

    it('[AC 8.43] restarts the 300ms wait when the input is focused again', async () => {
      setVisualViewport({ height: 500, offsetTop: 0 })
      const { input } = await openWithFakeTimers()
      placeInput(input, 520, 560)

      fireEvent.focus(input)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      fireEvent.focus(input)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      expect(scrollIntoView).not.toHaveBeenCalled()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(100)
      })
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
    })
  })
})
