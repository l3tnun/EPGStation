import { expect, type Page, test } from '@playwright/test'
import { installAppShellApiMocks, installDashboardApiMocks } from './support/appShellMocks'

// Regression guard: at desktop widths (Linux + Chrome, 1272px included) the navigation drawer had no open/close
// animation at all -- it teleported between fully open and fully closed with zero intermediate
// frames. Cause to guard against (client/src/app/components/DrawerHost.tsx): the desktop
// open state rendered MUI Drawer with `variant="permanent"`, which MUI never wraps in a Slide
// transition regardless of the `open` prop (permanent ignores `open` entirely), and the desktop
// closed state was not rendered at all (`shouldMountDrawer` unmounted the whole `<Drawer>`), so
// there was nothing left to animate in either direction. Every prior test (imp, spec, and e2e) only
// asserted the drawer's *end-state* DOM attributes (`data-drawer-open`, `data-drawer-variant`,
// `data-drawer-mounted`) taken after any transition would already be over -- an instantly-teleported
// drawer and a smoothly-animated one produce the exact same end-state attributes, so none of that
// coverage could ever have caught this.
//
// This test drives a real Chromium build of the app (via Playwright's own preview server) and
// asserts on the product's own CSS transition directly, through the CSSTransition object the
// browser creates on the drawer paper's `transform` and the shell content's `margin-left`
// (https://drafts.csswg.org/css-transitions-2/#the-csstransition-interface --
// `Element.getAnimations()` returns these while a transition is running, and each carries a
// `transitionProperty` naming the CSS property it animates and an `effect.getTiming()` with the
// exact `duration`/`easing` the browser is using). This is deterministic -- it reads the browser's
// own transition timing model instead of sampling `requestAnimationFrame`s and inferring "animated"
// from how many distinct intermediate positions happened to be observed, so it does not depend on
// stretching the product's 200ms transition to some longer value to make it samplable, and it does
// not need an "in-progress animation" fallback for a slow worker that missed every intermediate
// frame.
const PAPER_SELECTOR = '.MuiDrawer-paper'
const TOGGLE_BUTTON_SELECTOR = '[aria-label="ナビゲーションを開閉"]'
const MAIN_CONTENT_SELECTOR = '[data-testid="shell-content"]'
const DRAWER_SELECTOR = '[data-testid="shell-drawer"]'

// Mirrors client/src/app/drawerLayout.ts (APP_SHELL_DRAWER_TRANSITION_DURATION_MS /
// APP_SHELL_DRAWER_TRANSITION_EASING). Both the drawer paper's `transform` transition
// (DrawerHost.tsx) and the shell content's `margin-left` transition (AppShell.tsx) must share this
// single duration and easing so the drawer and the content it displaces move together.
const EXPECTED_TRANSITION_DURATION_MS = 200
const EXPECTED_TRANSITION_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'
const SAMPLE_WINDOW_MS = 600

interface TransitionSample {
  tMs: number
  drawerVariant: string | null
  paperTransitionProperty: string | null
  paperTransform: string | null
  paperDurationMs: number | null
  paperEasing: string | null
  mainContentTransitionProperty: string | null
  mainContentMarginLeft: string | null
  mainContentDurationMs: number | null
  mainContentEasing: string | null
}

