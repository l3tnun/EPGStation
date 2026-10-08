import type { SettingsConsumerValue } from '@/shared/settings'
import type { SearchRequestBody, SearchRuleDetail, SearchRuleOptionDraft } from './searchTypes'

function createDefaultRuleOptionDraft({
  searchBody,
  settings,
  encodeModes,
}: {
  searchBody: SearchRequestBody
  settings: SettingsConsumerValue
  encodeModes: readonly string[]
}): SearchRuleOptionDraft {
  const keyword = searchBody.option.keyword ?? null
  const directory = settings.isEnableCopyKeywordToDirectory ? keyword : null
  const [firstAvailableEncodeMode] = encodeModes
  const firstEncodeMode =
    settings.isEnableEncodingSettingWhenCreateRule && firstAvailableEncodeMode !== undefined
      ? firstAvailableEncodeMode
      : null
  const encodeOption =
    encodeModes.length === 0
      ? undefined
      : {
          mode1: firstEncodeMode,
          encodeParentDirectoryName1: null,
          directory1: firstEncodeMode === null ? null : directory,
          mode2: null,
          encodeParentDirectoryName2: null,
          directory2: null,
          mode3: null,
          encodeParentDirectoryName3: null,
          directory3: null,
          isDeleteOriginalAfterEncode: settings.isCheckDeleteOriginalAfterEncode,
        }

  return {
    reserveOption: {
      enable: true,
      allowEndLack: true,
      avoidDuplicate: settings.isCheckAvoidDuplicate,
      periodToAvoidDuplicate: null,
    },
    saveOption: {
      parentDirectoryName: null,
      directory,
      recordedFormat: null,
    },
    ...(encodeOption === undefined ? {} : { encodeOption }),
  }
}

export function createRuleOptionDraft({
  existingRule,
  searchBody,
  settings,
  encodeModes,
}: {
  existingRule: SearchRuleDetail | null
  searchBody: SearchRequestBody
  settings: SettingsConsumerValue
  encodeModes: readonly string[]
}): SearchRuleOptionDraft {
  if (existingRule !== null) {
    return {
      reserveOption: existingRule.reserveOption,
      saveOption: existingRule.saveOption,
      ...(existingRule.encodeOption === undefined
        ? {}
        : { encodeOption: existingRule.encodeOption }),
    }
  }

  return createDefaultRuleOptionDraft({ searchBody, settings, encodeModes })
}
