import { GUIDE_VIEW_MODE_VALUES, type GuideViewMode } from './settingsTypes'

interface NumberRangeContract {
  min: number
  max: number
}

interface AllowedValuesContract<TValue extends string | number> {
  values: readonly TValue[]
}

interface SettingsUiContract {
  guideLength: NumberRangeContract
  reservesLength: NumberRangeContract
  recordingLength: NumberRangeContract
  recordedLength: NumberRangeContract
  rulesLength: NumberRangeContract
  searchLength: AllowedValuesContract<number>
  guideMode: AllowedValuesContract<GuideViewMode>
}

export const SETTINGS_UI_CONTRACT = {
  guideLength: { min: 1, max: 24 },
  reservesLength: { min: 1, max: 100 },
  recordingLength: { min: 1, max: 100 },
  recordedLength: { min: 1, max: 100 },
  rulesLength: { min: 1, max: 100 },
  searchLength: {
    values: [50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600],
  },
  guideMode: {
    values: GUIDE_VIEW_MODE_VALUES,
  },
} as const satisfies SettingsUiContract
