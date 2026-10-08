import type { GuideReserveIndex } from './guideRequests'
import {
  applyGenreVisibilityClasses,
  applyReserveStateClasses,
  createGridContent,
  createGridElement,
  createGridViewport,
  createProgramElement,
  createTimelineElement,
  nextFrame,
  renderChannelHeader,
  renderTimeScale,
  resolveSizeVariables,
} from './lib/guideGridDom'
import { createGuideGridLayout } from './lib/guideGridLayout'
import {
  MINUTE_MS,
  type GuideGenreVisibility,
  type GuideGridLayout,
  type GuideGridRendererInput,
  type GuideScrollData,
  type ProgramDomItem,
} from './lib/guideGridTypes'
import { GuideGridDragScroller, dispatchGuideGridClick } from './lib/guideGridInteraction'
import { applyGuideGridVisibility, resolveTimelineTop } from './lib/guideGridVisibility'

export type * from './lib/guideGridTypes'
export {
  createGuideGridLayout,
  createProgramCellClassList,
  isAudioVideoService,
  normalizeGuideViewport,
  shouldUpdateGuideVisibility,
} from './lib/guideGridLayout'

export class GuideGridRenderer {
  private container: HTMLElement | null = null
  private channelHeader: HTMLElement | null = null
  private timeScale: HTMLElement | null = null
  private programGrid: HTMLElement | null = null
  private currentTimeline: HTMLElement | null = null
  private timerId: ReturnType<typeof setTimeout> | null = null
  private layout: GuideGridLayout | null = null
  private input: GuideGridRendererInput | null = null
  private programDoms: ProgramDomItem[] = []
  private programDomIndex = new Map<number, HTMLElement[]>()
  private latestScrollData: GuideScrollData = { scrollLeft: 0, scrollTop: 0 }
  private generation = 0
  private readonly onScroll = () => {
    this.syncScrollFromProgramGrid()
  }
  private readonly onClick = (event: MouseEvent) => {
    if (this.input !== null) {
      dispatchGuideGridClick(event, this.input, this.layout)
    }
  }
  private readonly dragScroller = new GuideGridDragScroller(() => {
    this.syncScrollFromProgramGrid()
  })

  async mount(container: HTMLElement, input: GuideGridRendererInput): Promise<void> {
    this.destroy()
    const generation = ++this.generation
    this.container = container
    this.input = input
    this.layout = createGuideGridLayout(input)
    this.container.replaceChildren()

    const channelHeader = createGridElement('guide-channel-header', 'guide-channel-header')
    const body = createGridElement('guide-grid-body')
    const timeScale = createGridElement('guide-time-scale', 'guide-time-scale')
    const programGrid = createGridElement('guide-program-grid', 'guide-program-grid')
    const content = createGridContent(this.layout)

    renderChannelHeader(channelHeader, this.layout)
    renderTimeScale(timeScale, this.layout)
    this.currentTimeline = createTimelineElement()
    content.appendChild(this.currentTimeline)
    this.updateTimelinePosition()
    programGrid.appendChild(content)
    programGrid.addEventListener('scroll', this.onScroll)
    programGrid.addEventListener('click', this.onClick)
    channelHeader.addEventListener('click', this.onClick)
    this.dragScroller.attach(programGrid)
    body.append(timeScale, programGrid)
    container.append(channelHeader, body)

    this.channelHeader = channelHeader
    this.timeScale = timeScale
    this.programGrid = programGrid

    const appended = await this.appendProgramCells(content, generation)
    if (!appended || !this.isCurrentGeneration(generation)) {
      return
    }
    this.updateVisibility()
    this.scheduleTimelineUpdate()
  }

  updateReserveIndex(reserveIndex: GuideReserveIndex): void {
    if (this.input === null) {
      return
    }
    const scrollData = this.latestScrollData

    applyReserveStateClasses(this.programDomIndex, reserveIndex)
    this.input = {
      ...this.input,
      reserveIndex,
    }
    this.restoreScroll(scrollData)
  }

  updateGenreVisibility(genreVisibility: GuideGenreVisibility): void {
    if (this.input === null) {
      return
    }
    const scrollData = this.latestScrollData

    applyGenreVisibilityClasses(this.programDoms, genreVisibility)
    this.input = {
      ...this.input,
      genreVisibility,
    }
    this.restoreScroll(scrollData)
  }

