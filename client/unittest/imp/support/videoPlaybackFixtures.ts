import type { LiveStreamConfig } from '@/app/serverApi'

export const streamConfig: LiveStreamConfig = {
  live: {
    ts: {
      m2ts: [{ name: 'm2ts-default' }],
      m2tsll: ['ll-low'],
      webm: ['webm-low', 'webm-high'],
      mp4: ['mp4-low'],
      hls: ['hls-low'],
    },
  },
  recorded: {
    ts: {
      webm: ['ts-webm'],
      hls: ['ts-hls'],
    },
    encoded: {
      mp4: ['encoded-mp4'],
      hls: ['encoded-hls-low', 'encoded-hls-high'],
    },
  },
}

export function flushMicrotasks(): Promise<void> {
  return Promise.resolve()
}

export function setNavigatorPlatform({
  maxTouchPoints,
  platform,
  userAgent,
}: {
  maxTouchPoints: number
  platform: string
  userAgent: string
}): void {
  Object.defineProperty(navigator, 'maxTouchPoints', {
    configurable: true,
    value: maxTouchPoints,
  })
  Object.defineProperty(navigator, 'platform', {
    configurable: true,
    value: platform,
  })
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: userAgent,
  })
}
