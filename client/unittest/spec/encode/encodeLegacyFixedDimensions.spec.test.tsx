import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// v2 reference evidence:
//   client/src/components/encode/EncodeCancelDialog.vue:2 — `<v-dialog ... max-width="300" scrollable>`
//   (no explicit `width`, so Vuetify only applies `max-width: 300px`; short body content shrinks below 300px).
//   client/src/components/encode/EncodeSmallCard.vue — `.thumbnail { flex-basis: 30%; max-width: 200px }`
//   with `<v-img aspect-ratio="1.7778" ...>`; there is no fixed row min-height anywhere in v2, the row
//   height is whatever the thumbnail's rendered width produces through the 1.7778 aspect ratio.
describe('Encode legacy fixed-dimension contracts sourced from v2', () => {
  const css = readFileSync('src/features/encode/EncodePage.module.css', 'utf8')

  function rule(selector: string): string {
    const escaped = selector.replace(/[.[\]]/gu, (character) => `\\${character}`)
    const body = css.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]*)\\}`, 'u'))?.groups?.body

    if (body === undefined) {
      throw new Error(`selector not found: ${selector}`)
    }

    return body
  }

  function mediaBlock(): string {
    const marker = '@media (max-width: 600px)'
    const start = css.indexOf(marker)

    if (start === -1) {
      throw new Error('media block not found')
    }

    return css.slice(start)
  }

  it('[A-4] sizes the encode cancel dialog paper by content, only capping it at v2 max-width: 300px', () => {
    const cancelDialogPaperRule = rule('.cancelDialogPaper')

    expect(cancelDialogPaperRule).toContain('max-width: 300px')
    expect(cancelDialogPaperRule).not.toMatch(/(?<!max-)\bwidth:\s*300px/u)
  })

  it('[A-5] derives the encode item thumbnail height from the v2 1.7778 aspect ratio instead of a fixed min-height', () => {
    const thumbnailRule = rule('.thumbnail')

    expect(thumbnailRule).toContain('aspect-ratio: 1.7778')
    expect(thumbnailRule).not.toMatch(/min-height/u)
  })

  it('[A-5] does not force a fixed row min-height on the encode item or its button above 600px', () => {
    const itemRule = rule('.item')
    const itemButtonRule = rule('.itemButton')

    expect(itemRule).not.toMatch(/min-height/u)
    expect(itemButtonRule).not.toMatch(/min-height/u)
  })

  it('[A-5] does not reintroduce a fixed row min-height at the 600px breakpoint', () => {
    const block = mediaBlock()

    expect(block).not.toMatch(/\.item,\s*\n\s*\.item\[data-edit-mode='true'\]\s*\{[^}]*min-height/u)
    expect(block).not.toMatch(/\.thumbnail\s*\{[^}]*min-height/u)
    expect(block).not.toMatch(/\.itemButton\s*\{[^}]*min-height/u)
  })
})
