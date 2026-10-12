import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import FormControlLabel from '@mui/material/FormControlLabel'
import type { HTMLAttributes } from 'react'
import { useRef, useState } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import { AppSelect } from '@/shared/AppSelect'
import type { SettingsConsumerValue } from '@/shared/settings'
import { ProgramDialogBody } from './components/ProgramDialogBody'
import type { GuideProgram } from './guideApi'
import type { GuideReserveIndex } from './guideRequests'
import {
  buildGuideProgramAddReservePayload,
  buildGuideProgramSearchPath,
  type GuideProgramDetailSetting,
} from './guideRequests'
import { useProgramDialogSetting } from './hooks/useProgramDialogSetting'
import { actionSnackbarText, programName } from './lib/programDialogText'
import styles from './GuidePage.module.css'

// eslint-disable-next-line react-refresh/only-export-components
export { pad2, resolveLegacyComponentDetails, resolveLegacyGenre } from './lib/programDialogText'

export interface GuideProgramDialogProgram extends GuideProgram {
  id: number
  channelId?: number
  channelName?: string
}

export interface ProgramDialogProps {
  open: boolean
  program: GuideProgramDialogProgram
  reserveIndex: GuideReserveIndex
  settings: SettingsConsumerValue
  detailSetting: GuideProgramDetailSetting
  encodeModes: readonly string[]
  onClose: (setting: GuideProgramDetailSetting) => void
  onPersistSetting?: (setting: GuideProgramDetailSetting) => void
  onExited: () => void
  onNavigate: (path: string) => void
  onSnackbar: (snackbar: ShellSnackbarState) => void
  onAddReserve: (payload: ReturnType<typeof buildGuideProgramAddReservePayload>) => Promise<boolean>
  onDeleteReserve: (reserveId: number) => Promise<boolean>
  onUnlockSkipReserve: (reserveId: number) => Promise<boolean>
  onUnlockOverlapReserve: (reserveId: number) => Promise<boolean>
}

export type ProgramAction = 'add' | 'delete' | 'exclude' | 'unskip' | 'unoverlap'

