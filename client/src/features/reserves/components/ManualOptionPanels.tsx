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

export interface ManualPanelProps {
  formState: ManualReserveFormState
  setValue: UseFormSetValue<ManualReserveFormState>
  isOpen: (index: ManualOptionPanelIndex) => boolean
  onToggle: (index: ManualOptionPanelIndex) => void
}

export function ManualDirectoryPanel({
  formState,
  setValue,
  isOpen,
  onToggle,
  directories,
}: ManualPanelProps & { directories: readonly string[] }) {
  return (
    <ManualOptionPanel index={1} title="ディレクトリ" isOpen={isOpen(1)} onToggle={onToggle}>
      <div className={styles.manualFormGrid}>
        <TextField
          className={styles.manualCompactField}
          label="directory"
          variant="standard"
          select
          slotProps={{ select: { MenuProps: appSelectMenuProps } }}
          value={formState.saveOption?.parentDirectoryName ?? ''}
          onChange={(event) =>
            setValue('saveOption.parentDirectoryName', nullableString(event.target.value))
          }
        >
          <MenuItem value="" sx={{ display: 'none' }}>
            <em>directory</em>
          </MenuItem>
          {directories.map((directory) => (
            <MenuItem key={directory} value={directory}>
              {directory}
            </MenuItem>
          ))}
        </TextField>
        <ClearableTextField
          label="sub directory"
          variant="standard"
          value={formState.saveOption?.directory ?? ''}
          onClear={() => setValue('saveOption.directory', null)}
          onChange={(event) => setValue('saveOption.directory', nullableString(event.target.value))}
        />
      </div>
    </ManualOptionPanel>
  )
}

export function ManualFileFormatPanel({ formState, setValue, isOpen, onToggle }: ManualPanelProps) {
  return (
    <ManualOptionPanel index={2} title="ファイル名形式" isOpen={isOpen(2)} onToggle={onToggle}>
      <ClearableTextField
        className={styles.manualWideField}
        label="file format"
        variant="standard"
        value={formState.saveOption?.recordedFormat ?? ''}
        onClear={() => setValue('saveOption.recordedFormat', null)}
        onChange={(event) =>
          setValue('saveOption.recordedFormat', nullableString(event.target.value))
        }
      />
    </ManualOptionPanel>
  )
}
