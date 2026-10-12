import path from 'node:path'
import { loadConfigFromFile } from 'vite'

import {
  resolveDevServerPortFromHost,
  rewriteDevProxyConfigSocketIOPort,
  shouldSuppressProxyErrorLog,
} from '../../vite.config'

describe('vite dev server proxy', () => {
  test('uses relative asset paths for production static sub-directory deployments', async () => {
    const loaded = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      path.resolve(process.cwd(), 'vite.config.ts'),
    )

    expect(loaded?.config.base).toBe('./')
  })

  test('routes API, Socket.IO, and HLS playlist requests to the configured local backend', async () => {
    const originalTarget = process.env.EPGSTATION_DEV_PROXY_TARGET
    process.env.EPGSTATION_DEV_PROXY_TARGET = 'http://127.0.0.1:18080'
    const loaded = await loadConfigFromFile(
      { command: 'serve', mode: 'test' },
      path.resolve(process.cwd(), 'vite.config.ts'),
    )
    if (originalTarget === undefined) {
      delete process.env.EPGSTATION_DEV_PROXY_TARGET
    } else {
      process.env.EPGSTATION_DEV_PROXY_TARGET = originalTarget
    }

    expect(loaded?.config.server?.proxy).toMatchObject({
      '/api/config': {
        target: 'http://127.0.0.1:18080',
        changeOrigin: true,
        selfHandleResponse: true,
      },
      '/api': {
        target: 'http://127.0.0.1:18080',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://127.0.0.1:18080',
        changeOrigin: true,
        ws: true,
      },
      '/streamfiles': {
        target: 'http://127.0.0.1:18080',
        changeOrigin: true,
      },
    })
  })

  test('resolves the dev server port from the browser-facing Host header', () => {
    expect(resolveDevServerPortFromHost('127.0.0.1:5173')).toBe(5173)
    expect(resolveDevServerPortFromHost('localhost:4173')).toBe(4173)
    expect(resolveDevServerPortFromHost('[::1]:5173')).toBe(5173)
    expect(resolveDevServerPortFromHost('localhost')).toBeUndefined()
    expect(resolveDevServerPortFromHost(undefined)).toBeUndefined()
  })

  test('rewrites /api/config socketIOPort to the browser-facing dev proxy port', () => {
    const rewritten = rewriteDevProxyConfigSocketIOPort(
      Buffer.from('{"socketIOPort":9999,"subDirectory":"/epg"}'),
      5173,
    )

    expect(JSON.parse(rewritten.toString('utf8'))).toEqual({
      socketIOPort: 5173,
      subDirectory: '/epg',
    })
  })

  test('keeps /api/config unchanged when a safe rewrite cannot be made', () => {
    const validBody = Buffer.from('{"socketIOPort":9999}')
    const invalidBody = Buffer.from('not json')

    expect(rewriteDevProxyConfigSocketIOPort(validBody, undefined).toString('utf8')).toBe(
      validBody.toString('utf8'),
    )
    expect(rewriteDevProxyConfigSocketIOPort(invalidBody, 5173).toString('utf8')).toBe(
      invalidBody.toString('utf8'),
    )
  })

  test('filters only Vite proxy error logs when Playwright suppresses proxy noise', () => {
    expect(shouldSuppressProxyErrorLog('http proxy error: /api/channels')).toBe(true)
    expect(shouldSuppressProxyErrorLog('\u001B[31mhttp proxy error: /api/reserves\u001B[39m')).toBe(
      true,
    )
    expect(shouldSuppressProxyErrorLog('ws proxy error:')).toBe(false)
    expect(shouldSuppressProxyErrorLog(new Error('http proxy error: /api/channels'))).toBe(false)
  })
})
