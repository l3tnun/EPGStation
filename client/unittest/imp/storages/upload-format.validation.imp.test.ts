import { describe, expect, it } from 'vitest'
import {
  createSubGenreItems,
  createUploadChannelOption,
  createValidatedRequiredState,
  createValidatedVideoUploadRequests,
  formatDatetimeLocalValue,
  parseDatetimeLocalValue,
} from '@/features/storages/upload/lib/uploadFormat'
import type {
  RecordedUploadFormState,
  RecordedUploadVideoBlockState,
} from '@/features/recorded/recordedRequests'

function formState(overrides: Partial<RecordedUploadFormState> = {}): RecordedUploadFormState {
  return {
    channelId: 1,
    genre: null,
    subGenre: null,
    ruleId: null,
    startAt: 1_700_000_000_000,
    duration: 30,
    name: 'Synthetic name',
    description: null,
    extended: null,
    videoBlocks: [],
    ...overrides,
  }
}

const file = new File(['synthetic'], 'synthetic.ts')

function block(
  overrides: Partial<RecordedUploadVideoBlockState> = {},
): RecordedUploadVideoBlockState {
  return {
    id: 1,
    viewName: 'Synthetic upload',
    fileType: 'ts',
    parentDirectoryName: 'archive-root',
    subDirectory: null,
    file,
    ...overrides,
  }
}

describe('required upload fields', () => {
  it('accepts a name of any length once trimmed and rejects an empty one', () => {
    expect(createValidatedRequiredState(formState({ name: 'a' })).success).toBe(true)
    expect(createValidatedRequiredState(formState({ name: 'ab' })).success).toBe(true)
    expect(createValidatedRequiredState(formState({ name: '' })).success).toBe(false)
    expect(createValidatedRequiredState(formState({ name: '  ' })).success).toBe(false)
  })

  it('requires a positive duration', () => {
    expect(createValidatedRequiredState(formState({ duration: 1 })).success).toBe(true)
    expect(createValidatedRequiredState(formState({ duration: 0 })).success).toBe(false)
  })
})

describe('datetime-local values', () => {
  it('formats a local timestamp with zero padded fields', () => {
    expect(formatDatetimeLocalValue(new Date(2026, 4, 5, 9, 7).getTime())).toBe('2026-05-05T09:07')
    expect(formatDatetimeLocalValue(new Date(2026, 11, 31, 23, 59).getTime())).toBe(
      '2026-12-31T23:59',
    )
  })

  it('pads a short year to four digits', () => {
    const date = new Date(2026, 0, 1, 0, 0)
    date.setFullYear(5)

    expect(formatDatetimeLocalValue(date.getTime())).toBe('0005-01-01T00:00')
  })

  it('formats null and undefined as an empty string', () => {
    expect(formatDatetimeLocalValue(null)).toBe('')
    expect(formatDatetimeLocalValue(undefined)).toBe('')
  })

  it('parses a datetime-local string as local time', () => {
    expect(parseDatetimeLocalValue('2026-05-05T12:30')).toBe(new Date(2026, 4, 5, 12, 30).getTime())
  })
})

describe('sub genre items', () => {
  it('lists the id and name of each sub genre of a genre', () => {
    expect(createSubGenreItems(2)).toStrictEqual([{ id: 5, name: 'グルメ・料理' }])
    expect(createSubGenreItems(6)).toStrictEqual([
      { id: 0, name: '洋画' },
      { id: 1, name: '邦画' },
      { id: 2, name: 'アニメ' },
      { id: 3, name: 'その他' },
      { id: 15, name: 'その他' },
    ])
  })
})

describe('channel option labels', () => {
  it('strips only a trailing parenthesised count', () => {
    expect(createUploadChannelOption({ id: 1, name: 'Foo(12)' }, false)).toStrictEqual({
      value: 1,
      label: 'Foo',
    })
    expect(createUploadChannelOption({ id: 2, name: 'Foo(1)Bar' }, false)).toStrictEqual({
      value: 2,
      label: 'Foo(1)Bar',
    })
  })

  it('drops only labels that consist solely of digits', () => {
    expect(createUploadChannelOption({ id: 1, name: '1234' }, false)).toBeNull()
    expect(createUploadChannelOption({ id: 2, name: '12(3)' }, false)).toBeNull()
    expect(createUploadChannelOption({ id: 3, name: 'abc1' }, false)).toStrictEqual({
      value: 3,
      label: 'abc1',
    })
    expect(createUploadChannelOption({ id: 4, name: '1abc' }, false)).toStrictEqual({
      value: 4,
      label: '1abc',
    })
  })
})

describe('video upload requests', () => {
  it('builds a request from a complete block', () => {
    expect(
      createValidatedVideoUploadRequests({ recordedId: 9, videoBlocks: [block()] }),
    ).toStrictEqual([
      {
        recordedId: 9,
        parentDirectoryName: 'archive-root',
        viewName: 'Synthetic upload',
        fileType: 'ts',
        file,
      },
    ])
  })

  it('skips a block with no view name, even when a file is attached', () => {
    expect(
      createValidatedVideoUploadRequests({
        recordedId: 1,
        videoBlocks: [block({ viewName: null })],
      }),
    ).toStrictEqual([])
  })

  it('skips a block whose view name is blank', () => {
    expect(
      createValidatedVideoUploadRequests({
        recordedId: 1,
        videoBlocks: [block({ viewName: '   ' })],
      }),
    ).toStrictEqual([])
  })

  it('skips a block without a file type', () => {
    expect(
      createValidatedVideoUploadRequests({
        recordedId: 1,
        videoBlocks: [block({ fileType: undefined })],
      }),
    ).toStrictEqual([])
  })

  it('skips a block without a file even when it has a view name', () => {
    expect(
      createValidatedVideoUploadRequests({ recordedId: 1, videoBlocks: [block({ file: null })] }),
    ).toStrictEqual([])
  })

  it('skips an untouched block and keeps the complete ones around it', () => {
    const requests = createValidatedVideoUploadRequests({
      recordedId: 1,
      videoBlocks: [
        block({ id: 1 }),
        block({ id: 2, viewName: null, file: null }),
        block({ id: 3 }),
      ],
    })

    expect(requests).toHaveLength(2)
  })
})
