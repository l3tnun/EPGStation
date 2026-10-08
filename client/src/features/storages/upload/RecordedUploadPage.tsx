import Autocomplete from '@mui/material/Autocomplete'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import Fab from '@mui/material/Fab'
import LinearProgress from '@mui/material/LinearProgress'
import TextField from '@mui/material/TextField'
import { useNavigate } from 'react-router-dom'

import { SHELL_NAVIGATION_DRAWER_ID } from '@/app/AppShell'
import type { ShellSnackbarState } from '@/app/AppShell'

import { TitleBar } from '@/app/titleBar'
import { ClearableTextField } from '@/shared/ClearableTextField'
import type { RecordedApiRepository } from '../../recorded/recordedApi'

import styles from './RecordedUploadPage.module.css'

import { RecordedUploadDatetimePicker } from './components/RecordedUploadDatetimePicker'
import {
  createUploadChannelOption,
  createUploadGenreOption,
  nullableString,
  parseNullableNumber,
  valueFromNullableNumber,
} from './lib/uploadFormat'
import { RecordedUploadVideoBlock } from './components/RecordedUploadVideoBlock'
import { UploadSelect } from './components/UploadSelect'
import { useRecordedUploadForm } from './hooks/useRecordedUploadForm'
import { useRecordedUploadRun } from './hooks/useRecordedUploadRun'

export interface RecordedUploadPageProps {
  isNavigationOpen: boolean
  onNavigationClick: () => void
  isHalfWidthDisplayed: boolean
  apiRepository: RecordedApiRepository
  recordedDirectories: readonly string[]
  onSnackbar: (snackbar: ShellSnackbarState) => void
  suppressRouteSnackbarClose: (count: number) => void
}

