export const SYNTHETIC_RECORDING_ID_A = 9101
export const SYNTHETIC_RECORDING_VIDEO_ID_A = 9201
export const SYNTHETIC_RECORDING_VIDEO_ID_B = 9202
export const SYNTHETIC_ENCODE_RUNNING_ID = 9301
export const SYNTHETIC_ENCODE_PERCENT_ONLY_ID = 9302
export const SYNTHETIC_ENCODE_WAITING_ID = 9303

export const recordingItems = [
  {
    id: SYNTHETIC_RECORDING_ID_A,
    name: 'Synthetic Recording Alpha',
    channelId: 7101,
    channelName: 'Synthetic Recording Channel',
    startAt: 1_700_100_000_000,
    endAt: 1_700_103_600_000,
    description: 'Synthetic recording alpha description',
    ruleId: 8101,
    isProtected: false,
    isRecording: true,
    isEncoding: true,
    thumbnails: [],
    videoFiles: [
      {
        id: SYNTHETIC_RECORDING_VIDEO_ID_A,
        name: 'Synthetic Recording TS',
        filename: 'synthetic-recording-alpha.ts',
        size: 10_240,
        type: 'ts',
        isOriginal: true,
      },
      {
        id: SYNTHETIC_RECORDING_VIDEO_ID_B,
        name: 'Synthetic Recording MP4',
        filename: 'synthetic-recording-alpha.mp4',
        size: 4_096,
        type: 'encoded',
        isOriginal: false,
      },
    ],
  },
  {
    id: 9102,
    name: 'Synthetic Recording Beta',
    channelId: 7102,
    channelName: 'Synthetic Recording Secondary',
    startAt: 1_700_110_000_000,
    endAt: 1_700_113_600_000,
    description: 'Synthetic recording beta description',
    isProtected: true,
    isRecording: true,
    isEncoding: false,
    thumbnails: [],
    videoFiles: [
      {
        id: 9203,
        name: 'Synthetic Recording Beta TS',
        filename: 'synthetic-recording-beta.ts',
        size: 8_192,
        type: 'ts',
        isOriginal: true,
      },
    ],
  },
]

export const encodeRunningItems = [
  {
    id: SYNTHETIC_ENCODE_RUNNING_ID,
    mode: 'synthetic-main',
    percent: 0.64,
    log: 'synthetic-progress-log',
    recorded: {
      id: 9401,
      name: 'Synthetic Encode Running',
      channelName: 'Synthetic Encode Channel',
      startAt: 1_700_200_000_000,
      endAt: 1_700_203_600_000,
      videoFiles: [],
    },
  },
  {
    id: SYNTHETIC_ENCODE_PERCENT_ONLY_ID,
    mode: 'synthetic-percent',
    percent: 0.5,
    recorded: {
      id: 9402,
      name: 'Synthetic Encode Percent Only',
      channelName: 'Synthetic Encode Channel',
      startAt: 1_700_210_000_000,
      endAt: 1_700_213_600_000,
      videoFiles: [],
    },
  },
]

export const encodeWaitItems = [
  {
    id: SYNTHETIC_ENCODE_WAITING_ID,
    mode: 'synthetic-wait',
    recorded: {
      id: 9403,
      name: 'Synthetic Encode Waiting',
      channelName: 'Synthetic Encode Queue',
      startAt: 1_700_220_000_000,
      endAt: 1_700_223_600_000,
      videoFiles: [],
    },
  },
]

export const recordingEncodeFixtureSecrecyText = JSON.stringify({
  recordingItems,
  encodeRunningItems,
  encodeWaitItems,
})
