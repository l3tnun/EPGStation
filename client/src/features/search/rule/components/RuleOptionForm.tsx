import Button from '@mui/material/Button'
import type { FormEventHandler } from 'react'
import { parseNullableTextInput, parseNumberInput } from '../lib/inputParsers'
import type {
  SearchRuleEncodeOption,
  SearchRuleOptionDraft,
  SearchRuleReserveOption,
  SearchRuleSaveOption,
} from '../query'
import styles from '../SearchRulePage.module.css'
import { RuleOptionField } from './RuleOptionField'
import { SearchCheckbox } from './SearchCheckbox'

function EncodePanel({
  index,
  encodeModes,
  mode,
  parentDirectory,
  subDirectory,
  recordedDirectories,
  onChange,
}: {
  index: 1 | 2 | 3
  encodeModes: readonly string[]
  mode: string | null | undefined
  parentDirectory: string | null | undefined
  subDirectory: string | null | undefined
  recordedDirectories: readonly string[]
  onChange: (patch: Partial<SearchRuleEncodeOption>) => void
}) {
  const isOpen = index === 1 || (mode !== null && mode !== undefined)
  const patchByIndex = (
    key: 'mode' | 'encodeParentDirectoryName' | 'directory',
    value: string | null,
  ): Partial<SearchRuleEncodeOption> => {
    if (key === 'mode') {
      return index === 1 ? { mode1: value } : index === 2 ? { mode2: value } : { mode3: value }
    }
    if (key === 'encodeParentDirectoryName') {
      return index === 1
        ? { encodeParentDirectoryName1: value }
        : index === 2
          ? { encodeParentDirectoryName2: value }
          : { encodeParentDirectoryName3: value }
    }

    return index === 1
      ? { directory1: value }
      : index === 2
        ? { directory2: value }
        : { directory3: value }
  }

  return (
    <details className={styles.rulePanel} {...(isOpen ? { open: true } : {})}>
      <summary data-title={`エンコード${index}`}>
        <span className={styles.rulePanelTitle}>エンコード{index}</span>
      </summary>
      <div className={styles.rulePanelContent}>
        <RuleOptionField
          label={`mode${index}`}
          options={encodeModes}
          width="encode"
          value={mode ?? ''}
          onChange={(value) => onChange(patchByIndex('mode', parseNullableTextInput(value)))}
        />
        <RuleOptionField
          label={`directory${index}`}
          options={recordedDirectories}
          width="directory"
          value={parentDirectory ?? ''}
          onChange={(value) =>
            onChange(patchByIndex('encodeParentDirectoryName', parseNullableTextInput(value)))
          }
        />
        <RuleOptionField
          label={`sub directory${index}`}
          value={subDirectory ?? ''}
          wide
          onChange={(value) => onChange(patchByIndex('directory', parseNullableTextInput(value)))}
        />
      </div>
    </details>
  )
}

