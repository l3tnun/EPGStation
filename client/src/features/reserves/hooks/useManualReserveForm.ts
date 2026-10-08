import { useCallback, useMemo } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { createInitialFormState, type ManualReserveFormState } from '../lib/manualReserveForm'

export function useManualReserveForm() {
  const form = useForm<ManualReserveFormState>({
    defaultValues: createInitialFormState(),
  })
  const { control, reset, setValue } = form
  const watchedIsTimeSpecification = useWatch({ control, name: 'isTimeSpecification' }) ?? false
  const watchedName = useWatch({ control, name: 'timeSpecifiedOption.name' }) ?? null
  const watchedChannelId = useWatch({ control, name: 'timeSpecifiedOption.channelId' }) ?? null
  const watchedStartAt = useWatch({ control, name: 'timeSpecifiedOption.startAt' }) ?? null
  const watchedEndAt = useWatch({ control, name: 'timeSpecifiedOption.endAt' }) ?? null
  const watchedAllowEndLack = useWatch({ control, name: 'reserveOption.allowEndLack' }) ?? true
  const watchedSaveParentDirectoryName =
    useWatch({ control, name: 'saveOption.parentDirectoryName' }) ?? null
  const watchedSaveDirectory = useWatch({ control, name: 'saveOption.directory' }) ?? null
  const watchedRecordedFormat = useWatch({ control, name: 'saveOption.recordedFormat' }) ?? null
  const watchedEncodeMode1 = useWatch({ control, name: 'encodeOption.mode1' }) ?? null
  const watchedEncodeParentDirectoryName1 =
    useWatch({ control, name: 'encodeOption.encodeParentDirectoryName1' }) ?? null
  const watchedEncodeDirectory1 = useWatch({ control, name: 'encodeOption.directory1' }) ?? null
  const watchedEncodeMode2 = useWatch({ control, name: 'encodeOption.mode2' }) ?? null
  const watchedEncodeParentDirectoryName2 =
    useWatch({ control, name: 'encodeOption.encodeParentDirectoryName2' }) ?? null
  const watchedEncodeDirectory2 = useWatch({ control, name: 'encodeOption.directory2' }) ?? null
  const watchedEncodeMode3 = useWatch({ control, name: 'encodeOption.mode3' }) ?? null
  const watchedEncodeParentDirectoryName3 =
    useWatch({ control, name: 'encodeOption.encodeParentDirectoryName3' }) ?? null
  const watchedEncodeDirectory3 = useWatch({ control, name: 'encodeOption.directory3' }) ?? null
  const watchedIsDeleteOriginalAfterEncode =
    useWatch({ control, name: 'encodeOption.isDeleteOriginalAfterEncode' }) ?? false
  const watchedFormState = useMemo<ManualReserveFormState>(
    () => ({
      isTimeSpecification: watchedIsTimeSpecification,
      timeSpecifiedOption: {
        name: watchedName,
        channelId: watchedChannelId,
        startAt: watchedStartAt,
        endAt: watchedEndAt,
      },
      reserveOption: {
        allowEndLack: watchedAllowEndLack,
      },
      saveOption: {
        parentDirectoryName: watchedSaveParentDirectoryName,
        directory: watchedSaveDirectory,
        recordedFormat: watchedRecordedFormat,
      },
      encodeOption: {
        mode1: watchedEncodeMode1,
        encodeParentDirectoryName1: watchedEncodeParentDirectoryName1,
        directory1: watchedEncodeDirectory1,
        mode2: watchedEncodeMode2,
        encodeParentDirectoryName2: watchedEncodeParentDirectoryName2,
        directory2: watchedEncodeDirectory2,
        mode3: watchedEncodeMode3,
        encodeParentDirectoryName3: watchedEncodeParentDirectoryName3,
        directory3: watchedEncodeDirectory3,
        isDeleteOriginalAfterEncode: watchedIsDeleteOriginalAfterEncode,
      },
    }),
    [
      watchedAllowEndLack,
      watchedChannelId,
      watchedEncodeDirectory1,
      watchedEncodeDirectory2,
      watchedEncodeDirectory3,
      watchedEncodeMode1,
      watchedEncodeMode2,
      watchedEncodeMode3,
      watchedEncodeParentDirectoryName1,
      watchedEncodeParentDirectoryName2,
      watchedEncodeParentDirectoryName3,
      watchedEndAt,
      watchedIsDeleteOriginalAfterEncode,
      watchedIsTimeSpecification,
      watchedName,
      watchedRecordedFormat,
      watchedSaveDirectory,
      watchedSaveParentDirectoryName,
      watchedStartAt,
    ],
  )

  const replaceFormState = useCallback(
    (nextFormState: ManualReserveFormState) => {
      reset(nextFormState)
      setValue('isTimeSpecification', nextFormState.isTimeSpecification)
      setValue('timeSpecifiedOption.name', nextFormState.timeSpecifiedOption.name)
      setValue('timeSpecifiedOption.channelId', nextFormState.timeSpecifiedOption.channelId)
      setValue('timeSpecifiedOption.startAt', nextFormState.timeSpecifiedOption.startAt)
      setValue('timeSpecifiedOption.endAt', nextFormState.timeSpecifiedOption.endAt)
      setValue('reserveOption.allowEndLack', nextFormState.reserveOption.allowEndLack)
      if (nextFormState.saveOption !== undefined) {
        setValue(
          'saveOption.parentDirectoryName',
          nextFormState.saveOption.parentDirectoryName ?? null,
        )
        setValue('saveOption.directory', nextFormState.saveOption.directory ?? null)
        setValue('saveOption.recordedFormat', nextFormState.saveOption.recordedFormat ?? null)
      }
      setValue('encodeOption.mode1', nextFormState.encodeOption.mode1 ?? null)
      setValue(
        'encodeOption.encodeParentDirectoryName1',
        nextFormState.encodeOption.encodeParentDirectoryName1 ?? null,
      )
      setValue('encodeOption.directory1', nextFormState.encodeOption.directory1 ?? null)
      setValue('encodeOption.mode2', nextFormState.encodeOption.mode2 ?? null)
      setValue(
        'encodeOption.encodeParentDirectoryName2',
        nextFormState.encodeOption.encodeParentDirectoryName2 ?? null,
      )
      setValue('encodeOption.directory2', nextFormState.encodeOption.directory2 ?? null)
      setValue('encodeOption.mode3', nextFormState.encodeOption.mode3 ?? null)
      setValue(
        'encodeOption.encodeParentDirectoryName3',
        nextFormState.encodeOption.encodeParentDirectoryName3 ?? null,
      )
      setValue('encodeOption.directory3', nextFormState.encodeOption.directory3 ?? null)
      setValue(
        'encodeOption.isDeleteOriginalAfterEncode',
        nextFormState.encodeOption.isDeleteOriginalAfterEncode,
      )
    },
    [reset, setValue],
  )

  return { form, watchedFormState, replaceFormState }
}
