import { describe, expect, it } from 'vitest'
import {
  createSubGenreItems,
  createUploadChannelOption,
  createUploadGenreOption,
  createValidatedRequiredState,
  createValidatedVideoUploadRequests,
  nullableString,
  parseDatetimeLocalValue,
  parseNullableNumber,
  valueFromNullableNumber,
} from '@/features/storages/upload/lib/uploadFormat'
import type { RecordedUploadFormState } from '@/features/recorded/recordedRequests'

function createFormState(
  overrides: Partial<RecordedUploadFormState> = {},
): RecordedUploadFormState {
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

describe('uploadFormat implementation edges', () => {
  it('nullableString maps empty string to null and keeps other values as-is', () => {
    expect(nullableString('')).toBeNull()
    expect(nullableString('Synthetic value')).toBe('Synthetic value')
  })

  it('valueFromNullableNumber renders null/undefined as empty string and numbers as text', () => {
    expect(valueFromNullableNumber(null)).toBe('')
    expect(valueFromNullableNumber(undefined)).toBe('')
    expect(valueFromNullableNumber(42)).toBe('42')
  })

  it('parseNullableNumber treats empty string and non-safe-integer input as null', () => {
    expect(parseNullableNumber('')).toBeNull()
    expect(parseNullableNumber('30')).toBe(30)
    expect(parseNullableNumber('30.5')).toBeNull()
    expect(parseNullableNumber('not-a-number')).toBeNull()
  })

  it('parseDatetimeLocalValue returns null for empty and unparseable strings', () => {
    expect(parseDatetimeLocalValue('')).toBeNull()
    expect(parseDatetimeLocalValue('not-a-datetime')).toBeNull()
    expect(parseDatetimeLocalValue('2026-05-05T12:30')).not.toBeNull()
  })

  it('createSubGenreItems returns an empty list for a null genre or a genre without sub genres', () => {
    expect(createSubGenreItems(null)).toStrictEqual([])
    expect(createSubGenreItems(999_999)).toStrictEqual([])
    expect(createSubGenreItems(0).length).toBeGreaterThan(0)
  })

  it('createUploadChannelOption drops digit-only labels and resolves half-width display', () => {
    expect(createUploadChannelOption({ id: 1, name: '100' }, false)).toBeNull()
    expect(createUploadChannelOption({ id: 2, name: 'Synthetic channel(3)' }, false)).toStrictEqual(
      { value: 2, label: 'Synthetic channel' },
    )
    expect(
      createUploadChannelOption(
        { id: 3, name: 'Synthetic channel', halfWidthName: 'ﾁｬﾝﾈﾙ(4)' },
        true,
      ),
    ).toStrictEqual({ value: 3, label: 'ﾁｬﾝﾈﾙ' })
    expect(createUploadChannelOption({ id: 4, name: 'Fallback channel' }, true)).toStrictEqual({
      value: 4,
      label: 'Fallback channel',
    })
  })

  it('createUploadGenreOption strips the recorded search count suffix from the genre name', () => {
    expect(createUploadGenreOption({ id: 5, name: 'Synthetic genre(6)' })).toStrictEqual({
      value: 5,
      label: 'Synthetic genre',
    })
  })

  it('createValidatedRequiredState succeeds for complete required fields and fails otherwise', () => {
    expect(createValidatedRequiredState(createFormState()).success).toBe(true)
    expect(createValidatedRequiredState(createFormState({ channelId: null })).success).toBe(false)
    expect(createValidatedRequiredState(createFormState({ name: '   ' })).success).toBe(false)
  })

  it('excludes a video block whose parentDirectoryName is blank even when the rest is filled', () => {
    const file = new File(['synthetic'], 'synthetic.ts')

    const requests = createValidatedVideoUploadRequests({
      recordedId: 1,
      videoBlocks: [
        {
          id: 1,
          viewName: 'Synthetic upload',
          fileType: 'ts',
          parentDirectoryName: '   ',
          subDirectory: null,
          file,
        },
      ],
    })

    expect(requests).toStrictEqual([])
  })

  it('includes an optional subDirectory only when it is a non-empty trimmed string', () => {
    const file = new File(['synthetic'], 'synthetic.ts')

    const withSubDirectory = createValidatedVideoUploadRequests({
      recordedId: 1,
      videoBlocks: [
        {
          id: 1,
          viewName: 'Synthetic upload',
          fileType: 'ts',
          parentDirectoryName: 'archive-root',
          subDirectory: 'sub',
          file,
        },
      ],
    })
    expect(withSubDirectory[0]?.subDirectory).toBe('sub')

    const withBlankSubDirectory = createValidatedVideoUploadRequests({
      recordedId: 1,
      videoBlocks: [
        {
          id: 2,
          viewName: 'Synthetic upload',
          fileType: 'ts',
          parentDirectoryName: 'archive-root',
          subDirectory: '   ',
          file,
        },
      ],
    })
    expect(withBlankSubDirectory[0]?.subDirectory).toBeUndefined()
  })
})
