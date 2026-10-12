import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ManualEncodePanel } from '@/features/reserves/components/ManualEncodePanel'
import { createInitialFormState } from '@/features/reserves/lib/manualReserveForm'
import { selectManualOption } from './reservesTestKit'

describe('ManualEncodePanel direct interaction edges', () => {
  it('[AC 4.22] updates the encode parent directory and clears the sub directory field', () => {
    const setValue = vi.fn()
    const formState = {
      ...createInitialFormState(),
      encodeOption: {
        mode1: 'h264',
        encodeParentDirectoryName1: null,
        directory1: 'existing-sub-directory',
        mode2: null,
        mode3: null,
        isDeleteOriginalAfterEncode: false,
      },
    }

    render(
      <ManualEncodePanel
        slot={1}
        formState={formState}
        setValue={setValue}
        isOpen={() => true}
        onToggle={vi.fn()}
        directories={['synthetic-parent']}
        encodeModes={['h264']}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /クリア/, hidden: true }))
    expect(setValue).toHaveBeenCalledWith('encodeOption.directory1', null)
  })

  it('[AC 4.22] selects a value from the encode parent directory dropdown', async () => {
    const setValue = vi.fn()
    const formState = {
      ...createInitialFormState(),
      encodeOption: {
        mode1: 'h264',
        directory1: null,
        mode2: null,
        mode3: null,
        isDeleteOriginalAfterEncode: false,
      },
    }

    render(
      <ManualEncodePanel
        slot={1}
        formState={formState}
        setValue={setValue}
        isOpen={() => true}
        onToggle={vi.fn()}
        directories={['synthetic-parent']}
        encodeModes={['h264']}
      />,
    )

    await selectManualOption('directory1', 'synthetic-parent')

    expect(setValue).toHaveBeenCalledWith(
      'encodeOption.encodeParentDirectoryName1',
      'synthetic-parent',
    )
  })
})
