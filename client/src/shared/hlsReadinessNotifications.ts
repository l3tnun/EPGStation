import { createContext } from 'react'

export function createHlsReadinessNotifications() {
  const listeners = new Set<() => void>()
  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    notify(): void {
      for (const listener of [...listeners]) {
        listener()
      }
    },
  }
}

export const HlsReadinessNotificationsContext = createContext<
  ReturnType<typeof createHlsReadinessNotifications> | undefined
>(undefined)