// Samples, on every animation frame for `sampleWindowMs` after the caller has already triggered the
// toggle, whichever CSSTransition (if any) is currently animating the drawer paper's `transform` and
// the shell content's `margin-left`, plus enough raw state (the drawer's `data-drawer-variant`, the
// paper's computed `transform`, the content's computed `margin-left`) to describe the whole
// progression in a failure message -- this is the "sample の transitionProperty・transform・
// data-drawer-variant の推移" a flaky iOS run needs to diagnose without rerunning the suite.
async function captureTransitionSamples(
  page: Page,
  sampleWindowMs = SAMPLE_WINDOW_MS,
): Promise<TransitionSample[]> {
  return page.evaluate(
    async ({ paperSelector, mainContentSelector, drawerSelector, sampleWindowMs }) => {
      interface CSSTransitionLike extends Animation {
        transitionProperty?: string
      }

      function describeTransition(
        element: Element | null,
        property: string,
      ): { transitionProperty: string | null; durationMs: number | null; easing: string | null } {
        if (element === null) {
          return { transitionProperty: null, durationMs: null, easing: null }
        }

        const transition = (element.getAnimations() as CSSTransitionLike[]).find(
          (animation) => animation.transitionProperty === property,
        )

        if (transition === undefined) {
          return { transitionProperty: null, durationMs: null, easing: null }
        }

        const timing = transition.effect?.getTiming() ?? {}

        return {
          transitionProperty: property,
          durationMs: typeof timing.duration === 'number' ? timing.duration : null,
          easing: typeof timing.easing === 'string' ? timing.easing : null,
        }
      }

      const samples: TransitionSample[] = []
      const start = performance.now()

      // CSS transitions start on the next rendering opportunity after a style change, not
      // synchronously inside whatever triggered it, so the first sample can legitimately observe
      // no transition yet; the loop keeps sampling across the whole window regardless.
      while (performance.now() - start < sampleWindowMs) {
        const paper = document.querySelector<HTMLElement>(paperSelector)
        const mainContent = document.querySelector<HTMLElement>(mainContentSelector)
        const drawer = document.querySelector(drawerSelector)
        const paperInfo = describeTransition(paper, 'transform')
        const mainContentInfo = describeTransition(mainContent, 'margin-left')

        samples.push({
          tMs: performance.now() - start,
          drawerVariant: drawer?.getAttribute('data-drawer-variant') ?? null,
          paperTransitionProperty: paperInfo.transitionProperty,
          paperTransform: paper === null ? null : getComputedStyle(paper).transform,
          paperDurationMs: paperInfo.durationMs,
          paperEasing: paperInfo.easing,
          mainContentTransitionProperty: mainContentInfo.transitionProperty,
          mainContentMarginLeft:
            mainContent === null ? null : getComputedStyle(mainContent).marginLeft,
          mainContentDurationMs: mainContentInfo.durationMs,
          mainContentEasing: mainContentInfo.easing,
        })

        await new Promise((resolve) => requestAnimationFrame(resolve))
      }

      return samples
    },
    {
      paperSelector: PAPER_SELECTOR,
      mainContentSelector: MAIN_CONTENT_SELECTOR,
      drawerSelector: DRAWER_SELECTOR,
      sampleWindowMs,
    },
  )
}

// Waits until the drawer is at rest, as a state rather than as "no animation is running right now":
// a poll for "no running animation" also passes while the transition that is about to start has not
// been created yet (Slide positions a closed paper in a React effect, and the browser creates the
// CSSTransition only at the next style update after that), so a toggle click that follows it lands on
// a still-running mount/close transition. The browser then treats the click's transition as a
// reversal and shortens the duration the sample reads (Firefox reported 191.767 instead of 200).
//   1. Slide has put the paper at the resting position for the drawer's current open state (read
//      from `data-drawer-open`) -- the style change that starts the transition has been made. A
//      closed paper rests at an inline `translateX(-<width>px)`; an open one rests at `none`, or at
//      an empty inline `transform` when it was never closed (Slide only positions a paper it closes).
//   2. Two rendering opportunities have passed, so that style change has become a CSSTransition.
//   3. Every transition on the paper and the shell content has finished (re-checked after each wait,
//      because finishing one can leave another running).
async function waitForDrawerTransitionsToSettle(page: Page): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(
        ({ paperSelector, drawerSelector }) => {
          const paper = document.querySelector<HTMLElement>(paperSelector)
          const drawer = document.querySelector(drawerSelector)

          if (paper === null || drawer === null) {
            return false
          }

          const isAtOpenRest = paper.style.transform === '' || paper.style.transform === 'none'

          return drawer.getAttribute('data-drawer-open') === 'true' ? isAtOpenRest : !isAtOpenRest
        },
        { paperSelector: PAPER_SELECTOR, drawerSelector: DRAWER_SELECTOR },
      ),
    )
    .toBe(true)

  await page.evaluate(
    async ({ paperSelector, mainContentSelector }) => {
      const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const activeAnimations = () =>
        [
          document.querySelector(paperSelector),
          document.querySelector(mainContentSelector),
        ].flatMap((element) => (element === null ? [] : element.getAnimations()))

      await nextFrame()
      await nextFrame()

      for (let pending = activeAnimations(); pending.length > 0; pending = activeAnimations()) {
        await Promise.allSettled(pending.map((animation) => animation.finished))
        await nextFrame()
      }
    },
    { paperSelector: PAPER_SELECTOR, mainContentSelector: MAIN_CONTENT_SELECTOR },
  )
}

function describeSamplesForFailure(samples: readonly TransitionSample[]): string {
  return samples
    .map(
      (sample) =>
        `t=${sample.tMs.toFixed(0)}ms variant=${sample.drawerVariant} ` +
        `paper(transitionProperty=${sample.paperTransitionProperty} transform=${sample.paperTransform}) ` +
        `mainContent(transitionProperty=${sample.mainContentTransitionProperty} marginLeft=${sample.mainContentMarginLeft})`,
    )
    .join('\n')
}

