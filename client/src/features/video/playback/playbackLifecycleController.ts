import {
  HLS_MISSING_ID_SNACKBAR,
  HLS_READINESS_FAILURE_MESSAGE,
  HLS_START_FAILURE_SNACKBAR,
  HLS_STREAM_LOST_MESSAGE,
  areSameStreamId,
  buildHlsPlaylistUrl,
  clearTimer,
  type HlsLifecycleSnapshot,
  type HlsStreamId,
} from './playbackLifecycleTypes'
import { HlsLifecycleControllerBase } from './playbackLifecycleControllerBase'

export class HlsLifecycleController extends HlsLifecycleControllerBase {
  async start(): Promise<HlsLifecycleSnapshot> {
    const previousStreamId = this.current.streamId
    const token = this.nextGeneration()
    if (previousStreamId !== null) {
      await this.stopStream(previousStreamId, false)
    }
    if (!this.isCurrentGeneration(token)) {
      return this.snapshot()
    }
    this.abortController = new AbortController()
    this.setSnapshot({
      state: 'starting',
      streamId: null,
      errorMessage: null,
      snackbarText: null,
    })

    this.unsubscribeReadiness = this.subscribeReadiness?.(() => {
      if (this.isCurrentGeneration(token)) {
        this.requestReadinessCheck?.()
      }
    })

    let streamId: HlsStreamId | null
    try {
      streamId =
        this.startRetryCount <= 0
          ? (await this.repository.start(this.abortController.signal)).streamId
          : await this.startWithRetry(token)
    } catch {
      if (this.isCurrentGeneration(token)) {
        this.clearAbortableResources()
        this.setSnapshot({
          state: 'error',
          streamId: null,
          errorMessage: HLS_START_FAILURE_SNACKBAR,
          snackbarText: HLS_START_FAILURE_SNACKBAR,
        })
      }

      return this.snapshot()
    }

    if (!this.isCurrentGeneration(token)) {
      if (streamId !== null) {
        await this.stopStream(streamId, false)
      }

      return this.snapshot()
    }

    if (streamId === null) {
      this.clearAbortableResources()
      this.setSnapshot({
        state: 'error',
        streamId: null,
        errorMessage: HLS_MISSING_ID_SNACKBAR,
        snackbarText: HLS_MISSING_ID_SNACKBAR,
      })

      return this.snapshot()
    }

    this.startKeepTimer(streamId)
    this.setSnapshot({
      state: 'waiting',
      streamId,
      errorMessage: null,
      snackbarText: null,
    })

    await this.waitForReadiness(token, streamId)

    return this.snapshot()
  }

  protected async startWithRetry(token: number): Promise<HlsStreamId | null> {
    let lastError: unknown
    let attempt = 0
    while (true) {
      if (!this.isCurrentGeneration(token)) {
        throw lastError ?? new Error('HLS stream start aborted')
      }
      try {
        return (await this.repository.start(this.abortController?.signal)).streamId
      } catch (error) {
        lastError = error
        if (attempt >= this.startRetryCount) {
          throw error
        }
        await this.delayRetry(token)
        attempt += 1
      }
    }
  }

  async stop(): Promise<HlsLifecycleSnapshot> {
    this.generation += 1
    const streamId = this.current.streamId
    this.clearAbortableResources()

    if (streamId !== null) {
      await this.stopStream(streamId, true)
    }

    this.setSnapshot({
      state: 'stopped',
      streamId: null,
      errorMessage: null,
      snackbarText: this.current.snackbarText,
    })

    return this.snapshot()
  }

  cleanup({
    emit = true,
    onStopFailure,
  }: {
    emit?: boolean
    onStopFailure?: () => void
  } = {}): void {
    this.generation += 1
    const streamId = this.current.streamId
    this.clearAbortableResources()
    if (emit) {
      this.setSnapshot({
        state: 'stopped',
        streamId: null,
        errorMessage: null,
        snackbarText: null,
      })
    }

    if (streamId !== null) {
      void this.stopStream(streamId, false, onStopFailure)
    }
  }

  protected waitForReadiness(token: number, streamId: HlsStreamId): Promise<void> {
    return new Promise((resolve) => {
      let isSettling = false
      let hasCompleted = false
      let checking = false
      let checkAgain = false
      const completeWait = () => {
        if (hasCompleted) {
          return
        }
        isSettling = true
        hasCompleted = true
        if (this.resolveReadinessWait === completeWait) {
          this.resolveReadinessWait = undefined
        }
        resolve()
      }
      this.resolveReadinessWait = completeWait
      const resolveReady = () => {
        isSettling = true
        this.clearReadinessResources()
        this.setSnapshot({
          state: 'ready',
          streamId,
          playlistUrl: buildHlsPlaylistUrl(streamId, this.playlistBasePath),
          errorMessage: null,
          snackbarText: null,
        })
        completeWait()
      }
      const resolveTerminal = async (message: string) => {
        if (!this.isCurrentGeneration(token)) {
          completeWait()
          return
        }
        if (isSettling) {
          return
        }
        isSettling = true
        this.clearReadinessResources()
        this.abortController?.abort()
        this.abortController = undefined
        this.keepTimerId = clearTimer(this.keepTimerId)
        await this.stopStream(streamId, false)
        if (this.isCurrentGeneration(token)) {
          this.setSnapshot({
            state: 'error',
            streamId: null,
            errorMessage: message,
            snackbarText: null,
          })
        }
        completeWait()
      }
      // Fetch errors (network/HTTP failure) and the readinessTimeoutMs safety net both mean
      // "we could not determine whether the stream is still starting", so both use the
      // generic readiness-failure message.
      const resolveFailure = () => resolveTerminal(HLS_READINESS_FAILURE_MESSAGE)
      // The stream disappearing from a *successful* /api/streams response means the server
      // has already removed it (start failed after the id was issued, or the source process
      // exited -- see StreamManageModel.ts rejectStart()/attachStream()'s setExitStream()).
      // That is a definite failure signal, unlike isEnabled staying false, so it is reported
      // immediately instead of waiting for readinessTimeoutMs.
      const resolveMissing = () => resolveTerminal(HLS_STREAM_LOST_MESSAGE)
      const poll = async () => {
        try {
          const streams = await this.repository.fetchStreams(this.abortController?.signal)
          if (!this.isCurrentGeneration(token)) {
            completeWait()
            return
          }
          if (isSettling) {
            return
          }
          const match = streams.find((stream) => areSameStreamId(stream.streamId, streamId))
          if (match === undefined) {
            await resolveMissing()
            return
          }
          if (match.isEnabled) {
            resolveReady()
            return
          }
          // match found but not enabled yet: still starting server-side, keep waiting.
        } catch {
          await resolveFailure()
        } finally {
          checking = false
          if (checkAgain) {
            requestCheck()
          }
        }
      }
      const requestCheck = () => {
        if (isSettling || !this.isCurrentGeneration(token)) {
          return
        }
        if (checking) {
          checkAgain = true
          return
        }
        checking = true
        checkAgain = false
        void poll()
      }

      this.requestReadinessCheck = requestCheck
      this.readinessTimerId = setInterval(requestCheck, this.readinessPollMs)
      this.readinessTimeoutId = setTimeout(() => {
        void resolveFailure()
      }, this.readinessTimeoutMs)
      requestCheck()
    })
  }
}
