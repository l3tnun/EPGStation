export const dashboardReserveStart = Date.parse('2026-05-05T10:15:00+09:00')

export const recordingItems = [
  {
    id: 7101,
    name: 'Synthetic Dashboard Recording Alpha',
    channelId: 8101,
    channelName: 'Synthetic Dashboard Channel A',
    description: 'Synthetic recording description',
    thumbnails: [],
    videoFiles: [{ id: 9101, name: 'Synthetic Recording File', size: 10101, type: 'ts' }],
  },
]

export const recordedItems = [
  {
    id: 7201,
    name: 'Synthetic Dashboard Recorded Alpha',
    channelId: 8201,
    channelName: 'Synthetic Dashboard Channel B',
    description: 'Synthetic recorded description',
    isProtected: false,
    isRecording: false,
    isEncoding: true,
    ruleId: 8201,
    thumbnails: [],
    dropLogFile: {
      id: 82011,
      dropCnt: 2,
      errorCnt: 1,
      scramblingCnt: 0,
    },
    videoFiles: [{ id: 9201, name: 'Synthetic Recorded File', size: 20202, type: 'ts' }],
  },
  {
    id: 7202,
    name: 'Synthetic Dashboard Recorded Title Search',
    channelId: 8202,
    channelName: 'Synthetic Dashboard Channel E',
    description: 'Synthetic recorded title search description',
    isProtected: true,
    isRecording: false,
    isEncoding: false,
    thumbnails: [],
    videoFiles: [{ id: 9202, name: 'Synthetic Recorded File 2', size: 30303, type: 'ts' }],
  },
]

export const reserveItems = [
  {
    id: 7301,
    name: 'Synthetic Dashboard Reserve Alpha',
    channelId: 8301,
    channelType: 'GR',
    channelName: 'Synthetic Dashboard Channel C',
    startAt: dashboardReserveStart,
    endAt: dashboardReserveStart + 30 * 60 * 1000,
    description: 'Synthetic reserve description',
    extended: 'Synthetic reserve link https://example.invalid/dashboard-reserve',
    genres: ['Synthetic Dashboard Genre'],
  },
  {
    id: 7302,
    name: 'Synthetic Dashboard Reserve Delete',
    channelId: 8302,
    channelType: 'BS',
    channelName: 'Synthetic Dashboard Channel D',
    startAt: dashboardReserveStart + 60 * 60 * 1000,
    endAt: dashboardReserveStart + 90 * 60 * 1000,
    description: 'Synthetic reserve delete description',
  },
]

export function expandForOverflow<T extends { id: number; name: string }>(
  items: T[],
  count: number,
): T[] {
  return Array.from({ length: count }, (_, index) => {
    const item = items[index % items.length]

    return {
      ...item,
      id: item.id * 100 + index,
      name: `${item.name} ${index + 1}`,
    }
  })
}

export const dashboardFixtureSecrecyText = JSON.stringify({
  recordingItems,
  recordedItems,
  reserveItems,
})
