import type { Page } from '@playwright/test'

export async function setRecordedBrowserSettings(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'settings',
      JSON.stringify({
        recordedLength: 24,
        isShowTableMode: true,
        isPreferredPlayingOnWeb: true,
        deleteRecordedDefaultValue: true,
      }),
    )
  })
}
