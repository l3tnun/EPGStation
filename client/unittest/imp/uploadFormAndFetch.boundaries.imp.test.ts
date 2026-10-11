import { describe, expect, it, vi } from 'vitest'
import {
  buildRecordedUploadMetadataBody,
  buildRecordedUploadVideoFormData,
  validateRecordedUploadForm,
  type RecordedUploadFormState,
  type RecordedUploadVideoBlockState,
} from '@/features/recorded/requests/uploadForm'
import { linkifyReserveExtendedText } from '@/features/reserves/lib/reserveRoutes'
import {
  fetchAction,
  fetchJson,
  fetchJsonAction,
  resolveDefaultFetch,
} from '@/features/reserves/lib/reservesFetch'

const file = new File(['x'], 'a.ts')

function block(patch: Partial<RecordedUploadVideoBlockState> = {}): RecordedUploadVideoBlockState {
  return {
    id: 0,
    viewName: 'view',
    fileType: 'ts',
    parentDirectoryName: 'dir',
    subDirectory: null,
    file,
    ...patch,
  }
}

function form(patch: Partial<RecordedUploadFormState> = {}): RecordedUploadFormState {
  return {
    channelId: 1,
    genre: null,
    subGenre: null,
    ruleId: null,
    startAt: 1000,
    duration: 30,
    name: 'name',
    description: null,
    extended: null,
    videoBlocks: [block()],
    ...patch,
  }
}

describe('upload form validation', () => {
  it('accepts a complete form, with or without an extra empty block', () => {
    expect(validateRecordedUploadForm(form())).toBe(true)
    expect(
      validateRecordedUploadForm(
        form({ videoBlocks: [block(), block({ id: 1, viewName: null, file: null })] }),
      ),
    ).toBe(true)
  })

  it.each([
    ['no channel', { channelId: null }],
    ['no start', { startAt: null }],
    ['no duration', { duration: null }],
    ['zero duration', { duration: 0 }],
    ['no name', { name: null }],
    ['blank name', { name: '   ' }],
    ['no video block', { videoBlocks: [] }],
  ] as const)('rejects a form with %s', (_label, patch) => {
    expect(validateRecordedUploadForm(form(patch))).toBe(false)
  })

  it.each([
    ['blank view name', { viewName: '  ' }],
    ['no file type', { fileType: undefined }],
    ['blank parent directory', { parentDirectoryName: '  ' }],
    ['no file', { file: null }],
  ] as const)('rejects a video block with %s', (_label, patch) => {
    expect(validateRecordedUploadForm(form({ videoBlocks: [block(patch)] }))).toBe(false)
  })

  it('rejects a block that has a file but no view name even next to a complete block', () => {
    expect(
      validateRecordedUploadForm(
        form({ videoBlocks: [block(), block({ id: 1, viewName: null })] }),
      ),
    ).toBe(false)
  })

  it('rejects a block that has a view name but no file next to a complete block', () => {
    expect(
      validateRecordedUploadForm(form({ videoBlocks: [block(), block({ id: 1, file: null })] })),
    ).toBe(false)
  })

  it('rejects a form whose only blocks are empty', () => {
    expect(
      validateRecordedUploadForm(form({ videoBlocks: [block({ viewName: null, file: null })] })),
    ).toBe(false)
  })
})

