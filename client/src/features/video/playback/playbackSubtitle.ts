import {
  Controller as DefaultController,
  MPEGTSFeeder as DefaultFeeder,
  CanvasMainThreadRenderer as DefaultRenderer,
} from 'aribb24.js'

export interface PlaybackSubtitleAdapter {
  kind: 'native-text-track' | 'aribb24'
  setVisible: (visible: boolean) => void
  pushID3v2Data: (pts: number, data: Uint8Array) => void
  pushMpegtsPrivateData: (packet: MpegtsPrivateDataPacket) => void
  dispose: () => void
}

// aribb24.js 2.x splits caption handling into a
// Controller (media/lifecycle glue), a Feeder (demuxes and decodes caption data),
// and a Renderer (paints the decoded captions). The three are minimal structural
// interfaces here (not the concrete aribb24.js classes) so a fake module can be
// injected in tests via loadAribb24Module.
export interface Aribb24Controller {
  attachMedia: (media: HTMLVideoElement, container?: HTMLElement) => void
  detachMedia: () => void
  attachFeeder: (feeder: Aribb24Feeder) => void
  detachFeeder: () => void
  attachRenderer: (renderer: Aribb24Renderer) => void
  detachRenderer: (renderer: Aribb24Renderer) => void
  show: () => void
  hide: () => void
}

export interface Aribb24Feeder {
  feedID3: (data: Uint8Array, pts: number, dts?: number) => void
  feedB24: (data: Uint8Array, pts: number, dts?: number) => void
  destroy: () => void
}

export interface Aribb24Renderer {
  destroy: () => void
}

export type Aribb24Module = {
  Controller: new () => Aribb24Controller
  // aribb24.js 2.x's Feeder constructor optionally takes a `{ recieve: { type } }`
  // option -- default 'Caption', or 'Superimpose' for the 字幕スーパー data group. Two
  // Feeders (one of each type) are constructed so both data groups are decoded; see
  // createAribb24Subsystem below.
  Feeder: new (option?: Record<string, unknown>) => Aribb24Feeder
  Renderer: new (options: Record<string, unknown>) => Aribb24Renderer
}

export type Aribb24ModuleLoader = () => Aribb24Module

export interface PlaybackSubtitleAdapterInput {
  video: HTMLVideoElement
  rendererKind: 'aribb24' | 'none'
  strokeEnabled: boolean
  preferRenderer?: boolean
  loadAribb24Module?: Aribb24ModuleLoader
}

export interface MpegtsPrivateDataPacket {
  stream_id: number
  pid: number
  data: Uint8Array
  pts: number
  nearest_pts?: number
}

export function createPlaybackSubtitleAdapter({
  video,
  rendererKind,
  strokeEnabled,
  preferRenderer = false,
  loadAribb24Module = loadDefaultAribb24Module,
}: PlaybackSubtitleAdapterInput): PlaybackSubtitleAdapter | null {
  if (!preferRenderer) {
    const nativeAdapter = createNativeTextTrackSubtitleAdapter(video)
    if (nativeAdapter !== null) {
      return nativeAdapter
    }
  }

  if (rendererKind !== 'aribb24') {
    return null
  }

  const { Controller, Feeder, Renderer } = loadAribb24Module()
  const baseOptions = createAribb24BaseOptions({ strokeEnabled })

  // ARIB carries ordinary captions (data_identifier 0x80) and 字幕スーパー / superimpose
  // (0x81) as two independent data groups. aribb24.js 2.x's Feeder only decodes the
  // single `recieve.type` it was constructed with ('Caption' by default) and silently
  // discards the other, and a Controller can only ever hold one Feeder at a time. So a
  // caption subsystem and a superimpose subsystem are built and attached to the same
  // video independently -- mirroring how v2 attached two separate CanvasRenderer
  // instances to the same <video> for the same reason.
  const caption = createAribb24Subsystem({ Controller, Feeder, Renderer, video, baseOptions })
  const superimpose = createAribb24Subsystem({
    Controller,
    Feeder,
    Renderer,
    video,
    baseOptions,
    feederOption: { recieve: { type: 'Superimpose' } },
  })

  return {
    kind: 'aribb24',
    setVisible: (visible) => {
      if (visible) {
        caption.controller.show()
        superimpose.controller.show()
        return
      }
      caption.controller.hide()
      superimpose.controller.hide()
    },
    pushID3v2Data: (pts, data) => {
      // The delivering side does not tag which data group an ID3v2 frame carries, so
      // both Feeders receive the same raw frame data and independently keep only the
      // data group matching their own `recieve.type` (see DecodingFeeder.feed).
      caption.feeder.feedID3(data, pts)
      superimpose.feeder.feedID3(data, pts)
    },
    pushMpegtsPrivateData: (packet) => {
      pushMpegtsPrivateData({ caption: caption.feeder, superimpose: superimpose.feeder }, packet)
    },
    dispose: () => {
      disposeAribb24Subsystem(caption)
      disposeAribb24Subsystem(superimpose)
    },
  }
}

interface Aribb24Subsystem {
  controller: Aribb24Controller
  feeder: Aribb24Feeder
  renderer: Aribb24Renderer
}

