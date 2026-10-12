import { useEffect, useMemo, useRef, useState } from 'react'
import type { BroadcastWave } from '@/app/navigation'
import type { useScrollHistory } from '@/app/scrollHistory'
import {
  DEFAULT_GUIDE_PROGRAM_DETAIL_SETTING,
  type GuideProgramDetailSetting,
} from '@/features/guide/guideRequests'
import type { SettingsConsumerValue } from '@/shared/settings'
import type { SearchProgram } from '../api'
import { createRuleOptionDraft } from '../lib/ruleOptionDraft'
import {
  applySearchRouteQuery,
  buildSearchRequestBody,
  createDefaultSearchFormState,
  createDefaultSearchTimeReserveFormState,
  createSearchPageInfoFromState,
  resolveSearchPageInfoForRoute,
  shouldSaveSearchPageInfo,
  type SearchPageInfo,
  type SearchRequestBody,
  type SearchRouteState,
  type SearchRuleOptionDraft,
  type SearchTimeReserveFormState,
} from '../query'

export interface ActiveSearchRequest {
  body: SearchRequestBody
  serial: number
  source: 'route-search' | 'rule-edit-preload' | 'search-submit' | 'rule-edit-submit'
}

export type SearchRuleFormState = ReturnType<typeof useSearchRuleFormState>

