import { render, screen, waitFor } from '@testing-library/react'
import { defaultScheduler, notifyManager } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { createScrollHistory } from '@/app/scrollHistory'
import type { ReservesApiRepository } from '@/features/reserves/reservesApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { DEFAULT_DELAY_MS } from '@/shared/useDeferredLoading'
import { createDashboardRepository } from './dashboard/dashboardTestKit'
import {
  createDeferred,
  createReservesRepository,
  createShellRepository,
} from './reserves/reservesTestKit'

type ServerConfigResult = Awaited<
  ReturnType<ReturnType<typeof createShellRepository>['fetchServerConfig']>
>

const LOADED_SERVER_CONFIG: ServerConfigResult = {
  ok: true,
  value: { status: 'loaded', liveStreamEnabled: false, enabledBroadcastWaves: [] },
}

/**
 * Holds React Query's listener notifications. A page's query result then reaches the page only
 * through a render some other update starts, and the shell's server-config update is not
 * synchronous, so the page's content is committed in a scheduler task instead of a microtask.
 */
function holdQueryNotifications(): Array<() => void> {
  const held: Array<() => void> = []
  notifyManager.setScheduler((callback) => {
    held.push(callback)
  })

  return held
}

function drainMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Takes `useDeferredLoading`'s real show-timer (client/src/shared/useDeferredLoading.ts) out of the
 * test's hands. The reserves page arms that timer when it mounts with `isLoading` true, and this
 * suite deliberately keeps the page's query result from reaching the page
 * (`holdQueryNotifications`) until it has installed the ordering it forces. If the host is slow
 * enough that more than `DEFAULT_DELAY_MS` of real time passes in between, the timer fires, the
 * indicator is raised, and the page then keeps showing it for its minimum hold time instead of the
 * committed `reserves-page` the assertions look for - the reaction to a slow host, not the
 * scroll-readiness ordering this suite is about. Only the hook's own `setTimeout` call (the
 * default delay, called from that module) is redirected to a callback that does nothing, so "the
 * indicator timer has not come due" is a property of the test rather than of how fast the machine
 * is. Every other timer - react-query's, RTL's `waitFor`, the other `setTimeout` calls in this
 * file - stays real, which is why this is not `vi.useFakeTimers`: faking the clock around the
 * mount also swallows react-query's own mount-time `setTimeout`, and faking it for longer hangs
 * RTL's `waitFor` bookkeeping.
 */
function neutralizeDeferredLoadingShowTimer(): void {
  const realSetTimeout = globalThis.setTimeout
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
    handler: TimerHandler,
    delay?: number,
    ...args: unknown[]
  ) => {
    if (delay === DEFAULT_DELAY_MS && new Error().stack?.includes('useDeferredLoading') === true) {
      return realSetTimeout(() => undefined, delay)
    }

    return realSetTimeout(handler, delay, ...args)
  }) as typeof setTimeout)
}

// Captured once, at module load, before any test's `vi.spyOn(performance, 'now')` has a chance to
// replace it - `makeControlledClock` below needs the *real* implementation to fall back to, and
// reading `performance.now` again after spying on it would just read the spy back.
const REAL_PERFORMANCE_NOW = performance.now.bind(performance)

/**
 * The two orderings this suite forces, deterministically, every run. React's scheduler decides
 * whether to keep processing already-queued tasks - the render that commits a page, and the flush
 * of that same commit's passive effects, which the commit itself queues - inside one
 * `performWorkUntilDeadline` call (one macrotask), or to yield and let the rest run in a later one.
 * That decision (`shouldYieldToHost`, scheduler/cjs/scheduler.development.js:169) is purely
 * `performance.now() - startTime < frameInterval` (a 5ms budget, scheduler.development.js:210), so
 * controlling `performance.now()` controls the ordering directly instead of leaving it to whatever
 * the host's own speed happens to produce.
 */
type Ordering = 'same macrotask' | 'separate macrotask'

const ORDERINGS: readonly Ordering[] = ['same macrotask', 'separate macrotask']

/**
 * Builds the `performance.now()` replacement used below. While `keepForcing()` is `true`, every
 * call returns `valueWhileForcing()`; once it turns `false` (the completion notice has fired -
 * whatever this override exists to force has already happened by then), every later call instead
 * tracks real elapsed time from that instant on. Only the specific decision the caller is
 * overriding is touched - not every scheduler decision for the rest of the test, which would just
 * make the test slower and, past that point, reintroduce timing that is not the scheduler's own
 * (elsewhere in the tree, `useDeferredLoading` (client/src/shared/useDeferredLoading.ts) holds a
 * loading indicator up for a minimum real duration; forcing the scheduler's clock for longer than
 * necessary gives such unrelated real timers more real wall-clock time to fire during the test).
 */
function makeControlledClock(
  valueWhileForcing: () => number,
  keepForcing: () => boolean,
): () => number {
  let resumed = false
  let resumedAtReal = 0
  let resumedAtValue = 0

  return () => {
    if (!resumed) {
      if (keepForcing()) {
        return valueWhileForcing()
      }
      resumed = true
      resumedAtReal = REAL_PERFORMANCE_NOW()
      resumedAtValue = valueWhileForcing()
    }

    return resumedAtValue + (REAL_PERFORMANCE_NOW() - resumedAtReal)
  }
}

