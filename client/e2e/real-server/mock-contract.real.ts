import { createRequire } from 'node:module'
import { expect, test, type Page, type Route } from '@playwright/test'
import { installAppShellApiMocks } from '../support/appShellMocks'
import { installDashboardWorkflowApiMocks } from '../support/dashboardMocks'
import { installGuideOnAirApiMocks } from '../support/guideOnAirMocks'
import { installRecordedApiMocks } from '../support/recordedMocks'
import { installRecordingEncodeApiMocks } from '../support/recordingEncodeMocks'
import { installReservesApiMocks } from '../support/reservesMocks'
import { installSearchRuleWorkflowApiMocks } from '../support/searchRuleMocks'
import { installStoragesUploadApiMocks } from '../support/storagesUploadMocks'
import { NEXT_PROGRAM_ID } from './support/realServer'

/*
 * 通常の e2e の偽 API（`page.route` + msw の合成の応答）が返す JSON を、本物の v3 server が公開する API の定義
 * （`/api/docs`）の応答の schema で検証する。偽 API の応答が server の応答の形から外れていれば、その違いを記録する。
 */

type JsonSchema = Record<string, unknown>
interface AjvValidator {
  (data: unknown): boolean
  errors?: Array<{ dataPath?: string; keyword: string; params: Record<string, unknown> }> | null
}
interface AjvInstance {
  compile(schema: JsonSchema): AjvValidator
}

const require = createRequire(import.meta.url)
const Ajv = require('ajv') as new (options: Record<string, unknown>) => AjvInstance

const origin = (): string => {
  const value = process.env.EPGSTATION_REAL_SERVER_ORIGIN
  if (value === undefined) throw new Error('The real server origin is not set by the global setup')
  return value
}

type RouteHandler = (route: Route) => Promise<void>

/** installer が登録する `page.route` の handler を集める、page の代わり。 */
const captureHandlers = async (
  install: (page: Page) => Promise<unknown>,
): Promise<RouteHandler[]> => {
  const handlers: RouteHandler[] = []
  const page = {
    addInitScript: async () => undefined,
    route: async (_pattern: unknown, handler: RouteHandler) => {
      handlers.push(handler)
    },
    unrouteAll: async () => undefined,
    on: () => undefined,
  } as unknown as Page
  await install(page)
  return handlers
}

interface Captured {
  readonly status: number
  readonly body: unknown
}

/** handler に偽の route を渡し、fulfill された応答を受け取る。fallback されたら次の handler へ（Playwright と同じく後に登録した順）。 */
const requestThrough = async (
  handlers: readonly RouteHandler[],
  url: string,
): Promise<Captured | null> => {
  for (const handler of [...handlers].reverse()) {
    let captured: Captured | null | undefined
    const route = {
      request: () => ({
        url: () => url,
        method: () => 'GET',
        headers: () => ({}),
        postData: () => null,
        postDataBuffer: () => null,
      }),
      fulfill: async (response: { status?: number; body?: string | Buffer; json?: unknown }) => {
        const text = response.body === undefined ? '' : response.body.toString()
        captured = {
          status: response.status ?? 200,
          body: response.json ?? (text === '' ? null : JSON.parse(text)),
        }
      },
      fallback: async () => {
        captured = null
      },
      continue: async () => {
        captured = null
      },
    } as unknown as Route
    await handler(route)
    if (captured !== null && captured !== undefined) return captured
  }
  return null
}

interface OpenApiDocument {
  readonly components: { readonly schemas: Record<string, JsonSchema> }
  readonly paths: Record<
    string,
    { get?: { responses?: Record<string, { content?: Record<string, { schema?: JsonSchema }> }> } }
  >
}

const responseSchema = (document: OpenApiDocument, pathname: string): JsonSchema => {
  const apiPath = pathname.replace(/^\/api/, '')
  for (const [template, item] of Object.entries(document.paths)) {
    const pattern = new RegExp(`^${template.replace(/\{[^}]+\}/g, '[^/]+')}$`)
    if (pattern.test(apiPath)) {
      const schema = item.get?.responses?.['200']?.content?.['application/json']?.schema
      if (schema !== undefined) return schema
    }
  }
  throw new Error(`no 200 JSON response schema for ${pathname}`)
}