export function RecordedUploadPage({
  isNavigationOpen,
  onNavigationClick,
  isHalfWidthDisplayed,
  apiRepository,
  recordedDirectories,
  onSnackbar,
  suppressRouteSnackbarClose,
}: RecordedUploadPageProps) {
  const {
    formState,
    videoBlocks,
    subGenreItems,
    options,
    ruleItems,
    ruleInputValue,
    setRuleInputValue,
    datetimePickerGeneration,
    fileInputGeneration,
    setValue,
    fetchRuleItemsForInput,
    resetForm,
    addVideoBlock,
    updateVideoBlock,
  } = useRecordedUploadForm({ apiRepository, recordedDirectories, onSnackbar })
  const navigate = useNavigate()
  const { isSubmitting, isUploadingDialogOpen, isUploadingDialogMounted, submit } =
    useRecordedUploadRun({ apiRepository, onSnackbar, navigate, suppressRouteSnackbarClose })

  return (
    <>
      <TitleBar
        title="アップロード"
        isNavigationOpen={isNavigationOpen}
        navigationControlsId={SHELL_NAVIGATION_DRAWER_ID}
        onNavigationClick={onNavigationClick}
      />
      <form
        className={styles.uploadPage}
        data-testid="recorded-upload-page"
        data-video-block-count={videoBlocks.length}
        data-datetime-picker-generation={datetimePickerGeneration}
        data-selected-rule-id={formState.ruleId ?? ''}
        onSubmit={(event) => {
          event.preventDefault()
          void submit(formState)
        }}
      >
        <div className={styles.formRows}>
          <div className={styles.formRow}>
            <div className={`${styles.rowTitle} ${styles.requiredTitle}`}>放送局※</div>
            <div className={styles.rowContent}>
              <UploadSelect
                label="channel"
                ariaLabel="放送局※"
                value={valueFromNullableNumber(formState.channelId)}
                inputProps={{ 'data-is-half-width': String(isHalfWidthDisplayed) }}
                options={[
                  { value: '', label: 'channel', hidden: true },
                  ...options.channels.flatMap((channel) => {
                    const option = createUploadChannelOption(channel, isHalfWidthDisplayed)
                    return option === null ? [] : [option]
                  }),
                ]}
                onChange={(value) => setValue('channelId', parseNullableNumber(value))}
                onClear={() => setValue('channelId', null)}
              />
            </div>
          </div>
          <div className={styles.formRow}>
            <div className={styles.rowTitle}>ジャンル</div>
            <div className={`${styles.rowContent} ${styles.genreFields}`}>
              <UploadSelect
                label="genre"
                value={valueFromNullableNumber(formState.genre)}
                options={[
                  { value: '', label: 'genre', hidden: true },
                  ...options.genres.map(createUploadGenreOption),
                ]}
                onChange={(value) => {
                  setValue('genre', parseNullableNumber(value))
                  setValue('subGenre', null)
                }}
                onClear={() => {
                  setValue('genre', null)
                  setValue('subGenre', null)
                }}
              />
              <UploadSelect
                label="sub genre"
                value={valueFromNullableNumber(formState.subGenre)}
                options={[
                  { value: '', label: 'sub genre', hidden: true },
                  ...subGenreItems.map((genre) => ({ value: genre.id, label: genre.name })),
                ]}
                onChange={(value) => setValue('subGenre', parseNullableNumber(value))}
                onClear={() => setValue('subGenre', null)}
              />
            </div>
          </div>
          <div className={styles.formRow}>
            <div className={styles.rowTitle}>ルール</div>
            <div className={styles.rowContent}>
              <Autocomplete
                openOnFocus
                options={ruleItems}
                getOptionLabel={(option) => option.keyword}
                inputValue={ruleInputValue}
                value={ruleItems.find((item) => item.id === formState.ruleId) ?? null}
                onChange={(_, item) => {
                  setValue('ruleId', item?.id ?? null)
                  setRuleInputValue(item?.keyword ?? '')
                }}
                onInputChange={(_, value, reason) => {
                  setRuleInputValue(value)
                  if (reason === 'input') {
                    setValue('ruleId', null)
                    void fetchRuleItemsForInput(value)
                  }
                }}
                renderInput={(params) => (
                  <TextField {...params} variant="standard" label="ルール" />
                )}
              />
            </div>
          </div>
          <div className={`${styles.formRow} ${styles.dateRow}`}>
            <div className={`${styles.rowTitle} ${styles.requiredTitle}`}>日付※</div>
            <div className={styles.rowContent}>
              <RecordedUploadDatetimePicker
                key={datetimePickerGeneration}
                generation={datetimePickerGeneration}
                value={formState.startAt ?? null}
                onChange={(value) => setValue('startAt', value)}
              />
            </div>
          </div>
          <div className={styles.formRow}>
            <div className={`${styles.rowTitle} ${styles.requiredTitle}`}>長さ※</div>
            <div className={styles.rowContent}>
              <ClearableTextField
                variant="standard"
                label="長さ(分)"
                slotProps={{
                  htmlInput: {
                    'aria-label': '長さ※',
                  },
                }}
                value={valueFromNullableNumber(formState.duration)}
                onClear={() => setValue('duration', null)}
                inputMode="numeric"
                onChange={(event) => setValue('duration', parseNullableNumber(event.target.value))}
              />
            </div>
          </div>
          <div className={styles.formRow}>
            <div className={`${styles.rowTitle} ${styles.requiredTitle}`}>番組名※</div>
            <div className={styles.rowContent}>
              <ClearableTextField
                variant="standard"
                label="name"
                slotProps={{
                  htmlInput: {
                    'aria-label': '番組名※',
                  },
                }}
                value={formState.name ?? ''}
                onClear={() => setValue('name', null)}
                onChange={(event) => setValue('name', nullableString(event.target.value))}
              />
            </div>
          </div>
          <div className={styles.formRow}>
            <div className={styles.rowTitle}>概要</div>
            <div className={styles.rowContent}>
              <ClearableTextField
                variant="standard"
                multiline
                rows={3}
                label="description"
                value={formState.description ?? ''}
                onClear={() => setValue('description', null)}
                onChange={(event) => setValue('description', nullableString(event.target.value))}
              />
            </div>
          </div>
          <div className={styles.formRow}>
            <div className={styles.rowTitle}>詳細</div>
            <div className={styles.rowContent}>
              <ClearableTextField
                variant="standard"
                className={styles.extendedField}
                label="extended"
                multiline
                rows={3}
                value={formState.extended ?? ''}
                onClear={() => setValue('extended', null)}
                onChange={(event) => setValue('extended', nullableString(event.target.value))}
              />
            </div>
          </div>
        </div>
        <div className={styles.videoBlocks}>
          {videoBlocks.map((block, index) => (
            <RecordedUploadVideoBlock
              key={block.id}
              index={index}
              block={block}
              recordedDirectories={recordedDirectories}
              fileInputGeneration={fileInputGeneration}
              onChange={(nextBlock) => updateVideoBlock(index, nextBlock)}
            />
          ))}
        </div>
        <div className={styles.fabRow}>
          <Fab
            type="button"
            aria-label="動画ファイルを追加"
            className={styles.addVideoFab}
            onClick={addVideoBlock}
          >
            <span className={styles.mdiIcon} aria-hidden="true">
              +
            </span>
          </Fab>
        </div>
        <div className={styles.actions}>
          <Button
            type="button"
            variant="text"
            color="error"
            disabled={isSubmitting}
            onClick={resetForm}
          >
            リセット
          </Button>
          <Button type="submit" variant="text" color="primary" disabled={isSubmitting}>
            アップロード
          </Button>
        </div>
      </form>
      {isUploadingDialogMounted ? (
        <Dialog
          open={isUploadingDialogOpen}
          aria-labelledby="recorded-uploading-dialog-title"
          onClose={() => undefined}
        >
          <DialogContent className={styles.uploadingDialogContent}>
            <h3 id="recorded-uploading-dialog-title" className={styles.uploadingDialogTitle}>
              アップロード中
            </h3>
            <LinearProgress aria-label="アップロード進捗" />
          </DialogContent>
        </Dialog>
      ) : undefined}
    </>
  )
}
