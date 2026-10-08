import {
  HLS_STOP_FAILURE_SNACKBAR,
  clearTimer,
  type HlsLifecycleControllerOptions,
  type HlsLifecycleRepository,
  type HlsLifecycleSnapshot,
  type HlsStreamId,
} from './playbackLifecycleTypes'

export class HlsLifecycleControllerBase {
  protected readonly repository: HlsLifecycleRepository
  protected readonly readinessPollMs: number
  protected readonly readinessTimeoutMs: number
  protected readonly keepIntervalMs: number
  protected readonly startRetryCount: number
  protected readonly retryDelayMs: number
  protected readonly playlistBasePath: string
  protected readonly onChange?: (snapshot: HlsLifecycleSnapshot) => void
  protected readinessTimerId: ReturnType<typeof setInterval> | undefined
  protected readinessTimeoutId: ReturnType<typeof setTimeout> | undefined
  protected keepTimerId: ReturnType<typeof setInterval> | undefined
  protected abortController: AbortController | undefined
  protected resolveReadinessWait: (() => void) | undefined
  protected generation = 0
  protected current: HlsLifecycleSnapshot = {
    state: 'idle',
    streamId: null,
    errorMessage: null,
    snackbarText: null,
  }

  constructor({
    repository,
    readinessPollMs = 1000,
    // Safety net only: /api/streams distinguishes "still starting" (isEnabled: false,
    // streamId present) from "failed/stopped" (streamId absent) -- see
    // playbackLifecycleController.ts waitForReadiness(). A present-but-disabled stream is
    // never treated as a failure by elapsed time alone, so this bound only protects against a
    // stream entry that never becomes enabled and is never removed server-side (a scenario
    // that has not been observed, but that the server imposes no timeout on either; see
    // StreamBaseModel.ts startCheckStreamEnable()). 30000 (30s) was too short for real tuner/
    // encoder start latency and would make readiness fail while the server was still healthy.
    readinessTimeoutMs = 1800000,
    keepIntervalMs = 10000,
    startRetryCount = 0,
    retryDelayMs = 500,
    playlistBasePath = './streamfiles',
    onChange,
  }: HlsLifecycleControllerOptions) {
    this.repository = repository
    this.readinessPollMs = readinessPollMs
    this.readinessTimeoutMs = readinessTimeoutMs
    this.keepIntervalMs = keepIntervalMs
    this.startRetryCount = startRetryCount
    this.retryDelayMs = retryDelayMs
    this.playlistBasePath = playlistBasePath
    this.onChange = onChange
  }

  snapshot(): HlsLifecycleSnapshot {
    return { ...this.current }
  }

  protected nextGeneration(): number {
    this.generation += 1
    this.clearAbortableResources()

    return this.generation
  }

  protected isCurrentGeneration(token: number): boolean {
    return token === this.generation
  }

  protected setSnapshot(snapshot: HlsLifecycleSnapshot): void {
    this.current = snapshot
    this.onChange?.(this.snapshot())
  }

  protected clearAbortableResources(): void {
    this.readinessTimerId = clearTimer(this.readinessTimerId)
    if (this.readinessTimeoutId !== undefined) {
      clearTimeout(this.readinessTimeoutId)
      this.readinessTimeoutId = undefined
    }
    this.keepTimerId = clearTimer(this.keepTimerId)
    this.resolveReadinessWait?.()
    this.resolveReadinessWait = undefined
    this.abortController?.abort()
    this.abortController = undefined
  }

  protected startKeepTimer(streamId: HlsStreamId): void {
    this.keepTimerId = clearTimer(this.keepTimerId)
    this.keepTimerId = setInterval(() => {
      void this.repository.keep(streamId).catch(() => undefined)
    }, this.keepIntervalMs)
  }

  protected async stopStream(
    streamId: HlsStreamId,
    reportFailure: boolean,
    onFailure?: () => void,
  ): Promise<void> {
    try {
      await this.repository.stop(streamId)
    } catch {
      onFailure?.()
      if (reportFailure) {
        this.setSnapshot({
          ...this.current,
          snackbarText: HLS_STOP_FAILURE_SNACKBAR,
        })
      }
    }
  }

  protected delayRetry(token: number): Promise<void> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve()
      }, this.retryDelayMs)
      if (!this.isCurrentGeneration(token)) {
        clearTimeout(timeoutId)
        resolve()
      }
    })
  }
}
