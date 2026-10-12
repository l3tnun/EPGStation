import IconButton from '@mui/material/IconButton'
import type { ReactNode, RefObject } from 'react'
import type { GuideReserveIndex } from '@/features/guide/guideRequests'
import type { SearchProgram } from '../api'
import { programMeta, programName } from '../lib/programDisplay'
import styles from '../SearchRulePage.module.css'

export function SearchResultSection({
  programs,
  reserveIndex,
  resultRef,
  ruleOptionRef,
  ruleOptionForm,
  onProgramClick,
  onScrollToRuleOption,
}: {
  programs: readonly SearchProgram[]
  reserveIndex: GuideReserveIndex
  resultRef: RefObject<HTMLElement | null>
  ruleOptionRef: RefObject<HTMLDivElement | null>
  ruleOptionForm: ReactNode
  onProgramClick: (program: SearchProgram) => void
  onScrollToRuleOption: () => void
}) {
  return (
    <section ref={resultRef} className={styles.result} role="region" aria-label="検索結果">
      <div className={styles.resultHeader}>
        <IconButton aria-label="録画設定へ移動" size="small" onClick={onScrollToRuleOption}>
          <span aria-hidden="true" className={styles.linkIcon} />
        </IconButton>
        <div>{programs.length} 件ヒット</div>
      </div>
      <div className={styles.resultList} role="list" aria-label="検索結果一覧">
        {programs.map((program) => (
          <div key={program.id} role="listitem">
            <button
              className={styles.resultItem}
              type="button"
              aria-label={programName(program)}
              data-reserve-state={reserveIndex[program.id]?.type}
              onClick={() => onProgramClick(program)}
            >
              <span className={styles.programName} data-search-result-text="title">
                {programName(program)}
              </span>
              <span className={styles.programMeta} data-search-result-text="meta">
                {programMeta(program)}
              </span>
              {program.description === undefined ? null : (
                <span className={styles.programDescription} data-search-result-text="description">
                  {program.description}
                </span>
              )}
            </button>
          </div>
        ))}
      </div>
      <div ref={ruleOptionRef} data-testid="search-rule-option-anchor">
        {ruleOptionForm}
      </div>
    </section>
  )
}
