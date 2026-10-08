import Fab from '@mui/material/Fab'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ShellSnackbarState } from '@/app/AppShell'
import {
  readCurrentRouteScrollPosition,
  useScrollHistory,
  useScrollHistoryPageReady,
} from '@/app/scrollHistory'
import { LegacyPagination } from '@/shared/LegacyPagination'
import type { SettingsConsumerValue } from '@/shared/settings'
import { useMeasuredContainerWidth } from '@/shared/useMeasuredContainerWidth'
import type { RuleListItem, SearchRuleApiRepository } from './api'
import { BulkDeleteDialog, RuleDeleteDialog } from './components/RuleDeleteDialogs'
import { RuleItemMenu, type RuleItemMenuState } from './components/RuleItemMenu'
import { RuleListRow } from './components/RuleListRow'
import { RuleListTitleBar } from './components/RuleListTitleBar'
import { RuleSearchMenu } from './components/RuleSearchMenu'
import { resolveRuleLayout } from './lib/ruleLayout'
import { ruleKeyword } from './lib/ruleListText'
import { SEARCH_RULE_QUERY_KEY, buildRuleListRequest, parseRuleRoute } from './query'
import styles from './SearchRulePage.module.css'

export interface RuleListPageProps {
  isNavigationOpen: boolean
  onNavigationClick: () => void
  settings: SettingsConsumerValue
  // `useMeasuredContainerWidth` starts at `undefined` on every mount (its `ResizeObserver` only
  // delivers a first measurement asynchronously, one frame or so after mount), so the table/list
  // layout decision (`resolveRuleLayout`) needs a real fallback in the meantime - mirrors
  // `ReservesPage`/`RecordedPage`, which both take the actual viewport width for the same reason
  // instead of assuming a desktop width. Assuming a fixed desktop width here (this page's previous
  // behavior) picks `'table'` on every mount on a narrow viewport; that layout, squeezed into the
  // real (narrow) container before the correct `'list'` layout takes over, wraps its long
  // channel/genre/keyword text and renders measurably taller than the `'list'` layout that
  // immediately replaces it. Measured directly (Playwright, Android Chrome/Pixel 5, this page's
  // synthetic 2-rule fixture): `'table'` renders the section at 275px, `'list'` at 188px - a 87px
  // difference. That transient 87px of content sitting above an already-restored scroll position is
  // what triggered the browser's own scroll-anchoring to silently move the page away from a position
  // `useRouteScrollRestoration` had already applied (see e2e/app-shell-scroll-workflow.spec.ts,
  // "restores the rule list scroll position immediately after browser back").
  viewportWidth?: number
  /**
   * Overrides the measured list container width used for the table/list layout decision
   * (`resolveRuleLayout`). Real usage measures the actual rendered `.page` container via
   * `ResizeObserver`, matching v2 `RuleItems.vue`'s `this.$el.clientWidth`; this prop exists so
   * tests can inject a container width directly, since jsdom never fires `ResizeObserver`.
   */
  containerWidth?: number
  apiRepository: SearchRuleApiRepository
  onSnackbar: (snackbar: ShellSnackbarState) => void
}