/**
 * Freezes the scheduler's time budget so `performance.now() - startTime` is always `0`: the
 * scheduler never has a time-based reason to yield, so every task it already has queued for a
 * commit - including the passive-effect flush the commit itself schedules - runs inside the same
 * `performWorkUntilDeadline` call. This is the "fast host" case from the original bug report,
 * forced to happen every run instead of only when the host happens to be fast enough. The freeze
 * lasts only until the completion notice fires once (`getNotifyCallCount`), which is the last
 * point this test's assertions depend on scheduler timing at all.
 */
function forceSameMacrotask(getNotifyCallCount: () => number): void {
  const baseline = performance.now()
  vi.spyOn(performance, 'now').mockImplementation(
    makeControlledClock(
      () => baseline,
      () => getNotifyCallCount() === 0,
    ),
  )
}

/**
 * Forces the render that inserts `testId` and the passive-effect flush that follows it into two
 * separate macrotasks. Whether `testId` is already in the DOM is checked synchronously, inside the
 * very call `shouldYieldToHost` makes to read the clock - not from a `MutationObserver` callback,
 * which only ever runs as a microtask and can lose the race to the scheduler continuing on to the
 * next task first, in the same still-synchronous turn (this is why the previous, now-removed gate
 * could pass or fail depending on host speed). So there is no window in which the insertion has
 * happened but this check has not yet seen it: the first read of the clock taken after `testId`
 * exists reports a time far past the 5ms budget, which forces the scheduler to yield before it
 * flushes that commit's passive effects. As with `forceSameMacrotask`, the override only holds
 * until the completion notice fires once, then steps aside.
 *
 * `notifyCountAtInsertion` is captured at that same synchronous instant: how many times the
 * completion notice had fired by the moment the page first existed in the DOM. It is the
 * "immediately after the commit" checkpoint the original gate tried to observe from outside the
 * scheduler; reading it from inside the scheduler's own clock check removes the race instead of
 * just relocating it.
 */
function forceSeparateMacrotask(
  testId: string,
  getNotifyCallCount: () => number,
): { notifyCountAtInsertion: () => number | null; cleanup: () => void } {
  const baseline = performance.now()
  let notifyCountAtInsertion: number | null = null
  // `performance.now()` is called far more often than just at the one decision this override
  // exists to control - every scheduler task, throughout the whole app, consults it, and this
  // suite's own render tree is not small. A `document.querySelector` scan on every one of those
  // calls is real, measurable overhead (large enough, on its own, to push this test's real
  // wall-clock time up and closer to unrelated real-timer thresholds elsewhere in the tree - see
  // `useDeferredLoading`, client/src/shared/useDeferredLoading.ts). `MutationObserver.
  // takeRecords()` is a synchronous, native call - unlike the observer's own callback, it needs no
  // microtask hop - so it is used as a cheap "did anything change since last time" gate: the
  // expensive query only ever runs on the rare check where it reports at least one mutation.
  let insertedCache = false
  const mutations = new MutationObserver(() => undefined)
  mutations.observe(document.body, { childList: true, subtree: true })
  const isInserted = () => {
    if (!insertedCache && mutations.takeRecords().length > 0) {
      insertedCache = document.querySelector(`[data-testid='${testId}']`) !== null
    }
    return insertedCache
  }

  vi.spyOn(performance, 'now').mockImplementation(
    makeControlledClock(
      () => {
        if (isInserted() && notifyCountAtInsertion === null) {
          notifyCountAtInsertion = getNotifyCallCount()
        }

        return isInserted() ? baseline + 1000 : baseline
      },
      () => getNotifyCallCount() === 0,
    ),
  )

  return {
    notifyCountAtInsertion: () => notifyCountAtInsertion,
    cleanup: () => mutations.disconnect(),
  }
}

/**
 * Installs `ordering` and returns the "commit had not notified yet" checkpoint. It stays `null`
 * for `same macrotask`, which has no such mid-flight instant to check - everything runs in one
 * flush - and is otherwise the value `forceSeparateMacrotask` captured. Always call `cleanup()`
 * once the test is done with it.
 */
function forceOrdering(
  ordering: Ordering,
  testId: string,
  getNotifyCallCount: () => number,
): { notifyCountAtInsertion: () => number | null; cleanup: () => void } {
  if (ordering === 'same macrotask') {
    forceSameMacrotask(getNotifyCallCount)
    return { notifyCountAtInsertion: () => null, cleanup: () => undefined }
  }

  return forceSeparateMacrotask(testId, getNotifyCallCount)
}

