import type { CSSProperties } from 'react'
import type { GuideSizeSetting, GuideSizeValue } from '../guideStorage'

export type GuideSizeSection = keyof GuideSizeSetting
export type GuideSizeField = keyof GuideSizeValue

export interface GuideSizeFieldDefinition {
  field: GuideSizeField
  label: string
  min: number
  max: number
  step: number
}

export const GUIDE_SIZE_FIELDS: readonly GuideSizeFieldDefinition[] = [
  { field: 'channelHeight', label: 'チャンネル高さ', min: 10, max: 100, step: 10 },
  { field: 'channelWidth', label: 'チャンネル横幅', min: 0, max: 600, step: 10 },
  { field: 'channelFontsize', label: 'チャンネルフォント', min: 0.5, max: 40, step: 0.5 },
  { field: 'timescaleHeight', label: '時刻高さ', min: 10, max: 400, step: 10 },
  { field: 'timescaleWidth', label: '時刻横幅', min: 10, max: 100, step: 10 },
  { field: 'timescaleFontsize', label: '時刻フォント', min: 0.5, max: 40, step: 0.5 },
  { field: 'programFontSize', label: '番組フォント', min: 0.5, max: 40, step: 0.5 },
]

export function createNumberOptions(min: number, max: number, step: number): number[] {
  const count = Math.floor((max - min) / step)

  return Array.from({ length: count + 1 }, (_, index) =>
    Number(Math.min(max, min + index * step).toFixed(1)),
  )
}

export function createGuideSizeCssVariables(setting: GuideSizeSetting): CSSProperties {
  return {
    '--channel-tablet-height': `${setting.tablet.channelHeight}px`,
    '--channel-tablet-width': `${setting.tablet.channelWidth}px`,
    '--channel-tablet-fontsize': `${setting.tablet.channelFontsize}px`,
    '--timescale-tablet-height': `${setting.tablet.timescaleHeight}px`,
    '--timescale-tablet-width': `${setting.tablet.timescaleWidth}px`,
    '--timescale-tablet-fontsize': `${setting.tablet.timescaleFontsize}px`,
    '--program-tablet-fontsize': `${setting.tablet.programFontSize}pt`,
    '--channel-mobile-height': `${setting.mobile.channelHeight}px`,
    '--channel-mobile-width': `${setting.mobile.channelWidth}px`,
    '--channel-mobile-fontsize': `${setting.mobile.channelFontsize}px`,
    '--timescale-mobile-height': `${setting.mobile.timescaleHeight}px`,
    '--timescale-mobile-width': `${setting.mobile.timescaleWidth}px`,
    '--timescale-mobile-fontsize': `${setting.mobile.timescaleFontsize}px`,
    '--program-mobile-fontsize': `${setting.mobile.programFontSize}pt`,
  } as CSSProperties
}
