import Hls from 'hls.js'
import Mpegts from 'mpegts.js'
import type { PlaybackSubtitleAdapter } from './playbackSubtitle'

export interface HlsMetadataSample {
  pts: number
  data: Uint8Array
}

export interface HlsMetadataEventSource {
  on: (
    event: string,
    handler: (event: string, data: { samples: HlsMetadataSample[] }) => void,
  ) => void
  off?: (
    event: string,
    handler: (event: string, data: { samples: HlsMetadataSample[] }) => void,
  ) => void
}

export interface MpegtsPrivateDataEventSource {
  on: (
    event: string,
    handler: (data: Parameters<PlaybackSubtitleAdapter['pushMpegtsPrivateData']>[0]) => void,
  ) => void
  off?: (
    event: string,
    handler: (data: Parameters<PlaybackSubtitleAdapter['pushMpegtsPrivateData']>[0]) => void,
  ) => void
}

export function attachHlsSubtitleMetadataBridge({
  hls,
  getSubtitleAdapter,
}: {
  hls: HlsMetadataEventSource
  getSubtitleAdapter: () => PlaybackSubtitleAdapter | null
}): () => void {
  const handler = (_event: string, data: { samples: HlsMetadataSample[] }) => {
    const adapter = getSubtitleAdapter()
    if (adapter === null) {
      return
    }
    for (const sample of data.samples) {
      adapter.pushID3v2Data(sample.pts, sample.data)
    }
  }

  hls.on(Hls.Events.FRAG_PARSING_METADATA, handler)

  return () => {
    hls.off?.(Hls.Events.FRAG_PARSING_METADATA, handler)
  }
}

export function attachMpegtsSubtitleMetadataBridge({
  player,
  getSubtitleAdapter,
}: {
  player: MpegtsPrivateDataEventSource
  getSubtitleAdapter: () => PlaybackSubtitleAdapter | null
}): () => void {
  const handler = (data: Parameters<PlaybackSubtitleAdapter['pushMpegtsPrivateData']>[0]) => {
    getSubtitleAdapter()?.pushMpegtsPrivateData(data)
  }

  player.on(Mpegts.Events.PES_PRIVATE_DATA_ARRIVED, handler)

  return () => {
    player.off?.(Mpegts.Events.PES_PRIVATE_DATA_ARRIVED, handler)
  }
}
