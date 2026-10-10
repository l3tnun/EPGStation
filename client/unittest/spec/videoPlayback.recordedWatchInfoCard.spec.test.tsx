import { readFileSync } from 'node:fs'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RecordedWatchInfoCard } from '@/features/video/playback/components/RecordedWatchInfoCard'
import type { RecordedListItem } from '@/features/recorded/recordedApi'

describe('RecordedWatchInfoCard contract', () => {
  it('[AC 2.11] falls back to an empty title when the recorded item has no name', () => {
    const item: RecordedListItem = {
      startAt: Date.parse('2026-05-05T09:00:00+09:00'),
      endAt: Date.parse('2026-05-05T10:00:00+09:00'),
    }

    render(<RecordedWatchInfoCard item={item} />)

    const card = screen.getByTestId('recorded-watch-info-card')
    const titleDiv = card.querySelector('[class*="infoCardTitle"]')
    expect(titleDiv).not.toBeNull()
    expect(titleDiv?.textContent).toBe('')
  })

  it('[AC 2.11] omits the time range and channel name rows when the item has neither', () => {
    const item: RecordedListItem = { name: 'no schedule metadata' }

    render(<RecordedWatchInfoCard item={item} />)

    const card = screen.getByTestId('recorded-watch-info-card')
    expect(card.querySelector('[class*="infoCardTime"]')).toBeNull()
    expect(card.textContent).not.toContain('~')
    expect(card.querySelector('article')?.children).toHaveLength(1)
  })

  it('[design: Visual Implementation Contract, info card radius] uses a 4px border radius matching the Vuetify v-card default v2 relied on', () => {
    // v2 WatchRecordedInfoCard.vue renders an unstyled Vuetify <v-card>, whose
    // border-radius comes from $card-border-radius: $border-radius-root (4px in
    // vuetify 2.7.0's default theme, see vuetify (a v2 dependency)
    // src/styles/settings/_variables.scss and components/VCard/_variables.scss).
    const css = readFileSync('src/features/video/playback/PlaybackPage.module.css', 'utf8')
    const infoCardRule = css.match(/\.infoCard\s*\{[\s\S]*?\n\}/)
    expect(infoCardRule).not.toBeNull()
    expect(infoCardRule?.[0]).toMatch(/border-radius:\s*4px;/)
  })
})
