import { normalizeGuideViewport, shouldUpdateGuideVisibility } from './guideGridLayout'
import type {
  GuideGridRendererInput,
  GuideGridSizeVariables,
  GuideGridViewport,
  ProgramDomItem,
} from './guideGridTypes'

/** Toggles the `hidden` class of program cells outside the viewport (virtualized guide modes). */
export function applyGuideGridVisibility({
  programDoms,
  input,
  viewport: rawViewport,
  sizeVariables,
}: {
  programDoms: readonly ProgramDomItem[]
  input: GuideGridRendererInput
  viewport: GuideGridViewport
  sizeVariables: GuideGridSizeVariables
}): void {
  const viewport = normalizeGuideViewport(rawViewport)
  if (!shouldUpdateGuideVisibility(viewport)) {
    return
  }

  const baseHeight = sizeVariables.timescaleHeight / 60
  const topStart = viewport.scrollTop
  const topEnd = viewport.scrollTop + viewport.height
  programDoms.forEach((dom) => {
    if (input.guideMode === 'sequential' && dom.isVisible) {
      return
    }

    const left = dom.channelIndex * sizeVariables.channelWidth
    const top = dom.topMinutes * baseHeight
    const bottom = (dom.topMinutes + dom.heightMinutes) * baseHeight
    const isVisible =
      left + sizeVariables.channelWidth > viewport.scrollLeft &&
      left < viewport.scrollLeft + viewport.width &&
      top < topEnd &&
      bottom > topStart

    if (dom.isVisible === isVisible) {
      return
    }

    dom.isVisible = isVisible
    dom.element.classList.toggle('hidden', !isVisible)
  })
}

/** Position of the current-time line, in CSS, for the given instant. */
export function resolveTimelineTop(input: GuideGridRendererInput, minuteMs: number): string {
  const now = input.now?.() ?? Date.now()
  const positionMinutes = now < input.startAt ? 0 : Math.floor((now - input.startAt) / minuteMs)

  return positionMinutes <= 0 || positionMinutes >= input.hours * 60
    ? '-100px'
    : `calc((${positionMinutes} * (var(--timescale-height) / 60)) - 1px)`
}
