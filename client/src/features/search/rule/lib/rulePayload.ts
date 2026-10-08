import type { SettingsConsumerValue } from '@/shared/settings'
import { z } from 'zod'
import type {
  SearchApiOption,
  SearchRequestBody,
  SearchRuleEncodeOption,
  SearchRuleOptionDraft,
  SearchRulePayload,
} from './searchTypes'

function hasSelectedEncodeMode(encodeOption: SearchRuleEncodeOption): boolean {
  return encodeOption.mode1 !== null || encodeOption.mode2 !== null || encodeOption.mode3 !== null
}

const SEARCH_RULE_PAYLOAD_SCHEMA: z.ZodType<SearchRulePayload> = z.object({
  isTimeSpecification: z.boolean(),
  searchOption: z.custom<SearchApiOption>((value) => typeof value === 'object' && value !== null),
  reserveOption: z.object({
    enable: z.boolean(),
    allowEndLack: z.boolean(),
    avoidDuplicate: z.boolean(),
    periodToAvoidDuplicate: z.number().nullable(),
  }),
  saveOption: z.object({
    parentDirectoryName: z.string().nullable(),
    directory: z.string().nullable(),
    recordedFormat: z.string().nullable(),
  }),
  encodeOption: z
    .object({
      mode1: z.string().nullable(),
      encodeParentDirectoryName1: z.string().nullable(),
      directory1: z.string().nullable(),
      mode2: z.string().nullable(),
      encodeParentDirectoryName2: z.string().nullable(),
      directory2: z.string().nullable(),
      mode3: z.string().nullable(),
      encodeParentDirectoryName3: z.string().nullable(),
      directory3: z.string().nullable(),
      isDeleteOriginalAfterEncode: z.boolean(),
    })
    .optional(),
})

export function buildSearchRulePayload({
  searchBody,
  isTimeSpecification,
  timeSpecifiedSearchOption,
  settings,
  encodeModes,
  existingRule,
  optionDraft,
}: {
  searchBody: SearchRequestBody
  isTimeSpecification?: boolean
  timeSpecifiedSearchOption?: SearchApiOption
  settings: Pick<
    SettingsConsumerValue,
    | 'isCheckAvoidDuplicate'
    | 'isCheckDeleteOriginalAfterEncode'
    | 'isEnableCopyKeywordToDirectory'
    | 'isEnableEncodingSettingWhenCreateRule'
  >
  encodeModes: readonly string[]
  existingRule?: SearchRulePayload
  optionDraft?: SearchRuleOptionDraft
}): SearchRulePayload {
  const keyword = searchBody.option.keyword ?? null
  const directory = settings.isEnableCopyKeywordToDirectory ? keyword : null
  const [firstAvailableEncodeMode] = encodeModes
  const firstEncodeMode =
    settings.isEnableEncodingSettingWhenCreateRule && firstAvailableEncodeMode !== undefined
      ? firstAvailableEncodeMode
      : null
  const searchOption =
    timeSpecifiedSearchOption ??
    (existingRule?.isTimeSpecification === true ? existingRule.searchOption : searchBody.option)
  const payloadIsTimeSpecification =
    isTimeSpecification ?? existingRule?.isTimeSpecification ?? false
  const payload: SearchRulePayload = {
    isTimeSpecification: payloadIsTimeSpecification,
    searchOption,
    reserveOption: optionDraft?.reserveOption ??
      existingRule?.reserveOption ?? {
        enable: true,
        allowEndLack: true,
        avoidDuplicate: settings.isCheckAvoidDuplicate,
        periodToAvoidDuplicate: null,
      },
    saveOption: optionDraft?.saveOption ??
      existingRule?.saveOption ?? {
        parentDirectoryName: null,
        directory,
        recordedFormat: null,
      },
  }

  if (optionDraft !== undefined) {
    if (optionDraft.encodeOption !== undefined && hasSelectedEncodeMode(optionDraft.encodeOption)) {
      payload.encodeOption = optionDraft.encodeOption
    }
  } else if (existingRule?.encodeOption !== undefined) {
    payload.encodeOption = existingRule.encodeOption
  } else if (firstEncodeMode !== null) {
    payload.encodeOption = {
      mode1: firstEncodeMode,
      encodeParentDirectoryName1: null,
      directory1: directory,
      mode2: null,
      encodeParentDirectoryName2: null,
      directory2: null,
      mode3: null,
      encodeParentDirectoryName3: null,
      directory3: null,
      isDeleteOriginalAfterEncode: settings.isCheckDeleteOriginalAfterEncode,
    }
  }

  return SEARCH_RULE_PAYLOAD_SCHEMA.parse(payload)
}
