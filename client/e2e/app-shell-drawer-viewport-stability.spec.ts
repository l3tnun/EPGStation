import { expect, type Page, test } from '@playwright/test'
import { installAppShellApiMocks, installDashboardApiMocks } from './support/appShellMocks'
import { installGuideOnAirApiMocks } from './support/guideOnAirMocks'
import { installRecordedApiMocks } from './support/recordedMocks'
import { installRecordingEncodeApiMocks } from './support/recordingEncodeMocks'
import { installReservesApiMocks } from './support/reservesMocks'
import { installSearchRuleWorkflowApiMocks } from './support/searchRuleMocks'
import { installStoragesUploadApiMocks } from './support/storagesUploadMocks'

// Regression guard: at a real Linux + Chrome desktop width barely above the app shell's desktop
// breakpoint (APP_SHELL_DESKTOP_BREAKPOINT = 1264px, drawerLayout.ts) -- 1272px -- the
// permanent navigation drawer must not close itself while navigating between screens, while a dialog
// is open (onair), or while operating a dropdown (settings), and the hamburger toggle must keep
// opening it. Cause to guard against (client/src/app/browserAdapters.ts, getBrowserViewportWidth):
// resolving the app's viewport width as the *narrowest* of window.innerWidth,
// window.visualViewport.width, and document.documentElement.clientWidth. The latter two exclude a
// classic (non-overlay) scrollbar's gutter -- the default rendering on Linux desktop Chrome -- so
// they silently narrow by the scrollbar's width (commonly 15-17px) whenever a routed page's
// content is tall enough to need a vertical scrollbar, or whenever a MUI Modal (Dialog / Select /
// the drawer itself) locks body scroll and removes that scrollbar. At 1272px this is enough to
// cross the 1264px breakpoint even though the physical browser window never changed size, which
// flips `isDesktop` and -- via useDrawerUserState's mobile-to-desktop transition effect -- resets
// the user's own drawer open/close choice. getBrowserViewportWidth() therefore prefers
// window.innerWidth (which never changes because of the page's own content) and only fall back to
// the narrower sources when innerWidth itself is unavailable.
//
// Headless Chromium never reserves scrollbar-gutter space at all (an overlay scrollbar occupies 0
// layout width even for genuinely overflowing content), so the divergence between
// window.innerWidth and document.documentElement.clientWidth this bug depends on cannot occur
// here on its own.
// This test drives the exact mechanism the app itself reacts to: it makes a real, engine-observed
// change to document.documentElement's own client width (the same delta a real classic scrollbar
// removing/inserting itself produces) and dispatches the 'resize' event the app's own
// useResolvedViewportWidth hook listens for, instead of depending on this environment's headless
// Chromium to render a real scrollbar (which it structurally cannot).

const OWNER_REPORTED_VIEWPORT = { width: 1272, height: 900 }
// A typical classic (non-overlay) scrollbar width on Linux desktop Chrome.
const SIMULATED_SCROLLBAR_WIDTH = 15

async function simulateClassicScrollbarNarrowing(page: Page): Promise<void> {
  await page.evaluate((narrowerWidth) => {
    Object.defineProperty(document.documentElement, 'clientWidth', {
      configurable: true,
      value: narrowerWidth,
    })
    window.dispatchEvent(new Event('resize'))
  }, OWNER_REPORTED_VIEWPORT.width - SIMULATED_SCROLLBAR_WIDTH)
}

async function restoreRealClientWidth(page: Page): Promise<void> {
  await page.evaluate((realWidth) => {
    Object.defineProperty(document.documentElement, 'clientWidth', {
      configurable: true,
      value: realWidth,
    })
    window.dispatchEvent(new Event('resize'))
  }, OWNER_REPORTED_VIEWPORT.width)
}

async function expectDrawerPermanentAndOpen(page: Page): Promise<void> {
  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-variant', 'permanent')
  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'true')
}

// Every routed screen reachable from the navigation drawer (client/src/app/navigation/items.ts).
// Enumerated (rather than picking one representative page) because the owner's report and
// instruction are explicit that the fix and its test must hold for every page, not just the ones
// he happened to reproduce it on.
const ROUTES: ReadonlyArray<{
  path: string
  installMocks: (page: Page) => Promise<unknown>
}> = [
  { path: '/', installMocks: async (page) => installDashboardApiMocks(page) },
  { path: '/onair', installMocks: async (page) => installGuideOnAirApiMocks(page) },
  { path: '/guide', installMocks: async (page) => installGuideOnAirApiMocks(page) },
  { path: '/recording', installMocks: async (page) => installRecordingEncodeApiMocks(page) },
  { path: '/recorded', installMocks: async (page) => installRecordedApiMocks(page) },
  { path: '/encode', installMocks: async (page) => installRecordingEncodeApiMocks(page) },
  { path: '/reserves?type=normal', installMocks: async (page) => installReservesApiMocks(page) },
  { path: '/search', installMocks: async (page) => installSearchRuleWorkflowApiMocks(page) },
  { path: '/rule', installMocks: async (page) => installSearchRuleWorkflowApiMocks(page) },
  { path: '/storages', installMocks: async (page) => installStoragesUploadApiMocks(page) },
  { path: '/settings', installMocks: async () => undefined },
]

for (const route of ROUTES) {
  test(`drawer stays permanent and open on ${route.path} when the page's own scrollbar narrows documentElement.clientWidth`, async ({
    page,
  }) => {
    await installAppShellApiMocks(page)
    await route.installMocks(page)
    await page.setViewportSize(OWNER_REPORTED_VIEWPORT)
    await page.goto(`/#${route.path}`)

    await expectDrawerPermanentAndOpen(page)

    // Simulate the page having its own vertical scrollbar (or a dialog/dropdown having just
    // closed and restored one) the way real Linux desktop Chrome would at this width.
    await simulateClassicScrollbarNarrowing(page)
    await expectDrawerPermanentAndOpen(page)

    // Simulate the scrollbar disappearing again (e.g. a dialog opening and locking body scroll).
    await restoreRealClientWidth(page)
    await expectDrawerPermanentAndOpen(page)
  })
}

test('drawer stays open while navigating across screens and the hamburger toggle keeps working, even while the page scrollbar narrows documentElement.clientWidth', async ({
  page,
}) => {
  await installAppShellApiMocks(page)
  await installDashboardApiMocks(page)
  await installGuideOnAirApiMocks(page)
  await installReservesApiMocks(page)
  await page.setViewportSize(OWNER_REPORTED_VIEWPORT)
  await page.goto('/')

  await expectDrawerPermanentAndOpen(page)

  for (const navigationItemId of [
    'navigation-item-onair',
    'navigation-item-reserves-normal',
    'navigation-item-dashboard',
  ]) {
    await simulateClassicScrollbarNarrowing(page)
    await page.getByTestId(navigationItemId).click()
    await expectDrawerPermanentAndOpen(page)
    await restoreRealClientWidth(page)
    await expectDrawerPermanentAndOpen(page)
  }

  // The hamburger toggle must still be able to close and reopen the drawer on the user's own
  // command, independent of the simulated scrollbar narrowing.
  await simulateClassicScrollbarNarrowing(page)
  await page.getByRole('button', { name: 'ナビゲーションを開閉' }).click()
  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'false')
  await page.getByRole('button', { name: 'ナビゲーションを開閉' }).click()
  await expectDrawerPermanentAndOpen(page)
})