const loadValidator = async (): Promise<(pathname: string, body: unknown) => string[]> => {
  const response = await fetch(`${origin()}/api/docs`)
  expect(response.ok).toBe(true)
  const document = (await response.json()) as OpenApiDocument
  const ajv = new Ajv({
    allErrors: true,
    nullable: true,
    unknownFormats: 'ignore',
    schemaId: 'auto',
  })
  return (pathname, body) => {
    const validate = ajv.compile({
      ...responseSchema(document, pathname),
      components: document.components,
    } as JsonSchema)
    // 配列の添字を `[]` にまとめ、同じ違いを 1 つにする。
    if (validate(body)) return []
    const messages = (validate.errors ?? []).map((error) => {
      const path = (error.dataPath ?? '').replace(/\[\d+\]/g, '[]')
      return error.keyword === 'required'
        ? `${path} missing ${String(error.params.missingProperty)}`
        : `${path} ${error.keyword} ${JSON.stringify(error.params)}`
    })
    return [...new Set(messages)].sort()
  }
}

// 偽 API ごとに、画面が要求する API の URL（`isHalfWidth` などの query は画面と同じ形）。
const mockCases: ReadonlyArray<{
  name: string
  install: (page: Page) => Promise<unknown>
  urls: readonly string[]
}> = [
  {
    name: 'app shell',
    install: (page) => installAppShellApiMocks(page),
    urls: ['/api/version', '/api/config'],
  },
  {
    name: 'dashboard',
    install: (page) => installDashboardWorkflowApiMocks(page),
    urls: [
      '/api/recording?isHalfWidth=true&offset=0&limit=24',
      '/api/recorded?isHalfWidth=true&offset=0&limit=24',
      '/api/reserves?isHalfWidth=true&offset=0&limit=24&type=all',
    ],
  },
  {
    name: 'guide and on-air',
    install: (page) => installGuideOnAirApiMocks(page),
    urls: [
      '/api/channels',
      '/api/schedules/broadcasting?isHalfWidth=true',
      '/api/schedules?startAt=1700000000000&endAt=1700086400000&isHalfWidth=true&GR=true&BS=true&CS=true&SKY=true',
    ],
  },
  {
    name: 'recorded',
    install: (page) => installRecordedApiMocks(page),
    urls: [
      '/api/recorded?isHalfWidth=true&offset=0&limit=24',
      '/api/recorded/8301?isHalfWidth=true',
      '/api/recorded/options',
    ],
  },
  {
    name: 'recording and encode',
    install: (page) => installRecordingEncodeApiMocks(page),
    urls: ['/api/recording?isHalfWidth=true&offset=0&limit=24', '/api/encode?isHalfWidth=true'],
  },
  {
    name: 'reserves',
    install: (page) => installReservesApiMocks(page),
    urls: ['/api/reserves?isHalfWidth=true&offset=0&limit=24&type=all'],
  },
  {
    name: 'search rule',
    install: (page) => installSearchRuleWorkflowApiMocks(page),
    urls: ['/api/rules?isHalfWidth=true&offset=0&limit=24'],
  },
  {
    name: 'storages',
    install: (page) => installStoragesUploadApiMocks(page),
    urls: ['/api/storages'],
  },
]

