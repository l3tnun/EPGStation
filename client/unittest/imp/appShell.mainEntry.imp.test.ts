import type { Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

let capturedRoot: Root | undefined

vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>()

  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      capturedRoot = actual.createRoot(...args)
      return capturedRoot
    },
  }
})

describe('App Shell main entry point', () => {
  afterEach(() => {
    capturedRoot?.unmount()
    capturedRoot = undefined
    vi.restoreAllMocks()
    vi.resetModules()
    document.body.innerHTML = ''
  })

  it('mounts the App into the #root element on import', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response('failure', { status: 500 }),
    )

    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)

    await import('@/main')
    await vi.waitFor(() => {
      expect(root.querySelector("[data-testid='app-shell']")).not.toBeNull()
    })

    expect(capturedRoot).toBeDefined()
  })
})
