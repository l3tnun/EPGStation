import { describe, expect, it, vi } from 'vitest'
import {
  DISCONNECT_MESSAGE,
  RECONNECT_MESSAGE,
  SOCKET_INITIALIZATION_FAILURE_MESSAGE,
  createSocketIoRealtimeConnector,
} from '@/app/realtime'

describe('Socket.IO realtime connector', () => {
  it('announces connection changes with the fixed messages', () => {
    expect(SOCKET_INITIALIZATION_FAILURE_MESSAGE).toBe('SocketIO の初期設定に失敗しました')
    expect(DISCONNECT_MESSAGE).toBe('接続が切断されました')
    expect(RECONNECT_MESSAGE).toBe('再接続されました')
  })

  it('connects to the page host on the server socket port with the socket.io path under the page directory', () => {
    const io = vi.fn(() => ({ on: vi.fn(), off: vi.fn() }))
    const connector = createSocketIoRealtimeConnector({
      io,
      location: { protocol: 'https:', hostname: 'host.example', pathname: '/sub/dir/index.html' },
    })

    connector({ socketIOPort: 8889 })

    expect(io).toHaveBeenCalledWith('https://host.example:8889', { path: '/sub/dir/socket.io' })
  })

  it('uses the browser location when none is given', () => {
    const io = vi.fn(() => ({ on: vi.fn(), off: vi.fn() }))
    const connector = createSocketIoRealtimeConnector({ io })

    connector({ socketIOPort: 8889 })

    expect(io).toHaveBeenCalledWith(
      `${window.location.protocol}//${window.location.hostname}:8889`,
      {
        path: `${window.location.pathname.replace(/\/[^/]*$/, '')}/socket.io`,
      },
    )
  })
})
