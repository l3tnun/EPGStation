import { describe, expect, it } from 'vitest'
import {
  formatRecordedDropInfo,
  hasRecordedDropError,
  shouldShowRecordedListDropInfo,
} from '@/features/recorded/lib/recordedFormat'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

const quiet = { dropCnt: 0, errorCnt: 0, scramblingCnt: 0 }

describe('Recorded list drop info visibility', () => {
  const base = new DefaultSettingsFactory().create()
  const dropInfo = { ...base, isShowDropInfoInsteadOfDescription: true }
  const noDropInfo = { ...base, isShowDropInfoInsteadOfDescription: false }

  it('shows only when the setting is on, the item is not recording, and a drop log exists', () => {
    expect(shouldShowRecordedListDropInfo({ dropLogFile: quiet }, dropInfo)).toBe(true)
    expect(
      shouldShowRecordedListDropInfo({ dropLogFile: quiet, isRecording: false }, dropInfo),
    ).toBe(true)
    expect(shouldShowRecordedListDropInfo({ dropLogFile: quiet }, noDropInfo)).toBe(false)
    expect(
      shouldShowRecordedListDropInfo({ dropLogFile: quiet, isRecording: true }, dropInfo),
    ).toBe(false)
    expect(shouldShowRecordedListDropInfo({}, dropInfo)).toBe(false)
    expect(shouldShowRecordedListDropInfo({ isRecording: false }, noDropInfo)).toBe(false)
  })
})

describe('Recorded drop info text', () => {
  it('is null while recording or without a drop log', () => {
    expect(formatRecordedDropInfo({ dropLogFile: quiet, isRecording: true })).toBeNull()
    expect(formatRecordedDropInfo({ isRecording: true })).toBeNull()
    expect(formatRecordedDropInfo({})).toBeNull()
  })

  it('lists the counts followed by the summed video file size', () => {
    expect(
      formatRecordedDropInfo({
        dropLogFile: { dropCnt: 1, errorCnt: 2, scramblingCnt: 3 },
        videoFiles: [{ size: 500 }, { size: 700 }, {}],
      }),
    ).toBe('drop: 1, error: 2, scrambling: 3 1.2KB')
    expect(
      formatRecordedDropInfo({
        dropLogFile: quiet,
        isRecording: false,
      }),
    ).toBe('drop: 0, error: 0, scrambling: 0 0.0B')
  })
})

describe('Recorded drop error detection', () => {
  it('is false without a drop log and while recording', () => {
    expect(hasRecordedDropError({})).toBe(false)
    expect(
      hasRecordedDropError({
        dropLogFile: { dropCnt: 1, errorCnt: 1, scramblingCnt: 1 },
        isRecording: true,
      }),
    ).toBe(false)
  })

  it('is true when any single counter reaches one', () => {
    expect(hasRecordedDropError({ dropLogFile: quiet })).toBe(false)
    expect(hasRecordedDropError({ dropLogFile: { ...quiet, dropCnt: 1 } })).toBe(true)
    expect(hasRecordedDropError({ dropLogFile: { ...quiet, errorCnt: 1 } })).toBe(true)
    expect(hasRecordedDropError({ dropLogFile: { ...quiet, scramblingCnt: 1 } })).toBe(true)
    expect(
      hasRecordedDropError({ dropLogFile: { ...quiet, dropCnt: 1 }, isRecording: false }),
    ).toBe(true)
  })
})
