import type { GuideSchedule } from '../guideApi'
import type { buildGuideFetchRequestSet } from '../guideRequests'
import { createGuideGridLayout } from '../GuideGridRenderer'
import type { GuideProgramDialogProgram } from '../ProgramDialog'

export type GuideRequestSet = ReturnType<typeof buildGuideFetchRequestSet>

export const EMPTY_INVALID_CHANNEL_IDS = new Set<number>()

export function getBrowserLocalStorage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage
}

export function firstScheduleChannelName(
  schedules: readonly GuideSchedule[] | undefined,
): string | undefined {
  return schedules?.[0]?.channel?.name
}

export function findGuideDialogProgram(
  schedules: readonly GuideSchedule[] | undefined,
  programId: number | undefined,
): GuideProgramDialogProgram | null {
  if (schedules === undefined || programId === undefined) {
    return null
  }

  for (const schedule of schedules) {
    const program = schedule.programs?.find((item) => item.id === programId)

    if (program?.id !== undefined) {
      const dialogProgram: GuideProgramDialogProgram = {
        ...program,
        id: program.id,
      }

      const channelId = program.channelId ?? schedule.channel?.id
      if (channelId !== undefined) {
        dialogProgram.channelId = channelId
      }
      if (schedule.channel?.name !== undefined) {
        dialogProgram.channelName = schedule.channel.name
      }

      return dialogProgram
    }
  }

  return null
}

export function createRouteKey(location: { pathname: string; search: string }): string {
  return `${location.pathname}${location.search}`
}

export function createRouteHistoryUrl(location: {
  pathname: string
  search: string
  hash: string
}): string | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  const basePath = `${window.location.origin}${window.location.pathname}${window.location.search}`

  return `${basePath}#${location.pathname}${location.search}${location.hash}`
}

export function hasTimestampHistoryKey(routeHistoryUrl: string | undefined): boolean {
  if (routeHistoryUrl === undefined) {
    return false
  }

  const query = routeHistoryUrl.includes('#')
    ? routeHistoryUrl.split('#')[1]?.split('?')[1]
    : routeHistoryUrl.split('?')[1]

  return query === undefined ? false : new URLSearchParams(query).has('timestamp')
}

export function resolveGuideHours(requestSet: GuideRequestSet): number {
  if (requestSet.schedule.mode === 'singleChannel') {
    return 24
  }

  return Math.max(1, Math.ceil((requestSet.schedule.endAt - requestSet.schedule.startAt) / 3600000))
}

export function hasDisplayChannels(input: {
  schedules: readonly GuideSchedule[] | undefined
  requestSet: GuideRequestSet
}): boolean {
  if (input.schedules === undefined || input.schedules.length === 0) {
    return false
  }

  return (
    createGuideGridLayout({
      schedules: input.schedules,
      mode: input.requestSet.guideQuery.mode,
      startAt: input.requestSet.guideQuery.startAt,
      hours: resolveGuideHours(input.requestSet),
    }).channels.length > 0
  )
}
