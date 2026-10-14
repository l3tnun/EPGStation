import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPlaybackSubtitleAdapter,
  type Aribb24Module,
} from '@/features/video/playback/playbackSubtitle'

// vitest.setup.ts は aribb24.js を test 全体で mock に差し替えているので、この test だけ実物の Controller を読む。
const { Controller } = await vi.importActual<typeof import('aribb24.js')>('aribb24.js')

// aribb24.js の実際の Controller を使い、Feeder と Renderer だけを合成の実装にする。Feeder は常に表示中の字幕を
// 1 件返し、Renderer は描画の呼出しを数える。これで「描画 loop が動いているか」を描画の回数として観測する。
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
  public show(): void {}
  public hide(): void {}
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

    // 字幕を off にしたまま再生を始める
    adapter?.setVisible(false)
    video.dispatchEvent(new Event('play'))
    advanceFrames(2)
    expect(renderers.map((renderer) => renderer.renderCount)).toEqual([0, 0])

    // on にした時点から、caption と superimpose の両方で描画する
    adapter?.setVisible(true)
    advanceFrames(2)
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
    // 描画 loop が二重に登録されていれば、1 frame に 2 回以上の requestAnimationFrame が残る
    expect(vi.getTimerCount()).toBe(2)

    adapter?.setVisible(false)
    expect(vi.getTimerCount()).toBe(0)
    adapter?.dispose()
  })
})
