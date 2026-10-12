import Mpegts from 'mpegts.js'

export interface MpegtsLivePlaybackCapability {
  isSupported(): boolean
  getFeatureList(): {
    mseLivePlayback?: boolean
  }
}

export function detectMpegtsLivePlaybackSupport(
  capability: MpegtsLivePlaybackCapability = Mpegts,
): boolean {
  return capability.isSupported() && capability.getFeatureList().mseLivePlayback === true
}
