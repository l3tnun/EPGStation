import { describe, expect, it } from 'vitest'
import {
  buildAddEncodeRequestBody,
  createRecordedSearchKeyword,
  resolveAddEncodeParentDirectory,
} from '@/features/recorded/recordedRequests'
import { formatRecordedFileSize } from '@/features/recorded/requests/fileSize'

const base = {
  recordedId: 1,
  sourceVideoFileId: 2,
  mode: 'm',
  removeOriginal: false,
}

describe('add-encode request body: directory fields', () => {
  it('sends a non-empty parent directory and directory when not saving into the same directory', () => {
    expect(
      buildAddEncodeRequestBody({
        ...base,
        isSaveSameDirectory: false,
        parentDir: 'parent',
        directory: 'child',
      }),
    ).toStrictEqual({
      ...base,
      isSaveSameDirectory: false,
      parentDir: 'parent',
      directory: 'child',
    })
  })

  it('leaves out each directory field that is undefined, null or empty', () => {
    for (const empty of [undefined, null, ''] as const) {
      expect(
        buildAddEncodeRequestBody({
          ...base,
          isSaveSameDirectory: false,
          parentDir: empty,
          directory: 'child',
        }),
      ).toStrictEqual({ ...base, isSaveSameDirectory: false, directory: 'child' })
      expect(
        buildAddEncodeRequestBody({
          ...base,
          isSaveSameDirectory: false,
          parentDir: 'parent',
          directory: empty,
        }),
      ).toStrictEqual({ ...base, isSaveSameDirectory: false, parentDir: 'parent' })
    }
  })

  it('sends no directory field when saving into the same directory', () => {
    expect(
      buildAddEncodeRequestBody({
        ...base,
        isSaveSameDirectory: true,
        parentDir: 'parent',
        directory: 'child',
      }),
    ).toStrictEqual({ ...base, isSaveSameDirectory: true })
  })
})

describe('add-encode parent directory resolution', () => {
  const recordedDirectories = ['first', 'second']

  it('keeps the stored parent directory when the server still lists it', () => {
    expect(
      resolveAddEncodeParentDirectory({ storedParentDirectory: 'second', recordedDirectories }),
    ).toBe('second')
  })

  it('falls back to the first directory when the stored one is unknown, null or undefined', () => {
    for (const stored of ['gone', null, undefined]) {
      expect(
        resolveAddEncodeParentDirectory({ storedParentDirectory: stored, recordedDirectories }),
      ).toBe('first')
    }
  })

  it('returns an empty string when the server lists no directories', () => {
    expect(
      resolveAddEncodeParentDirectory({ storedParentDirectory: 'x', recordedDirectories: [] }),
    ).toBe('')
  })
})

describe('recorded file size formatting', () => {
  it('treats non-finite sizes as zero', () => {
    expect(formatRecordedFileSize(Number.NaN)).toBe('0.0B')
    expect(formatRecordedFileSize(Number.POSITIVE_INFINITY)).toBe('0.0B')
    expect(formatRecordedFileSize(undefined)).toBe('0.0B')
  })

  it('switches to the next unit at exactly 1000', () => {
    expect(formatRecordedFileSize(999)).toBe('999.0B')
    expect(formatRecordedFileSize(1000)).toBe('1.0KB')
  })

  it('stops at the largest unit', () => {
    expect(formatRecordedFileSize(1024 ** 6)).toBe('1024.0PB')
  })
})

describe('recorded search keyword from a title', () => {
  it('replaces bracketed marks with a single space', () => {
    expect(createRecordedSearchKeyword('Foo[new]Bar')).toBe('Foo Bar')
    expect(createRecordedSearchKeyword('Foo【ab】Bar')).toBe('Foo Bar')
    expect(createRecordedSearchKeyword('Foo(字)Bar')).toBe('Foo Bar')
  })

  it('collapses runs of spaces', () => {
    expect(createRecordedSearchKeyword('A     B')).toBe('A B')
  })
})