export function useSearchRuleFormState({
  routeState,
  routeSearch,
  enabledBroadcastWaves,
  encodeModes,
  settings,
  scrollHistory,
}: {
  routeState: SearchRouteState
  routeSearch: string
  enabledBroadcastWaves: readonly BroadcastWave[]
  encodeModes: readonly string[]
  settings: SettingsConsumerValue
  scrollHistory: ReturnType<typeof useScrollHistory>
}) {
  const resultRef = useRef<HTMLElement | null>(null)
  const ruleOptionRef = useRef<HTMLDivElement | null>(null)
  const handledFailureCountRef = useRef(0)
  // v2's `updateSocketIoState()` (Search.vue) picks the refresh-failure text purely by which
  // method is running - the initial `search()`/rule-reserves fetch vs. the Socket.IO
  // `updateStatus` handler - never by whether a fetch has ever succeeded. Tracking "has this
  // fetch attempted a response before" (regardless of outcome) reproduces that same distinction
  // structurally: the query key only changes on a fresh user- or route-driven request, so a
  // second settled response for the same key can only come from a Socket.IO triggered refetch.
  // A prior "has ever succeeded" version of this flag matched v2 in every case except a
  // continuous run of failures that never succeeds once.
  const hasAttemptedSearchResultRef = useRef(false)
  const hasAttemptedRuleReservesRef = useRef(false)
  const initializedRuleOptionSerialRef = useRef<number | null>(null)
  const initializedRuleEditKeyRef = useRef<string | null>(null)
  const previousRouteSearchRef = useRef(routeSearch)
  const successBackTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | undefined>(
    undefined,
  )
  const modeRef = useRef(routeState.mode)
  useEffect(() => {
    modeRef.current = routeState.mode
  }, [routeState.mode])
  // Captured once, at this component instance's mount: only a genuine history restore (browser
  // back/forward returning to this exact `/search` route entry) may seed initial state from a
  // previous visit's saved page info (AC 1.18). Opening `/search` fresh - from the navigation
  // drawer, or any push navigation - must always start blank, even if a stale page info from an
  // earlier visit this session is still saved; `resolveSearchPageInfoForRoute` enforces that by
  // returning null whenever `scrollHistory.isNeedRestoreHistory()` is false. Route param changes
  // that happen while this component stays mounted (e.g. `/search?keyword=a` -> `/search?rule=5`)
  // must not re-trigger this - that transition is handled entirely by
  // useSearchRuleRouteEffects.ts (AC 1.21) - so this only reads `scrollHistory`/`routeState` once,
  // via a ref, rather than on every render.
  // `useState` with a lazy initializer, not a ref: the value is computed once for this component
  // instance and never set again, and reading a ref during render is not allowed.
  const [restoredPageInfo] = useState<SearchPageInfo | null>(() =>
    resolveSearchPageInfoForRoute({
      mode: routeState.mode,
      shouldRestoreHistory: scrollHistory.isNeedRestoreHistory(),
      // `getScrollData` is a single per-URL slot shared by every route (Guide/Reserves/Dashboard
      // all write their own shape into it), so its type argument is only the caller's wish, not a
      // guarantee - `resolveSearchPageInfoForRoute` validates the actual shape before trusting it.
      pageInfo: scrollHistory.getScrollData(),
    }),
  )
  // Query-driven auto-search (v2 `Search.vue`'s `isQuerySearch` branch) always scrolls
  // to the result once the first search succeeds, independent of
  // `isEnableAutoScrollWhenEditingRule` (AC 2.22). `useSearchRuleRouteEffects.ts` only sets this
  // flag when `routeSearch` actually changes *after* mount (AC 1.21's guard against unrelated
  // ancestor re-renders resetting in-progress form state); on the initial mount,
  // `previousRouteSearchRef` is seeded from this same render's `routeSearch`, so that guard never
  // fires for the very first query-driven search. The initial value mirrors `activeRequest`'s own
  // seeding below: a restored page info (AC 1.18) takes priority and is not itself query-driven,
  // so it must not force a scroll here.
  const needsResultScrollRef = useRef(
    restoredPageInfo === null && routeState.mode === 'search' && routeState.shouldAutoSearch,
  )
  const [form, setForm] = useState(() => {
    if (restoredPageInfo !== null) {
      return restoredPageInfo.form
    }

    const defaultForm = createDefaultSearchFormState(enabledBroadcastWaves)

    return routeState.mode === 'search'
      ? applySearchRouteQuery(defaultForm, routeState.query)
      : defaultForm
  })
  // `enabledBroadcastWaves` starts as the "not loaded yet" fallback (every wave) and narrows to
  // the server's real list once server config finishes loading, but this state's initializer
  // above only runs once at mount. Without reconciling, a wave that was in the fallback list but
  // isn't actually enabled stays baked into `form.broadcastWaves` forever, even though its
  // checkbox never renders - and that phantom "still enabled" entry can make the all-disabled
  // check below (mirroring v2's `isDisabledAllBroadcasWave`) see a wave as checked when the user
  // sees every visible checkbox unchecked. Reconcile the key set (not the checked values users
  // set) whenever the actual set of enabled waves changes.
  const enabledBroadcastWaveSetKey = [...enabledBroadcastWaves].sort().join(',')
  const reconciledBroadcastWaveSetKeyRef = useRef(enabledBroadcastWaveSetKey)
  useEffect(() => {
    // Guarded on the wave *set* (a stable primitive), not merely on this effect having run: a
    // new-but-equal-content `enabledBroadcastWaves` array reference re-runs this effect (it's a
    // dependency below, for the linter's sake), but the guard below makes that a cheap no-op
    // instead of a spurious reconciliation (see useSearchRuleRouteEffects.ts for why that
    // distinction matters elsewhere).
    if (reconciledBroadcastWaveSetKeyRef.current === enabledBroadcastWaveSetKey) {
      return
    }
    reconciledBroadcastWaveSetKeyRef.current = enabledBroadcastWaveSetKey

    setForm((current) => ({
      ...current,
      broadcastWaves: Object.fromEntries(
        enabledBroadcastWaves.map((wave) => [wave, current.broadcastWaves[wave] ?? true]),
      ),
    }))
  }, [enabledBroadcastWaveSetKey, enabledBroadcastWaves])
  const [isTimeSpecification, setTimeSpecification] = useState(
    () => restoredPageInfo?.isTimeSpecification ?? false,
  )
  const [timeReserveForm, setTimeReserveForm] = useState<SearchTimeReserveFormState>(
    () => restoredPageInfo?.timeReserveForm ?? createDefaultSearchTimeReserveFormState(),
  )
  const keywordInputValueRef = useRef(form.keyword)
  const ignoreKeywordInputValueRef = useRef(form.ignoreKeyword)
  const [isSubGenreVisible, setSubGenreVisible] = useState(true)
  const requestBody = useMemo(() => buildSearchRequestBody({ form, settings }), [form, settings])
  const [activeRequest, setActiveRequest] = useState<ActiveSearchRequest | null>(() => {
    // A restored page info takes priority over the URL's query-driven auto search entirely (v2
    // `Search.vue` `onUrlChange()` only reaches its `isQuerySearch` branch in the *non*-restore
    // path): restoring re-searches only when the saved snapshot says a search
    // had actually run (`isSearched`), independent of what `routeState.shouldAutoSearch` says
    // about the current URL.
    const shouldSeedActiveRequest =
      restoredPageInfo !== null
        ? restoredPageInfo.isSearched
        : routeState.mode === 'search' && routeState.shouldAutoSearch

    return shouldSeedActiveRequest ? { body: requestBody, serial: 0, source: 'route-search' } : null
  })
  const [optionDraft, setOptionDraft] = useState<SearchRuleOptionDraft>(
    () =>
      restoredPageInfo?.optionDraft ??
      createRuleOptionDraft({
        existingRule: null,
        searchBody: requestBody,
        settings,
        encodeModes,
      }),
  )
  const [selectedProgram, setSelectedProgram] = useState<SearchProgram | null>(null)
  const [isProgramDialogOpen, setProgramDialogOpen] = useState(false)
  const [detailSetting, setDetailSetting] = useState<GuideProgramDetailSetting>({
    ...DEFAULT_GUIDE_PROGRAM_DETAIL_SETTING,
  })
  const pageInfoRef = useRef<SearchPageInfo>(
    createSearchPageInfoFromState({
      form,
      isTimeSpecification,
      timeReserveForm,
      optionDraft,
      isSearched: activeRequest !== null,
    }),
  )
  useEffect(() => {
    pageInfoRef.current = createSearchPageInfoFromState({
      form,
      isTimeSpecification,
      timeReserveForm,
      optionDraft,
      isSearched: activeRequest !== null,
    })
  }, [form, isTimeSpecification, timeReserveForm, optionDraft, activeRequest])
  useEffect(() => {
    // Route param changes that keep this component mounted (e.g. `/search?keyword=a` ->
    // `/search?rule=5`) must not save/clear this - only this hook's real mount/unmount lifecycle
    // (leaving `/search` for a different route entirely, or the tab closing) should, mirroring
    // `useManualReserveLoader.ts`'s save-on-cleanup pattern (AC 1.18). `modeRef`/`pageInfoRef`
    // hold whatever the latest route mode/page state were at the moment of that unmount.
    return () => {
      if (!shouldSaveSearchPageInfo({ mode: modeRef.current })) {
        return
      }

      scrollHistory.saveScrollData<SearchPageInfo>(pageInfoRef.current)
    }
  }, [scrollHistory])

  return {
    resultRef,
    ruleOptionRef,
    needsResultScrollRef,
    handledFailureCountRef,
    hasAttemptedSearchResultRef,
    hasAttemptedRuleReservesRef,
    initializedRuleOptionSerialRef,
    initializedRuleEditKeyRef,
    previousRouteSearchRef,
    successBackTimerRef,
    keywordInputValueRef,
    ignoreKeywordInputValueRef,
    form,
    setForm,
    isTimeSpecification,
    setTimeSpecification,
    timeReserveForm,
    setTimeReserveForm,
    isSubGenreVisible,
    setSubGenreVisible,
    requestBody,
    activeRequest,
    setActiveRequest,
    optionDraft,
    setOptionDraft,
    selectedProgram,
    setSelectedProgram,
    isProgramDialogOpen,
    setProgramDialogOpen,
    detailSetting,
    setDetailSetting,
  }
}
