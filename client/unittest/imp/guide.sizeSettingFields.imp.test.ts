import { describe, expect, it } from 'vitest'
import {
  GUIDE_SIZE_FIELDS,
  createGuideSizeCssVariables,
} from '@/features/guide/lib/guideSizeSettingForm'
import type { GuideSizeSetting } from '@/features/guide/guideStorage'

describe('GUIDE_SIZE_FIELDS', () => {
  it('lists every size field with its label and allowed range in display order', () => {
    expect(GUIDE_SIZE_FIELDS).toStrictEqual([
      { field: 'channelHeight', label: 'チャンネル高さ', min: 10, max: 100, step: 10 },
      { field: 'channelWidth', label: 'チャンネル横幅', min: 0, max: 600, step: 10 },
      { field: 'channelFontsize', label: 'チャンネルフォント', min: 0.5, max: 40, step: 0.5 },
      { field: 'timescaleHeight', label: '時刻高さ', min: 10, max: 400, step: 10 },
      { field: 'timescaleWidth', label: '時刻横幅', min: 10, max: 100, step: 10 },
      { field: 'timescaleFontsize', label: '時刻フォント', min: 0.5, max: 40, step: 0.5 },
      { field: 'programFontSize', label: '番組フォント', min: 0.5, max: 40, step: 0.5 },
    ])
  })
})

describe('createGuideSizeCssVariables', () => {
  it('maps every tablet and mobile size to its own CSS variable with its unit', () => {
    const setting: GuideSizeSetting = {
      tablet: {
        channelHeight: 11,
        channelWidth: 12,
        channelFontsize: 13.5,
        timescaleHeight: 14,
        timescaleWidth: 15,
        timescaleFontsize: 16.5,
        programFontSize: 17.5,
      },
      mobile: {
        channelHeight: 21,
        channelWidth: 22,
        channelFontsize: 23.5,
        timescaleHeight: 24,
        timescaleWidth: 25,
        timescaleFontsize: 26.5,
        programFontSize: 27.5,
      },
    }

    expect(createGuideSizeCssVariables(setting)).toStrictEqual({
      '--channel-tablet-height': '11px',
      '--channel-tablet-width': '12px',
      '--channel-tablet-fontsize': '13.5px',
      '--timescale-tablet-height': '14px',
      '--timescale-tablet-width': '15px',
      '--timescale-tablet-fontsize': '16.5px',
      '--program-tablet-fontsize': '17.5pt',
      '--channel-mobile-height': '21px',
      '--channel-mobile-width': '22px',
      '--channel-mobile-fontsize': '23.5px',
      '--timescale-mobile-height': '24px',
      '--timescale-mobile-width': '25px',
      '--timescale-mobile-fontsize': '26.5px',
      '--program-mobile-fontsize': '27.5pt',
    })
  })
})
