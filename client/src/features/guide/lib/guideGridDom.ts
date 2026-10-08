import type { GuideReserveIndex } from '../guideRequests'
import { createProgramCellClassList, firstGenre, formatProgramStartTime } from './guideGridLayout'
import {
  DEFAULT_CHANNEL_WIDTH_PX,
  RESERVE_STATE_CLASSES,
  DEFAULT_TIMESCALE_HEIGHT_PX,
  DEFAULT_VIEWPORT_HEIGHT_PX,
  DEFAULT_VIEWPORT_WIDTH_PX,
  type GuideGridLayout,
  type GuideGridLayoutProgram,
  type GuideGridRendererInput,
  type GuideGridSizeVariables,
  type GuideGridViewport,
  type ProgramDomItem,
  type GuideGenreVisibility,
} from './guideGridTypes'

export function setTextChild(parent: HTMLElement, className: string, text: string): void {
  const child = document.createElement('div')
  child.className = className
  const supportsInnerText =
    typeof HTMLElement !== 'undefined' && 'innerText' in HTMLElement.prototype
  if (supportsInnerText) {
    child.innerText = text
  } else {
    child.textContent = text.replace(/\r?\n/g, '')
  }
  parent.appendChild(child)
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0)
  })
}

export function parseCssPixelValue(value: string): number | null {
  const parsed = Number.parseFloat(value)

  return Number.isFinite(parsed) ? parsed : null
}

export function createGridElement(className: string, testId?: string): HTMLDivElement {
  const element = document.createElement('div')
  if (testId !== undefined) {
    element.dataset.testid = testId
  }
  element.className = className

  return element
}

export function createGridContent(layout: GuideGridLayout): HTMLDivElement {
  const content = createGridElement('guide-program-grid-dom', 'guide-program-grid-dom')
  content.style.minWidth = `calc(${layout.channels.length} * var(--channel-width))`
  content.style.width = `calc(${layout.channels.length} * var(--channel-width))`
  content.style.minHeight = `calc(${layout.contentMinutes} * (var(--timescale-height) / 60))`
  content.style.height = `calc(${layout.contentMinutes} * (var(--timescale-height) / 60))`

  return content
}

export function renderChannelHeader(channelHeader: HTMLElement, layout: GuideGridLayout): void {
  const dummy = document.createElement('div')
  dummy.className = 'guide-channel-header-item guide-channel-header-dummy'
  channelHeader.appendChild(dummy)

  layout.channels.forEach((channel, index) => {
    const item = document.createElement('div')
    item.className = 'guide-channel-header-item'
    item.dataset.channelIndex = String(index)
    item.textContent = channel.name ?? ''
    channelHeader.appendChild(item)
  })

  const scrollbar = document.createElement('div')
  scrollbar.className = 'guide-channel-header-item guide-channel-header-scrollbar'
  channelHeader.appendChild(scrollbar)
}

export function renderTimeScale(timeScale: HTMLElement, layout: GuideGridLayout): void {
  layout.timeLabels.forEach((time) => {
    const item = document.createElement('div')
    item.className = `guide-time-scale-item time-${time}`
    item.textContent = String(time)
    timeScale.appendChild(item)
  })

  const dummy = document.createElement('div')
  dummy.className = 'guide-time-scale-item guide-time-scale-dummy'
  timeScale.appendChild(dummy)
}

export function createTimelineElement(): HTMLDivElement {
  const timeline = document.createElement('div')
  timeline.className = 'guide-current-time-line'
  timeline.setAttribute('aria-hidden', 'true')

  return timeline
}

export function createProgramElement(
  layoutProgram: GuideGridLayoutProgram,
  input: GuideGridRendererInput,
): HTMLElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.dataset.testid = `guide-program-${layoutProgram.program.id}`
  element.dataset.programId = String(layoutProgram.program.id)
  element.className = createProgramCellClassList({
    program: layoutProgram.program,
    reserveIndex: input.reserveIndex,
    genreVisibility: input.genreVisibility,
    hidden: input.guideMode !== 'all',
  }).join(' ')
  element.style.height = `calc(${layoutProgram.heightMinutes} * (var(--timescale-height) / 60))`
  element.style.top = `calc(${layoutProgram.topMinutes} * (var(--timescale-height) / 60))`
  element.style.left = `calc(${layoutProgram.channelIndex} * var(--channel-width))`

  setTextChild(element, 'name', layoutProgram.program.name ?? '')
  setTextChild(element, 'time', formatProgramStartTime(layoutProgram.program.startAt))
  if (layoutProgram.program.description !== undefined) {
    setTextChild(element, 'description', layoutProgram.program.description)
  }

  return element
}

export function resolveSizeVariables(
  container: HTMLElement | null,
  input: GuideGridRendererInput,
): GuideGridSizeVariables {
  const style =
    container === null || typeof window === 'undefined' ? null : window.getComputedStyle(container)
  const cssChannelWidth =
    style === null ? null : parseCssPixelValue(style.getPropertyValue('--channel-width'))
  const cssTimescaleHeight =
    style === null ? null : parseCssPixelValue(style.getPropertyValue('--timescale-height'))

  return {
    channelWidth: input.sizeVariables?.channelWidth ?? cssChannelWidth ?? DEFAULT_CHANNEL_WIDTH_PX,
    timescaleHeight:
      input.sizeVariables?.timescaleHeight ?? cssTimescaleHeight ?? DEFAULT_TIMESCALE_HEIGHT_PX,
  }
}

export function createGridViewport(
  programGrid: HTMLElement | null,
  layout: GuideGridLayout,
  sizeVariables: GuideGridSizeVariables,
): GuideGridViewport {
  return {
    scrollLeft: programGrid?.scrollLeft ?? 0,
    scrollTop: programGrid?.scrollTop ?? 0,
    width: programGrid?.clientWidth || DEFAULT_VIEWPORT_WIDTH_PX,
    height: programGrid?.clientHeight || DEFAULT_VIEWPORT_HEIGHT_PX,
    contentWidth: layout.channels.length * sizeVariables.channelWidth,
    contentHeight: layout.contentMinutes * (sizeVariables.timescaleHeight / 60),
  }
}
export function applyReserveStateClasses(
  programDomIndex: ReadonlyMap<number, readonly HTMLElement[]>,
  reserveIndex: GuideReserveIndex,
): void {
  programDomIndex.forEach((elements) => {
    elements.forEach((element) => {
      element.classList.remove(...RESERVE_STATE_CLASSES)
    })
  })
  Object.entries(reserveIndex).forEach(([programId, reserve]) => {
    programDomIndex.get(Number(programId))?.forEach((element) => {
      element.classList.add(reserve.type)
    })
  })
}

export function applyGenreVisibilityClasses(
  programDoms: readonly ProgramDomItem[],
  genreVisibility: GuideGenreVisibility,
): void {
  programDoms.forEach((dom) => {
    const genre = firstGenre(dom.program)
    dom.element.classList.remove('hide')
    if (genre !== undefined && genreVisibility[genre] === false) {
      dom.element.classList.add('hide')
    }
  })
}
