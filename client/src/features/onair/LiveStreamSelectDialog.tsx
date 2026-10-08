import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ShellSnackbarState } from '@/app/AppShell'
import type { LiveStreamConfig, ServerConfigNavigationState } from '@/app/serverApi'
import { AppSelect } from '@/shared/AppSelect'
import { detectMpegtsLivePlaybackSupport } from '@/shared/media/mpegtsSupport'
import type { SettingsConsumerValue } from '@/shared/settings'
import { detectNavigatorUrlSchemePlatform } from '@/shared/settings/urlSchemePlatform'
import {
  buildLiveM2TSPlaylistUrl,
  buildLiveM2TSUrlSchemeUrl,
  buildOnAirWatchRoute,
  readOnAirSelectStreamSetting,
  resolveLiveM2TSUrlSchemeTemplate,
  resolveLiveStreamCandidates,
  writeOnAirSelectStreamSetting,
  type LiveStreamType,
  type OnAirSelectStreamSetting,
} from './onairRequests'
import {
  findCandidate,
  getBrowserHref,
  getBrowserLocalStorage,
  isGuideRouteTimeValue,
  repairSelectionForCandidates,
} from './lib/liveStreamSelection'
import styles from './OnAirPage.module.css'

export interface LiveStreamSelectChannel {
  id: number
  name?: string
}

export interface LiveStreamSelectDialogProps {
  open: boolean
  channel: LiveStreamSelectChannel | null
  settings: SettingsConsumerValue
  streamConfig?: LiveStreamConfig
  urlscheme?: ServerConfigNavigationState['urlscheme']
  showGuide?: boolean
  onClose: () => void
  onSnackbar: (snackbar: ShellSnackbarState) => void
}

type FormValue = OnAirSelectStreamSetting