export function ProgramDialog({
  open,
  program,
  reserveIndex,
  settings,
  detailSetting,
  encodeModes,
  onClose,
  onPersistSetting,
  onExited,
  onNavigate,
  onSnackbar,
  onAddReserve,
  onDeleteReserve,
  onUnlockSkipReserve,
  onUnlockOverlapReserve,
}: ProgramDialogProps) {
  const {
    encode,
    setEncode,
    isDeleteOriginalAfterEncode,
    setIsDeleteOriginalAfterEncode,
    closeWithCurrentSetting,
  } = useProgramDialogSetting({
    open,
    programId: program.id,
    detailSetting,
    onClose,
    onPersistSetting,
  })
  const [isActionRunning, setIsActionRunning] = useState(false)
  const isActionRunningRef = useRef(false)
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const reserve = reserveIndex[program.id]
  const reserveItem = reserve?.item
  const isRuleReserve = reserveItem?.ruleId !== undefined
  const title = programName(program)
  const buttonSx = { color: '#1e88e5' }
  const navigateAndClose = (path: string) => {
    if (navigationTimer.current !== undefined) {
      clearTimeout(navigationTimer.current)
    }
    closeWithCurrentSetting()
    navigationTimer.current = setTimeout(() => {
      navigationTimer.current = undefined
      onNavigate(path)
    }, 300)
  }
  const runAction = async (action: ProgramAction) => {
    if (isActionRunningRef.current) {
      return
    }

    isActionRunningRef.current = true
    setIsActionRunning(true)
    let ok = false

    if (action === 'add') {
      ok = await onAddReserve(
        buildGuideProgramAddReservePayload({
          programId: program.id,
          encode,
          isDeleteOriginalAfterEncode,
        }),
      )
    } else if (reserveItem !== undefined) {
      if (action === 'delete' || action === 'exclude') {
        ok = await onDeleteReserve(reserveItem.id)
      } else if (action === 'unskip') {
        ok = await onUnlockSkipReserve(reserveItem.id)
      } else {
        ok = await onUnlockOverlapReserve(reserveItem.id)
      }
    }

    onSnackbar({
      text: actionSnackbarText({ name: title, action, ok }),
      severity: ok ? 'success' : 'error',
    })
    closeWithCurrentSetting()
  }

  return (
    <Dialog
      open={open}
      aria-labelledby="guide-program-dialog-title"
      slotProps={{
        paper: {
          'data-max-width': '500',
          className: styles.programDialogPaper,
          sx: {
            bgcolor: 'background.paper',
            color: 'text.primary',
            margin: '24px',
            maxWidth: 500,
            width: 'calc(100% - 48px)',
          },
        } as HTMLAttributes<HTMLDivElement>,
        transition: {
          onExited,
        },
      }}
      onClose={closeWithCurrentSetting}
    >
      <DialogContent className={styles.programDialogContent}>
        <ProgramDialogBody program={program} title={title} />
      </DialogContent>
      <div
        className={`${styles.programDialogFooter} ${
          reserve === undefined ? '' : styles.programDialogFooterReserved
        } ${isRuleReserve ? styles.programDialogFooterRuleReserve : ''}`}
      >
        {reserve === undefined ? (
          <div className={styles.programOptionList}>
            <FormControlLabel
              className={styles.programCheckbox}
              control={
                <Checkbox
                  checked={isDeleteOriginalAfterEncode}
                  onChange={(event) => setIsDeleteOriginalAfterEncode(event.target.checked)}
                  size="small"
                />
              }
              label="元ファイル削除"
            />
            <label className={styles.settingField}>
              <AppSelect
                ariaLabel="エンコード"
                value={encode}
                options={Array.from(new Set(['TS', ...encodeModes, encode]).values()).map(
                  (mode) => ({ label: mode, value: mode }),
                )}
                disableMenuInternalScroll
                menuMaxVisibleItems={7.5}
                onChange={setEncode}
              />
            </label>
          </div>
        ) : undefined}
        <DialogActions className={styles.programDialogActions}>
          <Button sx={buttonSx} disabled={isActionRunning} onClick={closeWithCurrentSetting}>
            閉じる
          </Button>
          {reserve === undefined ? (
            <Button
              sx={buttonSx}
              disabled={isActionRunning}
              onClick={() => navigateAndClose(`/reserves/manual?programId=${program.id}`)}
            >
              詳細
            </Button>
          ) : undefined}
          {!isRuleReserve && reserveItem !== undefined ? (
            <Button
              sx={buttonSx}
              disabled={isActionRunning}
              onClick={() => navigateAndClose(`/reserves/manual?reserveId=${reserveItem.id}`)}
            >
              編集
            </Button>
          ) : undefined}
          {isRuleReserve && reserveItem?.ruleId !== undefined ? (
            <Button
              sx={buttonSx}
              disabled={isActionRunning}
              onClick={() => navigateAndClose(`/search?rule=${reserveItem.ruleId}`)}
            >
              ルール
            </Button>
          ) : undefined}
          <Button
            sx={buttonSx}
            disabled={isActionRunning}
            onClick={() => navigateAndClose(buildGuideProgramSearchPath({ program, settings }))}
          >
            検索
          </Button>
          {reserve === undefined ? (
            <Button sx={buttonSx} disabled={isActionRunning} onClick={() => void runAction('add')}>
              予約
            </Button>
          ) : reserve.type === 'skip' ? (
            <Button
              sx={buttonSx}
              disabled={isActionRunning}
              onClick={() => void runAction('unskip')}
            >
              除外解除
            </Button>
          ) : reserve.type === 'overlap' ? (
            <Button
              sx={buttonSx}
              disabled={isActionRunning}
              onClick={() => void runAction('unoverlap')}
            >
              重複解除
            </Button>
          ) : (
            <Button
              sx={buttonSx}
              disabled={isActionRunning}
              onClick={() => void runAction(isRuleReserve ? 'exclude' : 'delete')}
            >
              {isRuleReserve ? '除外' : '削除'}
            </Button>
          )}
        </DialogActions>
      </div>
    </Dialog>
  )
}