function assertSharedTransitionTiming(
  samples: readonly TransitionSample[],
  target: 'paper' | 'mainContent',
): void {
  const failureContext = () => describeSamplesForFailure(samples)
  const property = target === 'paper' ? 'transform' : 'margin-left'
  const sampleWithTransition = samples.find((sample) =>
    target === 'paper'
      ? sample.paperTransitionProperty === property
      : sample.mainContentTransitionProperty === property,
  )

  expect(
    sampleWithTransition,
    `no CSSTransition observed for ${target} (${property}) across the sampling window.\n${failureContext()}`,
  ).toBeDefined()

  const durationMs =
    target === 'paper'
      ? sampleWithTransition?.paperDurationMs
      : sampleWithTransition?.mainContentDurationMs
  const easing =
    target === 'paper' ? sampleWithTransition?.paperEasing : sampleWithTransition?.mainContentEasing

  expect(durationMs, failureContext()).toBe(EXPECTED_TRANSITION_DURATION_MS)
  expect(easing, failureContext()).toBe(EXPECTED_TRANSITION_EASING)
}

const DESKTOP_WIDTHS = [1272, 1920] as const

for (const width of DESKTOP_WIDTHS) {
  test(`animates the permanent drawer closed with the shared 200ms transition at ${width}px`, async ({
    page,
  }) => {
    await installAppShellApiMocks(page)
    await installDashboardApiMocks(page)
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')

    await expect(page.getByTestId('shell-drawer')).toHaveAttribute(
      'data-drawer-variant',
      'permanent',
    )
    await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'true')
    // Wait for any mount transition to settle before sampling the close transition, so this test
    // is not confused by an unrelated transition still finishing from page load.
    await waitForDrawerTransitionsToSettle(page)

    await page.locator(TOGGLE_BUTTON_SELECTOR).click()
    const samples = await captureTransitionSamples(page)

    await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'false')

    // The drawer must stay attached to the DOM throughout the close (it must not be unmounted
    // outright -- that is precisely what made the animation impossible).
    expect(
      samples.every((sample) => sample.paperTransform !== null),
      describeSamplesForFailure(samples),
    ).toBe(true)

    assertSharedTransitionTiming(samples, 'paper')
    assertSharedTransitionTiming(samples, 'mainContent')
  })

  test(`animates the permanent drawer open with the shared 200ms transition at ${width}px`, async ({
    page,
  }) => {
    await installAppShellApiMocks(page)
    await installDashboardApiMocks(page)
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')

    // Start from closed so the sampled toggle is the opening transition.
    await page.locator(TOGGLE_BUTTON_SELECTOR).click()
    await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'false')
    await waitForDrawerTransitionsToSettle(page)

    await page.locator(TOGGLE_BUTTON_SELECTOR).click()
    const samples = await captureTransitionSamples(page)

    await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'true')

    assertSharedTransitionTiming(samples, 'paper')
    assertSharedTransitionTiming(samples, 'mainContent')
  })
}

test('keeps animating the temporary drawer open with the shared 200ms transition at mobile width (regression guard)', async ({
  page,
}) => {
  await installAppShellApiMocks(page)
  await installDashboardApiMocks(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-variant', 'temporary')
  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'false')
  // Mounting the drawer closed still moves the paper: MUI Slide's own mount effect
  // (@mui/material/Slide/Slide.js, `useEffect(() => { if (!inProp) updatePosition() }, ...)`)
  // repositions the paper off-screen once, and the paper's `transition: transform 200ms` (sx in
  // DrawerHost.tsx) is unconditional, so that repositioning animates too. If the toggle click below
  // fires while that mount-time transition is still running, the browser treats the click's open
  // transition as a reversal of it and applies CSS Transitions Level 2's reversing-shortening factor
  // (https://drafts.csswg.org/css-transitions-2/#starting), which legitimately shortens the
  // `effect.getTiming().duration` this test asserts on below -- not a flaky measurement, a real
  // interrupted-transition duration. Wait for it to settle first, exactly like the desktop tests
  // above do for their own mount transition.
  await waitForDrawerTransitionsToSettle(page)

  await page.locator(TOGGLE_BUTTON_SELECTOR).click()
  const samples = await captureTransitionSamples(page)

  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'true')

  assertSharedTransitionTiming(samples, 'paper')
})