export function LiveStreamSelectDialog({
  open,
  channel,
  settings,
  streamConfig,
  urlscheme,
  showGuide = false,
  onClose,
  onSnackbar,
}: LiveStreamSelectDialogProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const [selection, setSelection] = useState<OnAirSelectStreamSetting>(() => {
    const saved = readOnAirSelectStreamSetting(getBrowserLocalStorage())

    return repairSelectionForCandidates(
      saved,
      resolveLiveStreamCandidates({
        streamConfig,
        useURLScheme: saved.useURLScheme,
      }),
    )
  })
  const candidates = useMemo(
    () =>
      resolveLiveStreamCandidates({
        streamConfig,
        useURLScheme: selection.useURLScheme,
      }),
    [selection.useURLScheme, streamConfig],
  )
  const currentCandidate = findCandidate(candidates, selection.type)
  const form = useForm<FormValue>({
    values: selection,
  })

  const closeAndSave = () => {
    writeOnAirSelectStreamSetting(getBrowserLocalStorage(), selection)
    onClose()
  }
  const navigateToGuide = () => {
    if (channel === null) {
      return
    }

    const currentParameters = new URLSearchParams(location.search)
    const parameters = new URLSearchParams()
    parameters.set('channelId', String(channel.id))
    const time = currentParameters.get('time')
    if (time !== null && isGuideRouteTimeValue(time)) {
      parameters.set('time', time)
    }
    closeAndSave()
    window.setTimeout(() => {
      navigate(`/guide?${parameters.toString()}`)
    }, 300)
  }
  // `channel` is passed in from the render-time null check so that this handler
  // never has to re-check it, and `selection` already satisfies `FormValue`.
  const watch = (target: LiveStreamSelectChannel) => {
    const nextSelection = repairSelectionForCandidates(selection, candidates)
    writeOnAirSelectStreamSetting(getBrowserLocalStorage(), nextSelection)
    setSelection(nextSelection)

    if (nextSelection.type === 'M2TS') {
      const url = buildLiveM2TSUrlSchemeUrl({
        channelId: target.id,
        mode: nextSelection.mode,
        browserHref: getBrowserHref(),
        template: resolveLiveM2TSUrlSchemeTemplate({
          savedTemplate: settings.onAirM2TSViewURLScheme,
          serverUrlScheme: urlscheme,
          platform: detectNavigatorUrlSchemePlatform(
            /* v8 ignore next -- navigator: navigator is always defined in the jsdom test environment */
            typeof navigator === 'undefined' ? undefined : navigator,
          ),
        }),
      })

      if (url !== null) {
        window.location.href = url
        onClose()
        return
      }

      const playlistUrl = buildLiveM2TSPlaylistUrl({
        channelId: target.id,
        mode: nextSelection.mode,
      })

      window.location.href = playlistUrl
      onClose()
      return
    }

    if (nextSelection.type === 'M2TS-LL' && !detectMpegtsLivePlaybackSupport()) {
      onClose()
      onSnackbar({ text: '再生に対応していません', severity: 'error' })
      return
    }

    try {
      onClose()
      navigate(
        buildOnAirWatchRoute({
          type: nextSelection.type,
          channelId: target.id,
          mode: nextSelection.mode,
        }),
      )
    } catch {
      onSnackbar({ text: '視聴ページへの移動に失敗', severity: 'error' })
    }
  }

  const buttonSx = { color: '#1976d2' }

  return (
    <Dialog
      open={open}
      aria-label="ストリーム選択"
      onClose={closeAndSave}
      slotProps={{
        paper: {
          'aria-label': 'ストリーム選択',
          sx: {
            maxWidth: 400,
            width: '100%',
            '@media (max-width: 600px)': {
              margin: 0,
              maxWidth: '100%',
              width: '100%',
            },
          },
        },
      }}
    >
      <DialogContent className={styles.streamDialogContent}>
        <p>{channel?.name ?? ''}</p>
        <div className={styles.streamSelectRow}>
          <label className={styles.streamTypeField}>
            <AppSelect
              ariaLabel="配信方式"
              value={selection.type}
              options={candidates.map((candidate) => ({
                label: candidate.type,
                value: candidate.type,
              }))}
              onChange={(value) => {
                // The options are built from `candidates`, so the emitted value is
                // always one of their types.
                const type = value as LiveStreamType
                setSelection((current) =>
                  repairSelectionForCandidates({ ...current, type }, candidates),
                )
              }}
            />
          </label>
          <label className={styles.streamModeField}>
            <AppSelect
              ariaLabel="画質"
              value={selection.mode}
              options={(currentCandidate?.modes ?? []).map((mode, index) => ({
                label: mode,
                value: index,
              }))}
              onChange={(value) => {
                setSelection((current) => ({
                  ...current,
                  mode: Number(value),
                }))
              }}
            />
          </label>
        </div>
        <label className={styles.programCheckbox}>
          <input
            aria-label="外部アプリで開く"
            role="switch"
            type="checkbox"
            {...form.register('useURLScheme')}
            checked={selection.useURLScheme}
            onChange={(event) => {
              const useURLScheme = event.target.checked
              const nextCandidates = resolveLiveStreamCandidates({ streamConfig, useURLScheme })
              setSelection((current) =>
                repairSelectionForCandidates(
                  {
                    ...current,
                    useURLScheme,
                    type: nextCandidates[0]?.type ?? current.type,
                    mode: 0,
                  },
                  nextCandidates,
                ),
              )
            }}
          />
          <span>外部アプリで開く</span>
        </label>
      </DialogContent>
      <DialogActions>
        {showGuide ? (
          <Button sx={buttonSx} onClick={navigateToGuide}>
            番組表
          </Button>
        ) : undefined}
        <Button sx={{ ...buttonSx, minWidth: 110 }} onClick={closeAndSave}>
          キャンセル
        </Button>
        <Button
          sx={buttonSx}
          disabled={channel === null || candidates.length === 0}
          onClick={
            channel === null
              ? undefined
              : () => {
                  watch(channel)
                }
          }
        >
          視聴
        </Button>
      </DialogActions>
    </Dialog>
  )
}
