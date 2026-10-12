export interface ScrollPosition {
  x: number
  y: number
}

export interface ScrollHistoryState {
  isNeedRestoreHistory(): boolean
  saveScrollData<T>(data: T, url?: string): void
  getScrollData<T>(): T | null
  getHistoryPosition(): ScrollPosition | null
  updateHistoryPosition(position?: ScrollPosition, url?: string): void
  emitDoneGetData(): void
  onDoneGetData(timeout?: number): Promise<void>
  clearRestoreHistory(): void
}

export interface CreateScrollHistoryOptions {
  shouldRestoreHistory: boolean
  initialScrollPosition?: ScrollPosition
}

export interface CreateSessionScrollHistoryOptions {
  storage: Pick<Storage, 'getItem' | 'setItem'>
  locationProvider: () => string
  scrollPositionProvider?: () => ScrollPosition
}

const DEFAULT_DONE_GET_DATA_TIMEOUT_MS = 5000

export function createDoneGetDataSignal() {
  let isDoneGetData = false
  const listeners = new Set<{
    resolve: () => void
    timeoutId: ReturnType<typeof setTimeout>
  }>()

  return {
    reset() {
      isDoneGetData = false
      listeners.forEach((listener) => {
        clearTimeout(listener.timeoutId)
        listener.resolve()
      })
      listeners.clear()
    },

    emit() {
      if (isDoneGetData) {
        return
      }

      isDoneGetData = true
      listeners.forEach((listener) => {
        clearTimeout(listener.timeoutId)
        listener.resolve()
      })
      listeners.clear()
    },

    wait(timeout = DEFAULT_DONE_GET_DATA_TIMEOUT_MS) {
      if (isDoneGetData) {
        return Promise.resolve()
      }

      return new Promise<void>((resolve) => {
        const listener = {
          resolve,
          timeoutId: setTimeout(() => {
            listeners.delete(listener)
            resolve()
          }, timeout),
        }
        listeners.add(listener)
      })
    },
  }
}
