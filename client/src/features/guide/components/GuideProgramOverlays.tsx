import type { NavigateFunction } from 'react-router-dom'
import type { ShellSnackbarState } from '@/app/AppShell'
import type { LiveStreamConfig, ServerConfigNavigationState } from '@/app/serverApi'
import {
  LiveStreamSelectDialog,
  type LiveStreamSelectChannel,
} from '@/features/onair/LiveStreamSelectDialog'
import type { SettingsConsumerValue } from '@/shared/settings'
import type { GuideApiRepository } from '../guideApi'
import type { GuideProgramDetailSetting, GuideReserveIndex } from '../guideRequests'
import { ProgramDialog, type GuideProgramDialogProgram } from '../ProgramDialog'

export interface GuideProgramOverlaysProps {
  settings: SettingsConsumerValue
  encodeModes: readonly string[]
  streamConfig?: LiveStreamConfig
  urlscheme?: ServerConfigNavigationState['urlscheme']
  apiRepository: GuideApiRepository
  reserveIndex: GuideReserveIndex
  selectedProgramId: number | undefined
  selectedProgram: GuideProgramDialogProgram | null
  programDialogOpen: boolean
  detailSetting: GuideProgramDetailSetting
  streamDialogChannel: LiveStreamSelectChannel | null
  onCloseProgramDialog: (setting: GuideProgramDetailSetting) => void
  onPersistSetting: (setting: GuideProgramDetailSetting) => void
  onProgramDialogExited: () => void
  onCloseStreamDialog: () => void
  onReserveResult: (ok: boolean) => Promise<boolean>
  onNavigate: NavigateFunction
  onSnackbar: (snackbar: ShellSnackbarState) => void
}

/** The program detail dialog and the live stream selector opened from the Guide grid. */
export function GuideProgramOverlays({
  settings,
  encodeModes,
  streamConfig,
  urlscheme,
  apiRepository,
  reserveIndex,
  selectedProgramId,
  selectedProgram,
  programDialogOpen,
  detailSetting,
  streamDialogChannel,
  onCloseProgramDialog,
  onPersistSetting,
  onProgramDialogExited,
  onCloseStreamDialog,
  onReserveResult,
  onNavigate,
  onSnackbar,
}: GuideProgramOverlaysProps) {
  const runReserveAction = async (action: Promise<{ ok: boolean }>) =>
    onReserveResult((await action).ok)

  return (
    <>
      {selectedProgram === null ? undefined : (
        <ProgramDialog
          key={selectedProgramId}
          open={programDialogOpen}
          program={selectedProgram}
          reserveIndex={reserveIndex}
          settings={settings}
          detailSetting={detailSetting}
          encodeModes={encodeModes}
          onClose={onCloseProgramDialog}
          onPersistSetting={onPersistSetting}
          onExited={onProgramDialogExited}
          onNavigate={onNavigate}
          onSnackbar={onSnackbar}
          onAddReserve={(payload) => runReserveAction(apiRepository.addProgramReserve(payload))}
          onDeleteReserve={(reserveId) => runReserveAction(apiRepository.deleteReserve(reserveId))}
          onUnlockSkipReserve={(reserveId) =>
            runReserveAction(apiRepository.unlockSkipReserve(reserveId))
          }
          onUnlockOverlapReserve={(reserveId) =>
            runReserveAction(apiRepository.unlockOverlapReserve(reserveId))
          }
        />
      )}
      {streamDialogChannel === null ? undefined : (
        <LiveStreamSelectDialog
          open
          channel={streamDialogChannel}
          settings={settings}
          streamConfig={streamConfig}
          urlscheme={urlscheme}
          showGuide
          onClose={onCloseStreamDialog}
          onSnackbar={onSnackbar}
        />
      )}
    </>
  )
}