describe('scroll readiness when the page is committed outside a synchronous render', () => {
  afterEach(() => {
    notifyManager.setScheduler(defaultScheduler)
    vi.restoreAllMocks()
  })

  it.each(ORDERINGS)(
    '[AC reserves 1.9] still emits scroll restoration done for an empty reserves page (%s)',
    async (ordering) => {
      window.history.replaceState(null, '', '/#/reserves?type=conflict&page=3')
      const reservesRepository = createReservesRepository()
      const reserves = createDeferred<Awaited<ReturnType<ReservesApiRepository['fetchReserves']>>>()
      vi.mocked(reservesRepository.fetchReserves).mockReturnValue(reserves.promise)
      const shellRepository = createShellRepository()
      const serverConfig = createDeferred<ServerConfigResult>()
      shellRepository.fetchServerConfig.mockReturnValue(serverConfig.promise)
      const scrollHistory = createScrollHistory({ shouldRestoreHistory: false })
      // Whichever of the two orderings this run forces (below), the notification must never fire
      // for a page that has not committed yet.
      const pageVisibleAtCall: boolean[] = []
      const realEmitDoneGetData = scrollHistory.emitDoneGetData.bind(scrollHistory)
      const emitDoneGetData = vi.spyOn(scrollHistory, 'emitDoneGetData').mockImplementation(() => {
        pageVisibleAtCall.push(screen.queryByTestId('reserves-page') !== null)
        realEmitDoneGetData()
      })

      neutralizeDeferredLoadingShowTimer()
      render(
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={shellRepository}
          reservesApiRepository={reservesRepository}
          scrollHistory={scrollHistory}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        />,
      )
      await waitFor(() => {
        expect(reservesRepository.fetchReserves).toHaveBeenCalled()
        expect(shellRepository.fetchServerConfig).toHaveBeenCalled()
      })

      holdQueryNotifications()
      reserves.resolve({ ok: true, value: { reserves: [], total: 0 } })
      await drainMicrotasks()

      const split = forceOrdering(
        ordering,
        'reserves-page',
        () => emitDoneGetData.mock.calls.length,
      )
      serverConfig.resolve(LOADED_SERVER_CONFIG)

      await waitFor(() => {
        expect(emitDoneGetData).toHaveBeenCalled()
      })

      expect(screen.getByTestId('reserves-page')).toBeVisible()
      expect(screen.queryAllByTestId('reserves-list-item')).toHaveLength(0)
      // The completion notice must have fired exactly once, and only once the page it reports on
      // had already committed - never while the commit that produces it is still in flight.
      expect(pageVisibleAtCall).toEqual([true])
      if (ordering === 'separate macrotask') {
        // The path the original test protected against, forced to actually happen this run (rather
        // than left to host speed) and confirmed to have been taken: the notice had not fired yet
        // at the instant the page first existed in the DOM.
        expect(split.notifyCountAtInsertion()).toBe(0)
      }
      split.cleanup()
    },
  )

  it.each(ORDERINGS)(
    '[AC dashboard 1.9] still restores section scroll once the dashboard is committed (%s)',
    async (ordering) => {
      localStorage.clear()
      window.history.replaceState(null, '', '/#/')
      const scrollHistory = createScrollHistory({ shouldRestoreHistory: true })
      scrollHistory.saveScrollData({ recordingScroll: 10, recordedScroll: 20, reservesScroll: 30 })
      // See the reserves case above: the ordering is forced (below), not left to host speed, and
      // the invariant must hold either way.
      const pageVisibleAtCall: boolean[] = []
      const realEmitDoneGetData = scrollHistory.emitDoneGetData.bind(scrollHistory)
      const emitDoneGetData = vi.spyOn(scrollHistory, 'emitDoneGetData').mockImplementation(() => {
        pageVisibleAtCall.push(screen.queryByTestId('dashboard-page') !== null)
        realEmitDoneGetData()
      })
      const shellRepository = createShellRepository()
      const serverConfig = createDeferred<ServerConfigResult>()
      shellRepository.fetchServerConfig.mockReturnValue(serverConfig.promise)
      holdQueryNotifications()

      render(
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={shellRepository}
          dashboardApiRepository={createDashboardRepository()}
          scrollHistory={scrollHistory}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        />,
      )
      await waitFor(() => {
        expect(shellRepository.fetchServerConfig).toHaveBeenCalled()
      })
      await drainMicrotasks()

      const split = forceOrdering(
        ordering,
        'dashboard-page',
        () => emitDoneGetData.mock.calls.length,
      )
      serverConfig.resolve(LOADED_SERVER_CONFIG)

      await waitFor(() => {
        expect(screen.getByTestId('dashboard-section-recording-list')).toHaveProperty(
          'scrollTop',
          10,
        )
        expect(screen.getByTestId('dashboard-section-recorded-list')).toHaveProperty(
          'scrollTop',
          20,
        )
        expect(screen.getByTestId('dashboard-section-reserves-list')).toHaveProperty(
          'scrollTop',
          30,
        )
      })
      expect(emitDoneGetData).toHaveBeenCalledTimes(1)
      // The completion notice must have fired exactly once, and only once the page it reports on
      // had already committed - never while the commit that produces it is still in flight.
      expect(pageVisibleAtCall).toEqual([true])
      if (ordering === 'separate macrotask') {
        expect(split.notifyCountAtInsertion()).toBe(0)
      }
      split.cleanup()
    },
  )
})
