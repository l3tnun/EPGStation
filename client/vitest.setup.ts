import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

const storageData = new WeakMap<Storage, Map<string, string>>()

Object.defineProperties(Storage.prototype, {
  length: {
    configurable: true,
    get(this: Storage) {
      return storageData.get(this)?.size ?? 0
    },
  },
  clear: {
    configurable: true,
    value(this: Storage) {
      storageData.get(this)?.clear()
    },
  },
  getItem: {
    configurable: true,
    value(this: Storage, key: string) {
      return storageData.get(this)?.get(String(key)) ?? null
    },
  },
  key: {
    configurable: true,
    value(this: Storage, index: number) {
      return Array.from(storageData.get(this)?.keys() ?? [])[index] ?? null
    },
  },
  removeItem: {
    configurable: true,
    value(this: Storage, key: string) {
      storageData.get(this)?.delete(String(key))
    },
  },
  setItem: {
    configurable: true,
    value(this: Storage, key: string, value: string) {
      storageData.get(this)?.set(String(key), String(value))
    },
  },
})

const createTestStorage = (): Storage => {
  const storage = Object.create(Storage.prototype) as Storage
  storageData.set(storage, new Map<string, string>())

  return storage
}

const localStorageMock = createTestStorage()
const sessionStorageMock = createTestStorage()

Object.defineProperties(globalThis, {
  localStorage: {
    configurable: true,
    get: () => localStorageMock,
  },
  sessionStorage: {
    configurable: true,
    get: () => sessionStorageMock,
  },
})

Object.defineProperties(window, {
  localStorage: {
    configurable: true,
    get: () => localStorageMock,
  },
  sessionStorage: {
    configurable: true,
    get: () => sessionStorageMock,
  },
})

// jsdom does not implement `window.matchMedia` at all (there is no layout/CSS engine behind it),
// but the app itself now depends on it for two things that are decided by a media query rather than by comparing a
// JS-measured width (App Shell's desktop/mobile drawer breakpoint, and the Recording page's
// card-vs-table breakpoint -- see browserAdapters.ts/isDesktopViewport and
// recordingFormat.ts/readIsCardLayout). Without a polyfill every test that does not explicitly
// stub `matchMedia` itself (most tests drive the App Shell breakpoint through the separate
// `viewportWidth` prop seam instead, but Recording's breakpoint has no such seam) would silently
// evaluate every media query as non-matching. This polyfill only understands a single
// `(min-width: Npx)`/`(max-width: Npx)` feature -- the only shape either call site uses -- and
// evaluates it against `window.innerWidth`, so existing tests that drive layout by setting
// `window.innerWidth` and firing a `resize` event keep working unchanged. A test that wants a
// specific `matches` value can still `Object.defineProperty(window, 'matchMedia', ...)` over this
// default, exactly as the existing OS-dark-preference tests already do.
if (typeof window.matchMedia !== 'function') {
  const WIDTH_MEDIA_QUERY_PATTERN = /^\(\s*(min|max)-width:\s*(\d+(?:\.\d+)?)px\s*\)$/

  const evaluateWidthMediaQuery = (query: string): boolean => {
    const match = WIDTH_MEDIA_QUERY_PATTERN.exec(query.trim())
    if (match === null) {
      return false
    }

    const [, boundType, pixels] = match
    const threshold = Number(pixels)

    return boundType === 'min' ? window.innerWidth >= threshold : window.innerWidth <= threshold
  }

  type ChangeListener = (event: { matches: boolean; media: string }) => void

  const matchMediaPolyfill = (query: string) => {
    const changeListeners = new Set<ChangeListener>()
    let matches = evaluateWidthMediaQuery(query)
    let isSubscribedToResize = false

    const recomputeMatches = () => {
      const nextMatches = evaluateWidthMediaQuery(query)
      if (nextMatches === matches) {
        return
      }

      matches = nextMatches
      const event = { matches, media: query }
      changeListeners.forEach((listener) => listener(event))
    }

    const subscribeToResizeIfNeeded = () => {
      if (!isSubscribedToResize) {
        window.addEventListener('resize', recomputeMatches)
        isSubscribedToResize = true
      }
    }

    const unsubscribeFromResizeIfUnused = () => {
      if (isSubscribedToResize && changeListeners.size === 0) {
        window.removeEventListener('resize', recomputeMatches)
        isSubscribedToResize = false
      }
    }

    const addEventListener = (type: string, listener: ChangeListener) => {
      if (type === 'change') {
        changeListeners.add(listener)
        subscribeToResizeIfNeeded()
      }
    }

    const removeEventListener = (type: string, listener: ChangeListener) => {
      if (type === 'change') {
        changeListeners.delete(listener)
        unsubscribeFromResizeIfUnused()
      }
    }

    return {
      get matches() {
        return matches
      },
      media: query,
      onchange: null,
      addEventListener,
      removeEventListener,
      addListener: (listener: ChangeListener | null) => {
        if (listener !== null) {
          addEventListener('change', listener)
        }
      },
      removeListener: (listener: ChangeListener | null) => {
        if (listener !== null) {
          removeEventListener('change', listener)
        }
      },
      dispatchEvent: () => true,
    }
  }

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: matchMediaPolyfill as unknown as typeof window.matchMedia,
  })
}

vi.mock('aribb24.js', () => ({
  Controller: class {
    public attachMedia(): void {
      return undefined
    }

    public detachMedia(): void {
      return undefined
    }

    public attachFeeder(): void {
      return undefined
    }

    public detachFeeder(): void {
      return undefined
    }

    public attachRenderer(): void {
      return undefined
    }

    public detachRenderer(): void {
      return undefined
    }

    public show(): void {
      return undefined
    }

    public hide(): void {
      return undefined
    }
  },
  MPEGTSFeeder: class {
    public feedID3(): void {
      return undefined
    }

    public feedB24(): void {
      return undefined
    }

    public destroy(): void {
      return undefined
    }
  },
  CanvasMainThreadRenderer: class {
    public destroy(): void {
      return undefined
    }
  },
}))
