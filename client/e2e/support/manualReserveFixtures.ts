export const manualReserveOptions = {
  channelOptions: [
    {
      channelId: 410,
      channelName: 'Synthetic Manual Channel',
    },
  ],
  timeSpecifiedOptions: {
    valid: {
      name: 'Synthetic Time Specified Reserve',
      channelId: 410,
      startAt: Date.parse('2026-05-06T13:00:00+09:00'),
      endAt: Date.parse('2026-05-06T13:45:00+09:00'),
    },
    invalidRange: {
      name: 'Synthetic Invalid Time Range',
      channelId: 410,
      startAt: Date.parse('2026-05-06T14:00:00+09:00'),
      endAt: Date.parse('2026-05-06T13:45:00+09:00'),
    },
  },
  reserveOptions: {
    allowEndLack: {
      allowEndLack: true,
    },
    disallowEndLack: {
      allowEndLack: false,
    },
  },
  saveOptions: {
    empty: {},
    omitted: undefined,
    selected: {
      parentDirectoryName: 'synthetic-parent',
      directory: 'synthetic-directory',
      recordedFormat: 'synthetic-format',
    },
  },
  encodeOptions: {
    allNull: {
      mode1: null,
      mode2: null,
      mode3: null,
      isDeleteOriginalAfterEncode: false,
    },
    selected: {
      mode1: 'synthetic-encode',
      directory1: 'synthetic-encode-directory',
      mode2: null,
      mode3: null,
      isDeleteOriginalAfterEncode: true,
    },
    multipleSelected: {
      mode1: 'synthetic-encode-main',
      directory1: 'synthetic-encode-directory-main',
      mode2: 'synthetic-encode-sub',
      directory2: 'synthetic-encode-directory-sub',
      mode3: null,
      isDeleteOriginalAfterEncode: false,
    },
    deleteOriginalSelected: {
      mode1: 'synthetic-delete-original-encode',
      directory1: 'synthetic-delete-original-directory',
      mode2: null,
      mode3: null,
      isDeleteOriginalAfterEncode: true,
    },
  },
  programDetail: {
    id: 9001,
    name: 'Synthetic Manual Program',
    channelId: 410,
    channelName: 'Synthetic Manual Channel',
    startAt: Date.parse('2026-05-06T12:00:00+09:00'),
    endAt: Date.parse('2026-05-06T12:45:00+09:00'),
    description: 'Synthetic manual program detail.',
  },
} as const

export const manualProgramDetail = manualReserveOptions.programDetail

export const manualReserveEdit = {
  reserveIdFixture: 7001,
  programIdFixture: manualProgramDetail.id,
  savedPageInfo: {
    isTimeSpecification: true,
    timeSpecifiedOption: manualReserveOptions.timeSpecifiedOptions.valid,
    reserveOption: manualReserveOptions.reserveOptions.allowEndLack,
    saveOption: manualReserveOptions.saveOptions.selected,
    encodeOption: manualReserveOptions.encodeOptions.multipleSelected,
  },
  editModeNoRestorePageInfo: {
    isTimeSpecification: false,
    timeSpecifiedOption: manualReserveOptions.timeSpecifiedOptions.invalidRange,
    reserveOption: manualReserveOptions.reserveOptions.disallowEndLack,
    saveOption: manualReserveOptions.saveOptions.empty,
    encodeOption: manualReserveOptions.encodeOptions.allNull,
  },
  id: 7001,
  programId: manualProgramDetail.id,
  name: 'Synthetic Editable Manual Reserve',
  channelId: manualProgramDetail.channelId,
  channelName: manualProgramDetail.channelName,
  startAt: manualProgramDetail.startAt,
  endAt: manualProgramDetail.endAt,
  isTimeSpecified: false,
  allowEndLack: false,
  parentDirectoryName: manualReserveOptions.saveOptions.selected.parentDirectoryName,
  directory: manualReserveOptions.saveOptions.selected.directory,
  recordedFormat: manualReserveOptions.saveOptions.selected.recordedFormat,
  encodeMode1: manualReserveOptions.encodeOptions.selected.mode1,
  encodeDirectory1: manualReserveOptions.encodeOptions.selected.directory1,
  isDeleteOriginalAfterEncode:
    manualReserveOptions.encodeOptions.selected.isDeleteOriginalAfterEncode,
}
