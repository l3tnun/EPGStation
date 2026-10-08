import { expect, test } from '@playwright/test'
import { installAppShellApiMocks, isDesktopViewport } from '../e2e/support/appShellMocks'
import { installGuideOnAirApiMocks } from '../e2e/support/guideOnAirMocks'
import { expectAnnounced } from '../e2e/support/notificationObservation'
import { createRealtimeHarness } from '../e2e/support/realtimeHarness'
import { installRecordedApiMocks } from '../e2e/support/recordedMocks'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
})

test('keeps the shell content in the viewport', async ({ page }) => {
  await page.goto('/')

  const main = page.getByTestId('shell-main')
  const viewport = page.viewportSize()
  const expectedOffset = isDesktopViewport(page) ? '256' : '0'
  const expectedVariant = isDesktopViewport(page) ? 'permanent' : 'temporary'

  expect(viewport).not.toBeNull()
  await expect(main).toBeVisible()
  const mainBox = await main.boundingBox()
  expect(mainBox).not.toBeNull()
  expect(mainBox?.height).toBeGreaterThanOrEqual((viewport?.height ?? 0) - 1)
  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-width', '256')
  await expect(page.getByTestId('shell-drawer')).toHaveAttribute(
    'data-drawer-variant',
    expectedVariant,
  )
  await expect(main).toHaveAttribute('data-main-offset', expectedOffset)
})

test('updates drawer geometry when resizing across the desktop breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 1263, height: 720 })
  await page.goto('/')

  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-variant', 'temporary')
  await expect(page.getByTestId('shell-main')).toHaveAttribute('data-main-offset', '0')

  await page.setViewportSize({ width: 1264, height: 720 })

  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-variant', 'permanent')
  await expect(page.getByTestId('shell-main')).toHaveAttribute('data-main-offset', '256')

  await page.setViewportSize({ width: 1263, height: 720 })

  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-variant', 'temporary')
  await expect(page.getByTestId('shell-main')).toHaveAttribute('data-main-offset', '0')
})

test('renders the routed title bar with light and dark app bar treatments', async ({ page }) => {
  await page.goto('/')

  const titleBar = page.getByTestId('title-bar')

  await expect(titleBar).toHaveAttribute('data-app-bar-treatment', 'light')
  await expect(titleBar.getByRole('heading', { name: 'EPGStation' })).toBeVisible()

  await page.evaluate(() => {
    window.localStorage.setItem(
      'settings',
      JSON.stringify({
        shouldUseOSColorTheme: false,
        isForceDarkTheme: true,
      }),
    )
  })
  await page.reload()

  await expect(titleBar).toHaveAttribute('data-app-bar-treatment', 'dark')
})

test('aligns the routed title bar to the shell main edge before body padding starts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  const mainBox = await page.getByTestId('shell-main').boundingBox()
  const titleBarBox = await page.getByTestId('title-bar').boundingBox()

  expect(mainBox).not.toBeNull()
  expect(titleBarBox).not.toBeNull()
  // Source D: src/app/AppShell.tsx renders the routed TitleBar as the first child of `<main
  // data-testid="shell-main">`, and src/app/AppShell.module.css `.main` carries no padding
  // (body padding is applied later, by `.screenBody { padding: 24px }`), so the title bar's
  // top-left edge is contracted to match shell-main's; toBeCloseTo(..., 0) allows ±0.5px
  // sub-pixel rounding.
  expect(titleBarBox?.x).toBeCloseTo(mainBox?.x ?? 0, 0)
  expect(titleBarBox?.y).toBeCloseTo(mainBox?.y ?? 0, 0)
  expect(titleBarBox?.width).toBeCloseTo(mainBox?.width ?? 0, 0)
})

test('keeps the drawer closed and the main offset at 0 at 1024x768 on a routed screen', async ({
  page,
}) => {
  await installRecordedApiMocks(page)
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/#/recorded')

  // Below 1264px the drawer is temporary: closed by default, and the routed screen owns the title.
  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-variant', 'temporary')
  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'false')
  await expect(page.getByTestId('shell-main')).toHaveAttribute('data-main-offset', '0')
  await expect(
    page.getByTestId('title-bar').getByRole('heading', { name: '録画済み' }),
  ).toBeVisible()
  const mainBox = await page.getByTestId('shell-main').boundingBox()
  expect(mainBox?.x).toBe(0)
  expect(mainBox?.width).toBe(1024)
})

