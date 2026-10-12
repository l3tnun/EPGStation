import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createGuideRepository, createShellRepository } from './support/guideSpecHarness'

// GuideSettingPage guards against a non-finite parsed value (Number.isFinite(value) ? value :
// current) when a size field changes. AppSelect only ever emits option values that are already
// valid numeric strings, so that guard cannot be reached through the real control; it is
// exercised here through a stub that can emit an arbitrary raw string instead.
vi.mock('@/shared/AppSelect', () => ({
  AppSelect: (props: {
    ariaLabel: string
    value: string | number
    onChange: (value: string) => void
  }) => (
    <input
      aria-label={props.ariaLabel}
      value={String(props.value)}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}))

describe('GuideSettingPage size field parsing guard', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 3.28] keeps the current value when a size field change cannot be parsed as a finite number', () => {
    window.history.replaceState(null, '', '/#/guide/setting')

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={createGuideRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const input = screen.getByLabelText('通常表示 チャンネル高さ')
    const before = (input as HTMLInputElement).value

    fireEvent.change(input, { target: { value: 'not-a-number' } })

    expect((input as HTMLInputElement).value).toBe(before)
  })
})
