import type { Page } from '@playwright/test'
import { installAppShellApiMocks } from './appShellMocks'
import { installGuideOnAirApiMocks } from './guideOnAirMocks'

export const getHashSearchParams = (url: string): URLSearchParams => {
  const hashQuery = url.split('#')[1]?.split('?')[1] ?? ''

  return new URLSearchParams(hashQuery)
}

export async function installBroadcastWorkflowMocks(page: Page): Promise<void> {
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
  await installGuideOnAirApiMocks(page)
}
