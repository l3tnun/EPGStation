import { BROADCAST_WAVE_ORDER, type BroadcastWave } from '@/app/navigation'
import type { SettingsConsumerValue } from '@/shared/settings'
import type {
  SearchApiOption,
  SearchApiTime,
  SearchFormState,
  SearchKeywordTargets,
  SearchRequestBody,
  SearchTimeReserveFormState,
  SearchWeekdayState,
} from './searchTypes'

function trimOptionalText(value: string): string | undefined {
  const trimmed = value.trim()

  return trimmed === '' ? undefined : trimmed
}

function createWeekMask(weekdays: SearchWeekdayState): number {
  let mask = 0
  if (weekdays.sun) mask += 0x01
  if (weekdays.mon) mask += 0x02
  if (weekdays.tue) mask += 0x04
  if (weekdays.wed) mask += 0x08
  if (weekdays.thu) mask += 0x10
  if (weekdays.fri) mask += 0x20
  if (weekdays.sat) mask += 0x40

  return mask === 0 ? 0x7f : mask
}

function createTimeOption(form: SearchFormState): SearchApiTime {
  const time: SearchApiTime = {
    week: createWeekMask(form.weekdays),
  }

  if (form.startTime !== null && form.durationMinutes !== null) {
    time.start = form.startTime
    time.range = form.durationMinutes
  }

  return time
}

function parseTimeTextToSeconds(value: string | null): number | null {
  if (value === null || !/^\d{2}:\d{2}$/.test(value)) {
    return null
  }

  const [hourText, minuteText] = value.split(':')
  const hour = Number(hourText)
  const minute = Number(minuteText)

  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) {
    return null
  }

  return hour * 60 * 60 + minute * 60
}

export function createTimeSpecifiedSearchOption(form: SearchTimeReserveFormState): SearchApiOption {
  const keyword = trimOptionalText(form.keyword)
  const start = parseTimeTextToSeconds(form.startTime)
  const end = parseTimeTextToSeconds(form.endTime)

  if (keyword === undefined || form.channelId === null || start === null || end === null) {
    throw new Error('TimeReserveOptionIsInvalidValue')
  }

  return {
    keyword,
    channelIds: [form.channelId],
    times: [
      {
        start,
        range: start <= end ? end - start : 24 * 60 * 60 - (start - end),
        week: createWeekMask(form.weekdays),
      },
    ],
  }
}

function visibleBroadcastWaveEntries(form: SearchFormState): [BroadcastWave, boolean][] {
  return BROADCAST_WAVE_ORDER.flatMap((wave) =>
    form.broadcastWaves[wave] === undefined ? [] : [[wave, form.broadcastWaves[wave]]],
  )
}

// Mirrors v2's `prepSearchOption()` (client/src/model/state/search/SearchState.ts): a channel
// filter takes priority and disables every visible broadcast wave, otherwise every visible wave
// is re-enabled once none is left checked (a channel-less, wave-less search would otherwise match
// nothing). v2 runs this on the same reactive state its checkboxes are bound to, so both branches
// are visible, not just the outgoing request.
export function restoreVisibleBroadcastWaves(form: SearchFormState): SearchFormState {
  const entries = visibleBroadcastWaveEntries(form)
  if (entries.length === 0) {
    return form
  }

  if (form.channelIds.length > 0) {
    const hasEnabledVisibleWave = entries.some(([, isEnabled]) => isEnabled)
    if (!hasEnabledVisibleWave) {
      return form
    }

    return {
      ...form,
      broadcastWaves: Object.fromEntries(entries.map(([wave]) => [wave, false])),
    }
  }

  const hasEnabledVisibleWave = entries.some(([, isEnabled]) => isEnabled)
  if (hasEnabledVisibleWave) {
    return form
  }

  return {
    ...form,
    broadcastWaves: Object.fromEntries(entries.map(([wave]) => [wave, true])),
  }
}

function appendKeywordOption(
  option: SearchApiOption,
  prefix: '' | 'ignore',
  keyword: string,
  targets: SearchKeywordTargets,
): void {
  if (prefix === '') {
    option.keyword = keyword
    option.keyCS = targets.keyCS
    option.keyRegExp = targets.keyRegExp
    option.name = targets.name
    option.description = targets.description
    option.extended = targets.extended
    return
  }

  option.ignoreKeyword = keyword
  option.ignoreKeyCS = targets.keyCS
  option.ignoreKeyRegExp = targets.keyRegExp
  option.ignoreName = targets.name
  option.ignoreDescription = targets.description
  option.ignoreExtended = targets.extended
}

function normalizeKeywordTargetsForSearch(targets: SearchKeywordTargets): SearchKeywordTargets {
  if (!targets.name && !targets.description && !targets.extended) {
    return {
      ...targets,
      name: true,
      description: true,
    }
  }

  return targets
}

function appendBroadcastWaveOption(option: SearchApiOption, form: SearchFormState): void {
  const normalized = restoreVisibleBroadcastWaves(form)
  const entries = visibleBroadcastWaveEntries(normalized)
  const areAllVisibleEnabled = entries.every(([, isEnabled]) => isEnabled)

  if (normalized.channelIds.length > 0 || entries.length === 0 || areAllVisibleEnabled) {
    return
  }

  entries.forEach(([wave, isEnabled]) => {
    option[wave] = isEnabled
  })
}

export function buildSearchRequestBody({
  form,
  settings,
}: {
  form: SearchFormState
  settings: Pick<SettingsConsumerValue, 'isHalfWidthDisplayed' | 'searchLength'>
}): SearchRequestBody {
  const normalized = restoreVisibleBroadcastWaves(form)
  const option = {} as SearchApiOption
  const keyword = trimOptionalText(normalized.keyword)
  const ignoreKeyword = trimOptionalText(normalized.ignoreKeyword)

  if (keyword !== undefined) {
    appendKeywordOption(
      option,
      '',
      keyword,
      normalizeKeywordTargetsForSearch(normalized.keywordTargets),
    )
  }
  if (ignoreKeyword !== undefined) {
    appendKeywordOption(
      option,
      'ignore',
      ignoreKeyword,
      normalizeKeywordTargetsForSearch(normalized.ignoreKeywordTargets),
    )
  }
  if (normalized.channelIds.length > 0) {
    option.channelIds = [...normalized.channelIds]
  } else {
    appendBroadcastWaveOption(option, normalized)
  }
  if (normalized.selectedGenres.length > 0) {
    option.genres = normalized.selectedGenres.map((genre) => ({ ...genre }))
  }
  option.times = [createTimeOption(normalized)]
  if (normalized.durationMinMinutes !== null) {
    option.durationMin = normalized.durationMinMinutes * 60
  }
  if (normalized.durationMaxMinutes !== null) {
    option.durationMax = normalized.durationMaxMinutes * 60
  }
  if (normalized.startPeriod !== null && normalized.endPeriod !== null) {
    option.searchPeriods = [
      {
        startAt: normalized.startPeriod,
        endAt: normalized.endPeriod,
      },
    ]
  }
  if (normalized.isFree) {
    option.isFree = true
  }

  return {
    option,
    isHalfWidth: settings.isHalfWidthDisplayed,
    limit: settings.searchLength,
  }
}
