import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GuideTimeSelectorMenu } from '@/features/guide/components/GuideTimeSelectorMenu'
import type { GuideDateOption } from '@/features/guide/lib/guideDate'

function createOption(overrides: Partial<GuideDateOption> = {}): GuideDateOption {
  return {
    label: '05/05(火)',
    value: Date.parse('2026-05-05T09:00:00+09:00'),
    routeTime: '26050509',
    dayStartAt: Date.parse('2026-05-05T00:00:00+09:00'),
    dayRouteTime: '260505',
    ...overrides,
  }
}

describe('GuideTimeSelectorMenu edges', () => {
  it('[AC 3.33] closes on a global Escape keydown while open, and ignores other keys', () => {
    const anchorEl = document.createElement('button')
    document.body.appendChild(anchorEl)
    const onClose = vi.fn()

    render(
      <GuideTimeSelectorMenu
        anchorEl={anchorEl}
        open
        options={[createOption()]}
        currentStartAt={createOption().value}
        currentType={undefined}
        enabledBroadcastWaves={['GR', 'BS']}
        showBroadcastSelect
        onClose={onClose}
        onDisplay={vi.fn()}
      />,
    )

    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    anchorEl.remove()
  })

  it('[AC 3.34] closes automatically once the anchor element is disconnected from the document', () => {
    const anchorEl = document.createElement('button')
    document.body.appendChild(anchorEl)
    const onClose = vi.fn()

    const { rerender } = render(
      <GuideTimeSelectorMenu
        anchorEl={anchorEl}
        open
        options={[createOption()]}
        currentStartAt={createOption().value}
        currentType={undefined}
        enabledBroadcastWaves={['GR', 'BS']}
        showBroadcastSelect
        onClose={onClose}
        onDisplay={vi.fn()}
      />,
    )

    anchorEl.remove()
    // The disconnect-detection effect only re-runs when its dependencies change identity, so a
    // rerender with the exact same props would not re-check `anchorEl.isConnected`. Passing a
    // new `onClose` reference forces the effect to run again against the now-disconnected anchor.
    rerender(
      <GuideTimeSelectorMenu
        anchorEl={anchorEl}
        open
        options={[createOption()]}
        currentStartAt={createOption().value}
        currentType={undefined}
        enabledBroadcastWaves={['GR', 'BS']}
        showBroadcastSelect
        onClose={(...args: Parameters<typeof onClose>) => onClose(...args)}
        onDisplay={vi.fn()}
      />,
    )

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('[AC 3.10] does not call onDisplay when the selected day is not among the provided options', () => {
    const anchorEl = document.createElement('button')
    document.body.appendChild(anchorEl)
    const onDisplay = vi.fn()

    render(
      <GuideTimeSelectorMenu
        anchorEl={anchorEl}
        open
        options={[]}
        currentStartAt={createOption().value}
        currentType={undefined}
        enabledBroadcastWaves={['GR', 'BS']}
        showBroadcastSelect
        onClose={vi.fn()}
        onDisplay={onDisplay}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '表示' }))

    expect(onDisplay).not.toHaveBeenCalled()
    anchorEl.remove()
  })

  it('[AC 3.35] passes undefined as the type and offers an "all" option when no current type is selected', () => {
    const anchorEl = document.createElement('button')
    document.body.appendChild(anchorEl)
    const option = createOption()
    const onDisplay = vi.fn()

    render(
      <GuideTimeSelectorMenu
        anchorEl={anchorEl}
        open
        options={[option]}
        currentStartAt={option.value}
        currentType={undefined}
        enabledBroadcastWaves={['GR', 'BS']}
        showBroadcastSelect
        onClose={vi.fn()}
        onDisplay={onDisplay}
      />,
    )

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '放送波' }))
    expect(screen.getByRole('option', { name: 'すべて' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })

    fireEvent.click(screen.getByRole('button', { name: '表示' }))

    expect(onDisplay).toHaveBeenCalledWith(option.dayStartAt + 9 * 60 * 60 * 1000, undefined)
    anchorEl.remove()
  })

  it('[AC 3.35] omits the "all" option when a current broadcast type is already selected', () => {
    const anchorEl = document.createElement('button')
    document.body.appendChild(anchorEl)
    const option = createOption()

    render(
      <GuideTimeSelectorMenu
        anchorEl={anchorEl}
        open
        options={[option]}
        currentStartAt={option.value}
        currentType="BS"
        enabledBroadcastWaves={['GR', 'BS']}
        showBroadcastSelect
        onClose={vi.fn()}
        onDisplay={vi.fn()}
      />,
    )

    expect(screen.getByRole('combobox', { name: '放送波' })).toHaveTextContent('BS')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '放送波' }))
    expect(screen.queryByRole('option', { name: 'すべて' })).not.toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })

    anchorEl.remove()
  })
})