test('checks the JSON the e2e fake API returns against the response schemas the real server publishes', async () => {
  const validate = await loadValidator()
  const results: Record<string, string[]> = {}
  for (const mock of mockCases) {
    const handlers = await captureHandlers(mock.install)
    for (const path of mock.urls) {
      const response = await requestThrough(handlers, `http://127.0.0.1${path}`)
      const key = `${mock.name} ${new URL(path, 'http://127.0.0.1').pathname}`
      if (response === null || response.status !== 200) {
        results[key] = [
          `not answered with 200 (${response === null ? 'fallback' : response.status})`,
        ]
        continue
      }
      results[key] = validate(new URL(path, 'http://127.0.0.1').pathname, response.body)
    }
  }
  // 偽 API の応答は、画面が読む field だけを持つ。本物の server の応答が必ず持つ次の field を持たない、または
  // 型が違う。画面の adapter はこれらを読まないか既定値で補うので、通常の e2e は通る（本物の server の応答での
  // 描画は app.real.ts が確かめる）。偽 API を直したら、ここも合わせて直す。
  expect(results).toEqual({
    'app shell /api/version': [],
    'app shell /api/config': [
      ' missing encode',
      ' missing isEnableEncodedRecordedStream',
      ' missing isEnableLiveStream',
      ' missing isEnableTSRecordedStream',
      ' missing socketIOPort',
      '.urlscheme missing m2ts',
    ],
    'dashboard /api/recording': [
      '.records[] missing endAt',
      '.records[] missing isEncoding',
      '.records[] missing isProtected',
      '.records[] missing isRecording',
      '.records[] missing startAt',
    ],
    'dashboard /api/recorded': ['.records[] missing endAt', '.records[] missing startAt'],
    'dashboard /api/reserves': [
      '.reserves[] missing allowEndLack',
      '.reserves[] missing isConflict',
      '.reserves[] missing isDeleteOriginalAfterEncode',
      '.reserves[] missing isOverlap',
      '.reserves[] missing isSkip',
      '.reserves[] missing isTimeSpecified',
    ],
    'guide and on-air /api/channels': [
      '[] missing channel',
      '[] missing channelType',
      '[] missing hasLogoData',
      '[] missing networkId',
      '[] missing remoteControlKeyId',
      '[] missing serviceId',
    ],
    'guide and on-air /api/schedules/broadcasting': [
      '[].channel missing networkId',
      '[].channel missing serviceId',
      '[].programs[] missing isFree',
    ],
    'guide and on-air /api/schedules': [
      '[].channel missing channelType',
      '[].channel missing hasLogoData',
      '[].channel missing networkId',
      '[].channel missing serviceId',
    ],
    'recorded /api/recorded': [],
    'recorded /api/recorded/8301': [],
    'recorded /api/recorded/options': [
      '.channels[] missing channelId',
      '.channels[] missing cnt',
      '.genres[] missing cnt',
      '.genres[] missing genre',
    ],
    'recording and encode /api/recording': [],
    'recording and encode /api/encode': [
      '.runningItems[].recorded missing isEncoding',
      '.runningItems[].recorded missing isProtected',
      '.runningItems[].recorded missing isRecording',
      '.waitItems[].recorded missing isEncoding',
      '.waitItems[].recorded missing isProtected',
      '.waitItems[].recorded missing isRecording',
    ],
    'reserves /api/reserves': [
      '.reserves[] missing allowEndLack',
      '.reserves[] missing channelType',
      '.reserves[] missing isDeleteOriginalAfterEncode',
      '.reserves[] missing isTimeSpecified',
      '.reserves[].programId type {"type":"integer"}',
      '.reserves[].ruleId type {"type":"integer"}',
    ],
    'search rule /api/rules': [
      '.rules[] missing isTimeSpecification',
      '.rules[].reserveOption.periodToAvoidDuplicate type {"type":"integer"}',
      '.rules[].saveOption.directory type {"type":"string"}',
      '.rules[].saveOption.parentDirectoryName type {"type":"string"}',
      '.rules[].saveOption.recordedFormat type {"type":"string"}',
    ],
    'storages /api/storages': [],
  })
})

test('checks the JSON the real server returns against the response schemas it publishes', async ({
  request,
}) => {
  const validate = await loadValidator()
  // 予約を 1 件（手動予約。ruleId は null）入れてから、偽 API と同じ URL を本物の server に送る。
  const added = await request.post(`${origin()}/api/reserves`, {
    data: { programId: NEXT_PROGRAM_ID, allowEndLack: true },
  })
  expect(added.ok()).toBe(true)
  const results: Record<string, string[]> = {}
  try {
    // 偽 API の fixture の id を使う URL（本物の DB には無い）は除く。
    const paths = [...new Set(mockCases.flatMap((mock) => mock.urls))].filter(
      (path) => !/\/\d+(?:\?|$)/.test(path),
    )
    for (const path of paths) {
      const response = await request.get(`${origin()}${path}`)
      const pathname = new URL(path, 'http://127.0.0.1').pathname
      results[pathname] = response.ok()
        ? validate(pathname, await response.json())
        : [`not answered with 200 (${response.status()})`]
    }
  } finally {
    const reserves = (await (
      await request.get(`${origin()}/api/reserves?isHalfWidth=false`)
    ).json()) as {
      reserves: Array<{ id: number }>
    }
    for (const reserve of reserves.reserves)
      await request.delete(`${origin()}/api/reserves/${reserve.id}`)
  }
  // api.yml の Config は `isEnableLiveStream` を必須にしているが、server（v2 から同じ）は `isEnableTSLiveStream` を返す。
  expect(results).toEqual({
    ...Object.fromEntries(Object.keys(results).map((key) => [key, []])),
    '/api/config': [' missing isEnableLiveStream'],
  })
})
