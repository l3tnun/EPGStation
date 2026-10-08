import { act, fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppSelect, type AppSelectProps } from '@/shared/AppSelect'
import { LegacyPagination } from '@/shared/LegacyPagination'

describe('shared AppSelect control edges', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('[AC 8.1] joins multiple resolved option labels when the underlying value is an array', () => {
    render(
      <AppSelect
        ariaLabel="複数値セレクト"
        options={[
          { value: 'a', label: 'ラベルA' },
          { value: 'b', label: 'ラベルB' },
        ]}
        showEmptyOptionLabel
        // AppSelect never renders as `multiple`, but MUI's renderValue contract still accepts an
        // array; force that shape here to exercise the defensive array-handling branch.
        value={['a', 'b'] as unknown as AppSelectProps['value']}
        onChange={() => undefined}
      />,
    )

    expect(screen.getByText('ラベルA, ラベルB')).toBeInTheDocument()
  })

  it('[AC 8.2] shows the empty option label when every resolved value is blank', () => {
    render(
      <AppSelect
        ariaLabel="空セレクト"
        options={[{ value: '', label: '未選択' }]}
        showEmptyOptionLabel
        value=""
        onChange={() => undefined}
      />,
    )

    expect(screen.getByText('未選択')).toBeInTheDocument()
  })

  it('[AC 8.3] shows an empty string when no empty option label is defined and the value is blank', () => {
    render(
      <AppSelect
        ariaLabel="ラベルなしセレクト"
        options={[{ value: 'a', label: 'ラベルA' }]}
        showEmptyOptionLabel
        value=""
        onChange={() => undefined}
      />,
    )

    expect(screen.queryByText('ラベルA')).not.toBeInTheDocument()
  })

  it('[AC 8.4] clears the value when the clear button is clicked', () => {
    const onClear = vi.fn()

    render(
      <AppSelect
        ariaLabel="クリア可能セレクト"
        clearable
        options={[{ value: 'a', label: 'ラベルA' }]}
        onClear={onClear}
        value="a"
        onChange={() => undefined}
      />,
    )

    const clearButton = screen.getByRole('button', { name: 'クリア可能セレクトをクリア' })
    fireEvent.mouseDown(clearButton)
    fireEvent.click(clearButton)

    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('shows the raw value itself when the current value matches no option, since it has no label to resolve', () => {
    // AppSelect's `renderOptions` (used to populate the menu) synthesizes a hidden placeholder
    // option `{ value: selectedValue, label: selectedValue }` so MUI's Select doesn't warn about
    // an out-of-list value, but `defaultRenderValue` (used for the closed control's displayed
    // text) looks the value up in the original `options` prop, not `renderOptions` - so that
    // synthesized label is never found there either, and `?.label` falls back to the raw value
    // itself (AppSelect.tsx 111 行目).
    render(
      <AppSelect
        ariaLabel="未知の値セレクト"
        options={[{ value: 'a', label: 'ラベルA' }]}
        showEmptyOptionLabel
        value="missing-value"
        onChange={() => undefined}
      />,
    )

    expect(screen.getByText('missing-value')).toBeInTheDocument()
    expect(screen.queryByText('ラベルA')).not.toBeInTheDocument()
  })

  it('[AC 8.5] marks an option disabled only when its own disabled flag is set', () => {
    render(
      <AppSelect
        ariaLabel="無効オプションセレクト"
        options={[
          { value: 'a', label: 'ラベルA', disabled: true },
          { value: 'b', label: 'ラベルB' },
        ]}
        value="a"
        onChange={() => undefined}
      />,
    )

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '無効オプションセレクト' }))

    expect(screen.getByRole('option', { name: 'ラベルA' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('option', { name: 'ラベルB' })).not.toHaveAttribute('aria-disabled')
  })
})

