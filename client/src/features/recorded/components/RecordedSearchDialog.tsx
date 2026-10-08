import Autocomplete from '@mui/material/Autocomplete'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import DialogActions from '@mui/material/DialogActions'
import FormControlLabel from '@mui/material/FormControlLabel'
import Menu from '@mui/material/Menu'
import TextField from '@mui/material/TextField'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import { ClearableTextField } from '@/shared/ClearableTextField'
import { AppSelect } from '@/shared/AppSelect'
import type {
  RecordedApiRepository,
  RecordedRuleKeywordItem,
  RecordedSearchOptions,
} from '../recordedApi'
import {
  RECORDED_SEARCH_OPTIONS_FAILURE_MESSAGE,
  buildRecordedSearchPath,
} from '../recordedRequests'
import styles from '../RecordedPage.module.css'
import { parseOptionalNumber } from '../lib/recordedRoute'
import { openSnackbar } from '../lib/recordedSnackbar'
import { resolveRecordedSearchChannelLabel } from '../lib/recordedFormat'

export function RecordedSearchDialog({
  anchorEl,
  search,
  apiRepository,
  isHalfWidthDisplayed,
  onClose,
  onNavigate,
  onSnackbar,
}: {
  anchorEl: HTMLElement | null
  search: string
  apiRepository: RecordedApiRepository
  isHalfWidthDisplayed: boolean
  onClose: () => void
  onNavigate: (path: string) => void
  onSnackbar: (snackbar: ShellSnackbarState) => void
}) {
  const open = anchorEl !== null
  const parameters = useMemo(() => new URLSearchParams(search), [search])
  const [keyword, setKeyword] = useState('')
  const [ruleId, setRuleId] = useState<number | null>(null)
  const [channelId, setChannelId] = useState<number | null>(null)
  const [genre, setGenre] = useState<number | null>(null)
  const [hasOriginalFile, setHasOriginalFile] = useState(false)
  const [isManualOnly, setManualOnly] = useState(false)
  const [searchOptions, setSearchOptions] = useState<RecordedSearchOptions>({
    channels: [],
    genres: [],
  })
  const [ruleItems, setRuleItems] = useState<readonly RecordedRuleKeywordItem[]>([])
  const [ruleInputValue, setRuleInputValue] = useState('')
  const keywordInputRef = useRef<HTMLInputElement | null>(null)
  const ruleFetchSequence = useRef(0)
  const isCancelledRef = useRef(false)

  useEffect(
    () => () => {
      isCancelledRef.current = true
    },
    [],
  )

  useEffect(() => {
    const currentRuleId = parseOptionalNumber(parameters.get('ruleId'))
    // Route changes reset the search form to the current query contract.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setKeyword(parameters.get('keyword') ?? '')
    setRuleId(currentRuleId)
    setChannelId(parseOptionalNumber(parameters.get('channelId')))
    setGenre(parseOptionalNumber(parameters.get('genre')))
    setHasOriginalFile(parameters.get('hasOriginalFile') === 'true')
    setManualOnly(currentRuleId === 0)
  }, [parameters])

  useEffect(() => {
    if (!open) return
    window.setTimeout(() => keywordInputRef.current?.focus(), 0)
    void (async () => {
      const options = await apiRepository.fetchRecordedOptions()
      const rules = await apiRepository.fetchRuleKeywords()

      if (!options.ok || !rules.ok) {
        openSnackbar(onSnackbar, RECORDED_SEARCH_OPTIONS_FAILURE_MESSAGE, 'error')
        return
      }
      setSearchOptions(options.value)
      setRuleItems(rules.value)
    })()
  }, [apiRepository, onSnackbar, open])

  useEffect(() => {
    const currentRuleId = parseOptionalNumber(parameters.get('ruleId'))
    if (currentRuleId === null || currentRuleId === 0) {
      return
    }
    if (ruleItems.some((rule) => rule.id === currentRuleId)) {
      return
    }
    void (async () => {
      const result = await apiRepository.fetchRule(currentRuleId)
      if (!result.ok) {
        console.error('Recorded rule fetch failed', {
          ruleId: currentRuleId,
          message: result.message,
        })
        return
      }
      setRuleItems((current) =>
        current.some((rule) => rule.id === result.value.id)
          ? current
          : [...current, { id: result.value.id, keyword: result.value.keyword ?? '' }],
      )
    })()
  }, [apiRepository, parameters, ruleItems])

  // Reflects the route-selected rule's keyword into the input once it is available in
  // ruleItems. Guarded by `ruleId === currentRuleId` so it never overwrites text the user is
  // actively typing (typing sets `ruleId` to null, which fails this guard).
  useEffect(() => {
    const currentRuleId = parseOptionalNumber(parameters.get('ruleId'))
    if (currentRuleId === null || currentRuleId === 0 || ruleId !== currentRuleId) {
      return
    }
    const match = ruleItems.find((rule) => rule.id === currentRuleId)
    if (match === undefined) {
      return
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRuleInputValue(match.keyword)
  }, [parameters, ruleItems, ruleId])

  const fetchRuleItemsForInput = async (value: string) => {
    const sequence = ruleFetchSequence.current + 1
    ruleFetchSequence.current = sequence
    const result = await apiRepository.fetchRuleKeywords(value)

    if (isCancelledRef.current || ruleFetchSequence.current !== sequence) {
      return
    }

    if (result.ok) {
      setRuleItems(result.value)
    }
    // 入力駆動の取得失敗は snackbar を出さない。v2 の RecordedSearchMenu.vue も
    // `@Watch('search')` から呼ぶ `updateRuleItems()` の失敗を catch しておらず、
    // 1 文字ごとに snackbar が出て入力を妨げることを避けるため、通知は
    // dialog open 時の初回取得だけに絞る。
  }

  const submit = () => {
    const path = buildRecordedSearchPath({
      keyword,
      ruleId: isManualOnly ? 0 : ruleId,
      channelId,
      genre,
      hasOriginalFile,
    })
    onClose()
    onNavigate(path)
  }
  const submitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      submit()
    }
  }

  return (
    <Menu
      anchorEl={anchorEl}
      anchorOrigin={{
        vertical: 'top',
        horizontal: 'right',
      }}
      disableAutoFocusItem
      open={open}
      onClose={onClose}
      transformOrigin={{
        vertical: 'top',
        horizontal: 'right',
      }}
      slotProps={{
        list: {
          'aria-label': '録画検索',
          sx: { p: 0 },
        },
        paper: {
          sx: {
            maxWidth: 'calc(100vw - 32px)',
            transform: {
              xs: 'translateX(-8px) !important',
              sm: 'translateX(-27px) !important',
            },
            width: 400,
            '@media (max-width: 430px)': {
              transform: 'translate(-8px, -4px) !important',
              width: 312,
            },
          },
        },
      }}
    >
      <div className={styles.recordedSearchMenu} role="presentation">
        <div className={styles.recordedSearchFields}>
          <ClearableTextField
            autoFocus
            fullWidth
            inputRef={keywordInputRef}
            label="キーワード"
            variant="standard"
            value={keyword}
            onClear={() => setKeyword('')}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={submitOnEnter}
          />
          <div className={styles.recordedSearchSelectField}>
            <Autocomplete
              fullWidth
              openOnFocus
              disabled={isManualOnly}
              options={ruleItems}
              getOptionLabel={(rule) => rule.keyword}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              inputValue={ruleInputValue}
              value={ruleItems.find((rule) => rule.id === ruleId) ?? null}
              clearText="ルールをクリア"
              // AC35 (frontend-recorded): the clear action is visible whenever the field has a
              // selected value and is enabled, matching the other search selects' clear buttons.
              // MUI's default only reveals it on hover/focus; override so it is always shown.
              sx={{ '& .MuiAutocomplete-clearIndicator': { visibility: 'visible' } }}
              onChange={(_, rule) => {
                setRuleId(rule?.id ?? null)
                setRuleInputValue(rule?.keyword ?? '')
              }}
              onInputChange={(_, value, reason) => {
                setRuleInputValue(value)
                if (reason === 'input') {
                  setRuleId(null)
                  void fetchRuleItemsForInput(value)
                }
              }}
              renderInput={(autocompleteParams) => (
                <TextField {...autocompleteParams} variant="standard" label="ルール" />
              )}
            />
            <span aria-hidden="true" />
          </div>
          <div className={styles.recordedSearchSelectField}>
            <label
              className={styles.recordedSearchLegacySelect}
              data-has-value={channelId !== null}
            >
              <span>放送局</span>
              <AppSelect
                ariaLabel="放送局"
                value={channelId ?? ''}
                clearable
                showEmptyOptionLabel
                options={[
                  { label: '放送局', value: '', hidden: true },
                  ...searchOptions.channels.map((channel) => ({
                    label: resolveRecordedSearchChannelLabel(channel, isHalfWidthDisplayed),
                    value: channel.id,
                  })),
                ]}
                onChange={(value) => setChannelId(parseOptionalNumber(value))}
                onClear={() => setChannelId(null)}
              />
            </label>
            <span aria-hidden="true" />
          </div>
          <div className={styles.recordedSearchSelectField}>
            <label className={styles.recordedSearchLegacySelect} data-has-value={genre !== null}>
              <span>ジャンル</span>
              <AppSelect
                ariaLabel="ジャンル"
                value={genre ?? ''}
                clearable
                showEmptyOptionLabel
                options={[
                  { label: 'ジャンル', value: '', hidden: true },
                  ...searchOptions.genres.map((item) => ({ label: item.name, value: item.id })),
                ]}
                onChange={(value) => setGenre(parseOptionalNumber(value))}
                onClear={() => setGenre(null)}
              />
            </label>
            <span aria-hidden="true" />
          </div>
          <div className={styles.recordedSearchChecks}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={hasOriginalFile}
                  onChange={(event) => setHasOriginalFile(event.target.checked)}
                />
              }
              label="元ファイルを含む"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={isManualOnly}
                  onChange={(event) => setManualOnly(event.target.checked)}
                />
              }
              label="手動録画のみ"
            />
          </div>
        </div>
        <DialogActions className={styles.recordedSearchActions}>
          <Button color="error" onClick={onClose}>
            閉じる
          </Button>
          <Button onClick={submit}>検索</Button>
        </DialogActions>
      </div>
    </Menu>
  )
}
