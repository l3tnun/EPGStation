import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import type { UseFormSetValue } from 'react-hook-form'
import { ClearableTextField } from '@/shared/ClearableTextField'
import { appSelectMenuProps } from '@/shared/appSelectConfig'
import {
  nullableString,
  type ManualOptionPanelIndex,
  type ManualReserveFormState,
} from '../lib/manualReserveForm'
import styles from '../ReservesPage.module.css'
import { ManualOptionPanel } from './ManualOptionPanel'

type EncodeSlot = 1 | 2 | 3

const ENCODE_PANEL_INDEX: Record<EncodeSlot, ManualOptionPanelIndex> = { 1: 3, 2: 4, 3: 5 }

export function ManualEncodePanel({
  slot,
  formState,
  setValue,
  isOpen,
  onToggle,
  directories,
  encodeModes,
}: {
  slot: EncodeSlot
  formState: ManualReserveFormState
  setValue: UseFormSetValue<ManualReserveFormState>
  isOpen: (index: ManualOptionPanelIndex) => boolean
  onToggle: (index: ManualOptionPanelIndex) => void
  directories: readonly string[]
  encodeModes: readonly string[]
}) {
  const index = ENCODE_PANEL_INDEX[slot]
  const modeKey = `encodeOption.mode${slot}` as const
  const parentKey = `encodeOption.encodeParentDirectoryName${slot}` as const
  const directoryKey = `encodeOption.directory${slot}` as const
  const encodeOption = formState.encodeOption

  return (
    <ManualOptionPanel
      index={index}
      title={`エンコード${slot}`}
      isOpen={isOpen(index)}
      onToggle={onToggle}
    >
      <div className={styles.manualFormGrid}>
        <TextField
          className={styles.manualWideField}
          label={`mode${slot}`}
          variant="standard"
          select
          slotProps={{ select: { MenuProps: appSelectMenuProps } }}
          value={encodeOption?.[`mode${slot}`] ?? ''}
          onChange={(event) => setValue(modeKey, nullableString(event.target.value))}
        >
          <MenuItem value="" sx={{ display: 'none' }}>
            <em>{`mode${slot}`}</em>
          </MenuItem>
          {encodeModes.map((encodeMode) => (
            <MenuItem key={encodeMode} value={encodeMode}>
              {encodeMode}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          className={styles.manualCompactField}
          label={`directory${slot}`}
          variant="standard"
          select
          slotProps={{ select: { MenuProps: appSelectMenuProps } }}
          value={encodeOption?.[`encodeParentDirectoryName${slot}`] ?? ''}
          onChange={(event) => setValue(parentKey, nullableString(event.target.value))}
        >
          <MenuItem value="" sx={{ display: 'none' }}>
            <em>{`directory${slot}`}</em>
          </MenuItem>
          {directories.map((directory) => (
            <MenuItem key={directory} value={directory}>
              {directory}
            </MenuItem>
          ))}
        </TextField>
        <ClearableTextField
          label={`sub directory${slot}`}
          variant="standard"
          value={encodeOption?.[`directory${slot}`] ?? ''}
          onClear={() => setValue(directoryKey, null)}
          onChange={(event) => setValue(directoryKey, nullableString(event.target.value))}
        />
      </div>
    </ManualOptionPanel>
  )
}