describe('shared LegacyPagination viewport-driven layout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    const visualViewportDescriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    if (visualViewportDescriptor === undefined) {
      Reflect.deleteProperty(window, 'visualViewport')
    }
  })

  it('[AC 8.6] falls back to the desktop pagination layout without a window (server-side render)', () => {
    vi.stubGlobal('window', undefined)

    try {
      const html = renderToStaticMarkup(
        <LegacyPagination page={50} pageSize={1} total={100} onPageChange={() => undefined} />,
      )

      expect(html).toContain('49 ページ')
      expect(html).toContain('...')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('[AC 8.7] ignores document.documentElement.clientWidth without a document (server-side render)', () => {
    vi.stubGlobal('window', {
      innerWidth: 400,
      visualViewport: undefined,
    })
    vi.stubGlobal('document', undefined)

    try {
      const html = renderToStaticMarkup(
        <LegacyPagination page={3} pageSize={10} total={200} onPageChange={() => undefined} />,
      )

      expect(html).toContain('前のページ')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('[AC 8.8] falls back to the default desktop layout when no viewport width source resolves', () => {
    const innerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    const documentDescriptor = Object.getOwnPropertyDescriptor(
      window.document.documentElement,
      'clientWidth',
    )
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 0 })
    Object.defineProperty(window.document.documentElement, 'clientWidth', {
      configurable: true,
      value: 0,
    })

    try {
      render(<LegacyPagination page={50} pageSize={1} total={100} onPageChange={() => undefined} />)

      expect(screen.getAllByText('...').length).toBe(2)
    } finally {
      if (innerWidthDescriptor !== undefined) {
        Object.defineProperty(window, 'innerWidth', innerWidthDescriptor)
      }
      if (documentDescriptor !== undefined) {
        Object.defineProperty(window.document.documentElement, 'clientWidth', documentDescriptor)
      }
    }
  })

  it('[AC 8.9] centers the mobile page window near the start of a long list', () => {
    const innerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })

    try {
      render(<LegacyPagination page={1} pageSize={1} total={20} onPageChange={() => undefined} />)

      // page=1 collapses to the "currentPage <= 2" branch (startPage stays 1).
      expect(screen.getByRole('button', { name: '1 ページ' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '5 ページ' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '6 ページ' })).not.toBeInTheDocument()
    } finally {
      if (innerWidthDescriptor !== undefined) {
        Object.defineProperty(window, 'innerWidth', innerWidthDescriptor)
      }
    }
  })

  it('[AC 8.10] centers the mobile page window near the end of a long list', () => {
    const innerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 })

    try {
      render(<LegacyPagination page={20} pageSize={1} total={20} onPageChange={() => undefined} />)

      // page=20 with pageCount=20 collapses to the "pageCount - currentPage < 2" branch.
      expect(screen.getByRole('button', { name: '16 ページ' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: '20 ページ' })).toBeInTheDocument()
    } finally {
      if (innerWidthDescriptor !== undefined) {
        Object.defineProperty(window, 'innerWidth', innerWidthDescriptor)
      }
    }
  })

  it('[AC 8.11] renders nothing when the total does not exceed one page', () => {
    const { container } = render(
      <LegacyPagination page={1} pageSize={20} total={10} onPageChange={() => undefined} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('[AC 8.12] collapses to the mobile pagination layout under the mobile width threshold', () => {
    const innerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 480 })

    try {
      render(<LegacyPagination page={3} pageSize={10} total={200} onPageChange={() => undefined} />)

      expect(screen.getByRole('button', { name: '1 ページ' })).toBeInTheDocument()
      expect(screen.queryByText('...')).not.toBeInTheDocument()
    } finally {
      if (innerWidthDescriptor !== undefined) {
        Object.defineProperty(window, 'innerWidth', innerWidthDescriptor)
      }
    }
  })

  it('[AC 8.13] uses visualViewport width over window.innerWidth when it resolves narrower', () => {
    const innerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    const visualViewportDescriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        width: 400,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })

    try {
      render(<LegacyPagination page={3} pageSize={10} total={200} onPageChange={() => undefined} />)

      expect(screen.getByRole('button', { name: '1 ページ' })).toBeInTheDocument()
      expect(screen.queryByText('...')).not.toBeInTheDocument()
    } finally {
      if (innerWidthDescriptor !== undefined) {
        Object.defineProperty(window, 'innerWidth', innerWidthDescriptor)
      }
      if (visualViewportDescriptor !== undefined) {
        Object.defineProperty(window, 'visualViewport', visualViewportDescriptor)
      } else {
        Reflect.deleteProperty(window, 'visualViewport')
      }
    }
  })

  it('[AC 8.14] shows the desktop ellipsis clusters when the current page is near the end', () => {
    render(<LegacyPagination page={98} pageSize={1} total={100} onPageChange={() => undefined} />)

    const ellipses = screen.getAllByText('...')
    expect(ellipses.length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '100 ページ' })).toBeInTheDocument()
  })

  it('[AC 8.15] shows both ellipsis clusters when the current page is in the middle', () => {
    render(<LegacyPagination page={50} pageSize={1} total={100} onPageChange={() => undefined} />)

    expect(screen.getAllByText('...').length).toBe(2)
    expect(screen.getByRole('button', { name: '49 ページ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '50 ページ' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '51 ページ' })).toBeInTheDocument()
  })

  it('[AC 8.16] re-renders visible pages when the viewport resizes', () => {
    const innerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })

    try {
      render(<LegacyPagination page={50} pageSize={1} total={100} onPageChange={() => undefined} />)

      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 480 })
      fireEvent.resize(window)

      expect(screen.getByRole('button', { name: '48 ページ' })).toBeInTheDocument()
      expect(screen.queryByText('...')).not.toBeInTheDocument()
    } finally {
      if (innerWidthDescriptor !== undefined) {
        Object.defineProperty(window, 'innerWidth', innerWidthDescriptor)
      }
    }
  })

  it('[AC 8.17] narrows the desktop ellipsis cluster to the real measured element width via ResizeObserver, matching v2 VPagination fluid window', () => {
    // v2 Vuetify VPagination.onResize() (VPagination.ts:156-161):
    //   maxButtons = Math.floor((width - 96) / 42)
    // A measured width of 432 yields maxButtons = floor((432-96)/42) = 8, so
    // computeDesktopPaginationItems(20, 3, 8) narrows to a 4-first / 3-last cluster
    // (maxLength=8, even=1, left=4, right=20-4+1+1=18).
    let resizeCallback: ResizeObserverCallback | undefined
    const observe = vi.fn()
    const disconnect = vi.fn()
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }
      observe = observe
      disconnect = disconnect
      unobserve = vi.fn()
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)

    const { unmount } = render(
      <LegacyPagination page={3} pageSize={1} total={20} onPageChange={() => undefined} />,
    )

    const nav = screen.getByRole('navigation', { name: 'ページ' })
    expect(observe).toHaveBeenCalledWith(nav)

    Object.defineProperty(nav, 'clientWidth', { configurable: true, value: 432 })
    act(() => {
      resizeCallback?.([] as unknown as ResizeObserverEntry[], {} as ResizeObserver)
    })

    expect(screen.getByRole('button', { name: '4 ページ' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '5 ページ' })).not.toBeInTheDocument()
    expect(screen.getByText('...')).toBeVisible()
    expect(screen.getByRole('button', { name: '18 ページ' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '17 ページ' })).not.toBeInTheDocument()

    unmount()
    expect(disconnect).toHaveBeenCalled()
  })
})
