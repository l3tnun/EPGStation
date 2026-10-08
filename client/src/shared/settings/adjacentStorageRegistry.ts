import type { AdjacentStorageDefinition, AdjacentStorageKey } from './settingsTypes'

const definitions: readonly AdjacentStorageDefinition[] = [
  {
    key: 'OnAirSelectStreamSetting',
    owner: 'frontend-onair',
    defaultValue: { useURLScheme: false, type: 'M2TS', mode: 0 },
  },
  {
    key: 'RecordedSelectStreamSetting',
    owner: 'frontend-recorded',
    defaultValue: { type: 'WebM', mode: 0 },
  },
  {
    key: 'SendVideoFileSelectHostSetting',
    owner: 'frontend-recorded',
    defaultValue: { hostName: null },
  },
  {
    key: 'VideoPlayerSetting',
    owner: 'frontend-video-playback',
    defaultValue: { isShowSubtitle: false },
  },
  {
    key: 'GuideSizeSetting',
    owner: 'frontend-guide',
    defaultValue: null,
  },
  {
    key: 'GuideGenreSetting',
    owner: 'frontend-guide',
    defaultValue: null,
  },
  {
    key: 'GuideProgramDetailSetting',
    owner: 'frontend-guide',
    defaultValue: { encode: 'TS', isDeleteOriginalAfterEncode: false },
  },
  {
    key: 'AddEncodeSeting',
    owner: 'frontend-recorded',
    defaultValue: {
      encodeMode: null,
      parentDirectory: null,
      isSaveSameDirectory: false,
      removeOriginal: false,
    },
  },
]

function cloneDefinition(definition: AdjacentStorageDefinition): AdjacentStorageDefinition {
  return {
    ...definition,
    defaultValue: definition.defaultValue === null ? null : { ...definition.defaultValue },
  }
}

export class AdjacentStorageRegistry {
  list(): readonly AdjacentStorageDefinition[] {
    return definitions.map(cloneDefinition)
  }

  find(key: AdjacentStorageKey): AdjacentStorageDefinition {
    const definition = definitions.find((item) => item.key === key)
    if (definition === undefined) {
      throw new Error(`Unknown adjacent storage key: ${key}`)
    }
    return cloneDefinition(definition)
  }
}
