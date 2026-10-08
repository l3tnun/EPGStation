import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createSocketIoRealtimeConnector as createSocketIoRealtimeConnectionConnector } from '@/app/realtime'
import {
  REALTIME_RECONNECT_QUERY_KEYS,
  REALTIME_UPDATE_ENCODE_QUERY_KEYS,
  REALTIME_UPDATE_STATUS_QUERY_KEYS,
} from '@/app/realtimeInvalidation'

describe('App Shell Socket.IO realtime connector implementation edges', () => {
  it('subscribes only to Socket.IO events the server actually emits', () => {
    // `src/model/service/socketio/SocketIOManageModel.ts` emits `updateStatus` and `updateEncode`
    // and nothing else. Subscribing to a name the server never emits, and driving tests through
    // it, covers a path that cannot occur against a real server.
    const source = readFileSync('src/app/realtime.ts', 'utf8')
    const union = /export type RealtimeEventName =\s*([^\n]*(?:\n[^\n]*)?)/u.exec(source)?.[1] ?? ''
    const names = [...union.matchAll(/'([^']+)'/gu)].map((match) => match[1])

    expect(names).toStrictEqual(['connect', 'disconnect', 'updateStatus', 'updateEncode'])
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
