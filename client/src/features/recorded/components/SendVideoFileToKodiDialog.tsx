import Button from '@mui/material/Button'

import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import { useEffect, useRef, useState } from 'react'
import type { HTMLAttributes } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import { AppSelect } from '@/shared/AppSelect'
import type { RecordedApiRepository, RecordedListItem } from '../recordedApi'
import {
  readSendVideoFileSelectHostSetting,
  resolveKodiHostName,
  writeSendVideoFileSelectHostSetting,
} from '../recordedRequests'
import styles from '../RecordedPage.module.css'
import { RecordedPlainDialog } from './RecordedPlainDialog'
import { openSnackbar } from '../lib/recordedSnackbar'
import { getBrowserStorage } from '../lib/recordedBrowser'
import { videoFileId } from '../lib/recordedFormat'

export function SendVideoFileToKodiDialog({
  open,
  item,
  hosts,
  apiRepository,
  onClose,
  onSnackbar,
}: {
  open: boolean
  item: RecordedListItem
  hosts: readonly string[]
  apiRepository: RecordedApiRepository
  onClose: () => void
  onSnackbar: (snackbar: ShellSnackbarState) => void
}) {
  const storage = getBrowserStorage()
  const [hostName, setHostName] = useState('')
  const dialogPaperAttributes = {
    'data-recorded-kodi-dialog': 'legacy',
    className: styles.kodiPaper,
  } as HTMLAttributes<HTMLDivElement>

  const latestInputs = useRef({ hosts, storage })
  useEffect(() => {
    latestInputs.current = { hosts, storage }
  })

  useEffect(() => {
    if (!open) return
    const inputs = latestInputs.current
    const setting =
      inputs.storage === undefined
        ? { hostName: null }
        : readSendVideoFileSelectHostSetting(inputs.storage)
    const restoredHostName = resolveKodiHostName({
      storedHostName: setting.hostName,
      hosts: inputs.hosts,
    })

    // Dialog open restores adjacent storage; parent re-renders must not reset the chosen host.
    setHostName(restoredHostName ?? '')
  }, [open])

  const closeAndSave = () => {
    if (storage !== undefined) {
      writeSendVideoFileSelectHostSetting(storage, {
        hostName: hostName === '' ? null : hostName,
      })
    }
    onClose()
  }
  const send = async (videoFileId: number) => {
    if (hostName === '') {
      openSnackbar(onSnackbar, '送信に失敗しました', 'error')
      return
    }

    const result = await apiRepository.sendVideoFileToKodi({
      videoFileId,
      kodiName: hostName,
    })
    openSnackbar(
      onSnackbar,
      result.ok ? '送信しました' : '送信に失敗しました',
      result.ok ? 'success' : 'error',
    )
  }

  return (
    <RecordedPlainDialog
      open={open}
      ariaLabel="Kodi 送信"
      maxWidth={400}
      paperAttributes={dialogPaperAttributes}
      onClose={closeAndSave}
    >
      <DialogContent className={styles.kodiContent}>
        <div className={styles.kodiTitle}>{item.name ?? ''}</div>
        <label className={styles.kodiHostField}>
          <span>kodi host</span>
          <AppSelect
            ariaLabel="kodi host"
            controlHeight={32}
            value={hostName}
            options={hosts.map((host) => ({ label: host, value: host }))}
            onChange={setHostName}
          />
        </label>
        <div className={styles.kodiActionRow}>
          {(item.videoFiles ?? []).map((file) => {
            const id = videoFileId(file)
            if (id === undefined) return undefined

            return (
              <Button
                key={id}
                className={styles.kodiVideoButton}
                type="button"
                onClick={() => void send(id)}
              >
                {file.name ?? `#${id}`}
              </Button>
            )
          })}
        </div>
      </DialogContent>
      <DialogActions className={styles.kodiActions}>
        <Button onClick={closeAndSave}>閉じる</Button>
      </DialogActions>
    </RecordedPlainDialog>
  )
}
