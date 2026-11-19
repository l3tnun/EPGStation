import { createContext } from 'react'
import type { HlsReadyEvent } from '@/app/realtime'

export function createHlsReadyNotifications() {
  const listeners = new Set<(event: HlsReadyEvent) => void>()
  return {
    subscribe(listener: (event: HlsReadyEvent) => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    notify(event: HlsReadyEvent): void {
      for (const listener of [...listeners]) listener(event)
    },
  }
}

export const HlsReadyNotificationsContext = createContext<
  ReturnType<typeof createHlsReadyNotifications> | undefined
>(undefined)
