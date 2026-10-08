import type { Page, Route } from '@playwright/test'
import { HttpResponse, getResponse, http } from 'msw'

export const SYNTHETIC_APP_VERSION = '9.8.7-synthetic'
export const SYNTHETIC_NAVIGATION_TIMESTAMP = '1700000000000'

type ApiMockMode = 'success' | 'config-failure'

export interface AppShellMockOptions {
  mode?: ApiMockMode
  seedSettings?: boolean
  enableBroadcastWaveNavigation?: boolean
  encodeModes?: string[]
  forceDarkTheme?: boolean
  socketIOPort?: number
  version?: string
}

const successfulConfigResponse = {
  isEnableTSLiveStream: true,
  broadcast: {
    GR: true,
    BS: true,
    CS: false,
    SKY: false,
    BS4K: false,
  },
  recorded: ['archive-root', 'backup-root'],
  isEnableEncode: true,
  encodeModes: ['synthetic-encode-main', 'synthetic-encode-sub'],
  kodiHosts: ['kodi-one', 'kodi-two'],
  urlscheme: {
    video: {
      ios: 'synthetic-view://PROTOCOL/ADDRESS',
      android: 'synthetic-view://PROTOCOL/ADDRESS',
      mac: 'synthetic-view://PROTOCOL/ADDRESS',
      win: 'synthetic-view://PROTOCOL/ADDRESS',
    },
    download: {
      ios: 'synthetic-download://PROTOCOL/ADDRESS',
      android: 'synthetic-download://PROTOCOL/ADDRESS',
      mac: 'synthetic-download://PROTOCOL/ADDRESS',
      win: 'synthetic-download://PROTOCOL/ADDRESS',
    },
  },
  streamConfig: {
    live: {
      ts: {
        m2ts: [{ name: 'm2ts-standard' }],
        m2tsll: ['ll-standard'],
        webm: ['webm-standard'],
        mp4: ['mp4-standard'],
        hls: ['hls-standard'],
      },
    },
    recorded: {
      ts: {
        webm: ['recorded-ts-webm-standard'],
        mp4: ['recorded-ts-mp4-standard'],
        hls: ['recorded-ts-hls-standard'],
      },
      encoded: {
        webm: ['recorded-encoded-webm-standard'],
        mp4: ['recorded-encoded-mp4-standard'],
        hls: ['recorded-encoded-hls-standard'],
      },
    },
  },
}

export async function fulfillMswResponse(route: Route, response: Response): Promise<void> {
  const headers = Object.fromEntries(response.headers.entries())

  await route.fulfill({
    status: response.status,
    headers,
    body: Buffer.from(await response.arrayBuffer()),
  })
}

export async function createMswRequest(route: Route): Promise<Request> {
  const request = route.request()
  const method = request.method()
  const headers = new Headers(request.headers())

  if (method === 'GET' || method === 'HEAD') {
    return new Request(request.url(), { method, headers })
  }

  const contentType = headers.get('content-type') ?? ''
  const postDataBuffer = contentType.includes('multipart/form-data')
    ? request.postDataBuffer()
    : null
  const body =
    postDataBuffer === null
      ? (request.postData() ?? undefined)
      : new Blob([new Uint8Array(postDataBuffer)])

  return new Request(request.url(), {
    method,
    headers,
    body,
  })
}

function createAppShellHandlers({
  encodeModes,
  mode,
  socketIOPort,
  version,
}: Required<Pick<AppShellMockOptions, 'mode' | 'version'>> &
  Pick<AppShellMockOptions, 'encodeModes' | 'socketIOPort'>) {
  return [
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/version'),
      () => HttpResponse.json({ version }),
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/config'),
      () => {
        if (mode === 'config-failure') {
          return HttpResponse.json({ error: 'synthetic-config-failure' }, { status: 503 })
        }

        return HttpResponse.json({
          ...successfulConfigResponse,
          encodeModes: encodeModes ?? successfulConfigResponse.encodeModes,
          ...(socketIOPort === undefined ? {} : { socketIOPort }),
        })
      },
    ),
  ]
}

export async function installAppShellApiMocks(
  page: Page,
  {
    mode = 'success',
    seedSettings = true,
    enableBroadcastWaveNavigation = false,
    encodeModes,
    forceDarkTheme,
    socketIOPort,
    version = SYNTHETIC_APP_VERSION,
  }: AppShellMockOptions = {},
): Promise<void> {
  await page.addInitScript(
    ({
      enableBroadcastWaveNavigation: shouldEnableBroadcastWaveNavigation,
      forceDarkTheme: shouldForceDarkTheme,
      timestamp,
      seedSettings: shouldSeedSettings,
    }) => {
      Date.now = () => Number(timestamp)
      if (!shouldSeedSettings) return
      const savedSettings = JSON.parse(window.localStorage.getItem('settings') ?? '{}') as Record<
        string,
        unknown
      >
      window.localStorage.setItem(
        'settings',
        JSON.stringify({
          ...savedSettings,
          isEnableDisplayForEachBroadcastWave: shouldEnableBroadcastWaveNavigation,
          shouldUseOSColorTheme: false,
          isForceDarkTheme:
            shouldForceDarkTheme === undefined
              ? savedSettings.isForceDarkTheme === true
              : shouldForceDarkTheme,
        }),
      )
    },
    {
      enableBroadcastWaveNavigation,
      forceDarkTheme,
      timestamp: SYNTHETIC_NAVIGATION_TIMESTAMP,
      seedSettings,
    },
  )

  const handlers = createAppShellHandlers({ encodeModes, mode, socketIOPort, version })

  await page.route('**/api/**', async (route) => {
    const response = await getResponse(handlers, await createMswRequest(route))

    if (response === undefined) {
      await route.fallback()
      return
    }

    await fulfillMswResponse(route, response)
  })
}

function createDashboardHandlers() {
  return [
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/reserves/cnts'),
      () =>
        HttpResponse.json({
          normal: 1,
          conflicts: 0,
          skips: 0,
          overlaps: 0,
        }),
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/recording'),
      () =>
        HttpResponse.json({
          records: [{ id: 1, name: 'Synthetic Dashboard Recording' }],
          total: 1,
        }),
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/recorded'),
      () =>
        HttpResponse.json({
          records: [{ id: 2, name: 'Synthetic Dashboard Recorded' }],
          total: 1,
        }),
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/reserves'),
      () =>
        HttpResponse.json({
          reserves: [{ id: 3, name: 'Synthetic Dashboard Reserve' }],
          total: 1,
        }),
    ),
  ]
}

export async function installDashboardApiMocks(page: Page): Promise<void> {
  const handlers = createDashboardHandlers()

  await page.route('**/api/**', async (route) => {
    const response = await getResponse(handlers, await createMswRequest(route))

    if (response === undefined) {
      await route.fallback()
      return
    }

    await fulfillMswResponse(route, response)
  })
}

export function isDesktopViewport(page: Page): boolean {
  const viewport = page.viewportSize()

  return viewport !== null && viewport.width >= 1264
}
