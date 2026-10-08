import { useEffect, useLayoutEffect, useRef } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import type { SettingsConsumerValue } from '@/shared/settings'
import { scrollToElementHead } from '../lib/pageScroll'
import { createRuleOptionDraft } from '../lib/ruleOptionDraft'
import {
  RULE_RESERVES_REFRESH_FAILURE_MESSAGE,
  SEARCH_REFRESH_FAILURE_MESSAGE,
  SEARCH_SCROLL_FAILURE_MESSAGE,
  type SearchRouteState,
} from '../query'
import type { SearchRuleFormState } from './useSearchRuleFormState'
import type { SearchRuleQueries } from './useSearchRuleQueries'

export function useSearchResultEffects({
  state,
  queries,
  routeState,
  settings,
  encodeModes,
  onSnackbar,
}: {
  state: SearchRuleFormState
  queries: SearchRuleQueries
  routeState: SearchRouteState
  settings: SettingsConsumerValue
  encodeModes: readonly string[]
  onSnackbar: (snackbar: ShellSnackbarState) => void
}) {
  const {
    activeRequest,
    hasAttemptedSearchResultRef,
    initializedRuleOptionSerialRef,
    needsResultScrollRef,
    handledFailureCountRef,
    hasAttemptedRuleReservesRef,
    resultRef,
    setOptionDraft,
    successBackTimerRef,
  } = state
  const { currentSearchResponse, query, ruleDetailQuery, ruleReservesQuery } = queries
  // Guards the failure branch below against re-firing for the exact same settled
  // `currentSearchResponse`, the failure-side counterpart to the success branch's own
  // re-entrancy guards (`initializedRuleOptionSerialRef` for the option-draft rebuild,
  // `needsResultScrollRef` for the scroll attempt): an effect re-run triggered by an unrelated
  // dependency changing (e.g. a new-but-equal-content `encodeModes`/`settings` reference from an
  // ancestor re-render - see [AC 2.9] elsewhere in this feature for that exact re-render shape)
  // must not show the same failure snackbar a second time. Kept separate from
  // `hasAttemptedSearchResultRef` (which only distinguishes first-attempt vs. refresh wording and
  // must keep doing that the same whether or not this guard is present) so the two never gate each
  // other: a genuinely new search - submitted or route-driven - always settles into a distinct
  // response object, so this needs no explicit reset on submit/route change the way those other
  // refs do.
  const handledFailureResponseRef = useRef<typeof currentSearchResponse>(undefined)

  useLayoutEffect(() => {
    if (currentSearchResponse?.ok) {
      hasAttemptedSearchResultRef.current = true
    }
  }, [currentSearchResponse, hasAttemptedSearchResultRef])

  useEffect(() => {
    if (currentSearchResponse === undefined || query.isFetching || currentSearchResponse.ok) {
      if (currentSearchResponse?.ok) {
        hasAttemptedSearchResultRef.current = true
        if (
          activeRequest !== null &&
          routeState.mode === 'search' &&
          initializedRuleOptionSerialRef.current !== activeRequest.serial
        ) {
          initializedRuleOptionSerialRef.current = activeRequest.serial
          // Source SearchState rebuilds rule defaults from the submitted search condition.
          setOptionDraft(
            createRuleOptionDraft({
              existingRule: null,
              searchBody: activeRequest.body,
              settings,
              encodeModes,
            }),
          )
        }
        if (needsResultScrollRef.current) {
          needsResultScrollRef.current = false
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              if (
                !scrollToElementHead(resultRef.current, {
                  behavior: 'smooth',
                })
              ) {
                onSnackbar({
                  text: SEARCH_SCROLL_FAILURE_MESSAGE,
                  severity: 'error',
                })
              }
            })
          })
        }
      }
      return
    }

    // v2's `updateSocketIoState()` (Search.vue) always shows the refresh-failure text for a
    // Socket.IO triggered refetch, regardless of whether a search has ever succeeded - it
    // decides purely by which method is running. The search query's key only changes on a fresh
    // user- or route-driven request, so a second settled response for this same key can only be
    // a Socket.IO triggered refetch; "has this key settled before" therefore reproduces v2's
    // caller-based distinction without needing to track the caller directly.
    if (handledFailureResponseRef.current === currentSearchResponse) {
      return
    }
    handledFailureResponseRef.current = currentSearchResponse

    const isFirstAttempt = !hasAttemptedSearchResultRef.current
    hasAttemptedSearchResultRef.current = true
    handledFailureCountRef.current += 1
    onSnackbar({
      text: isFirstAttempt ? currentSearchResponse.message : SEARCH_REFRESH_FAILURE_MESSAGE,
      severity: 'error',
      timeout: 5000,
    })
  }, [
    activeRequest,
    encodeModes,
    handledFailureCountRef,
    handledFailureResponseRef,
    hasAttemptedSearchResultRef,
    initializedRuleOptionSerialRef,
    needsResultScrollRef,
    onSnackbar,
    currentSearchResponse,
    query.isFetching,
    resultRef,
    routeState.mode,
    setOptionDraft,
    settings,
  ])

  useEffect(() => {
    if (ruleDetailQuery.data === undefined || ruleDetailQuery.data.ok) {
      return
    }

    onSnackbar({ text: ruleDetailQuery.data.message, severity: 'error' })
  }, [onSnackbar, ruleDetailQuery.data])

  useLayoutEffect(() => {
    if (ruleReservesQuery.data?.ok) {
      hasAttemptedRuleReservesRef.current = true
    }
  }, [hasAttemptedRuleReservesRef, ruleReservesQuery.data])

  useEffect(() => {
    if (ruleReservesQuery.data === undefined || ruleReservesQuery.data.ok) {
      return
    }

    // Same reasoning as the search effect above: v2's Socket.IO handler always shows the
    // refresh-failure text for a refetch, regardless of whether the initial fetch ever
    // succeeded, and the rule-reserves query key is stable across a rule-edit session, so a
    // second settled response can only be a Socket.IO triggered refetch.
    const isFirstAttempt = !hasAttemptedRuleReservesRef.current
    hasAttemptedRuleReservesRef.current = true
    onSnackbar({
      text: isFirstAttempt ? ruleReservesQuery.data.message : RULE_RESERVES_REFRESH_FAILURE_MESSAGE,
      severity: 'error',
    })
  }, [hasAttemptedRuleReservesRef, onSnackbar, ruleReservesQuery.data])

  useEffect(
    () => () => {
      if (successBackTimerRef.current !== undefined) {
        clearTimeout(successBackTimerRef.current)
      }
    },
    [successBackTimerRef],
  )
}
