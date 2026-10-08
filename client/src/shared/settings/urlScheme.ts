export interface URLSchemePlaceholders {
  protocol: string
  address: string
  filename: string
}

const PLACEHOLDER_REPLACEMENTS = {
  PROTOCOL: 'protocol',
  ADDRESS: 'address',
  FILENAME: 'filename',
} as const

type URLSchemePlaceholderToken = keyof typeof PLACEHOLDER_REPLACEMENTS

export function replaceURLSchemePlaceholders(
  template: string,
  placeholders: URLSchemePlaceholders,
): string {
  // The regex only ever matches the literal PROTOCOL/ADDRESS/FILENAME tokens, which are exactly
  // the keys of PLACEHOLDER_REPLACEMENTS, so the match is always a known placeholder token.
  return template.replaceAll(/PROTOCOL|ADDRESS|FILENAME/g, (token: string): string => {
    const placeholderKey = PLACEHOLDER_REPLACEMENTS[token as URLSchemePlaceholderToken]
    const replacement = placeholders[placeholderKey]
    if (replacement === undefined) {
      throw new Error(`Missing URL scheme placeholder value: ${token}`)
    }

    return replacement
  })
}

export function resolveURLSchemeTemplate(
  savedTemplate: string | null,
  fallbackTemplate: string,
): string {
  if (savedTemplate === null || savedTemplate.trim() === '') {
    return fallbackTemplate
  }

  return savedTemplate
}
