export const SYNTHETIC_RECORDED_LIST_ID = 8201
export const SYNTHETIC_RECORDED_DETAIL_ID = 8301
export const SYNTHETIC_RECORDED_ZERO_DROP_DETAIL_ID = 8302
export const SYNTHETIC_RECORDED_RECORDING_DETAIL_ID = 8303
export const SYNTHETIC_RECORDED_ORIGINAL_VIDEO_ID = 8401
export const SYNTHETIC_RECORDED_ENCODED_VIDEO_ID = 8402

export const recordedListItems = [
  {
    id: SYNTHETIC_RECORDED_LIST_ID,
    name: 'Synthetic Recorded Matrix A',
    channelId: 4101,
    channelName: 'Synthetic Recorded Channel',
    genres: ['Synthetic Recorded Genre'],
    startAt: 1_700_000_000_000,
    endAt: 1_700_003_600_000,
    description: 'Synthetic recorded description',
    extended: 'Synthetic extended text',
    ruleId: 5101,
    isProtected: false,
    isRecording: false,
    isEncoding: false,
    thumbnails: [],
    dropLogFile: {
      id: 6101,
      dropCnt: 1,
      errorCnt: 0,
      scramblingCnt: 0,
    },
    videoFiles: [
      {
        id: SYNTHETIC_RECORDED_ORIGINAL_VIDEO_ID,
        name: 'Synthetic Original TS',
        filename: 'synthetic-original.ts',
        size: 12_345_678,
        type: 'ts',
        isOriginal: true,
      },
      {
        id: SYNTHETIC_RECORDED_ENCODED_VIDEO_ID,
        name: 'Synthetic Encoded MP4',
        filename: 'synthetic-encoded.mp4',
        size: 2_345_678,
        type: 'encoded',
        isOriginal: false,
      },
    ],
  },
  {
    id: 8202,
    name: 'Synthetic Protected Item',
    channelId: 4102,
    channelName: 'Synthetic Secondary Channel',
    startAt: 1_700_010_000_000,
    endAt: 1_700_013_600_000,
    description: 'Synthetic protected description',
    ruleId: 0,
    isProtected: true,
    isRecording: false,
    isEncoding: true,
    thumbnails: [6202],
    videoFiles: [
      {
        id: 8403,
        name: 'Synthetic Protected File',
        filename: 'synthetic-protected.ts',
        size: 3_456_789,
        type: 'ts',
        isOriginal: true,
      },
    ],
  },
  ...Array.from({ length: 4 }, (_, index) => ({
    id: 8203 + index,
    name: `Synthetic Wide Card ${index + 1}`,
    channelId: 4101,
    channelName: 'Synthetic Recorded Channel',
    genres: ['Synthetic Recorded Genre'],
    startAt: 1_700_020_000_000 + index * 3_600_000,
    endAt: 1_700_023_600_000 + index * 3_600_000,
    description: `Synthetic wide card description ${index + 1}`,
    ruleId: 5101,
    isProtected: false,
    isRecording: false,
    isEncoding: false,
    thumbnails: [],
    videoFiles: [
      {
        id: 8503 + index,
        name: `Synthetic Wide File ${index + 1}`,
        filename: `synthetic-wide-${index + 1}.ts`,
        size: 1_000_000 + index,
        type: 'ts',
        isOriginal: true,
      },
    ],
  })),
]

export const longRecordedListItems = Array.from({ length: 60 }, (_, index) => ({
  ...recordedListItems[index % recordedListItems.length],
  id: 9001 + index,
  name: `Synthetic Long Recorded ${String(index + 1).padStart(2, '0')}`,
}))

export const recordedDetail = {
  ...recordedListItems[0],
  id: SYNTHETIC_RECORDED_DETAIL_ID,
  name: 'Synthetic Detail Target',
  description: 'Synthetic detail description',
  extended: 'Synthetic detail link https://example.invalid/recorded/detail',
}

export const recordedZeroDropDetail = {
  ...recordedDetail,
  id: SYNTHETIC_RECORDED_ZERO_DROP_DETAIL_ID,
  name: 'Synthetic Zero Drop Detail',
  dropLogFile: {
    id: 6102,
    dropCnt: 0,
    errorCnt: 0,
    scramblingCnt: 0,
  },
}

export const recordedRecordingDetail = {
  ...recordedZeroDropDetail,
  id: SYNTHETIC_RECORDED_RECORDING_DETAIL_ID,
  name: 'Synthetic Recording Detail',
  isRecording: true,
}

export const recordedOptions = {
  channels: [
    {
      id: 4101,
      name: 'Synthetic Recorded Channel',
      halfWidthName: 'Synthetic Recorded Channel HW',
    },
  ],
  genres: [{ id: 7, name: 'Synthetic Recorded Genre' }],
}

export const ruleKeywords = {
  items: [{ id: 5101, keyword: 'Synthetic Recorded Rule' }],
}

export const recordedFixtureSecrecyText = JSON.stringify({
  recordedListItems,
  recordedDetail,
  recordedZeroDropDetail,
  recordedRecordingDetail,
  recordedOptions,
  ruleKeywords,
})
