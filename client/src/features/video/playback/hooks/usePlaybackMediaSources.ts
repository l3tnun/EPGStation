import type { MutableRefObject } from 'react'
import { useEffect, useRef } from 'react'
import Hls from 'hls.js'
import Mpegts from 'mpegts.js'
import type { PlaybackSubtitleAdapter } from '../playbackSubtitle'
import {
  attachHlsSubtitleMetadataBridge,
  attachMpegtsSubtitleMetadataBridge,
  type HlsMetadataEventSource,
} from '../playbackStreamMetadata'

export interface PlaybackMediaSourcesInput {
  videoRef: MutableRefObject<HTMLVideoElement | null>
  subtitleAdapterRef: MutableRefObject<PlaybackSubtitleAdapter | null>
  effectiveMediaUrl: string | undefined
  usesHlsJsMediaSource: boolean
  usesMpegtsMediaSource: boolean
}

export function usePlaybackMediaSources({
  videoRef,
  subtitleAdapterRef,
  effectiveMediaUrl,
  usesHlsJsMediaSource,
  usesMpegtsMediaSource,
}: PlaybackMediaSourcesInput) {
  const hlsPlayerRef = useRef<Hls | null>(null)
  const mpegtsPlayerRef = useRef<ReturnType<typeof Mpegts.createPlayer> | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!usesHlsJsMediaSource || video === null || effectiveMediaUrl === undefined) {
      hlsPlayerRef.current?.destroy()
      hlsPlayerRef.current = null
      return
    }

    const hls = new Hls()
    hlsPlayerRef.current = hls
    const detachSubtitleBridge = attachHlsSubtitleMetadataBridge({
      hls: hls as unknown as HlsMetadataEventSource,
      getSubtitleAdapter: () => subtitleAdapterRef.current,
    })
    hls.attachMedia(video)
    hls.loadSource(effectiveMediaUrl)
    hls.once(Hls.Events.MANIFEST_PARSED, () => {
      void video.play().catch((error: unknown) => {
        console.warn('video.play() failed', error)
      })
    })

    return () => {
      detachSubtitleBridge()
      hls.destroy()
      // React always runs this cleanup before this effect can run again for a new hls
      // instance, and hlsPlayerRef is only ever written inside this effect -- so it is
      // always still this closure's own `hls` here.
      hlsPlayerRef.current = null
    }
  }, [effectiveMediaUrl, subtitleAdapterRef, usesHlsJsMediaSource, videoRef])

  useEffect(() => {
    const video = videoRef.current
    if (!usesMpegtsMediaSource || video === null || effectiveMediaUrl === undefined) {
      mpegtsPlayerRef.current?.destroy()
      mpegtsPlayerRef.current = null
      return
    }

    const player = Mpegts.createPlayer(
      {
        type: 'mse',
        isLive: true,
        url: effectiveMediaUrl,
      },
      {
        enableWorker: true,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMinRemain: 1,
        liveBufferLatencyMaxLatency: 2,
      },
    )
    mpegtsPlayerRef.current = player
    const detachSubtitleBridge = attachMpegtsSubtitleMetadataBridge({
      player,
      getSubtitleAdapter: () => subtitleAdapterRef.current,
    })
    player.attachMediaElement(video)
    player.load()
    void player.play()

    return () => {
      detachSubtitleBridge()
      player.pause()
      player.unload()
      player.destroy()
      // See the equivalent comment in the HLS effect above: mpegtsPlayerRef is only
      // ever written inside this effect, so it is always still this closure's `player`.
      mpegtsPlayerRef.current = null
    }
  }, [effectiveMediaUrl, subtitleAdapterRef, usesMpegtsMediaSource, videoRef])
}
