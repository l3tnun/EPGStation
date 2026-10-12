import { describe, expect, it } from 'vitest'
import { linkifyRecordedExtendedText } from '@/features/recorded/requests/extendedText'

describe('Recorded extended text links', () => {
  it('returns no tokens for undefined or empty text', () => {
    expect(linkifyRecordedExtendedText(undefined)).toStrictEqual([])
    expect(linkifyRecordedExtendedText('')).toStrictEqual([])
  })

  it('splits text around http and https links', () => {
    expect(linkifyRecordedExtendedText('a http://x.test/p b https://y.test')).toStrictEqual([
      { type: 'text', text: 'a ' },
      { type: 'link', text: 'http://x.test/p', href: 'http://x.test/p' },
      { type: 'text', text: ' b ' },
      { type: 'link', text: 'https://y.test', href: 'https://y.test' },
    ])
  })

  it('keeps a url that cannot be parsed as plain text', () => {
    expect(linkifyRecordedExtendedText('see http://[ now')).toStrictEqual([
      { type: 'text', text: 'see ' },
      { type: 'text', text: 'http://[' },
      { type: 'text', text: ' now' },
    ])
  })
})
