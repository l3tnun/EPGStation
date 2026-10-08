import {
  createDoneGetDataSignal,
  type CreateSessionScrollHistoryOptions,
  type ScrollHistoryState,
  type ScrollPosition,
} from './scrollHistoryTypes'

const SCROLL_HISTORY_STORAGE_KEY = 'historyInfo'

interface ScrollHistoryEntry {
  key: string
  url: string
  data: unknown
  position: ScrollPosition | null
}

interface StoredScrollHistory {
  history: ScrollHistoryEntry[]
  currentPosition: number
}

function isScrollPosition(value: unknown): value is ScrollPosition {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const position = value as Partial<ScrollPosition>

  return typeof position.x === 'number' && typeof position.y === 'number'
}

function isScrollHistoryEntry(value: unknown): value is ScrollHistoryEntry {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const entry = value as Partial<ScrollHistoryEntry>

  return (
    typeof entry.key === 'string' &&
    typeof entry.url === 'string' &&
    (entry.position === null || isScrollPosition(entry.position))
  )
}

function readStoredHistory(storage: Pick<Storage, 'getItem'>): StoredScrollHistory {
  const rawValue = storage.getItem(SCROLL_HISTORY_STORAGE_KEY)

  if (rawValue === null) {
    return {
      history: [],
      currentPosition: -1,
    }
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<StoredScrollHistory>

    if (!Array.isArray(parsed.history) || typeof parsed.currentPosition !== 'number') {
      return {
        history: [],
        currentPosition: -1,
      }
    }

    return {
      history: parsed.history.filter(isScrollHistoryEntry),
      currentPosition: parsed.currentPosition,
    }
  } catch {
    return {
      history: [],
      currentPosition: -1,
    }
  }
}

function writeStoredHistory(
  storage: Pick<Storage, 'setItem'>,
  storedHistory: StoredScrollHistory,
): void {
  storage.setItem(SCROLL_HISTORY_STORAGE_KEY, JSON.stringify(storedHistory))
}

function extractRouteKeyFromUrl(url: string): string {
  if (url.includes('#')) {
    // Splitting on '#' after confirming it is present always yields a defined second element
    // (possibly an empty string), so there is no missing-fragment case to fall back from.
    return url.split('#')[1]
  }

  try {
    const parsedUrl = new URL(url)

    return `${parsedUrl.pathname}${parsedUrl.search}`
  } catch {
    return url
  }
}

function resolveHistoryKey(url: string): string {
  return extractRouteKeyFromUrl(url)
}

export function resolveBrowserScrollPosition(): ScrollPosition {
  return {
    x: window.scrollX,
    y: window.scrollY,
  }
}

export function createSessionScrollHistory(
  options: CreateSessionScrollHistoryOptions,
): ScrollHistoryState {
  let storedHistory: StoredScrollHistory | null = null
  let shouldRestoreHistory = false
  const doneGetData = createDoneGetDataSignal()
  const scrollPositionProvider = options.scrollPositionProvider ?? resolveBrowserScrollPosition

  // readStoredHistory always resolves a concrete StoredScrollHistory (never null), so once this
  // runs the first time, storedHistory stays non-null for the rest of this closure's lifetime.
  const restoreStorage = (): StoredScrollHistory => {
    if (storedHistory === null) {
      storedHistory = readStoredHistory(options.storage)
    }

    return storedHistory
  }
  const getCurrentEntry = (): ScrollHistoryEntry | null => {
    const history = restoreStorage()

    return history.history[history.currentPosition] ?? null
  }
  const updateEntry = (position?: ScrollPosition, explicitUrl?: string) => {
    const history = restoreStorage()
    doneGetData.reset()

    const url = explicitUrl ?? options.locationProvider()
    const key = resolveHistoryKey(url)
    const previousPosition = history.currentPosition
    const existingPosition = history.history.findIndex((entry) => entry.key === key)

    if (existingPosition === -1) {
      const historyPosition = position ?? scrollPositionProvider()
      const nextPosition = history.currentPosition + 1
      history.history = history.history.slice(0, nextPosition)
      history.history.push({
        key,
        url,
        data: null,
        position: historyPosition,
      })
      history.currentPosition = nextPosition
      shouldRestoreHistory = false
      persist(history)
      return
    }

    history.currentPosition = existingPosition
    if (position !== undefined) {
      history.history[existingPosition].position = position
    }
    shouldRestoreHistory = previousPosition !== existingPosition
    persist(history)
  }
  // Callers always pass the StoredScrollHistory they just resolved via restoreStorage, so there is
  // no missing-history case to guard here.
  const persist = (history: StoredScrollHistory) => {
    writeStoredHistory(options.storage, history)
  }

  return {
    isNeedRestoreHistory() {
      return shouldRestoreHistory
    },

    saveScrollData<T>(data: T, explicitUrl?: string) {
      let currentEntry = getCurrentEntry()

      // updateEntry always leaves currentPosition pointing at a valid entry (either the one it
      // just pushed, or a pre-existing match), so getCurrentEntry() right after it can never
      // return null here.
      if (currentEntry === null) {
        updateEntry(undefined, explicitUrl)
        currentEntry = getCurrentEntry() as ScrollHistoryEntry
      }

      if (explicitUrl !== undefined && currentEntry.url !== explicitUrl) {
        updateEntry(undefined, explicitUrl)
        currentEntry = getCurrentEntry() as ScrollHistoryEntry
      }

      currentEntry.data = data
      persist(restoreStorage())
    },

    getScrollData<T>() {
      const currentEntry = getCurrentEntry()

      if (currentEntry === null || currentEntry.data === null) {
        return null
      }

      return currentEntry.data as T
    },

    getHistoryPosition() {
      return getCurrentEntry()?.position ?? null
    },

    updateHistoryPosition(position, explicitUrl) {
      updateEntry(position, explicitUrl)
    },

    emitDoneGetData() {
      doneGetData.emit()
    },

    onDoneGetData(timeout) {
      return doneGetData.wait(timeout)
    },

    clearRestoreHistory() {
      shouldRestoreHistory = false
    },
  }
}
