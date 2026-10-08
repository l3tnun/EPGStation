import { useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { useLocation, useNavigate } from 'react-router-dom'
import { SHELL_NAVIGATION_DRAWER_ID, type ShellSnackbarState } from '@/app/AppShell'
import type { BroadcastWave } from '@/app/navigation'
import { useScrollHistory } from '@/app/scrollHistory'
import { TitleBar } from '@/app/titleBar'
import { ProgramDialog } from '@/features/guide/ProgramDialog'
import type { SettingsConsumerValue } from '@/shared/settings'
import type { SearchRuleApiRepository } from './api'
import { RuleOptionForm } from './components/RuleOptionForm'
import { SearchConditionForm } from './components/SearchConditionForm'
import { SearchResultSection } from './components/SearchResultSection'
import { TimeSpecifiedReserveSection } from './components/TimeSpecifiedReserveSection'
import { TimeSpecifiedSearchForm } from './components/TimeSpecifiedSearchForm'
import { useSearchResultEffects } from './hooks/useSearchResultEffects'
import { useSearchRuleActions, type RuleActionFormValues } from './hooks/useSearchRuleActions'
import { useSearchRuleFormState } from './hooks/useSearchRuleFormState'
import { useSearchRuleQueries } from './hooks/useSearchRuleQueries'
import { useSearchRuleRouteEffects } from './hooks/useSearchRuleRouteEffects'
import { mergeChannelSelectOptions } from './lib/channelSelectOptions'
import { toDialogProgram } from './lib/programDisplay'
import { parseSearchRoute } from './query'
import styles from './SearchRulePage.module.css'

export interface SearchRulePageProps {
  isNavigationOpen: boolean
  onNavigationClick: () => void
  settings: SettingsConsumerValue
  enabledBroadcastWaves: readonly BroadcastWave[]
  encodeModes: readonly string[]
  recordedDirectories: readonly string[]
  apiRepository: SearchRuleApiRepository
  onSnackbar: (snackbar: ShellSnackbarState) => void
}

export function SearchRulePage({
  isNavigationOpen,
  onNavigationClick,
  settings,
  enabledBroadcastWaves,
  encodeModes,
  recordedDirectories,
  apiRepository,
  onSnackbar,
}: SearchRulePageProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const scrollHistory = useScrollHistory()
  const { handleSubmit } = useForm<RuleActionFormValues>({
    defaultValues: { action: 'save' },
  })
  const routeState = useMemo(() => parseSearchRoute(location.search), [location.search])
  const state = useSearchRuleFormState({
    routeState,
    routeSearch: location.search,
    enabledBroadcastWaves,
    encodeModes,
    settings,
    scrollHistory,
  })
  const queries = useSearchRuleQueries({
    apiRepository,
    routeState,
    routeKey: `${location.pathname}${location.search}`,
    settings,
    activeRequest: state.activeRequest,
  })
  const { ruleDetail, channelOptions, ruleReservesQuery, programs, reserveIndex } = queries
  const title = routeState.mode === 'rule-edit' ? 'ルール編集' : '検索'
  const isTimeSpecificationMode =
    routeState.mode === 'rule-edit'
      ? ruleDetail?.isTimeSpecification === true
      : state.isTimeSpecification
  const channelSelectOptions = mergeChannelSelectOptions({
    channelIds: state.form.channelIds,
    channelOptions,
    ruleDetail,
  })

  useSearchRuleRouteEffects({
    state,
    routeState,
    routeSearch: location.search,
    ruleDetail,
    enabledBroadcastWaves,
    encodeModes,
    settings,
  })
  useSearchResultEffects({ state, queries, routeState, settings, encodeModes, onSnackbar })
  const { submitSearch, clearSearch, submitRuleForm, scrollToRuleOption, scrollToTop } =
    useSearchRuleActions({
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
    })
  const ruleOptionForm = (buttonText: '追加' | '更新') => (
    <RuleOptionForm
      buttonText={buttonText}
      encodeModes={encodeModes}
      optionDraft={state.optionDraft}
      recordedDirectories={recordedDirectories}
      onOptionDraftChange={state.setOptionDraft}
      onSubmit={(event) => {
        void handleSubmit(submitRuleForm)(event)
      }}
    />
  )

  return (
    <>
      <TitleBar
        title={title}
        isNavigationOpen={isNavigationOpen}
        navigationControlsId={SHELL_NAVIGATION_DRAWER_ID}
        onNavigationClick={onNavigationClick}
      />
      <div className={styles.page} data-testid="search-rule-page">
        {state.selectedProgram === null ? null : (
          <ProgramDialog
            open={state.isProgramDialogOpen}
            program={toDialogProgram(state.selectedProgram)}
            reserveIndex={reserveIndex}
            settings={settings}
            detailSetting={state.detailSetting}
            encodeModes={encodeModes}
            onClose={(nextSetting) => {
              state.setDetailSetting(nextSetting)
              state.setProgramDialogOpen(false)
            }}
            onExited={() => state.setSelectedProgram(null)}
            onNavigate={(path) => navigate(path)}
            onSnackbar={onSnackbar}
            onAddReserve={async (payload) => {
              const result = await apiRepository.addProgramReserve(payload)

              return result.ok
            }}
            onDeleteReserve={async (reserveId) => {
              const result = await apiRepository.deleteReserve(reserveId)

              return result.ok
            }}
            onUnlockSkipReserve={async (reserveId) => {
              const result = await apiRepository.unlockSkipReserve(reserveId)

              return result.ok
            }}
            onUnlockOverlapReserve={async (reserveId) => {
              const result = await apiRepository.unlockOverlapReserve(reserveId)

              return result.ok
            }}
          />
        )}
        <section className={styles.form} aria-label="検索条件">
          <button
            aria-checked={isTimeSpecificationMode}
            className={styles.searchTimeToggle}
            disabled={routeState.mode === 'rule-edit'}
            role="switch"
            type="button"
            onClick={() => {
              state.setTimeSpecification((current) => !current)
              state.setActiveRequest(null)
            }}
          >
            <span className={styles.ruleSwitch} data-checked={String(isTimeSpecificationMode)} />
            <span>時刻指定</span>
          </button>
          {isTimeSpecificationMode ? (
            <TimeSpecifiedSearchForm
              channelOptions={channelOptions}
              timeReserveForm={state.timeReserveForm}
              setTimeReserveForm={state.setTimeReserveForm}
            />
          ) : (
            <SearchConditionForm
              form={state.form}
              setForm={state.setForm}
              enabledBroadcastWaves={enabledBroadcastWaves}
              channelSelectOptions={channelSelectOptions}
              keywordInputValueRef={state.keywordInputValueRef}
              ignoreKeywordInputValueRef={state.ignoreKeywordInputValueRef}
              isSubGenreVisible={state.isSubGenreVisible}
              setSubGenreVisible={state.setSubGenreVisible}
              submitSearch={submitSearch}
              clearSearch={clearSearch}
            />
          )}
        </section>

        {routeState.mode === 'search' && state.isTimeSpecification ? (
          <section className={styles.result} role="region" aria-label="時刻指定予約設定">
            {ruleOptionForm('追加')}
          </section>
        ) : ruleDetail?.isTimeSpecification === true ? (
          <TimeSpecifiedReserveSection
            reserves={ruleReservesQuery.data?.ok ? ruleReservesQuery.data.value : null}
            ruleOptionForm={ruleOptionForm('更新')}
            onSnackbar={onSnackbar}
          />
        ) : programs === null ? null : (
          <SearchResultSection
            programs={programs}
            reserveIndex={reserveIndex}
            resultRef={state.resultRef}
            ruleOptionRef={state.ruleOptionRef}
            ruleOptionForm={ruleOptionForm(routeState.mode === 'rule-edit' ? '更新' : '追加')}
            onProgramClick={(program) => {
              state.setSelectedProgram(program)
              state.setProgramDialogOpen(true)
            }}
            onScrollToRuleOption={scrollToRuleOption}
          />
        )}
        <button
          className={styles.scrollFab}
          type="button"
          aria-label="トップへ戻る"
          onClick={scrollToTop}
        >
          <span aria-hidden="true" className={styles.chevronUpIcon} />
        </button>
        <div className={styles.fabSpace} />
      </div>
    </>
  )
}
