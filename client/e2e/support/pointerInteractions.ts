import { expect, type Locator, type Page } from '@playwright/test'

// Playwright の click は pointer が安定するまで待つため、transition 中の要素では
// timeout する。可視であることだけを確認して DOM 側の click を発火させる。
// 無効な要素への DOM click は何も起こさず、失敗もしない。読み込み中で無効な保存ボタンを
// 押した場合、要求は送られないまま結果だけを待つことになるため、操作可能になるまで待つ。
export async function clickWithoutPointerStabilityWait(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible()
  await expect(locator).toBeEnabled()
  await locator.evaluate((node) => {
    const element = node as HTMLElement
    element.click()
  })
}

export async function openReservesMenu(page: Page, label: string): Promise<void> {
  await clickWithoutPointerStabilityWait(
    page.getByRole('button', { name: `予約メニュー: ${label}` }),
  )
}