export function RuleListPage({
  isNavigationOpen,
  onNavigationClick,
  settings,
  viewportWidth = 1440,
  containerWidth,
  apiRepository,
  onSnackbar,
}: RuleListPageProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const scrollHistory = useScrollHistory()
  const [pageContainerRef, measuredContainerWidth] = useMeasuredContainerWidth<HTMLElement>()
  const layout = resolveRuleLayout(containerWidth ?? measuredContainerWidth ?? viewportWidth)
  const [isEditMode, setEditMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set())
  const [deleteRule, setDeleteRule] = useState<RuleListItem | null>(null)
  const [isBulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [searchAnchor, setSearchAnchor] = useState<HTMLElement | null>(null)
  const [enabledOverrides, setEnabledOverrides] = useState<Map<number, boolean>>(() => new Map())
  const ruleSearchNavigateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const deleteRuleOpenTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [menuState, setMenuState] = useState<RuleItemMenuState | null>(null)
  const route = useMemo(() => parseRuleRoute(location.search), [location.search])
  const request = useMemo(() => buildRuleListRequest({ route, settings }), [route, settings])
  const query = useQuery({
    queryKey: [...SEARCH_RULE_QUERY_KEY, 'rules', request],
    queryFn: () => apiRepository.fetchRules(request),
  })
  useScrollHistoryPageReady(
    query.data !== undefined && !query.isFetching,
    `${location.pathname}${location.search}`,
  )
  const rules = useMemo(() => (query.data?.ok ? query.data.value.rules : []), [query.data])
  const total = query.data?.ok ? query.data.value.total : 0
  const title = isEditMode ? `${selectedIds.size} 件選択` : 'ルール'
  const handledFetchRouteKey = useRef<string | undefined>(undefined)
  useEffect(() => {
    // Guards against re-announcing the same failed fetch on every unrelated re-render: the
    // snackbar fires once per route, when that route's fetch first settles.
    if (query.data === undefined || query.isFetching) {
      return
    }
    if (handledFetchRouteKey.current === location.search) {
      return
    }
    handledFetchRouteKey.current = location.search
    if (!query.data.ok) {
      onSnackbar({ text: query.data.message, severity: 'error' })
    }
  }, [location.search, onSnackbar, query.data, query.isFetching])
  useEffect(() => {
    // A refetch that is not driven by a route change (Socket.IO `updateStatus`, a background
    // react-query refetch, ...) keeps edit-mode selection, but only for rule ids still present in
    // the current page -- ids that dropped out of view must not linger in the selected set.
    const visibleIds = new Set(rules.map((rule) => rule.id))

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds((current) => {
      if (current.size === 0) {
        return current
      }

      let didDropId = false
      const next = new Set<number>()

      current.forEach((id) => {
        if (visibleIds.has(id)) {
          next.add(id)
        } else {
          didDropId = true
        }
      })

      return didDropId ? next : current
    })
  }, [rules])
  useEffect(() => {
    // Route changes reset rule-list interaction state before the next fetch is displayed.
    if (deleteRuleOpenTimer.current !== undefined) {
      clearTimeout(deleteRuleOpenTimer.current)
      deleteRuleOpenTimer.current = undefined
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds(new Set())
    setEditMode(false)
    setBulkDeleteOpen(false)
    setDeleteRule(null)
    setMenuState(null)
    setSearchAnchor(null)
    setEnabledOverrides(new Map())
  }, [location.search])
  useEffect(
    () => () => {
      if (ruleSearchNavigateTimer.current !== undefined) {
        clearTimeout(ruleSearchNavigateTimer.current)
      }
      if (deleteRuleOpenTimer.current !== undefined) {
        clearTimeout(deleteRuleOpenTimer.current)
      }
    },
    [],
  )
  const openDeleteRuleAfterDelay = (target: RuleListItem) => {
    // v2's `RuleItemMenu.vue` `openDeleteDialog()` closes the menu (`v-list-item` click closes
    // the `v-menu` itself), then `await Util.sleep(300)` before opening `RuleDeleteDialog`
    // (76 行目). Measuring the actual MUI Menu close transition confirmed it takes close to
    // 300ms, and opening the confirmation dialog immediately (as a 0ms delay does) visibly
    // overlaps the closing menu with the newly opened dialog's backdrop.
    if (deleteRuleOpenTimer.current !== undefined) {
      clearTimeout(deleteRuleOpenTimer.current)
    }
    deleteRuleOpenTimer.current = setTimeout(() => {
      deleteRuleOpenTimer.current = undefined
      setDeleteRule(target)
    }, 300)
  }
  const runEnable = async (rule: RuleListItem, enable: boolean) => {
    const result = enable
      ? await apiRepository.enableRule(rule.id)
      : await apiRepository.disableRule(rule.id)
    const keyword = ruleKeyword(rule)

    onSnackbar({
      text: result.ok ? `${enable ? '有効化' : '無効化'}: ${keyword}` : result.message,
      severity: result.ok ? 'success' : 'error',
    })
    if (result.ok) {
      setEnabledOverrides((current) => {
        const next = new Map(current)
        next.set(rule.id, enable)
        return next
      })
    }
  }
  const confirmDelete = async (target: RuleListItem) => {
    const result = await apiRepository.deleteRule(target.id)
    setDeleteRule(null)
    onSnackbar({
      text: result.ok ? `${ruleKeyword(target)} を削除` : `${ruleKeyword(target)} を削除に失敗`,
      severity: result.ok ? 'success' : 'error',
    })
  }
  const toggleSelection = (ruleId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(ruleId)) {
        next.delete(ruleId)
      } else {
        next.add(ruleId)
      }
      return next
    })
  }
  const toggleAll = () => {
    setSelectedIds((current) => {
      const visibleIds = rules.map((rule) => rule.id)
      const hasAllVisible = visibleIds.every((id) => current.has(id))

      return hasAllVisible ? new Set() : new Set(visibleIds)
    })
  }
  const closeEditMode = () => {
    setSelectedIds(new Set())
    setEditMode(false)
  }
  const openBulkDelete = () => {
    if (selectedIds.size === 0) {
      onSnackbar({ text: 'ルールを選択してください。', severity: 'error' })
      return
    }

    setBulkDeleteOpen(true)
  }
  const confirmBulkDelete = async () => {
    const targets = rules.filter((rule) => selectedIds.has(rule.id))
    const results = []

    setBulkDeleteOpen(false)
    setSelectedIds(new Set())
    setEditMode(false)

    for (const rule of targets) {
      results.push(await apiRepository.deleteRule(rule.id))
    }

    onSnackbar({
      text: results.every((result) => result.ok)
        ? '選択したルールを削除しました。'
        : '一部ルールの削除に失敗しました。',
      severity: results.every((result) => result.ok) ? 'success' : 'error',
    })
  }
  const goToPage = (page: number) => {
    const parameters = new URLSearchParams(location.search)
    parameters.set('page', String(page))
    scrollHistory.updateHistoryPosition(readCurrentRouteScrollPosition())
    navigate({
      pathname: location.pathname,
      search: `?${parameters.toString()}`,
    })
  }
  const submitRuleSearch = (path: string) => {
    if (ruleSearchNavigateTimer.current !== undefined) {
      clearTimeout(ruleSearchNavigateTimer.current)
    }
    setSearchAnchor(null)
    ruleSearchNavigateTimer.current = setTimeout(() => {
      ruleSearchNavigateTimer.current = undefined
      navigate(path)
    }, 300)
  }

  return (
    <>
      <RuleListTitleBar
        isEditMode={isEditMode}
        title={title}
        isNavigationOpen={isNavigationOpen}
        onNavigationClick={onNavigationClick}
        onCloseEditMode={closeEditMode}
        onSelectAll={toggleAll}
        onDelete={openBulkDelete}
        onOpenSearch={setSearchAnchor}
        onOpenEditMode={() => setEditMode(true)}
      />
      {searchAnchor === null ? null : (
        <RuleSearchMenu
          anchorEl={searchAnchor}
          search={location.search}
          onClose={() => setSearchAnchor(null)}
          onSubmit={submitRuleSearch}
        />
      )}
      <section
        ref={pageContainerRef}
        className={styles.page}
        data-rule-layout={layout}
        aria-label="ルール一覧"
        data-testid="rule-page"
      >
        {deleteRule === null ? null : (
          <RuleDeleteDialog
            rule={deleteRule}
            onCancel={() => setDeleteRule(null)}
            onConfirm={() => void confirmDelete(deleteRule)}
          />
        )}
        {isBulkDeleteOpen ? (
          <BulkDeleteDialog
            count={selectedIds.size}
            onCancel={() => setBulkDeleteOpen(false)}
            onConfirm={() => void confirmBulkDelete()}
          />
        ) : null}
        <RuleItemMenu
          menuState={menuState}
          navigate={navigate}
          onClose={() => setMenuState(null)}
          onDelete={openDeleteRuleAfterDelay}
        />
        {rules.length === 0 ? null : (
          <div className={styles.ruleList} role="list" aria-label="ルール一覧">
            <div className={styles.ruleHeader} aria-hidden="true">
              <span />
              <span>キーワード</span>
              <span>除外キーワード</span>
              <span>放送局</span>
              <span>ジャンル</span>
              <span>予約数</span>
              <span />
            </div>
            {rules.map((rule) => {
              const isEnabled = enabledOverrides.get(rule.id) ?? rule.reserveOption.enable

              return (
                <RuleListRow
                  key={rule.id}
                  rule={rule}
                  isEnabled={isEnabled}
                  isEditMode={isEditMode}
                  isSelected={selectedIds.has(rule.id)}
                  onToggleEnable={() => void runEnable(rule, !isEnabled)}
                  onToggleSelection={() => toggleSelection(rule.id)}
                  onOpenMenu={(anchor) => setMenuState({ anchor, rule })}
                />
              )
            })}
          </div>
        )}
        <LegacyPagination
          page={route.page}
          pageSize={request.limit}
          total={total}
          onPageChange={goToPage}
        />
        {!isEditMode ? (
          <Fab
            aria-label="追加"
            className={styles.ruleFab}
            color="secondary"
            onClick={() => navigate('/search')}
          >
            <span aria-hidden="true">+</span>
          </Fab>
        ) : null}
      </section>
    </>
  )
}
