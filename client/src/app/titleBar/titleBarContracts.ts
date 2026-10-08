export interface DashboardTitleInput {
  version: string | null
}

export type BrowserTitleInput =
  | {
      routeKind: 'dashboard'
      version: string | null
    }
  | {
      routeKind: 'screen'
      title: string
    }

export function resolveDashboardTitle(input: DashboardTitleInput): string {
  if (input.version === null) {
    return 'EPGStation'
  }

  return `EPGStation v${input.version}`
}

export function resolveBrowserTitle(input: BrowserTitleInput): string {
  if (input.routeKind === 'dashboard') {
    return resolveDashboardTitle({ version: input.version })
  }

  return input.title
}
