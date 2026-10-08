import { useMemo } from 'react'
import type { LiveStreamSelectChannel } from '@/features/onair/LiveStreamSelectDialog'
import type { SettingsConsumerValue } from '@/shared/settings'
import type { GuideGenreVisibility, GuideGridRendererInput } from '../GuideGridRenderer'
import { resolveGuideHours } from '../lib/guidePageState'
import type { useGuideRouteData } from './useGuideRouteData'

type GuideRouteData = ReturnType<typeof useGuideRouteData>

export function useGuideRendererInput({
  routeData,
  genreVisibility,
  guideMode,
  now,
  onProgramClick,
  onChannelClick,
}: {
  routeData: Pick<
    GuideRouteData,
    'requestSet' | 'scheduleData' | 'reserveIndex' | 'hasScheduleData'
  >
  genreVisibility: GuideGenreVisibility
  guideMode: SettingsConsumerValue['guideMode']
  now: number | undefined
  onProgramClick: (programId: number) => void
  onChannelClick: (channel: LiveStreamSelectChannel) => void
}): GuideGridRendererInput | null {
  const { requestSet, scheduleData, reserveIndex, hasScheduleData } = routeData

  return useMemo<GuideGridRendererInput | null>(() => {
    if (scheduleData === undefined || !hasScheduleData) {
      return null
    }

    return {
      schedules: scheduleData,
      mode: requestSet.guideQuery.mode,
      startAt: requestSet.guideQuery.startAt,
      hours: resolveGuideHours(requestSet),
      reserveIndex,
      genreVisibility,
      guideMode,
      onProgramClick,
      onChannelClick: (channel) => {
        if (channel.id !== undefined && requestSet.guideQuery.channelId === undefined) {
          onChannelClick({
            id: channel.id,
            name: channel.name,
          })
        }
      },
      now: now === undefined ? undefined : () => now,
    }
  }, [
    genreVisibility,
    guideMode,
    hasScheduleData,
    now,
    onChannelClick,
    onProgramClick,
    requestSet,
    reserveIndex,
    scheduleData,
  ])
}
