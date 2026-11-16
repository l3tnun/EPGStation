import { readFileSync } from 'node:fs'
import { QueryClient } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import {
  useRealtimeConnection,
  type RealtimeConnectionInput,
} from '@/app/hooks/useRealtimeConnection'
import { UNLOADED_NAVIGATION_CONFIG } from '@/app/navigation'
import { describe, expect, it, vi } from 'vitest'
import {
  createSocketIoRealtimeConnector as createSocketIoRealtimeConnectionConnector,
  type RealtimeConnection,
} from '@/app/realtime'
import {
  REALTIME_RECONNECT_QUERY_KEYS,
  REALTIME_UPDATE_ENCODE_QUERY_KEYS,
  REALTIME_UPDATE_STATUS_QUERY_KEYS,
} from '@/app/realtimeInvalidation'

describe('App Shell Socket.IO realtime connector implementation edges', () => {
  it('subscribes only to Socket.IO events the server actually emits', () => {
    const source = readFileSync('src/app/realtime.ts', 'utf8')
    const union = /export type RealtimeEventName =\s*([^\n]*(?:\n[^\n]*)?)/u.exec(source)?.[1] ?? ''
    const names = [...union.matchAll(/'([^']+)'/gu)].map((match) => match[1])

    expect(names).toStrictEqual([
      'connect',
      'disconnect',
      'updateStatus',
      'updateEncode',
      'hlsReady',
    ])
  })

  it('forwards valid HLS readiness events from Socket.IO and ignores malformed payloads', () => {
    const connection = { on: vi.fn<RealtimeConnection['on']>(), off: vi.fn() }
    const onHlsReady = vi.fn()
    const input: RealtimeConnectionInput = {
      realtimeConnectionFactory: () => connection,
      realtimeConnectionConnector: undefined,
      activeServerConfig: UNLOADED_NAVIGATION_CONFIG,
      location: { pathname: '/', search: '', hash: '', state: null, key: 'initial' },
      queryClient: new QueryClient(),
      navigate: vi.fn(),
      showSnackbar: vi.fn(),
      refreshVersion: vi.fn(async () => undefined),
      latestFullRouteRef: { current: '/' },
      suppressedRouteSnackbarClosesRef: { current: 0 },
    }
    const { rerender } = renderHook<boolean, { listener: RealtimeConnectionInput['onHlsReady'] }>(
      ({ listener }) => useRealtimeConnection({ ...input, onHlsReady: listener }),
      { initialProps: { listener: onHlsReady } },
    )
    const findHandler = () => connection.on.mock.calls.find(([event]) => event === 'hlsReady')?.[1]
    const handleReady = findHandler()
    if (handleReady === undefined) throw new Error('The HLS readiness handler was not registered')

    handleReady('invalid')
    handleReady(null)
    handleReady({ streamId: '7', startRequestId: '00000000-0000-4000-8000-000000000007' })
    handleReady({ streamId: 7 })
    expect(onHlsReady).not.toHaveBeenCalled()

    const payload = { streamId: 7, startRequestId: '00000000-0000-4000-8000-000000000007' }
    handleReady(payload)
    expect(onHlsReady).toHaveBeenCalledExactlyOnceWith(payload)

    connection.on.mockClear()
    rerender({ listener: undefined })
    expect(connection.off).toHaveBeenCalledWith('hlsReady', handleReady)
    const handleWithoutListener = findHandler()
    if (handleWithoutListener === undefined)
      throw new Error('The HLS readiness handler was not registered')
    handleWithoutListener(payload)
    expect(onHlsReady).toHaveBeenCalledOnce()
  })

  it('keeps the realtime event to query invalidation matrix explicit and comprehensive', () => {
    expect(REALTIME_UPDATE_STATUS_QUERY_KEYS.map((queryKey) => queryKey.join('/'))).toEqual([
      'dashboard/summary',
      'guide/reserveIndex',
      'onair/broadcasting',
      'onair/watch-info',
      'recorded/list',
      'recorded/detail',
      'video-playback/recorded-watch-info',
      'recording/list',
      'encode/list',
      'reserves/list',
      'search-rule',
      'storages',
    ])
    expect(REALTIME_UPDATE_ENCODE_QUERY_KEYS.map((queryKey) => queryKey.join('/'))).toEqual([
      'encode/list',
    ])
    expect(REALTIME_RECONNECT_QUERY_KEYS.map((queryKey) => queryKey.join('/'))).toEqual([
      'dashboard/summary',
      'guide/schedule',
      'guide/reserveIndex',
      'onair/broadcasting',
      'onair/watch-info',
      'recorded/list',
      'recorded/detail',
      'video-playback/recorded-watch-info',
      'recording/list',
      'encode/list',
      'reserves/list',
      'search-rule',
      'storages',
    ])
  })

  it('builds the socket.io-client URL and subdirectory path from synthetic location data', () => {
    const socket = {
      on: vi.fn(),
      off: vi.fn(),
      disconnect: vi.fn(),
    }
    const io = vi.fn(() => socket)
    const connector = createSocketIoRealtimeConnectionConnector({
      io,
      location: {
        protocol: 'https:',
        hostname: 'example.invalid',
        pathname: '/synthetic/ui/',
      },
    })

    expect(connector({ socketIOPort: 4567 })).toBe(socket)
    expect(io).toHaveBeenCalledWith('https://example.invalid:4567', {
      path: '/synthetic/ui/socket.io',
    })
  })

  it('keeps Socket.IO traffic on the configured socketIOPort like the source Vue client', () => {
    const socket = {
      on: vi.fn(),
      off: vi.fn(),
      disconnect: vi.fn(),
    }
    const io = vi.fn(() => socket)
    const connector = createSocketIoRealtimeConnectionConnector({
      io,
      location: {
        protocol: 'http:',
        hostname: '127.0.0.1',
        pathname: '/',
        port: '5173',
      },
    })

    expect(connector({ socketIOPort: 5173 })).toBe(socket)
    expect(io).toHaveBeenCalledWith('http://127.0.0.1:5173', {
      path: '/socket.io',
    })
  })
})
