import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPlaybackSubtitleAdapter,
  type Aribb24Module,
} from '@/features/video/playback/playbackSubtitle'

// vitest.setup.ts は aribb24.js を test 全体で mock に差し替えているので、この test だけ実物の Controller を読む。
const { Controller } = await vi.importActual<typeof import('aribb24.js')>('aribb24.js')

// aribb24.js の実際の Controller を使い、Feeder と Renderer だけを合成の実装にする。Feeder は常に表示中の字幕を
// 1 件返し、Renderer は描画の呼出しを数え、show()・hide() で見えているかを持つ。字幕が見えることを「Renderer が
// 見えていて、字幕が描かれている」として観測する。
class SyntheticFeeder {
  public onAttach(): void {}
  public onDetach(): void {}
  public prepare(): void {}
  public onSeeking(): void {}
  public feedID3(): void {}
  public feedB24(): void {}
  public destroy(): void {}
  public content(): {
    pts: number
    duration: number
    state: object
    data: unknown[]
    info: object
  } {
    return { pts: 0, duration: Number.POSITIVE_INFINITY, state: {}, data: [], info: {} }
  }
}

const renderers: SyntheticRenderer[] = []

class SyntheticRenderer {
  public renderCount = 0
  public visible = true
  public constructor() {
    renderers.push(this)
  }
  public onAttach(): void {}
  public onDetach(): void {}
  public onPlay(): void {}
  public onPause(): void {}
  public onSeeking(): void {}
  public onContainerResize(): boolean {
    return false
  }
  public onVideoResize(): boolean {
    return false
  }
  public show(): void {
    this.visible = true
  }
  public hide(): void {
    this.visible = false
  }
  public clear(): void {}
  public render(): void {
    this.renderCount += 1
  }
  public destroy(): void {}
}

class SyntheticResizeObserver {
  public observe(): void {}
  public unobserve(): void {}
  public disconnect(): void {}
}

const loadAribb24Module = (): Aribb24Module =>
  ({
    Controller,
    Feeder: SyntheticFeeder,
    Renderer: SyntheticRenderer,
  }) as unknown as Aribb24Module

const makeVideo = (): HTMLVideoElement => {
  const container = document.createElement('div')
  const video = document.createElement('video')
  container.appendChild(video)
  document.body.appendChild(container)
  return video
}

const advanceFrames = (count: number): void => {
  for (let frame = 0; frame < count; frame += 1) {
    vi.advanceTimersToNextFrame()
  }
}

describe('Video Playback aribb24 subtitle visibility', () => {
  beforeEach(() => {
    renderers.length = 0
    vi.stubGlobal('ResizeObserver', SyntheticResizeObserver)
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  it('[AC 4.4a] draws subtitles once they are turned on after playback started while they were off', () => {
    const video = makeVideo()
    const adapter = createPlaybackSubtitleAdapter({
      video,
      rendererKind: 'aribb24',
      strokeEnabled: false,
      preferRenderer: true,
      loadAribb24Module,
    })
    expect(adapter?.kind).toBe('aribb24')

    // 字幕を off にしたまま再生を始め、一時停止して再開する。off の間は caption も superimpose も見えない
    adapter?.setVisible(false)
    video.dispatchEvent(new Event('play'))
    advanceFrames(2)
    video.dispatchEvent(new Event('pause'))
    advanceFrames(1)
    video.dispatchEvent(new Event('play'))
    advanceFrames(2)
    expect(renderers.map((renderer) => renderer.visible)).toEqual([false, false])

    // on にした時点から、caption と superimpose の両方で字幕が見える
    adapter?.setVisible(true)
    advanceFrames(2)
    expect(renderers.map((renderer) => renderer.visible)).toEqual([true, true])
    expect(renderers.every((renderer) => renderer.renderCount > 0)).toBe(true)

    adapter?.dispose()
  })

  it('[AC 4.4a] keeps drawing with a single rendering loop when subtitles are turned on repeatedly', () => {
    const video = makeVideo()
    const adapter = createPlaybackSubtitleAdapter({
      video,
      rendererKind: 'aribb24',
      strokeEnabled: false,
      preferRenderer: true,
      loadAribb24Module,
    })

    adapter?.setVisible(true)
    video.dispatchEvent(new Event('play'))
    adapter?.setVisible(true)
    adapter?.setVisible(true)
    advanceFrames(3)
    expect(renderers.every((renderer) => renderer.renderCount > 0)).toBe(true)
    // caption と superimpose の Controller が描画 loop を 1 つずつ持つ。二重に登録されていれば 3 つ以上残る
    expect(vi.getTimerCount()).toBe(2)

    // off にしても loop は 1 つずつのまま回り、dispose で 1 つも残らない
    adapter?.setVisible(false)
    advanceFrames(1)
    expect(vi.getTimerCount()).toBe(2)
    adapter?.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
})
