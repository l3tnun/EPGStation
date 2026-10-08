import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ManualTimeSpecifiedFields } from '@/features/reserves/components/ManualTimeSpecifiedFields'
import { createInitialFormState } from '@/features/reserves/lib/manualReserveForm'

describe('ManualTimeSpecifiedFields clear button edges', () => {
  it('[AC 4.25] clears the program name, start, and end fields independently', () => {
    const setValue = vi.fn()
    const formState = {
      ...createInitialFormState(),
      timeSpecifiedOption: {
        name: 'Synthetic name',
        channelId: 301,
        startAt: Date.parse('2026-05-05T10:15:00+09:00'),
        endAt: Date.parse('2026-05-05T10:45:00+09:00'),
      },
    }

    render(
      <ManualTimeSpecifiedFields
        formState={formState}
        channels={[]}
        disabled={false}
        setValue={setValue}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: /クリア/, hidden: true })[0])
    expect(setValue).toHaveBeenCalledWith('timeSpecifiedOption.name', null)

    fireEvent.click(screen.getByRole('button', { name: '開始をクリア', hidden: true }))
    expect(setValue).toHaveBeenCalledWith('timeSpecifiedOption.startAt', null)

    fireEvent.click(screen.getByRole('button', { name: '終了をクリア', hidden: true }))
    expect(setValue).toHaveBeenCalledWith('timeSpecifiedOption.endAt', null)
  })

  it('[AC 4.23] keeps showing exactly what was typed at every keystroke and commits milliseconds only once the value is complete', () => {
    const setValue = vi.fn()
    const formState = {
      ...createInitialFormState(),
      timeSpecifiedOption: {
        name: null,
        channelId: null,
        startAt: null,
        endAt: null,
      },
    }

    render(
      <ManualTimeSpecifiedFields
        formState={formState}
        channels={[]}
        disabled={false}
        setValue={setValue}
      />,
    )

    const startInput = screen.getByLabelText('開始')
    const target = '2026-09-20 21:00'

    // Simulate typing the value one keystroke at a time. At no point should the field ever show
    // anything other than exactly what has been typed so far -- in particular it must never
    // reformat a partial string into a bogus 1970-01-01-style date, which is what the numeric
    // millisecond fallback would do.
    for (let index = 1; index <= target.length; index += 1) {
      const typedSoFar = target.slice(0, index)
      fireEvent.change(startInput, { target: { value: typedSoFar } })
      expect(startInput).toHaveValue(typedSoFar)
    }

    // Every commit made while the string was still incomplete must have been null, never a small
    // numeric millisecond value derived from the partial digits.
    const startAtCommits = setValue.mock.calls
      .filter(([field]) => field === 'timeSpecifiedOption.startAt')
      .map(([, value]) => value)
    const expectedMs = Date.parse('2026-09-20T21:00:00+09:00')
    expect(startAtCommits.slice(0, -1).every((value) => value === null)).toBe(true)
    expect(startAtCommits.at(-1)).toBe(expectedMs)
  })

  it('[AC 4.23] recovers a value edited with Backspace and retyped without ever showing a UNIX-ms fallback', () => {
    const setValue = vi.fn()
    const initialStartAt = Date.parse('2026-05-05T10:15:00+09:00')
    const formState = {
      ...createInitialFormState(),
      timeSpecifiedOption: {
        name: null,
        channelId: null,
        startAt: initialStartAt,
        endAt: null,
      },
    }

    render(
      <ManualTimeSpecifiedFields
        formState={formState}
        channels={[]}
        disabled={false}
        setValue={setValue}
      />,
    )

    const startInput = screen.getByLabelText('開始')
    expect(startInput).toHaveValue('2026-05-05 10:15')

    // Backspace away the minutes, leaving an incomplete string.
    fireEvent.change(startInput, { target: { value: '2026-05-05 10:' } })
    expect(startInput).toHaveValue('2026-05-05 10:')
    expect(setValue).toHaveBeenCalledWith('timeSpecifiedOption.startAt', null)

    // Retype a new, different, complete value.
    fireEvent.change(startInput, { target: { value: '2026-05-05 10:1' } })
    expect(startInput).toHaveValue('2026-05-05 10:1')
    fireEvent.change(startInput, { target: { value: '2026-05-05 10:19' } })
    expect(startInput).toHaveValue('2026-05-05 10:19')

    expect(setValue).toHaveBeenLastCalledWith(
      'timeSpecifiedOption.startAt',
      Date.parse('2026-05-05T10:19:00+09:00'),
    )
  })

  it('[AC 4.23] replaces the whole field like a select-all-and-type edit', () => {
    const setValue = vi.fn()
    const formState = {
      ...createInitialFormState(),
      timeSpecifiedOption: {
        name: null,
        channelId: null,
        startAt: Date.parse('2026-05-05T10:15:00+09:00'),
        endAt: null,
      },
    }

    render(
      <ManualTimeSpecifiedFields
        formState={formState}
        channels={[]}
        disabled={false}
        setValue={setValue}
      />,
    )

    const startInput = screen.getByLabelText('開始')
    expect(startInput).toHaveValue('2026-05-05 10:15')

    // A select-all followed by typing replaces the whole input value in one change event.
    fireEvent.change(startInput, { target: { value: '2026-11-01 08:30' } })
    expect(startInput).toHaveValue('2026-11-01 08:30')
    expect(setValue).toHaveBeenLastCalledWith(
      'timeSpecifiedOption.startAt',
      Date.parse('2026-11-01T08:30:00+09:00'),
    )
  })

  it('[AC 4.23] never displays an unparsed value as a reformatted UNIX-ms date while it is incomplete', () => {
    const setValue = vi.fn()
    const formState = {
      ...createInitialFormState(),
      timeSpecifiedOption: {
        name: null,
        channelId: null,
        startAt: null,
        endAt: null,
      },
    }

    render(
      <ManualTimeSpecifiedFields
        formState={formState}
        channels={[]}
        disabled={false}
        setValue={setValue}
      />,
    )

    const startInput = screen.getByLabelText('開始')

    fireEvent.change(startInput, { target: { value: '2' } })
    expect(startInput).toHaveValue('2')
    expect(startInput).not.toHaveValue('1970-01-01 09:00')
    expect(setValue).toHaveBeenLastCalledWith('timeSpecifiedOption.startAt', null)
  })

  it('[AC 4.23] keeps an in-progress draft across an unrelated re-render, but resyncs once the committed value actually changes from outside', () => {
    const setValue = vi.fn()
    const initialStartAt = Date.parse('2026-05-05T10:15:00+09:00')
    const baseFormState = {
      ...createInitialFormState(),
      timeSpecifiedOption: {
        name: null,
        channelId: null,
        startAt: initialStartAt,
        endAt: null,
      },
    }

    const { rerender } = render(
      <ManualTimeSpecifiedFields
        formState={baseFormState}
        channels={[]}
        disabled={false}
        setValue={setValue}
      />,
    )

    const startInput = screen.getByLabelText('開始')
    expect(startInput).toHaveValue('2026-05-05 10:15')

    // Start an in-progress edit. `setValue` is mocked and never feeds anything back into
    // `formState`, so from the component's point of view this is indistinguishable from a
    // re-render caused by something unrelated (typing in another field, a parent state update
    // for a different reason, ...): the committed `startAt` prop stays exactly what it was.
    // A field whose displayed value is computed directly from `formState` on every render
    // (`value={formatManualDateTimeInput(formState.startAt)}`, with no draft state of its own)
    // would immediately snap this back to "2026-05-05 10:15" the moment React reconciles the
    // controlled input, because nothing ever changed the value it derives the display from.
    fireEvent.change(startInput, { target: { value: '2026-05-05 10:1' } })
    expect(startInput).toHaveValue('2026-05-05 10:1')

    // An unrelated re-render with a *new object* that carries the exact same startAt must not
    // clobber the in-progress draft either -- only a genuine change to the committed value may.
    rerender(
      <ManualTimeSpecifiedFields
        formState={{
          ...baseFormState,
          timeSpecifiedOption: { ...baseFormState.timeSpecifiedOption },
        }}
        channels={[]}
        disabled={false}
        setValue={setValue}
      />,
    )
    expect(startInput).toHaveValue('2026-05-05 10:1')

    // Now something other than this field's own onChange changes the committed value while it
    // stays mounted -- e.g. a `programId` fetch response or a scroll-history restore replacing
    // the whole form state. The displayed draft must pick up the newly formatted value.
    const externallySetStartAt = Date.parse('2026-07-01T09:30:00+09:00')
    rerender(
      <ManualTimeSpecifiedFields
        formState={{
          ...baseFormState,
          timeSpecifiedOption: {
            ...baseFormState.timeSpecifiedOption,
            startAt: externallySetStartAt,
          },
        }}
        channels={[]}
        disabled={false}
        setValue={setValue}
      />,
    )

    expect(startInput).toHaveValue('2026-07-01 09:30')
  })
})
