import { render } from '@testing-library/react'
import { type ReactNode } from 'react'
import { vi } from 'vitest'
import { AppShell } from '@/app/AppShell'

export class SyntheticRealtimeConnection {
  private readonly listeners = new Map<string, Set<() => void>>()

  on(eventName: string, listener: () => void): void {
    const eventListeners = this.listeners.get(eventName) ?? new Set<() => void>()
    eventListeners.add(listener)
    this.listeners.set(eventName, eventListeners)
  }

  off(eventName: string, listener: () => void): void {
    this.listeners.get(eventName)?.delete(listener)
  }

  emit(eventName: string): void {
    this.listeners.get(eventName)?.forEach((listener) => {
      listener()
    })
  }
}

export function createSuccessfulApiRepository(versionSequence: readonly string[]) {
  const versions = [...versionSequence]

  return {
    fetchVersion: vi.fn(async () => ({
      ok: true as const,
      value: {
        version: versions.shift() ?? versionSequence.at(-1) ?? '0.0.0',
      },
    })),
    fetchServerConfig: vi.fn(async () => ({
      ok: true as const,
      value: {
        status: 'loaded' as const,
        liveStreamEnabled: true,
        enabledBroadcastWaves: ['GR', 'BS'] as const,
        socketIOPort: 1234,
      },
    })),
  }
}

export function installDashboardFetchMock() {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)

    if (url.includes('/reserves/cnts')) {
      return new Response(
        JSON.stringify({
          normal: 0,
          conflicts: 0,
          skips: 0,
          overlaps: 0,
        }),
      )
    }

    if (url.includes('/reserves')) {
      return new Response(
        JSON.stringify({
          reserves: [],
          total: 0,
        }),
      )
    }

    if (url.includes('/recording') || url.includes('/recorded')) {
      return new Response(
        JSON.stringify({
          records: [],
          total: 0,
        }),
      )
    }

    throw new Error(`Unexpected dashboard fetch: ${url}`)
  })
}

export function appendHeadElement(element: HTMLElement): HTMLElement {
  document.head.appendChild(element)

  return element
}

export function renderFixedIOSShell(children: ReactNode) {
  document.documentElement.classList.add('fix-address-bar2')

  return render(
    <AppShell
      drawerLayout={{
        drawerVariant: 'temporary',
        drawerWidth: 256,
        isDesktop: false,
        isDrawerOpen: false,
        mainContentOffset: 0,
      }}
      navigationItems={[]}
      themeMode="light"
    >
      {children}
    </AppShell>,
  )
}