export function RuleOptionForm({
  buttonText,
  encodeModes,
  optionDraft,
  recordedDirectories,
  onOptionDraftChange,
  onSubmit,
}: {
  buttonText: '追加' | '更新'
  encodeModes: readonly string[]
  optionDraft: SearchRuleOptionDraft
  recordedDirectories: readonly string[]
  onOptionDraftChange: (draft: SearchRuleOptionDraft) => void
  onSubmit: FormEventHandler<HTMLFormElement>
}) {
  const { reserveOption, saveOption, encodeOption } = optionDraft
  const updateReserveOption = (patch: Partial<SearchRuleReserveOption>) =>
    onOptionDraftChange({
      ...optionDraft,
      reserveOption: { ...optionDraft.reserveOption, ...patch },
    })
  const updateSaveOption = (patch: Partial<SearchRuleSaveOption>) =>
    onOptionDraftChange({
      ...optionDraft,
      saveOption: { ...optionDraft.saveOption, ...patch },
    })
  const updateEncodeOption = (patch: Partial<SearchRuleEncodeOption>) => {
    if (optionDraft.encodeOption === undefined) {
      return
    }

    onOptionDraftChange({
      ...optionDraft,
      encodeOption: { ...optionDraft.encodeOption, ...patch },
    })
  }

  return (
    <form className={styles.ruleOptionCard} onSubmit={onSubmit}>
      <div className={styles.rulePanels}>
        <details className={styles.rulePanel} open>
          <summary data-title="オプション">
            <span className={styles.rulePanelTitle}>オプション</span>
          </summary>
          <div className={`${styles.rulePanelContent} ${styles.rulePanelOptionContent}`}>
            <SearchCheckbox
              checked={reserveOption.enable}
              label="有効"
              onChange={(checked) => updateReserveOption({ enable: checked })}
            />
            <SearchCheckbox
              checked={reserveOption.allowEndLack}
              label="状況に応じて末尾がかけることを許可"
              onChange={(checked) => updateReserveOption({ allowEndLack: checked })}
            />
          </div>
        </details>
        <details className={styles.rulePanel} open>
          <summary data-title="重複">
            <span className={styles.rulePanelTitle}>重複</span>
          </summary>
          <div className={styles.rulePanelContent}>
            <RuleOptionField
              label="日数"
              inputMode="numeric"
              width="period"
              value={String(reserveOption.periodToAvoidDuplicate ?? '')}
              onChange={(value) =>
                updateReserveOption({ periodToAvoidDuplicate: parseNumberInput(value) })
              }
            />
            <SearchCheckbox
              checked={reserveOption.avoidDuplicate}
              label="録画済み番組を排除"
              onChange={(checked) => updateReserveOption({ avoidDuplicate: checked })}
            />
          </div>
        </details>
        <details className={styles.rulePanel} open>
          <summary data-title="ディレクトリ">
            <span className={styles.rulePanelTitle}>ディレクトリ</span>
          </summary>
          <div className={styles.rulePanelContent}>
            <RuleOptionField
              label="directory"
              options={recordedDirectories}
              width="directory"
              value={saveOption.parentDirectoryName ?? ''}
              onChange={(value) =>
                updateSaveOption({ parentDirectoryName: parseNullableTextInput(value) })
              }
            />
            <RuleOptionField
              label="sub directory"
              value={saveOption.directory ?? ''}
              wide
              onChange={(value) => updateSaveOption({ directory: parseNullableTextInput(value) })}
            />
          </div>
        </details>
        <details className={styles.rulePanel} open>
          <summary data-title="ファイル名形式">
            <span className={styles.rulePanelTitle}>ファイル名形式</span>
          </summary>
          <div className={styles.rulePanelContent}>
            <RuleOptionField
              label="file format"
              value={saveOption.recordedFormat ?? ''}
              wide
              onChange={(value) =>
                updateSaveOption({ recordedFormat: parseNullableTextInput(value) })
              }
            />
          </div>
        </details>
        {encodeModes.length === 0 ? null : (
          <>
            <EncodePanel
              index={1}
              encodeModes={encodeModes}
              mode={encodeOption?.mode1}
              parentDirectory={encodeOption?.encodeParentDirectoryName1}
              subDirectory={encodeOption?.directory1}
              recordedDirectories={recordedDirectories}
              onChange={updateEncodeOption}
            />
            <EncodePanel
              index={2}
              encodeModes={encodeModes}
              mode={encodeOption?.mode2}
              parentDirectory={encodeOption?.encodeParentDirectoryName2}
              subDirectory={encodeOption?.directory2}
              recordedDirectories={recordedDirectories}
              onChange={updateEncodeOption}
            />
            <EncodePanel
              index={3}
              encodeModes={encodeModes}
              mode={encodeOption?.mode3}
              parentDirectory={encodeOption?.encodeParentDirectoryName3}
              subDirectory={encodeOption?.directory3}
              recordedDirectories={recordedDirectories}
              onChange={updateEncodeOption}
            />
            <details className={styles.rulePanel} open>
              <summary data-title="ファイル削除">
                <span className={styles.rulePanelTitle}>ファイル削除</span>
              </summary>
              <div className={styles.rulePanelContent}>
                <SearchCheckbox
                  checked={encodeOption?.isDeleteOriginalAfterEncode ?? false}
                  label="元ファイルの自動削除"
                  onChange={(checked) =>
                    updateEncodeOption({ isDeleteOriginalAfterEncode: checked })
                  }
                />
              </div>
            </details>
          </>
        )}
      </div>
      <div className={styles.ruleOptionActions}>
        <Button color="error" variant="text" type="button" onClick={() => history.back()}>
          キャンセル
        </Button>
        <Button variant="text" type="submit">
          {buttonText}
        </Button>
      </div>
    </form>
  )
}
