import {
  createDoneGetDataSignal,
  type CreateScrollHistoryOptions,
  type ScrollHistoryState,
  type ScrollPosition,
} from './scrollHistoryTypes'

export function createScrollHistory(options: CreateScrollHistoryOptions): ScrollHistoryState {
  let savedScrollData: unknown = options.initialScrollPosition ?? null
  let savedHistoryPosition: ScrollPosition | null = options.initialScrollPosition ?? null
  let shouldRestoreHistory = options.shouldRestoreHistory
  const doneGetData = createDoneGetDataSignal()

  return {
    isNeedRestoreHistory() {
      return shouldRestoreHistory
    },

    saveScrollData<T>(data: T) {
      savedScrollData = data
    },

    getScrollData<T>() {
      return savedScrollData === null ? null : (savedScrollData as T)
    },

    getHistoryPosition() {
      return savedHistoryPosition
    },

    updateHistoryPosition(position) {
      if (position !== undefined) {
        savedHistoryPosition = position
      }
      doneGetData.reset()
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
