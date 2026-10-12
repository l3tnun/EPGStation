import { expect, type Locator, type Page } from '@playwright/test'
import { createServer, type Server as HttpServer } from 'node:http'
import { Server as SocketIOServer } from 'socket.io'
import { installAppShellApiMocks } from './appShellMocks'

export function countRecordedDetailRequests(paths: readonly string[]): number {
  return paths.filter((path) => /\/api\/recorded\/\d+(?:\?|$)/.test(path)).length
}

export function countRequests(methods: readonly string[], method: string): number {
  return methods.filter((entry) => entry === method).length
}

export async function emitUntilRequestCountIncreases({
  emit,
  getRequestCount,
  previousCount,
}: {
  emit: () => void
  getRequestCount: () => number
  previousCount: number
}): Promise<void> {
  // D: no fixed target count to cite - previousCount is a call-site value, and "greater than" is
  // the only correct assertion since emit() may fire more than once before the count updates.
  await expect
    .poll(
      () => {
        emit()
        return getRequestCount()
      },
      { timeout: 15_000 },
    )
    .toBeGreaterThan(previousCount)
}

/**
 * Socket.IO の通知は取りこぼしても再送されない。画面遷移の直後に 1 度だけ送ると、購読が
 * 整う前に届いて何も起きないことがある。期待する内容が現れるまで送り続ける。
 */
export async function emitUntilTextAppears({
  emit,
  locator,
  expected,
  timeout = 10_000,
}: {
  emit: () => void
  locator: Locator
  expected: string
  timeout?: number
}): Promise<void> {
  await expect
    .poll(
      async () => {
        emit()
        return locator.textContent()
      },
      { timeout },
    )
    .toContain(expected)
}

export interface RealtimeHarness {
  socketIOPort: number
  socketServer: SocketIOServer
  close: () => Promise<void>
  emitUpdateStatus: () => void
  emitUpdateEncode: () => void
  waitForClient: () => Promise<void>
  waitForClientCount: (count: number) => Promise<void>
}

export async function createRealtimeHarness(page: Page): Promise<RealtimeHarness> {
  const httpServer: HttpServer = createServer()
  const socketServer = new SocketIOServer(httpServer, {
    cors: { origin: '*' },
    path: '/socket.io',
  })

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve)
  })

  const address = httpServer.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Socket.IO test server did not bind to a TCP port')
  }

  await installAppShellApiMocks(page, { socketIOPort: address.port })

  return {
    socketIOPort: address.port,
    socketServer,
    close: () =>
      new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 1_000)
        const finish = () => {
          clearTimeout(timeout)
          resolve()
        }
        socketServer.disconnectSockets(true)
        socketServer.close(() => {
          httpServer.close(() => finish())
        })
      }),
    emitUpdateStatus: () => socketServer.emit('updateStatus'),
    emitUpdateEncode: () => socketServer.emit('updateEncode'),
    // D: 0 is the logical minimum, not a borrowed magic number - this only confirms the page's
    // Socket.IO client actually connected to the mock server before a test emits an event.
    waitForClient: () =>
      expect.poll(() => socketServer.engine.clientsCount, { timeout: 10_000 }).toBeGreaterThan(0),
    waitForClientCount: (count) =>
      expect.poll(() => socketServer.engine.clientsCount, { timeout: 10_000 }).toBe(count),
  }
}