test('overlays the mobile drawer on /guide without shifting the main content', async ({ page }) => {
  await installGuideOnAirApiMocks(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/#/guide?time=23111507')

  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
  const mainBefore = await page.getByTestId('shell-main').boundingBox()
  const titleBarBefore = await page.getByTestId('title-bar').boundingBox()
  expect(mainBefore).not.toBeNull()
  expect(titleBarBefore).not.toBeNull()

  await page.getByRole('button', { name: 'ナビゲーションを開閉' }).click()
  await expect(page.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'true')
  // The drawer slides in; wait until its paper has reached the left edge and covers the content.
  await expect
    .poll(async () => (await page.getByTestId('shell-drawer-content').boundingBox())?.x)
    .toBeGreaterThanOrEqual(0)

  const mainAfter = await page.getByTestId('shell-main').boundingBox()
  const titleBarAfter = await page.getByTestId('title-bar').boundingBox()
  const drawerBox = await page.getByTestId('shell-drawer-content').boundingBox()
  expect(mainAfter?.x).toBe(mainBefore?.x)
  expect(mainAfter?.width).toBe(mainBefore?.width)
  expect(titleBarAfter?.x).toBe(titleBarBefore?.x)
  expect(titleBarAfter?.width).toBe(titleBarBefore?.width)
  // Overlay, not push: the drawer paper intersects the main area.
  expect(drawerBox).not.toBeNull()
  expect((drawerBox?.x ?? 0) + (drawerBox?.width ?? 0)).toBeGreaterThan((mainAfter?.x ?? 0) + 100)
  await expect(page.getByTestId('shell-main')).toHaveAttribute('data-main-offset', '0')
})

test('keeps reconnect feedback from moving the title bar and the first navigation item', async ({
  page,
}) => {
  const realtime = await createRealtimeHarness(page)

  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await expect(page.getByTestId('navigation-item-dashboard')).toBeVisible()
    // The routed screen (and with it the title bar) mounts after the drawer, once the initial
    // route has rendered. Take the baseline only when both elements are present: a baseline read
    // before the title bar exists would count every later frame as missing and leave its position
    // unchecked.
    await expect(page.getByTestId('title-bar')).toBeVisible()
    await expect(page.getByTestId('dashboard-page')).toBeVisible()
    await realtime.waitForClient()

    // Sample both elements on every frame while the disconnect and reconnect snackbars appear.
    const hasBaseline = await page.evaluate(() => {
      const ids = ['title-bar', 'navigation-item-dashboard']
      const read = () =>
        ids.map((id) => {
          const rect = document
            .querySelector<HTMLElement>(`[data-testid="${id}"]`)
            ?.getBoundingClientRect()

          return rect === undefined
            ? null
            : { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        })
      const baseline = read()
      const samples = { frames: 0, snackbarFrames: 0, maxShift: 0, missing: 0 }
      const tick = () => {
        samples.frames += 1
        if (document.querySelector('[data-snackbar-severity]') !== null) {
          samples.snackbarFrames += 1
        }
        read().forEach((rect, index) => {
          const base = baseline[index]
          if (rect === null || base === null) {
            samples.missing += 1
            return
          }
          samples.maxShift = Math.max(
            samples.maxShift,
            Math.abs(rect.x - base.x),
            Math.abs(rect.y - base.y),
            Math.abs(rect.width - base.width),
            Math.abs(rect.height - base.height),
          )
        })
        window.requestAnimationFrame(tick)
      }
      Object.assign(window, { __shellLayoutSamples: samples })
      window.requestAnimationFrame(tick)

      return baseline.every((rect) => rect !== null)
    })
    expect(hasBaseline).toBe(true)

    // Closing the engine drops the transport, which the client reports as a disconnect and then
    // reconnects from by itself.
    realtime.socketServer.engine.close()
    await expectAnnounced(page, '接続が切断されました')
    await expectAnnounced(page, '再接続されました', { timeout: 20_000 })

    const samples = await page.evaluate(
      () =>
        (
          window as unknown as {
            __shellLayoutSamples: {
              frames: number
              snackbarFrames: number
              maxShift: number
              missing: number
            }
          }
        ).__shellLayoutSamples,
    )

    expect(samples.snackbarFrames).toBeGreaterThan(0)
    expect(samples.missing).toBe(0)
    expect(samples.maxShift).toBeLessThanOrEqual(0.5)
  } finally {
    await realtime.close()
  }
})