describe('upload metadata body', () => {
  it.each([
    ['channel', { channelId: null }],
    ['start', { startAt: null }],
    ['duration', { duration: null }],
    ['name', { name: null }],
    ['blank name', { name: '  ' }],
  ] as const)('refuses to build a body without a valid %s', (_label, patch) => {
    expect(() => buildRecordedUploadMetadataBody(form(patch))).toThrow(
      'Invalid recorded upload metadata state',
    )
  })

  it('leaves blank description and extended text out and keeps the others', () => {
    expect(
      buildRecordedUploadMetadataBody(form({ description: '   ', extended: '' })),
    ).toStrictEqual({ channelId: 1, startAt: 1000, endAt: 1000 + 30 * 60 * 1000, name: 'name' })
    expect(
      buildRecordedUploadMetadataBody(
        form({ description: ' d ', extended: 'e', ruleId: 4, genre: 2, subGenre: 3 }),
      ),
    ).toStrictEqual({
      channelId: 1,
      startAt: 1000,
      endAt: 1000 + 30 * 60 * 1000,
      name: 'name',
      ruleId: 4,
      description: ' d ',
      extended: 'e',
      genre1: 2,
      subGenre1: 3,
    })
  })

  it('sends a sub directory only when it is not blank', () => {
    const base = { recordedId: 1, parentDirectoryName: 'dir', viewName: 'v', fileType: 'ts', file }
    expect(
      buildRecordedUploadVideoFormData({ ...base, subDirectory: '  ' } as never).has('subDirectory'),
    ).toBe(false)
    expect(
      buildRecordedUploadVideoFormData({ ...base, subDirectory: 'sub' } as never).get('subDirectory'),
    ).toBe('sub')
  })
})

describe('reserve extended text links', () => {
  it('returns no tokens for missing or empty text', () => {
    expect(linkifyReserveExtendedText(undefined)).toStrictEqual([])
    expect(linkifyReserveExtendedText('')).toStrictEqual([])
  })

  it('links both http and https addresses and keeps the surrounding text', () => {
    expect(linkifyReserveExtendedText('a http://x.test/p b https://y.test/q c')).toStrictEqual([
      { type: 'text', text: 'a ' },
      { type: 'link', text: 'http://x.test/p', href: 'http://x.test/p' },
      { type: 'text', text: ' b ' },
      { type: 'link', text: 'https://y.test/q', href: 'https://y.test/q' },
      { type: 'text', text: ' c' },
    ])
  })

  it('keeps an address that cannot be parsed as plain text', () => {
    expect(linkifyReserveExtendedText('see http://[ now')).toStrictEqual([
      { type: 'text', text: 'see ' },
      { type: 'text', text: 'http://[' },
      { type: 'text', text: ' now' },
    ])
  })
})

describe('reserve fetch helpers', () => {
  it('resolves the default fetcher to a function bound to the global fetch', async () => {
    const original = globalThis.fetch
    const spy = vi.fn(async () => ({ ok: true }) as Response)
    globalThis.fetch = spy as never
    try {
      const fetcher = resolveDefaultFetch()
      await fetcher('/x')

      expect(spy).toHaveBeenCalledWith('/x')
    } finally {
      globalThis.fetch = original
    }
  })

  const failing = vi.fn(async () => {
    throw new Error('network')
  })
  const notOk = (body: unknown = { data: 1 }, status = 500) =>
    vi.fn(async () => ({ ok: false, status, json: async () => body }) as unknown as Response)
  const ok = (body: unknown = { data: 1 }, status = 200) =>
    vi.fn(async () => ({ ok: true, status, json: async () => body }) as unknown as Response)

  it('fetchJson returns the body only for an ok response', async () => {
    expect(await fetchJson(ok(), '/u')).toStrictEqual({ data: 1 })
    expect(await fetchJson(notOk(), '/u')).toBeNull()
    expect(await fetchJson(failing, '/u')).toBeNull()
  })

  it('fetchAction returns the ok flag and false when the request throws', async () => {
    expect(await fetchAction(ok(), '/u', {})).toBe(true)
    expect(await fetchAction(notOk(), '/u', {})).toBe(false)
    expect(await fetchAction(failing, '/u', {})).toBe(false)
  })

  it('fetchJsonAction returns the status and body, null for a failure, and no body for 204', async () => {
    expect(await fetchJsonAction(ok(), '/u', 'POST', { a: 1 })).toStrictEqual({
      status: 200,
      body: { data: 1 },
    })
    expect(await fetchJsonAction(ok({ data: 1 }, 204), '/u', 'PUT', {})).toStrictEqual({
      status: 204,
      body: null,
    })
    expect(await fetchJsonAction(notOk(), '/u', 'POST', {})).toBeNull()
    expect(await fetchJsonAction(failing, '/u', 'POST', {})).toBeNull()
  })
})
