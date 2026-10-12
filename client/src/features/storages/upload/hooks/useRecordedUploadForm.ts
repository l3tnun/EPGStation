import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import type { ShellSnackbarState } from '@/app/AppShell'
import { useScrollHistory } from '@/app/scrollHistory'
import type {
  RecordedApiRepository,
  RecordedRuleKeywordItem,
  RecordedSearchOptions,
} from '../../../recorded/recordedApi'
import {
  RECORDED_RULE_KEYWORDS_FAILURE_MESSAGE,
  createInitialRecordedUploadFormState,
  createRecordedUploadVideoBlock,
} from '../../../recorded/recordedRequests'
import type {
  RecordedUploadFormState,
  RecordedUploadVideoBlockState,
} from '../../../recorded/recordedRequests'
import { openSnackbar } from '../../../recorded/lib/recordedSnackbar'
import { createSubGenreItems } from '../lib/uploadFormat'

export interface UseRecordedUploadFormInput {
  apiRepository: RecordedApiRepository
  recordedDirectories: readonly string[]
  onSnackbar: (snackbar: ShellSnackbarState) => void
}

export function useRecordedUploadForm({
  apiRepository,
  recordedDirectories,
  onSnackbar,
}: UseRecordedUploadFormInput) {
  const scrollHistory = useScrollHistory()
  const [options, setOptions] = useState<RecordedSearchOptions>({ channels: [], genres: [] })
  const [ruleItems, setRuleItems] = useState<readonly RecordedRuleKeywordItem[]>([])
  const [ruleInputValue, setRuleInputValue] = useState('')
  const [datetimePickerGeneration, setDatetimePickerGeneration] = useState(0)
  const [fileInputGeneration, setFileInputGeneration] = useState(0)
  const ruleFetchSequence = useRef(0)
  const hasTypedRuleInput = useRef(false)
  const initialFormState = useMemo(
    () => createInitialRecordedUploadFormState(recordedDirectories),
    [recordedDirectories],
  )
  const { control, reset, setValue } = useForm<RecordedUploadFormState>({
    defaultValues: initialFormState,
  })
  const watchedFormState = useWatch({ control })
  const formState: RecordedUploadFormState = {
    ...initialFormState,
    ...watchedFormState,
    videoBlocks:
      (watchedFormState.videoBlocks as RecordedUploadVideoBlockState[] | undefined) ??
      initialFormState.videoBlocks,
  }
  const videoBlocks = formState.videoBlocks
  const selectedGenre = formState.genre ?? null
  const subGenreItems = createSubGenreItems(selectedGenre)

  const replaceFormState = useCallback(
    (nextState: RecordedUploadFormState) => {
      reset(nextState)
      setValue('channelId', nextState.channelId)
      setValue('genre', nextState.genre)
      setValue('subGenre', nextState.subGenre)
      setValue('ruleId', nextState.ruleId)
      setValue('startAt', nextState.startAt)
      setValue('duration', nextState.duration)
      setValue('name', nextState.name)
      setValue('description', nextState.description)
      setValue('extended', nextState.extended)
      setValue('videoBlocks', nextState.videoBlocks)
    },
    [reset, setValue],
  )

  useEffect(() => {
    let isCancelled = false

    replaceFormState(initialFormState)
    void (async () => {
      const optionsResult = await (
        apiRepository.fetchRecordedUploadOptions ?? apiRepository.fetchRecordedOptions
      )()

      if (isCancelled) {
        return
      }

      if (optionsResult.ok) {
        setOptions(optionsResult.value)
      }
      scrollHistory.emitDoneGetData()
    })()

    return () => {
      isCancelled = true
    }
  }, [apiRepository, initialFormState, onSnackbar, replaceFormState, scrollHistory])

  useEffect(() => {
    let isCancelled = false

    void (async () => {
      const rulesResult = await apiRepository.fetchRuleKeywords()

      if (isCancelled) {
        return
      }

      if (rulesResult.ok) {
        if (!hasTypedRuleInput.current) {
          setRuleItems(rulesResult.value)
        }
      } else {
        openSnackbar(onSnackbar, RECORDED_RULE_KEYWORDS_FAILURE_MESSAGE, 'error')
      }
    })()

    return () => {
      isCancelled = true
    }
  }, [apiRepository, onSnackbar])

  const fetchRuleItemsForInput = async (keyword: string) => {
    hasTypedRuleInput.current = true
    const sequence = ruleFetchSequence.current + 1
    ruleFetchSequence.current = sequence
    const result = await apiRepository.fetchRuleKeywords(keyword)

    if (ruleFetchSequence.current !== sequence) {
      return
    }

    if (result.ok) {
      setRuleItems(result.value)
    }
    // 入力駆動の取得失敗は通知しない。v2 の `RecordedUpload.vue` は route 初期化時の
    // `fetchData()` だけを catch して `ルール情報取得に失敗` を出し、入力のたびに走る
    // `updateRuleItems()` は catch せず未処理 rejection にしている。文字を打つたびに
    // snackbar が出ると入力を妨げるため、通知は route 初期化時だけに絞る。
  }

  const resetForm = () => {
    replaceFormState(initialFormState)
    setDatetimePickerGeneration((current) => current + 1)
    setFileInputGeneration((current) => current + 1)
    setRuleInputValue('')
  }

  const addVideoBlock = () => {
    const nextId = videoBlocks.reduce((max, block) => Math.max(max, block.id), -1) + 1
    setValue('videoBlocks', [
      ...videoBlocks,
      createRecordedUploadVideoBlock({ id: nextId, recordedDirectories }),
    ])
  }

  const updateVideoBlock = (
    index: number,
    nextBlock: RecordedUploadFormState['videoBlocks'][number],
  ) => {
    setValue(
      'videoBlocks',
      videoBlocks.map((block, currentIndex) => (currentIndex === index ? nextBlock : block)),
    )
  }

  return {
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
  }
}
