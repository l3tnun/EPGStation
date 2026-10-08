export const guideStartAt = Date.parse('2023-11-15T07:00:00+09:00')
export const hour = 60 * 60 * 1000

export const syntheticGuideSchedules = [
  {
    channel: { id: 301, name: 'Synthetic Guide GR', type: 0x01 },
    programs: [
      {
        id: 4101,
        channelId: 301,
        name: 'Synthetic Morning News',
        description: 'Synthetic guide news description',
        startAt: guideStartAt,
        endAt: guideStartAt + hour,
        genre1: 0,
        isFree: true,
      },
      {
        id: 4102,
        channelId: 301,
        name: 'Synthetic Long Feature',
        description: 'Synthetic guide feature description',
        startAt: guideStartAt + hour,
        endAt: guideStartAt + 3 * hour,
        genre1: 1,
        isFree: false,
      },
    ],
  },
  {
    channel: { id: 302, name: 'Synthetic Guide BS', type: 0x02 },
    programs: [
      {
        id: 4201,
        channelId: 302,
        name: 'Synthetic Reserved Program',
        description: 'Synthetic reserved guide description',
        startAt: guideStartAt,
        endAt: guideStartAt + 2 * hour,
        genre1: 2,
        isFree: true,
      },
      {
        id: 4202,
        channelId: 302,
        name: 'Synthetic Night Movie',
        description: 'Synthetic movie description',
        startAt: guideStartAt + 2 * hour,
        endAt: guideStartAt + 4 * hour,
        genre1: 6,
        isFree: true,
      },
    ],
  },
  ...Array.from({ length: 12 }, (_, index) => {
    const channelId = 303 + index
    const programId = 4301 + index

    return {
      channel: { id: channelId, name: `Synthetic Guide Extra ${index + 1}`, type: 0x01 },
      programs: [
        {
          id: programId,
          channelId,
          name: `Synthetic Extra Program ${index + 1}`,
          description: 'Synthetic extra guide description',
          startAt: guideStartAt + index * 30 * 60 * 1000,
          endAt: guideStartAt + hour + index * 30 * 60 * 1000,
          genre1: index % 4,
          isFree: true,
        },
      ],
    }
  }),
]

const minute = 60 * 1000

// Dense guide fixture: 8 channels, each with 5 / 15 / 30 / 60 minute programs, a 3.5 hour program
// and a program crossing midnight (23:30 to 00:30 of the next day). genre1 covers 0 through 15
// across the whole set. Programs of one channel never overlap.
const denseProgramSpans: ReadonlyArray<readonly [startMinute: number, durationMinutes: number]> = [
  [0, 5],
  [5, 15],
  [20, 30],
  [50, 60],
  [110, 210],
  [16 * 60 + 30, 60],
]

export const syntheticGuideDenseSchedules = Array.from({ length: 8 }, (_, channelIndex) => {
  const channelId = 601 + channelIndex

  return {
    channel: { id: channelId, name: `Synthetic Dense Channel ${channelIndex + 1}`, type: 0x01 },
    programs: denseProgramSpans.map(([startMinute, durationMinutes], programIndex) => ({
      id: 6001 + channelIndex * 10 + programIndex,
      channelId,
      name: `Synthetic Dense Program ${channelIndex + 1}-${programIndex + 1}`,
      description: `Synthetic dense description ${channelIndex + 1}-${programIndex + 1}`,
      startAt: guideStartAt + startMinute * minute,
      endAt: guideStartAt + (startMinute + durationMinutes) * minute,
      genre1: (channelIndex * denseProgramSpans.length + programIndex) % 16,
      isFree: true,
    })),
  }
})

export const syntheticOnAirSchedules = [
  {
    channel: { id: 301, name: 'Synthetic Guide GR', channelType: 'GR', hasLogoData: false },
    programs: [
      {
        id: 5101,
        channelId: 301,
        name: 'Synthetic OnAir News',
        description: 'Synthetic onair news description',
        startAt: guideStartAt,
        endAt: guideStartAt + hour,
        genre1: 0,
      },
    ],
  },
  {
    channel: { id: 302, name: 'Synthetic Guide BS', channelType: 'BS', hasLogoData: false },
    programs: [
      {
        id: 5201,
        channelId: 302,
        name: 'Synthetic OnAir Movie',
        description: 'Synthetic onair movie description',
        startAt: guideStartAt,
        endAt: guideStartAt + 2 * hour,
        genre1: 6,
      },
    ],
  },
]

export const syntheticOnAirChannels = [
  {
    id: 301,
    name: 'Synthetic Guide GR',
    halfWidthName: 'Synthetic Guide GR',
  },
  {
    id: 302,
    name: 'Synthetic Guide BS',
    halfWidthName: 'Synthetic Guide BS',
  },
]
