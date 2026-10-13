import type { Page, Request } from '@playwright/test'

/*
 * 画面を開いた後で偽 API の組を入れ替えるための helper。
 *
 * `page.unrouteAll()` は、client 側の handler の一覧をすぐ空にしてから browser 側の横取りの設定を
 * 更新する。外している間に届いた要求は handler が見つからず実際の network（preview server の proxy。
 * つながる相手が無いので失敗する）へ流れ、外した時点で handler が処理中だった要求は、応答されないまま
 * 残ることがある。失敗した要求は前の画面の失敗の通知を記録し（後の通知の確認がその記録に当たって
 * 通る）、応答されない要求は、まだ data の無い query を取得中のままにする。同じ document の中で同じ
 * 画面へ戻っても、query はその要求を待つだけで取得し直さない。
 *
 * このため、入れ替える前に、画面が出した API の要求がすべて終わり、少しの間新しい要求が出ないことを
 * 待つ。そのうえで、処理中の handler を待つ指定で外し、新しい組を入れる。
 */

interface ApiRequestTracker {
  readonly inFlight: Set<Request>
  started: number
}

const trackers = new WeakMap<Page, ApiRequestTracker>()

const QUIET_PERIOD_MS = 150
const SETTLE_TIMEOUT_MS = 15_000

// 再生中の media の stream は再生が続く間終わらないので、待つ対象にしない。
const isTrackedApiRequest = (request: Request): boolean => {
  const { pathname } = new URL(request.url())
  return (
    pathname.includes('/api/') &&
    !/\/api\/streams\/(?:live|recorded)\/\d+\/(?:m2ts|m2tsll|webm|mp4)$/.test(pathname)
  )
}

/** page が出す API の要求を数え始める。`installAppShellApiMocks` が呼ぶ。2 回目以降は何もしない。 */
export function trackApiRequests(page: Page): void {
  if (trackers.has(page)) return
  const tracker: ApiRequestTracker = { inFlight: new Set(), started: 0 }
  trackers.set(page, tracker)
  page.on('request', (request) => {
    if (!isTrackedApiRequest(request)) return
    tracker.inFlight.add(request)
    tracker.started += 1
  })
  page.on('requestfinished', (request) => tracker.inFlight.delete(request))
  page.on('requestfailed', (request) => tracker.inFlight.delete(request))
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForApiRequestsToSettle(page: Page): Promise<void> {
  const tracker = trackers.get(page)
  if (tracker === undefined) {
    throw new Error('replaceApiMocks needs installAppShellApiMocks to have tracked the page first')
  }
  const deadline = Date.now() + SETTLE_TIMEOUT_MS
  for (;;) {
    if (tracker.inFlight.size === 0) {
      const startedBefore = tracker.started
      await sleep(QUIET_PERIOD_MS)
      if (tracker.inFlight.size === 0 && tracker.started === startedBefore) return
    }
    if (Date.now() > deadline) {
      const pending = [...tracker.inFlight].map((request) => new URL(request.url()).pathname)
      throw new Error(`API requests did not settle before replacing mocks: ${pending.join(', ')}`)
    }
    await sleep(25)
  }
}

/**
 * 画面の API の要求が終わるのを待ってから偽 API をすべて外し、`install` で新しい組を入れる。
 * `install` の戻り値（偽 API を操作する object など）をそのまま返す。
 */
export async function replaceApiMocks<T>(page: Page, install: () => Promise<T>): Promise<T> {
  await waitForApiRequestsToSettle(page)
  await page.unrouteAll({ behavior: 'wait' })
  return await install()
}