function createAribb24Subsystem({
  Controller,
  Feeder,
  Renderer,
  video,
  baseOptions,
  feederOption,
}: {
  Controller: Aribb24Module['Controller']
  Feeder: Aribb24Module['Feeder']
  Renderer: Aribb24Module['Renderer']
  video: HTMLVideoElement
  baseOptions: Record<string, unknown>
  feederOption?: Record<string, unknown>
}): Aribb24Subsystem {
  const controller = new Controller()
  const feeder = new Feeder(feederOption)
  const renderer = new Renderer(baseOptions)

  controller.attachFeeder(feeder)
  controller.attachRenderer(renderer)
  controller.attachMedia(video)

  return { controller, feeder, renderer }
}

function disposeAribb24Subsystem({ controller, feeder, renderer }: Aribb24Subsystem): void {
  // controller.detachMedia() removes the media/container event listeners and resize
  // observer, but it does not cancel an already-scheduled requestAnimationFrame loop by
  // itself -- only hide() does, via its own unregisterRenderingLoop() call. Call hide()
  // first so no rAF callback (and therefore no ResizeObserver either, once detachMedia
  // runs) is left running after dispose.
  controller.hide()
  controller.detachMedia()
  controller.detachFeeder()
  controller.detachRenderer(renderer)
  feeder.destroy()
  renderer.destroy()
}

export function createNativeTextTrackSubtitleAdapter(
  video: HTMLVideoElement,
): PlaybackSubtitleAdapter | null {
  const track = getFirstTextTrack(video.textTracks)
  if (track === null) {
    return null
  }

  return {
    kind: 'native-text-track',
    setVisible: (visible) => {
      track.mode = visible ? 'showing' : 'disabled'
    },
    pushID3v2Data: () => undefined,
    pushMpegtsPrivateData: () => undefined,
    dispose: () => undefined,
  }
}

export interface MpegtsPrivateDataFeeders {
  // private_stream_1, caption (data_identifier 0x80)
  caption?: Partial<Pick<Aribb24Feeder, 'feedB24'>>
  // private_stream_2, superimpose / 字幕スーパー (data_identifier 0x81)
  superimpose?: Partial<Pick<Aribb24Feeder, 'feedB24'>>
}

export function pushMpegtsPrivateData(
  feeders: MpegtsPrivateDataFeeders,
  packet: MpegtsPrivateDataPacket,
): void {
  if (packet.stream_id === 0xbd) {
    if (packet.data[0] !== 0x80 || feeders.caption?.feedB24 === undefined) {
      return
    }
    feeders.caption.feedB24(packet.data, packet.pts / 1000)
    return
  }

  if (packet.stream_id !== 0xbf || feeders.superimpose?.feedB24 === undefined) {
    return
  }

  const payload = packet.data[0] === 0x81 ? packet.data : parseMalformedPes(packet.data)
  if (payload[0] !== 0x81) {
    return
  }
  feeders.superimpose.feedB24(payload, (packet.nearest_pts ?? packet.pts) / 1000)
}

function parseMalformedPes(data: Uint8Array): Uint8Array {
  const ptsDtsFlags = (data[1] & 0xc0) >>> 6
  const pesHeaderDataLength = data[2]
  const payloadStart = ptsDtsFlags === 0x02 || ptsDtsFlags === 0x03 ? 3 + pesHeaderDataLength : 3

  return data.slice(payloadStart)
}

function getFirstTextTrack(textTracks: TextTrackList): TextTrack | null {
  if (textTracks.length === 0) {
    return null
  }

  const textTracksWithItem = textTracks as TextTrackList & {
    item?: (index: number) => TextTrack | null
  }
  if (typeof textTracksWithItem.item === 'function') {
    return textTracksWithItem.item(0)
  }

  return textTracks[0] ?? null
}

export function createAribb24BaseOptions({
  strokeEnabled,
}: {
  strokeEnabled: boolean
}): Record<string, unknown> {
  const font =
    isWindowsFirefox() === true
      ? '"Windows TV MaruGothic", "MS Gothic", "Yu Gothic", sans-serif'
      : '"Windows TV MaruGothic", "Hiragino Maru Gothic Pro", "HGMaruGothicMPRO", "Yu Gothic Medium", sans-serif'
  const options: Record<string, unknown> = {
    font: {
      normal: font,
      arib: font,
    },
    // DRCS (the glyphs a broadcaster defines and sends itself) is drawn from the
    // bitmap that arrived, which is what a receiver shows. 1.x substituted a
    // Unicode character for a known set of them; 2.x leaves `replace.drcs` empty
    // and draws what was sent. Keep it that way: the broadcaster's own glyph is
    // the faithful one, and a substitution table can only approximate it.
  }

  if (strokeEnabled) {
    options.color = { stroke: 'black' }
  }

  return options
}

function loadDefaultAribb24Module(): Aribb24Module {
  // The real aribb24.js classes structurally satisfy Aribb24Controller/Aribb24Feeder/
  // Aribb24Renderer (they simply expose more members, e.g. Controller.attachFeeder
  // accepts the library's full internal Feeder interface). TypeScript's contravariant
  // parameter check on class methods can't see that a caller here only ever passes an
  // object shaped like our slimmer Aribb24Feeder/Aribb24Renderer, so this cast asserts
  // what has been verified by reading the aribb24.js 2.0.25 source directly.
  return {
    Controller: DefaultController,
    Feeder: DefaultFeeder,
    Renderer: DefaultRenderer,
  } as unknown as Aribb24Module
}

function isWindowsFirefox(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }

  return /Windows/i.test(navigator.userAgent) && /Firefox/i.test(navigator.userAgent)
}
