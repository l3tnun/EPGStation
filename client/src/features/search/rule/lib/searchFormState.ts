import type { BroadcastWave } from '@/app/navigation'
import type {
  SearchApiOption,
  SearchFormState,
  SearchKeywordTargets,
  SearchRouteQuery,
  SearchTimeReserveFormState,
  SearchWeekdayState,
} from './searchTypes'

const DEFAULT_TARGETS: SearchKeywordTargets = {
  keyCS: false,
  keyRegExp: false,
  name: false,
  description: false,
  extended: false,
}

const DEFAULT_WEEKDAYS: SearchWeekdayState = {
  sun: true,
  mon: true,
  tue: true,
  wed: true,
  thu: true,
  fri: true,
  sat: true,
}

const DEFAULT_TIME_RESERVE_WEEKDAYS: SearchWeekdayState = {
  sun: false,
  mon: false,
  tue: false,
  wed: false,
  thu: false,
  fri: false,
  sat: false,
}

function createVisibleBroadcastWaveState(
  visibleBroadcastWaves: readonly BroadcastWave[],
): Partial<Record<BroadcastWave, boolean>> {
  const waves: Partial<Record<BroadcastWave, boolean>> = {}

  visibleBroadcastWaves.forEach((wave) => {
    waves[wave] = true
  })

  return waves
}

export function createDefaultSearchFormState(
  visibleBroadcastWaves: readonly BroadcastWave[],
): SearchFormState {
  return {
    keyword: '',
    keywordTargets: { ...DEFAULT_TARGETS },
    ignoreKeyword: '',
    ignoreKeywordTargets: { ...DEFAULT_TARGETS },
    channelIds: [],
    broadcastWaves: createVisibleBroadcastWaveState(visibleBroadcastWaves),
    genre: null,
    subGenre: null,
    selectedGenres: [],
    startTime: null,
    durationMinutes: null,
    weekdays: { ...DEFAULT_WEEKDAYS },
    durationMinMinutes: null,
    durationMaxMinutes: null,
    startPeriod: null,
    endPeriod: null,
    isFree: false,
  }
}

export function createDefaultSearchTimeReserveFormState(): SearchTimeReserveFormState {
  return {
    keyword: '',
    channelId: null,
    startTime: null,
    endTime: null,
    weekdays: { ...DEFAULT_TIME_RESERVE_WEEKDAYS },
  }
}

export function applySearchRouteQuery(
  form: SearchFormState,
  query: SearchRouteQuery,
): SearchFormState {
  const nextForm = {
    ...form,
    keyword: query.keyword ?? form.keyword,
    channelIds: query.channelId === undefined ? form.channelIds : [query.channelId],
    selectedGenres:
      query.genre === undefined
        ? form.selectedGenres
        : [
            {
              genre: query.genre,
              ...(query.subGenre === undefined ? {} : { subGenre: query.subGenre }),
            },
          ],
  }

  return applyLegacyKeywordTargetDefaults(nextForm)
}

function hasVisibleKeywordTarget(targets: SearchKeywordTargets): boolean {
  return targets.name || targets.description || targets.extended
}

export function applyLegacyKeywordTargetDefaults(form: SearchFormState): SearchFormState {
  const nextForm = { ...form }
  if (nextForm.keyword.trim() !== '' && !hasVisibleKeywordTarget(nextForm.keywordTargets)) {
    nextForm.keywordTargets = {
      ...nextForm.keywordTargets,
      name: true,
      description: true,
    }
  }

  if (
    nextForm.ignoreKeyword.trim() !== '' &&
    !hasVisibleKeywordTarget(nextForm.ignoreKeywordTargets)
  ) {
    nextForm.ignoreKeywordTargets = {
      ...nextForm.ignoreKeywordTargets,
      name: true,
      description: true,
    }
  }

  return nextForm
}

export function createSearchFormStateFromOption(
  option: SearchApiOption,
  visibleBroadcastWaves: readonly BroadcastWave[],
): SearchFormState {
  const form = createDefaultSearchFormState(visibleBroadcastWaves)
  const firstTime = option.times[0]
  const week = firstTime?.week ?? 0x7f

  return {
    ...form,
    keyword: option.keyword ?? '',
    keywordTargets: {
      keyCS: option.keyCS ?? false,
      keyRegExp: option.keyRegExp ?? false,
      name: option.name ?? false,
      description: option.description ?? false,
      extended: option.extended ?? false,
    },
    ignoreKeyword: option.ignoreKeyword ?? '',
    ignoreKeywordTargets: {
      keyCS: option.ignoreKeyCS ?? false,
      keyRegExp: option.ignoreKeyRegExp ?? false,
      name: option.ignoreName ?? false,
      description: option.ignoreDescription ?? false,
      extended: option.ignoreExtended ?? false,
    },
    channelIds: option.channelIds === undefined ? [] : [...option.channelIds],
    broadcastWaves: Object.fromEntries(
      visibleBroadcastWaves.map((wave) => [wave, option[wave] ?? false]),
    ),
    selectedGenres: option.genres === undefined ? [] : [...option.genres],
    startTime: firstTime?.start ?? null,
    durationMinutes: firstTime?.range ?? null,
    weekdays: {
      sun: week === 0x7f || Boolean(week & 0x01),
      mon: week === 0x7f || Boolean(week & 0x02),
      tue: week === 0x7f || Boolean(week & 0x04),
      wed: week === 0x7f || Boolean(week & 0x08),
      thu: week === 0x7f || Boolean(week & 0x10),
      fri: week === 0x7f || Boolean(week & 0x20),
      sat: week === 0x7f || Boolean(week & 0x40),
    },
    durationMinMinutes:
      option.durationMin === undefined ? null : Math.floor(option.durationMin / 60),
    durationMaxMinutes:
      option.durationMax === undefined ? null : Math.floor(option.durationMax / 60),
    startPeriod: option.searchPeriods?.[0]?.startAt ?? null,
    endPeriod: option.searchPeriods?.[0]?.endAt ?? null,
    isFree: option.isFree ?? false,
  }
}
