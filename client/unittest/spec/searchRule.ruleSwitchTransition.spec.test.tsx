import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Rule enable switch transition timing', () => {
  it('[AC 3.30] matches the v2 Vuetify switch thumb transition duration (300ms)', () => {
    const css = readFileSync('src/features/search/rule/SearchRulePage.module.css', 'utf8')

    expect(css).toMatch(/\.ruleSwitch\s*\{[^}]*transition:\s*background-color 300ms ease;/s)
    expect(css).toMatch(
      /\.ruleSwitch::after\s*\{[^}]*transition:\s*\n\s*background-color 300ms ease,\s*\n\s*left 300ms ease;/s,
    )
  })
})
