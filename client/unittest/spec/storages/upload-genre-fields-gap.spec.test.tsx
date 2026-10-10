import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// v2 reference evidence: client/src/components/recorded/upload/RecordedUploadForm.vue places the
// genre and sub genre `<v-select>` (each `style="width: 50%"`) directly adjacent inside a bare
// `<div class="d-flex">`. Vuetify's `.d-flex` utility is only `display: flex !important` and adds
// no gap, so the two selects sit flush against each other (0px gap) in v2.
describe('[design genre / subGenre 横並びの間隔] Recorded upload genre/subGenre row matches the v2 flush (no gap) layout', () => {
  const css = readFileSync('src/features/storages/upload/RecordedUploadPage.module.css', 'utf8')

  function rule(selector: string): string {
    const escaped = selector.replace(/[.[\]]/gu, (character) => `\\${character}`)
    const body = css.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, 'u'))?.groups?.body

    if (body === undefined) {
      throw new Error(`selector not found: ${selector}`)
    }

    return body
  }

  it('does not add a column-gap between the genre and sub genre selects', () => {
    const genreFieldsRule = rule('.genreFields')

    expect(genreFieldsRule).not.toMatch(/column-gap/u)
  })

  it('sizes each select to a plain 50% width without gap-compensation', () => {
    const wrapperRule = rule('.genreFields .uploadSelectWrapper')

    expect(wrapperRule).toMatch(/width:\s*50%/u)
    expect(wrapperRule).not.toMatch(/calc\(/u)
  })
})
