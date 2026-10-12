import type { GuideSchedule, GuideProgram, GuideChannel } from '../guideApi'
import type { GuideReserveIndex } from '../guideRequests'
import type { GuideViewMode } from '@/shared/settings/settingsTypes'

export type GuideGridRendererMode = 'normal' | 'singleChannel'
export type GuideGridRendererSchedule = GuideSchedule

export interface GuideGenreVisibility {
  readonly [genreId: number]: boolean | undefined
}

export interface GuideGridViewport {
  scrollLeft: number
  scrollTop: number
  width: number
  height: number
  contentWidth: number
  contentHeight: number
}

export interface GuideGridRendererInput {
  schedules: readonly GuideGridRendererSchedule[]
  mode: GuideGridRendererMode
  startAt: number
  hours: number
  reserveIndex: GuideReserveIndex
  genreVisibility: GuideGenreVisibility
  guideMode: GuideViewMode
  sizeVariables?: Partial<GuideGridSizeVariables>
  onProgramClick?: (programId: number) => void
  onChannelClick?: (channel: GuideChannel) => void
  now?: () => number
}

export interface GuideGridLayoutInput {
  schedules: readonly GuideGridRendererSchedule[]
  mode: GuideGridRendererMode
  startAt: number
  hours: number
}

export interface GuideGridLayoutProgram {
  channel: GuideChannel
  program: Required<Pick<GuideProgram, 'id' | 'startAt' | 'endAt'>> & GuideProgram
  channelIndex: number
  topMinutes: number
  heightMinutes: number
}

export interface GuideGridLayout {
  channels: readonly GuideChannel[]
  programs: readonly GuideGridLayoutProgram[]
  timeLabels: readonly number[]
  contentMinutes: number
}

export interface ProgramDomItem {
  element: HTMLElement
  program: GuideGridLayoutProgram['program']
  channelIndex: number
  topMinutes: number
  heightMinutes: number
  isVisible: boolean
}

export interface GuideScrollData {
  scrollLeft: number
  scrollTop: number
}

export interface GuideGridSizeVariables {
  channelWidth: number
  timescaleHeight: number
}

export const HOUR_MS = 60 * 60 * 1000
export const MINUTE_MS = 60 * 1000
export const DAY_MS = 24 * HOUR_MS
export const DEFAULT_CHANNEL_WIDTH_PX = 140
export const DEFAULT_TIMESCALE_HEIGHT_PX = 180
export const DEFAULT_VIEWPORT_WIDTH_PX = 240
export const DEFAULT_VIEWPORT_HEIGHT_PX = 120
export const RESERVE_STATE_CLASSES = ['reserve', 'conflict', 'skip', 'overlap'] as const
export const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const
