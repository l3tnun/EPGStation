import { describe, expect, it } from 'vitest'
import {
  findGuideDialogProgram,
  firstScheduleChannelName,
  hasDisplayChannels,
  resolveGuideHours,
  type GuideRequestSet,
} from '@/features/guide/lib/guidePageState'

const startAt = Date.parse('2026-05-05T00:00:00+09:00')

function requestSet(
  mode: 'normal' | 'singleChannel',
  scheduleStartAt: number,
  scheduleEndAt: number,
): GuideRequestSet {
  return {
    schedule: { mode, startAt: scheduleStartAt, endAt: scheduleEndAt },
    guideQuery: { mode, startAt },
  } as unknown as GuideRequestSet
}

describe('firstScheduleChannelName', () => {
  it('returns the name of the first schedule channel', () => {
    expect(
      firstScheduleChannelName([{ channel: { name: 'First' } }, { channel: { name: 'Second' } }]),
    ).toBe('First')
  })

  it('returns undefined without throwing when there is no schedule or no channel', () => {
    expect(firstScheduleChannelName(undefined)).toBeUndefined()
    expect(firstScheduleChannelName([])).toBeUndefined()
    expect(firstScheduleChannelName([{ programs: [] }])).toBeUndefined()
  })
})

describe('findGuideDialogProgram guards', () => {
  it('returns null when schedules are not loaded yet', () => {
    expect(findGuideDialogProgram(undefined, 10)).toBeNull()
  })

  it('returns null when no program id is selected', () => {
    expect(findGuideDialogProgram([{ programs: [{ id: 10 }] }], undefined)).toBeNull()
  })

  it('finds the program in a later schedule after schedules without a programs list', () => {
    expect(
      findGuideDialogProgram(
        [
          { channel: { id: 1, name: 'Empty' } },
          { channel: { id: 2, name: 'Second' }, programs: [{ id: 10 }] },
        ],
        10,
      ),
    ).toStrictEqual({ id: 10, channelId: 2, channelName: 'Second' })
  })
})

describe('resolveGuideHours', () => {
  it('is always one day for a single-channel guide regardless of the request window', () => {
    expect(resolveGuideHours(requestSet('singleChannel', startAt, startAt + 3 * 3600000))).toBe(24)
  })

  it('rounds the request window up to whole hours and never goes below one hour', () => {
    expect(resolveGuideHours(requestSet('normal', startAt, startAt + 3 * 3600000))).toBe(3)
    expect(resolveGuideHours(requestSet('normal', startAt, startAt + 3 * 3600000 + 1))).toBe(4)
    expect(resolveGuideHours(requestSet('normal', startAt, startAt))).toBe(1)
  })
})

describe('hasDisplayChannels', () => {
  it('is false while schedules are not loaded or empty', () => {
    expect(
      hasDisplayChannels({
        schedules: undefined,
        requestSet: requestSet('normal', startAt, startAt + 3600000),
      }),
    ).toBe(false)
    expect(
      hasDisplayChannels({
        schedules: [],
        requestSet: requestSet('normal', startAt, startAt + 3600000),
      }),
    ).toBe(false)
  })

  it('is true when at least one channel remains in the layout', () => {
    expect(
      hasDisplayChannels({
        schedules: [{ channel: { id: 1, type: 0x01 }, programs: [] }],
        requestSet: requestSet('normal', startAt, startAt + 3600000),
      }),
    ).toBe(true)
  })

  it('is false when the full guide filters out every non audio/video channel', () => {
    expect(
      hasDisplayChannels({
        schedules: [{ channel: { id: 1, type: 0xc0 }, programs: [] }],
        requestSet: requestSet('normal', startAt, startAt + 3600000),
      }),
    ).toBe(false)
  })
})