  restoreScroll(data: GuideScrollData): void {
    this.latestScrollData = data
    if (this.programGrid !== null) {
      this.programGrid.scrollLeft = data.scrollLeft
      this.programGrid.scrollTop = data.scrollTop
    }
    if (this.channelHeader !== null) {
      this.channelHeader.scrollLeft = data.scrollLeft
    }
    if (this.timeScale !== null) {
      this.timeScale.scrollTop = data.scrollTop
    }
    this.updateVisibility()
  }

  getScrollData(): GuideScrollData {
    if (this.programGrid === null) {
      return this.latestScrollData
    }

    return {
      scrollLeft: this.programGrid.scrollLeft,
      scrollTop: this.programGrid.scrollTop,
    }
  }

  destroy(): void {
    if (this.programGrid !== null) {
      this.programGrid.removeEventListener('scroll', this.onScroll)
      this.programGrid.removeEventListener('click', this.onClick)
    }
    if (this.channelHeader !== null) {
      this.channelHeader.removeEventListener('click', this.onClick)
    }
    this.generation += 1
    this.dragScroller.detach()
    if (this.timerId !== null) {
      clearTimeout(this.timerId)
      this.timerId = null
    }
    this.container?.replaceChildren()
    this.container = null
    this.channelHeader = null
    this.timeScale = null
    this.programGrid = null
    this.currentTimeline = null
    this.layout = null
    this.input = null
    this.programDoms = []
    this.programDomIndex = new Map()
  }

  private async appendProgramCells(content: HTMLElement, generation: number): Promise<boolean> {
    const fragment = document.createDocumentFragment()
    const layout = this.requireLayout()
    const input = this.requireInput()

    for (let index = 0; index < layout.programs.length; index += 1) {
      const layoutProgram = layout.programs[index]
      const element = createProgramElement(layoutProgram, input)

      fragment.appendChild(element)
      this.programDoms.push({
        element,
        program: layoutProgram.program,
        channelIndex: layoutProgram.channelIndex,
        topMinutes: layoutProgram.topMinutes,
        heightMinutes: layoutProgram.heightMinutes,
        isVisible: input.guideMode === 'all',
      })
      const indexed = this.programDomIndex.get(layoutProgram.program.id) ?? []
      indexed.push(element)
      this.programDomIndex.set(layoutProgram.program.id, indexed)

      if ((index + 1) % 500 === 0) {
        content.appendChild(fragment)
        await nextFrame()
        if (!this.isCurrentGeneration(generation)) {
          return false
        }
      }
    }

    content.appendChild(fragment)
    return true
  }

  private syncScrollFromProgramGrid(): void {
    if (this.programGrid === null) {
      return
    }

    const scrollData = {
      scrollLeft: this.programGrid.scrollLeft,
      scrollTop: this.programGrid.scrollTop,
    }
    this.latestScrollData = scrollData
    if (this.channelHeader !== null) {
      this.channelHeader.scrollLeft = scrollData.scrollLeft
    }
    if (this.timeScale !== null) {
      this.timeScale.scrollTop = scrollData.scrollTop
    }
    this.updateVisibility()
  }

  private updateVisibility(): void {
    const input = this.input

    if (input === null || input.guideMode === 'all' || this.programGrid === null) {
      return
    }

    const sizeVariables = resolveSizeVariables(this.container, input)
    applyGuideGridVisibility({
      programDoms: this.programDoms,
      input,
      viewport: createGridViewport(this.programGrid, this.requireLayout(), sizeVariables),
      sizeVariables,
    })
  }

  private updateTimelinePosition(): void {
    if (this.input === null || this.currentTimeline === null) {
      return
    }

    this.currentTimeline.style.top = resolveTimelineTop(this.input, MINUTE_MS)
  }

  private scheduleTimelineUpdate(): void {
    const generation = this.generation
    const delay = (60 - new Date(this.input?.now?.() ?? Date.now()).getSeconds()) * 1000

    this.timerId = setTimeout(() => {
      if (!this.isCurrentGeneration(generation)) {
        return
      }
      this.updateTimelinePosition()
      this.scheduleTimelineUpdate()
    }, delay)
  }

  private isCurrentGeneration(generation: number): boolean {
    return this.generation === generation && this.container !== null
  }

  private requireLayout(): GuideGridLayout {
    if (this.layout === null) {
      throw new Error('GuideGridRendererLayoutMissing')
    }

    return this.layout
  }

  private requireInput(): GuideGridRendererInput {
    if (this.input === null) {
      throw new Error('GuideGridRendererInputMissing')
    }

    return this.input
  }
}
