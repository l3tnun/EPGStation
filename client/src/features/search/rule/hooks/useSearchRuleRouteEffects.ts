import { useEffect } from 'react'
import type { BroadcastWave } from '@/app/navigation'
import type { SettingsConsumerValue } from '@/shared/settings'
import { createRuleOptionDraft } from '../lib/ruleOptionDraft'
import {
  applySearchRouteQuery,
  buildSearchRequestBody,
  createDefaultSearchFormState,
  createDefaultSearchTimeReserveFormState,
  createSearchFormStateFromOption,
  type SearchRouteState,
  type SearchRuleDetail,
} from '../query'
import type { SearchRuleFormState } from './useSearchRuleFormState'

export function useSearchRuleRouteEffects({
  state,
  routeState,
  routeSearch,
  ruleDetail,
  enabledBroadcastWaves,
  encodeModes,
  settings,
}: {
  state: SearchRuleFormState
  routeState: SearchRouteState
  routeSearch: string
  ruleDetail: SearchRuleDetail | null
  enabledBroadcastWaves: readonly BroadcastWave[]
  encodeModes: readonly string[]
  settings: SettingsConsumerValue
}) {
  const {
    previousRouteSearchRef,
    setTimeSpecification,
    setTimeReserveForm,
    setForm,
    keywordInputValueRef,
    ignoreKeywordInputValueRef,
    setActiveRequest,
    initializedRuleEditKeyRef,
    handledFailureCountRef,
    setOptionDraft,
    needsResultScrollRef,
  } = state
  const routeRuleId = routeState.mode === 'rule-edit' ? routeState.ruleId : null

  useEffect(() => {
    const didRouteSearchChange = previousRouteSearchRef.current !== routeSearch
    previousRouteSearchRef.current = routeSearch
    if (didRouteSearchChange) {
      setTimeSpecification(false)
      setTimeReserveForm(createDefaultSearchTimeReserveFormState())
    }
    if (routeState.mode === 'search') {
      // Only an actual navigation (routeSearch changing) may reset the in-progress form: this
      // effect's dependency array also includes object/array props (settings,
      // enabledBroadcastWaves, routeState) that can receive a new-but-equal-content reference from
      // an unrelated ancestor re-render. Resetting unconditionally on every effect run wiped
      // typed keyword/channel/time selections whenever that happened (typed
      // keyword or channel selection disappearing after touching other fields, or after any
      // snackbar was shown), even though the route itself never changed. v2's equivalent
      // (`@Watch('$route')` in Search.vue) is a Vue route watcher that only fires on an actual
      // route change, so this mirrors that behavior instead of React's broader effect semantics.
      if (didRouteSearchChange) {
        const defaultForm = createDefaultSearchFormState(enabledBroadcastWaves)
        const routeForm = applySearchRouteQuery(defaultForm, routeState.query)
        // Route changes reset Search form state to the current query contract.
        setForm(routeForm)
        keywordInputValueRef.current = routeForm.keyword
        ignoreKeywordInputValueRef.current = routeForm.ignoreKeyword
        setActiveRequest(
          routeState.shouldAutoSearch
            ? {
                body: buildSearchRequestBody({ form: routeForm, settings }),
                serial: 0,
                source: 'route-search',
              }
            : null,
        )
        // Query-driven auto-search always scrolls to the result once it succeeds - v2's
        // `isQuerySearch` branch calls `this.search(true)` unconditionally (Search.vue, ~line
        // 379) and never reads `isEnableAutoScrollWhenEditingRule`; that setting only gates the
        // separate EPG rule edit preload branch handled elsewhere in this hook.
        if (routeState.shouldAutoSearch) {
          needsResultScrollRef.current = true
        }
      }
    } else {
      // `SearchRouteState` only has the 'search' and 'rule-edit' modes, so this is
      // the rule-edit branch.
      if (didRouteSearchChange) {
        initializedRuleEditKeyRef.current = null
        setActiveRequest(null)
      }
    }
    handledFailureCountRef.current = 0
  }, [
    enabledBroadcastWaves,
    handledFailureCountRef,
    ignoreKeywordInputValueRef,
    initializedRuleEditKeyRef,
    keywordInputValueRef,
    needsResultScrollRef,
    previousRouteSearchRef,
    routeSearch,
    routeState,
    setActiveRequest,
    setForm,
    setTimeReserveForm,
    setTimeSpecification,
    settings,
  ])

  useEffect(() => {
    if (ruleDetail === null || routeState.mode !== 'rule-edit') {
      initializedRuleEditKeyRef.current = null
      return
    }

    const shouldAutoScroll = settings.isEnableAutoScrollWhenEditingRule
    const initializationKey = JSON.stringify({
      enabledBroadcastWaves,
      encodeModes,
      rule: {
        encodeOption: ruleDetail.encodeOption ?? null,
        id: routeRuleId,
        isTimeSpecification: ruleDetail.isTimeSpecification,
        reserveOption: ruleDetail.reserveOption,
        saveOption: ruleDetail.saveOption,
        searchOption: ruleDetail.searchOption,
      },
      shouldAutoScroll,
      settings: {
        isCheckAvoidDuplicate: settings.isCheckAvoidDuplicate,
        isCheckDeleteOriginalAfterEncode: settings.isCheckDeleteOriginalAfterEncode,
        isEnableCopyKeywordToDirectory: settings.isEnableCopyKeywordToDirectory,
        isEnableEncodingSettingWhenCreateRule: settings.isEnableEncodingSettingWhenCreateRule,
        isHalfWidthDisplayed: settings.isHalfWidthDisplayed,
        searchLength: settings.searchLength,
      },
    })

    if (initializedRuleEditKeyRef.current === initializationKey) {
      return
    }
    initializedRuleEditKeyRef.current = initializationKey

    if (ruleDetail.isTimeSpecification) {
      // Route preload synchronizes controlled option state to the loaded rule contract.
      setOptionDraft(
        createRuleOptionDraft({
          existingRule: ruleDetail,
          searchBody: {
            option: ruleDetail.searchOption,
            isHalfWidth: settings.isHalfWidthDisplayed,
            limit: settings.searchLength,
          },
          settings,
          encodeModes,
        }),
      )
      return
    }

    const nextForm = createSearchFormStateFromOption(ruleDetail.searchOption, enabledBroadcastWaves)
    const body = buildSearchRequestBody({ form: nextForm, settings })

    setOptionDraft(
      createRuleOptionDraft({
        existingRule: ruleDetail,
        searchBody: body,
        settings,
        encodeModes,
      }),
    )

    setForm(nextForm)
    needsResultScrollRef.current = shouldAutoScroll
    setActiveRequest({ body, serial: 0, source: 'rule-edit-preload' })
  }, [
    enabledBroadcastWaves,
    encodeModes,
    initializedRuleEditKeyRef,
    needsResultScrollRef,
    routeState.mode,
    routeRuleId,
    ruleDetail,
    setActiveRequest,
    setForm,
    setOptionDraft,
    settings,
  ])
}
