import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ChannelMultiSelect } from '@/features/search/rule/components/ChannelMultiSelect'

vi.mock('@mui/material/Select', () => ({
  default: (props: {
    onChange: (event: { target: { value: string[] | string } }) => void
    renderValue?: (selected: string[]) => ReactNode
    value: string[]
  }) => (
    <div>
      <div data-testid="rendered-value">{props.renderValue?.(props.value)}</div>
      <button type="button" onClick={() => props.onChange({ target: { value: '7,9' } })}>
        emit-native-string-value
      </button>
    </div>
  ),
}))

describe('ChannelMultiSelect', () => {
  it('[AC 2.33] parses a comma-delimited native select value into channel ids [AC contract: handleChange accepts a non-array SelectChangeEvent value]', () => {
    const onChange = vi.fn()

    render(
      <ChannelMultiSelect
        channelIds={[]}
        options={[
          { id: 7, name: 'Channel Seven' },
          { id: 9, name: 'Channel Nine' },
        ]}
        onChange={onChange}
      />,
    )

    fireEvent.click(screen.getByText('emit-native-string-value'))

    expect(onChange).toHaveBeenCalledWith([7, 9])
  })
})
