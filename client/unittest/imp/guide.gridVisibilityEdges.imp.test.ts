import { describe, expect, it } from 'vitest'
import { applyGuideGridVisibility } from '@/features/guide/lib/guideGridVisibility'
import type { GuideGridRendererInput, ProgramDomItem } from '@/features/guide/lib/guideGridTypes'

describe('applyGuideGridVisibility', () => {
  it('does nothing when the normalized viewport is not usable (non-finite dimensions)', () => {
    const element = document.createElement('div')
    const dom: ProgramDomItem = {
      element,
      program: { id: 1, startAt: 0, endAt: 1_000 },
      channelIndex: 0,
      topMinutes: 0,
      heightMinutes: 30,
      isVisible: false,
    }
    const input: GuideGridRendererInput = {
      schedules: [],
      mode: 'normal',
      startAt: 0,
      hours: 24,
      reserveIndex: {},
      genreVisibility: {},
      guideMode: 'all',
    }

    applyGuideGridVisibility({
      programDoms: [dom],
      input,
      viewport: {
        scrollLeft: 0,
        scrollTop: 0,
        width: Number.NaN,
        height: 0,
        contentWidth: 0,
        contentHeight: 0,
      },
      sizeVariables: { channelWidth: 140, timescaleHeight: 180 },
    })

    expect(dom.isVisible).toBe(false)
    expect(element.classList.contains('hidden')).toBe(false)
  })
})
