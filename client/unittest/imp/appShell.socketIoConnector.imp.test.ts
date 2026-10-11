import { describe, expect, it, vi } from 'vitest'
import { createSocketIoRealtimeConnector } from '@/app/realtime'

describe('Socket.IO realtime connector', () => {
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

    expect(io).toHaveBeenCalledWith(`${window.location.protocol}//${window.location.hostname}:8889`, {
      path: `${window.location.pathname.replace(/\/[^/]*$/, '')}/socket.io`,
    })
  })
})
