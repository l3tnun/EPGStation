import { type Page } from '@playwright/test'

// 画面の scroll 位置は route 側の scroll root、shell の main、document の
// いずれかが持つ。fix-address-bar2 が有効なときは shell の main だけが動く。
// どの画面でも同じ helper で読めるように、候補の最大値を採る。
export async function getActiveRouteScrollY(page: Page): Promise<number> {
  return page.evaluate(() => {
    const shellMain = document.querySelector<HTMLElement>('[data-testid="shell-main"]')
    // iOS `fix-address-bar2` scrolls `shell-main` only (see readCurrentRouteScrollPosition).
    // `window.scrollY` can stay at a different value, and Math.max then disagrees with the
    // position browser-back restores. final11 iOS read 806 and restored 640.
    if (document.documentElement.classList.contains('fix-address-bar2') && shellMain !== null) {
      return Math.round(shellMain.scrollTop)
    }

    const routeScrollRoot = document.querySelector<HTMLElement>('[data-route-scroll-root="true"]')
    const scrollTops = [routeScrollRoot, shellMain, document.scrollingElement]
      .filter((element): element is Element => element !== null)
      .map((element) => Math.round(element.scrollTop))

    return Math.max(window.scrollY, ...scrollTops)
  })
}

export async function scrollActiveRouteTo(page: Page, y: number): Promise<void> {
  await page.evaluate((scrollTop) => {
    const shellMain = document.querySelector<HTMLElement>('[data-testid="shell-main"]')

    if (document.documentElement.classList.contains('fix-address-bar2') && shellMain !== null) {
      shellMain.scrollTop = scrollTop
      shellMain.dispatchEvent(new Event('scroll', { bubbles: true }))
      return
    }

    window.scrollTo(0, scrollTop)
    window.dispatchEvent(new Event('scroll'))
  }, y)
}

// route の scroll 位置を「離れた時の位置」として比べる test は、scroll root の下に高さ spacer を
// 足してから scroll する。画面の data が描画されて scroll 位置より上の内容が伸びると、browser の
// scroll anchoring が scrollTop を動かす（WebKit で /encode は 720 から 1143 へ 423px）。scroll を
// 置く前に、その画面の一覧が描画済みであること（`renderedLocator` が見えること）を待つ。描画後は
// scrollTop が scrollActiveRouteTo の置いた値で止まるので、test はその値との一致で確かめる。
export async function addRouteScrollSpacer(
  page: Page,
  options: { styleTestId: string; heightPx: number; extraCss?: string },
): Promise<void> {
  await page.evaluate(({ styleTestId, heightPx, extraCss }) => {
    const style = document.createElement('style')
    style.dataset.testid = styleTestId
    style.textContent =
      `[data-testid="shell-main"]::after { content: ""; display: block; height: ${heightPx}px; }` +
      (extraCss === undefined ? '' : ` ${extraCss}`)
    document.head.appendChild(style)
  }, options)
}
