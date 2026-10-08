import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  ManualDirectoryPanel,
  ManualFileFormatPanel,
} from '@/features/reserves/components/ManualOptionPanels'
import { createInitialFormState } from '@/features/reserves/lib/manualReserveForm'

describe('ManualOptionPanels clear button edges', () => {
  it('[AC 32] reserves helper-text row height on every /reserves/manual add-mode option-panel field', () => {
    // Scoped to this route's option-panel fields (directory / file format / encode 1-3) rather
    // than a theme-wide MuiFormControl override: a theme-wide override pushes this
    // same padding onto fixed-height dialog rows app-wide (Guide ProgramDialog
    // `programOptionList`, `RecordedStreamSelectDialog`), forcing unwanted scroll/growth there.
    const reservesCss = readFileSync('src/features/reserves/ReservesPage.module.css', 'utf8')

    expect(reservesCss).toMatch(
      /\.manualFormGrid :global\(\.MuiFormControl-root\),\s*\.manualWideField:global\(\.MuiFormControl-root\)\s*\{\s*padding-bottom:\s*10px;\s*\}/,
    )
  })

  it('[AC 4.25] clears the save sub directory field', () => {
    const setValue = vi.fn()
    const formState = {
      ...createInitialFormState(),
      saveOption: {
        parentDirectoryName: null,
        directory: 'existing-directory',
        recordedFormat: null,
      },
    }

    render(
      <ManualDirectoryPanel
        formState={formState}
        setValue={setValue}
        isOpen={() => true}
        onToggle={vi.fn()}
        directories={['synthetic-parent']}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'sub directoryをクリア', hidden: true }))
    expect(setValue).toHaveBeenCalledWith('saveOption.directory', null)
  })

  it('[AC 4.25] edits and clears the file format field', () => {
    const setValue = vi.fn()
    const formState = {
      ...createInitialFormState(),
      saveOption: { parentDirectoryName: null, directory: null, recordedFormat: '%YEAR%' },
    }

    render(
      <ManualFileFormatPanel
        formState={formState}
        setValue={setValue}
        isOpen={() => true}
        onToggle={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText('file format'), { target: { value: '%MONTH%' } })
    expect(setValue).toHaveBeenCalledWith('saveOption.recordedFormat', '%MONTH%')

    fireEvent.click(screen.getByRole('button', { name: 'file formatをクリア', hidden: true }))
    expect(setValue).toHaveBeenCalledWith('saveOption.recordedFormat', null)
  })
})
