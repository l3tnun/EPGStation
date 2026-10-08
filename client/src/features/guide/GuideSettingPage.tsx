import Button from '@mui/material/Button'
import { useState } from 'react'
import { SHELL_NAVIGATION_DRAWER_ID, type ShellSnackbarState } from '@/app/AppShell'
import { useScrollHistoryPageReady } from '@/app/scrollHistory'
import { TitleBar } from '@/app/titleBar'
import { AppSelect } from '@/shared/AppSelect'
import {
  DEFAULT_GUIDE_SIZE_SETTING,
  normalizeGuideSizeSetting,
  readGuideSizeSetting,
  writeGuideSizeSetting,
  type GuideSizeSetting,
} from './guideStorage'
import { getBrowserLocalStorage } from './lib/guidePageState'
import {
  GUIDE_SIZE_FIELDS,
  createNumberOptions,
  type GuideSizeField,
  type GuideSizeFieldDefinition,
  type GuideSizeSection,
} from './lib/guideSizeSettingForm'
import styles from './GuidePage.module.css'

export interface GuideSettingPageProps {
  isNavigationOpen: boolean
  onNavigationClick: () => void
  onSnackbar: (snackbar: ShellSnackbarState) => void
}

function GuideSizeNumberInput({
  section,
  sectionLabel,
  definition,
  value,
  onChange,
}: {
  section: GuideSizeSection
  sectionLabel: string
  definition: GuideSizeFieldDefinition
  value: number
  onChange: (section: GuideSizeSection, field: GuideSizeField, value: number) => void
}) {
  const label = `${sectionLabel} ${definition.label}`
  const options = createNumberOptions(definition.min, definition.max, definition.step)

  return (
    <label className={styles.settingField}>
      <span>{definition.label}</span>
      <AppSelect
        className={styles.guideSizeSelect}
        wrapperClassName={styles.guideSizeSelectWrapper}
        ariaLabel={label}
        value={String(value)}
        options={options.map((option) => ({
          label: definition.step === 0.5 ? option.toFixed(1) : option,
          value: String(option),
        }))}
        onChange={(nextValue) => onChange(section, definition.field, Number(nextValue))}
      />
    </label>
  )
}

export function GuideSettingPage({
  isNavigationOpen,
  onNavigationClick,
  onSnackbar,
}: GuideSettingPageProps) {
  useScrollHistoryPageReady(true)
  const [draft, setDraft] = useState<GuideSizeSetting>(() =>
    readGuideSizeSetting(getBrowserLocalStorage()),
  )
  const updateDraft = (section: GuideSizeSection, field: GuideSizeField, value: number) => {
    setDraft((current) => ({
      ...current,
      [section]: {
        ...current[section],
        [field]: Number.isFinite(value) ? value : current[section][field],
      },
    }))
  }
  const resetDraft = () => {
    setDraft({
      tablet: { ...DEFAULT_GUIDE_SIZE_SETTING.tablet },
      mobile: { ...DEFAULT_GUIDE_SIZE_SETTING.mobile },
    })
  }
  const saveDraft = () => {
    const normalizedDraft = normalizeGuideSizeSetting(draft)

    setDraft(normalizedDraft)
    writeGuideSizeSetting(getBrowserLocalStorage(), normalizedDraft)
    onSnackbar({
      text: '保存されました',
      severity: 'success',
    })
  }

  return (
    <>
      <TitleBar
        title="番組表設定"
        isNavigationOpen={isNavigationOpen}
        navigationControlsId={SHELL_NAVIGATION_DRAWER_ID}
        onNavigationClick={onNavigationClick}
      />
      <section data-testid="guide-setting-page" className={styles.settingPage}>
        <form className={styles.settingForm}>
          {[
            ['tablet', '通常表示'],
            ['mobile', 'モバイル表示'],
          ].map(([section, sectionLabel]) => (
            <div key={section} className={styles.settingFieldset}>
              <div className={styles.settingLegend}>{sectionLabel}</div>
              {GUIDE_SIZE_FIELDS.map((definition) => (
                <GuideSizeNumberInput
                  key={definition.field}
                  section={section as GuideSizeSection}
                  sectionLabel={sectionLabel}
                  definition={definition}
                  value={draft[section as GuideSizeSection][definition.field]}
                  onChange={updateDraft}
                />
              ))}
            </div>
          ))}
          <div className={styles.settingActions}>
            <Button type="button" variant="text" color="inherit" onClick={resetDraft}>
              リセット
            </Button>
            <Button type="button" variant="text" color="primary" onClick={saveDraft}>
              保存
            </Button>
          </div>
        </form>
      </section>
    </>
  )
}
