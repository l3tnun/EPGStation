export type RecordedExtendedTextToken =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'link'
      text: string
      href: string
    }

function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)

    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function linkifyRecordedExtendedText(text: string | undefined): RecordedExtendedTextToken[] {
  if (text === undefined || text === '') {
    return []
  }

  const tokens: RecordedExtendedTextToken[] = []
  const urlPattern = /https?:\/\/[^\s<>"']+/gi
  let index = 0

  let match = urlPattern.exec(text)

  while (match !== null) {
    const value = match[0]
    const matchIndex = match.index

    if (matchIndex > index) {
      tokens.push({ type: 'text', text: text.slice(index, matchIndex) })
    }

    if (isSafeHttpUrl(value)) {
      tokens.push({ type: 'link', text: value, href: value })
    } else {
      tokens.push({ type: 'text', text: value })
    }
    index = matchIndex + value.length
    match = urlPattern.exec(text)
  }

  if (index < text.length) {
    tokens.push({ type: 'text', text: text.slice(index) })
  }

  return tokens
}
