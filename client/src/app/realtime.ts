import { io as socketIoClient } from 'socket.io-client'

export type RealtimeEventName = 'connect' | 'disconnect' | 'updateStatus' | 'updateEncode'

export interface RealtimeConnection {
  on(eventName: RealtimeEventName, listener: () => void): void
  off(eventName: RealtimeEventName, listener: () => void): void
  disconnect?(): void
}

export type RealtimeConnectionFactory = () => RealtimeConnection | null

export interface RealtimeConnectionConfig {
  socketIOPort: number
}

export type RealtimeConnectionConnector = (
  config: RealtimeConnectionConfig,
) => RealtimeConnection | null

export interface SocketIoLocation {
  protocol: string
  hostname: string
  pathname: string
  port?: string
}

export type SocketIoClient = (
  url: string,
  options: {
    path: string
  },
) => RealtimeConnection

export interface CreateSocketIoRealtimeConnectorOptions {
  io?: SocketIoClient
  location?: SocketIoLocation
}

export const SOCKET_INITIALIZATION_FAILURE_MESSAGE = 'SocketIO の初期設定に失敗しました'
export const DISCONNECT_MESSAGE = '接続が切断されました'
export const RECONNECT_MESSAGE = '再接続されました'

function resolveBrowserLocation(): SocketIoLocation {
  return window.location
}

function resolveSubDirectoryPath(pathname: string): string {
  return pathname.replace(/\/[^/]*$/, '')
}

function resolveSocketIoPath(pathname: string): string {
  const subDirectory = resolveSubDirectoryPath(pathname)

  return `${subDirectory}/socket.io`
}

function resolveSocketIoUrl(location: SocketIoLocation, socketIOPort: number): string {
  return `${location.protocol}//${location.hostname}:${socketIOPort}`
}

export function createSocketIoRealtimeConnector(
  options: CreateSocketIoRealtimeConnectorOptions = {},
): RealtimeConnectionConnector {
  const io = options.io ?? socketIoClient
  const location = options.location ?? resolveBrowserLocation()

  return ({ socketIOPort }) => {
    return io(resolveSocketIoUrl(location, socketIOPort), {
      path: resolveSocketIoPath(location.pathname),
    })
  }
}
