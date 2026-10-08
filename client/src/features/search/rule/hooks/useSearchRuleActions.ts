import type { SubmitHandler } from 'react-hook-form'
import type { NavigateFunction } from 'react-router-dom'
import type { ShellSnackbarState } from '@/app/AppShell'
import type { BroadcastWave } from '@/app/navigation'
import type { SettingsConsumerValue } from '@/shared/settings'
import type { SearchRuleApiRepository } from '../api'
import { scrollActivePageToTop, scrollToElementHead } from '../lib/pageScroll'
import { createRuleOptionDraft } from '../lib/ruleOptionDraft'
import {
  SEARCH_SCROLL_FAILURE_MESSAGE,
  applyLegacyKeywordTargetDefaults,
  buildSearchRequestBody,
  buildSearchRulePayload,
  createDefaultSearchFormState,
  createTimeSpecifiedSearchOption,
  restoreVisibleBroadcastWaves,
  type SearchFormState,
  type SearchRouteState,
  type SearchRuleDetail,
} from '../query'
import type { SearchRuleFormState } from './useSearchRuleFormState'

export interface RuleActionFormValues {
  action: 'save'
}

export function useSearchRuleActions({
  state,
  routeState,
  ruleDetail,
  isTimeSpecificationMode,
  enabledBroadcastWaves,
  encodeModes,
  settings,
  apiRepository,
  navigate,
  onSnackbar,
}: {
  state: SearchRuleFormState
  routeState: SearchRouteState
  ruleDetail: SearchRuleDetail | null
  isTimeSpecificationMode: boolean
  enabledBroadcastWaves: readonly BroadcastWave[]
  encodeModes: readonly string[]
  settings: SettingsConsumerValue
  apiRepository: SearchRuleApiRepository
  navigate: NavigateFunction
  onSnackbar: (snackbar: ShellSnackbarState) => void
}) {
  const {
    form,
    setForm,
    activeRequest,
    setActiveRequest,
    requestBody,
    timeReserveForm,
    optionDraft,
    setOptionDraft,
    handledFailureCountRef,
    hasAttemptedSearchResultRef,
    needsResultScrollRef,
    initializedRuleOptionSerialRef,
    successBackTimerRef,
    ruleOptionRef,
  } = state

  const submitSearch = (nextForm: SearchFormState = form) => {
    // v2's `prepSearchOption()` (SearchState.ts, run on every submit) re-enables every visible
    // broadcast wave when none is selected and no channel filter is active, mutating the same
    // state the checkboxes are bound to - so the checkboxes visibly flip back to checked, not
    // just the outgoing request. `restoreVisibleBroadcastWaves` already exists for the request
    // body (see buildSearchRequestBody); apply it here too so the visible form matches v2.
    const normalizedForm = restoreVisibleBroadcastWaves(applyLegacyKeywordTargetDefaults(nextForm))
    setForm(normalizedForm)
    const nextRequestBody = buildSearchRequestBody({ form: normalizedForm, settings })
    const nextSerial = activeRequest === null ? 1 : activeRequest.serial + 1
    handledFailureCountRef.current = 0
    hasAttemptedSearchResultRef.current = false
    needsResultScrollRef.current = true
    initializedRuleOptionSerialRef.current = nextSerial
    setOptionDraft(
      createRuleOptionDraft({
        existingRule: routeState.mode === 'rule-edit' ? ruleDetail : null,
        searchBody: nextRequestBody,
        settings,
        encodeModes,
      }),
    )
    setActiveRequest(() => ({
      body: nextRequestBody,
      serial: nextSerial,
      source: routeState.mode === 'rule-edit' ? 'rule-edit-submit' : 'search-submit',
    }))
  }
  const clearSearch = () => {
    const defaultForm = createDefaultSearchFormState(enabledBroadcastWaves)
    const defaultRequestBody = buildSearchRequestBody({ form: defaultForm, settings })
    setForm(defaultForm)
    setOptionDraft(
      createRuleOptionDraft({
        existingRule: null,
        searchBody: defaultRequestBody,
        settings,
        encodeModes,
      }),
    )
    initializedRuleOptionSerialRef.current = null
    setActiveRequest(null)
  }
  const submitRuleForm: SubmitHandler<RuleActionFormValues> = async () => {
    let result

    try {
      const payload = buildSearchRulePayload({
        searchBody: activeRequest?.body ?? requestBody,
        isTimeSpecification: isTimeSpecificationMode,
        timeSpecifiedSearchOption:
          isTimeSpecificationMode && routeState.mode === 'search'
            ? createTimeSpecifiedSearchOption(timeReserveForm)
            : undefined,
        settings,
        encodeModes,
        optionDraft,
        existingRule:
          routeState.mode === 'rule-edit' && ruleDetail !== null ? ruleDetail : undefined,
      })
      result =
        routeState.mode === 'rule-edit'
          ? await apiRepository.updateRule(routeState.ruleId, payload)
          : await apiRepository.addRule(payload)
    } catch {
      onSnackbar({
        text: routeState.mode === 'rule-edit' ? 'ルール更新に失敗' : 'ルール追加に失敗',
        severity: 'error',
      })
      return
    }

    const successMessage = routeState.mode === 'rule-edit' ? 'ルール更新に成功' : 'ルール追加に成功'
    const failureMessage = routeState.mode === 'rule-edit' ? 'ルール更新に失敗' : 'ルール追加に失敗'

    onSnackbar({
      text: result.ok ? successMessage : failureMessage,
      severity: result.ok ? 'success' : 'error',
    })

    if (result.ok) {
      clearTimeout(successBackTimerRef.current)
      successBackTimerRef.current = setTimeout(() => {
        successBackTimerRef.current = undefined
        navigate(-1)
      }, 1000)
    }
  }
  const scrollToRuleOption = () => {
    if (!scrollToElementHead(ruleOptionRef.current)) {
      onSnackbar({
        text: SEARCH_SCROLL_FAILURE_MESSAGE,
        severity: 'error',
      })
    }
  }
  const scrollToTop = () => {
    // v2's equivalent (Search.vue `scrollToTop()`) calls `window.scrollTo` unconditionally and
    // never reports a failure for this button, unlike the ref-based `scrollToElementHead` used
    // elsewhere in the same file. Match that: best-effort, silent on failure.
    scrollActivePageToTop()
  }

  return { submitSearch, clearSearch, submitRuleForm, scrollToRuleOption, scrollToTop }
}
