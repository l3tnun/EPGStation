import { useEffect, useRef, useState } from 'react'
import type { GuideProgramDetailSetting } from '../guideRequests'

const pendingUnmountCloseTimers = new Map<number, ReturnType<typeof setTimeout>>()

/**
 * Encode / delete-original draft of the program dialog. The draft is persisted when the dialog
 * closes, and once more on unmount if the dialog never reported a close.
 */
export function useProgramDialogSetting({
  open,
  programId,
  detailSetting,
  onClose,
  onPersistSetting,
}: {
  open: boolean
  programId: number
  detailSetting: GuideProgramDetailSetting
  onClose: (setting: GuideProgramDetailSetting) => void
  onPersistSetting?: (setting: GuideProgramDetailSetting) => void
}) {
  const [encode, setEncode] = useState(detailSetting.encode)
  const [isDeleteOriginalAfterEncode, setIsDeleteOriginalAfterEncode] = useState(
    detailSetting.isDeleteOriginalAfterEncode,
  )
  const latestDetailSetting = useRef<GuideProgramDetailSetting>(detailSetting)
  const onCloseRef = useRef(onClose)
  const onPersistSettingRef = useRef(onPersistSetting)
  const didCloseRef = useRef(false)
  const wasOpen = useRef(open)

  const closeWithCurrentSetting = () => {
    const setting = {
      encode: encode === '' ? 'TS' : encode,
      isDeleteOriginalAfterEncode,
    }

    latestDetailSetting.current = setting
    didCloseRef.current = true
    onClose(setting)
  }

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    onPersistSettingRef.current = onPersistSetting
  }, [onPersistSetting])

  useEffect(() => {
    latestDetailSetting.current = {
      encode: encode === '' ? 'TS' : encode,
      isDeleteOriginalAfterEncode,
    }
  }, [encode, isDeleteOriginalAfterEncode])

  useEffect(() => {
    const pendingTimer = pendingUnmountCloseTimers.get(programId)
    if (pendingTimer !== undefined) {
      clearTimeout(pendingTimer)
      pendingUnmountCloseTimers.delete(programId)
    }

    return () => {
      if (didCloseRef.current) {
        return
      }

      const setting = latestDetailSetting.current
      const timer = setTimeout(() => {
        pendingUnmountCloseTimers.delete(programId)
        onPersistSettingRef.current?.(setting)
      }, 0)
      pendingUnmountCloseTimers.set(programId, timer)
    }
  }, [programId])

  useEffect(() => {
    if (wasOpen.current && !open) {
      if (!didCloseRef.current) {
        didCloseRef.current = true
        onPersistSettingRef.current?.(latestDetailSetting.current)
      }
    }
    if (!wasOpen.current && open) {
      didCloseRef.current = false
    }
    wasOpen.current = open
  }, [open])

  return {
    encode,
    setEncode,
    isDeleteOriginalAfterEncode,
    setIsDeleteOriginalAfterEncode,
    closeWithCurrentSetting,
  }
}
