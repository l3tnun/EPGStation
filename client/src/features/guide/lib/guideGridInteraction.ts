import type { GuideGridLayout, GuideGridRendererInput } from './guideGridTypes'

/** Routes a click on a channel header or program cell to the renderer input callbacks. */
export function dispatchGuideGridClick(
  event: MouseEvent,
  input: GuideGridRendererInput,
  layout: GuideGridLayout | null,
): void {
  if (!(event.target instanceof Element)) {
    return
  }

  const channelHeader = event.target.closest<HTMLElement>('[data-channel-index]')
  const channelIndex = Number(channelHeader?.dataset.channelIndex)
  if (
    input.onChannelClick !== undefined &&
    Number.isSafeInteger(channelIndex) &&
    layout?.channels[channelIndex] !== undefined
  ) {
    input.onChannelClick(layout.channels[channelIndex])
    return
  }

  if (input.onProgramClick === undefined) {
    return
  }

  const cell = event.target.closest<HTMLElement>('[data-program-id]')
  const programId = Number(cell?.dataset.programId)

  if (Number.isSafeInteger(programId)) {
    input.onProgramClick(programId)
  }
}

/** Mouse-drag scrolling of the program grid (`is-dragging` while the pointer moves). */
export class GuideGridDragScroller {
  private isPushed = false
  private baseClientX = 0
  private baseClientY = 0
  private dragTimerId: ReturnType<typeof setTimeout> | null = null
  private programGrid: HTMLElement | null = null

  constructor(private readonly onScrolled: () => void) {}

  readonly onMouseDown = (event: MouseEvent) => {
    this.isPushed = true
    this.baseClientX = event.clientX
    this.baseClientY = event.clientY
  }

  readonly onMouseUp = () => {
    this.isPushed = false
  }

  readonly onMouseMove = (event: MouseEvent) => {
    if (!this.isPushed || this.programGrid === null) {
      return
    }

    this.programGrid.classList.add('is-dragging')
    this.programGrid.scrollLeft += this.baseClientX - event.clientX
    this.programGrid.scrollTop += this.baseClientY - event.clientY
    this.baseClientX = event.clientX
    this.baseClientY = event.clientY
    this.onScrolled()

    if (this.dragTimerId !== null) {
      clearTimeout(this.dragTimerId)
    }
    this.dragTimerId = setTimeout(() => {
      this.programGrid?.classList.remove('is-dragging')
      this.dragTimerId = null
    }, 100)
  }

  attach(programGrid: HTMLElement): void {
    this.programGrid = programGrid
    programGrid.addEventListener('mousedown', this.onMouseDown)
    document.addEventListener('mouseup', this.onMouseUp)
    document.addEventListener('mousemove', this.onMouseMove)
  }

  detach(): void {
    this.programGrid?.removeEventListener('mousedown', this.onMouseDown)
    document.removeEventListener('mouseup', this.onMouseUp)
    document.removeEventListener('mousemove', this.onMouseMove)
    if (this.dragTimerId !== null) {
      clearTimeout(this.dragTimerId)
      this.dragTimerId = null
    }
    this.programGrid = null
    this.isPushed = false
  }
}
