import { createContext, createElement, useContext, useEffect, type ReactNode } from 'react'
import { resolveBrowserScrollPosition } from './sessionScrollHistory'
import type { ScrollHistoryState, ScrollPosition } from './scrollHistoryTypes'

export function readCurrentRouteScrollPosition(): ScrollPosition {
  if (
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('fix-address-bar2')
  ) {
    const shellMain = document.querySelector<HTMLElement>("[data-testid='shell-main']")

    if (shellMain !== null) {
      return {
        x: shellMain.scrollLeft,
        y: shellMain.scrollTop,
      }
    }
  }

  return resolveBrowserScrollPosition()
}

function createMissingScrollHistory(): ScrollHistoryState {
  return {
    isNeedRestoreHistory: () => false,
    saveScrollData() {
      throw new Error('ScrollHistoryProviderMissing')
    },
    getScrollData: () => null,
    getHistoryPosition: () => null,
    updateHistoryPosition() {
      throw new Error('ScrollHistoryProviderMissing')
    },
    emitDoneGetData() {
      throw new Error('ScrollHistoryProviderMissing')
    },
    onDoneGetData: async () => undefined,
    clearRestoreHistory() {
      return undefined
    },
  }
}

const ScrollHistoryContext = createContext<ScrollHistoryState>(createMissingScrollHistory())

export function ScrollHistoryProvider({
  scrollHistory,
  children,
}: {
  scrollHistory: ScrollHistoryState
  children: ReactNode
}) {
  return createElement(ScrollHistoryContext.Provider, { value: scrollHistory }, children)
}

export function useScrollHistory(): ScrollHistoryState {
  return useContext(ScrollHistoryContext)
}

export function useScrollHistoryPageReady(isReady: boolean, readyKey: unknown = null): void {
  const scrollHistory = useScrollHistory()

  useEffect(() => {
    if (!isReady) {
      return
    }

    scrollHistory.emitDoneGetData()
  }, [isReady, readyKey, scrollHistory])
}

export async function restoreScrollHistoryBeforeVisible<T>(
  scrollHistory: ScrollHistoryState,
  restore: (data: T) => void,
  timeout?: number,
): Promise<void> {
  await scrollHistory.onDoneGetData(timeout)

  if (!scrollHistory.isNeedRestoreHistory()) {
    return
  }

  const scrollData = scrollHistory.getScrollData<T>()

  if (scrollData !== null) {
    restore(scrollData)
  }

  scrollHistory.clearRestoreHistory()
}
