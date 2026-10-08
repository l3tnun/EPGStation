import type { SearchRuleDetail, SearchRulePayload } from '../query'
import {
  adaptNullableStringField,
  isNonNegativeSafeInteger,
  isRecord,
  isSafeInteger,
} from './guards'
import type { RuleListItem, RuleListResponse } from './types'

export function adaptAddRuleResponse(value: unknown): { ruleId: number } | null {
  if (!isRecord(value)) {
    return null
  }

  if (isNonNegativeSafeInteger(value.ruleId)) {
    return { ruleId: value.ruleId }
  }
  if (isNonNegativeSafeInteger(value.id)) {
    return { ruleId: value.id }
  }

  return null
}

function adaptSearchRuleReserveOption(value: unknown): SearchRulePayload['reserveOption'] | null {
  if (!isRecord(value)) {
    return null
  }

  return {
    enable: typeof value.enable === 'boolean' ? value.enable : true,
    allowEndLack: typeof value.allowEndLack === 'boolean' ? value.allowEndLack : true,
    avoidDuplicate: typeof value.avoidDuplicate === 'boolean' ? value.avoidDuplicate : false,
    periodToAvoidDuplicate: isSafeInteger(value.periodToAvoidDuplicate)
      ? value.periodToAvoidDuplicate
      : null,
  }
}

function adaptSearchRuleSaveOption(value: unknown): SearchRulePayload['saveOption'] | null {
  if (value === undefined) {
    return {
      parentDirectoryName: null,
      directory: null,
      recordedFormat: null,
    }
  }

  if (!isRecord(value)) {
    return null
  }

  return {
    parentDirectoryName: adaptNullableStringField(value.parentDirectoryName),
    directory: adaptNullableStringField(value.directory),
    recordedFormat: adaptNullableStringField(value.recordedFormat),
  }
}

function adaptSearchRuleEncodeOption(value: unknown): SearchRulePayload['encodeOption'] {
  if (!isRecord(value)) {
    return undefined
  }

  return {
    mode1: adaptNullableStringField(value.mode1),
    encodeParentDirectoryName1: adaptNullableStringField(value.encodeParentDirectoryName1),
    directory1: adaptNullableStringField(value.directory1),
    mode2: adaptNullableStringField(value.mode2),
    encodeParentDirectoryName2: adaptNullableStringField(value.encodeParentDirectoryName2),
    directory2: adaptNullableStringField(value.directory2),
    mode3: adaptNullableStringField(value.mode3),
    encodeParentDirectoryName3: adaptNullableStringField(value.encodeParentDirectoryName3),
    directory3: adaptNullableStringField(value.directory3),
    isDeleteOriginalAfterEncode:
      typeof value.isDeleteOriginalAfterEncode === 'boolean'
        ? value.isDeleteOriginalAfterEncode
        : false,
  }
}

export function adaptSearchRuleDetail(value: unknown): SearchRuleDetail | null {
  if (
    !isRecord(value) ||
    !isNonNegativeSafeInteger(value.id) ||
    !isRecord(value.searchOption) ||
    !Array.isArray(value.searchOption.times)
  ) {
    return null
  }

  const reserveOption = adaptSearchRuleReserveOption(value.reserveOption)
  const saveOption = adaptSearchRuleSaveOption(value.saveOption)

  if (reserveOption === null || saveOption === null) {
    return null
  }

  const detail: SearchRuleDetail = {
    id: value.id,
    isTimeSpecification:
      typeof value.isTimeSpecification === 'boolean' ? value.isTimeSpecification : false,
    searchOption: value.searchOption as unknown as SearchRulePayload['searchOption'],
    reserveOption,
    saveOption,
  }
  const encodeOption = adaptSearchRuleEncodeOption(value.encodeOption)

  if (encodeOption !== undefined) {
    detail.encodeOption = encodeOption
  }

  return detail
}

function adaptRuleListItem(value: unknown): RuleListItem | null {
  if (
    !isRecord(value) ||
    !isNonNegativeSafeInteger(value.id) ||
    !isRecord(value.searchOption) ||
    !Array.isArray(value.searchOption.times)
  ) {
    return null
  }

  const reserveOption = adaptSearchRuleReserveOption(value.reserveOption)

  if (reserveOption === null) {
    return null
  }

  const item: RuleListItem = {
    id: value.id,
    searchOption: value.searchOption as unknown as SearchRulePayload['searchOption'],
    reserveOption,
  }

  if (isNonNegativeSafeInteger(value.reservesCnt)) {
    item.reservesCnt = value.reservesCnt
  }

  return item
}

export function adaptRuleListResponse(value: unknown): RuleListResponse | null {
  if (!isRecord(value) || !Array.isArray(value.rules)) {
    return null
  }

  const rules = value.rules.map(adaptRuleListItem)

  if (!rules.every((item): item is RuleListItem => item !== null)) {
    return null
  }

  return {
    rules,
    total: isNonNegativeSafeInteger(value.total) ? value.total : rules.length,
  }
}
