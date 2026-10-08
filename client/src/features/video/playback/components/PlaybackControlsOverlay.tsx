import type { RefObject } from 'react'
import type { PlaybackControlVisibility } from '../playbackControls'
import type { SubtitleRendererContract } from '../playbackSettings'
import styles from '../PlaybackPage.module.css'

export interface PlaybackControlsOverlayProps {
  controlVisibility: PlaybackControlVisibility
  subtitleContract: SubtitleRendererContract
  isFullscreen: boolean
  isPaused: boolean
  playbackRate: number
  volume: number
  volumeLabel: string
  volumeIcon: string
  effectiveDuration: number
  currentTime: number
  pendingSeekTime: number | null
  rangeSeekElementRef: RefObject<HTMLInputElement | null>
  onRotateScreen: () => void
  onSeekBy: (deltaSeconds: number) => void
  onTogglePlay: () => void
  onSetPlaybackRate: (nextRate: number) => void
  onPreviewSeekBarTime: (nextTime: number) => void
  onCommitSeekBarTime: () => void
  onCancelSeekBarPreview: () => void
  onToggleMute: () => void
  onVolumeInput: (nextVolume: number) => void
  onToggleSubtitle: () => void
  onEnterPictureInPicture: () => void
  onToggleFullscreen: () => void
}

function PlaybackIcon({ icon }: { icon: string }) {
  return <span aria-hidden="true" className={styles.playbackIcon} data-playback-icon={icon} />
}

// resolvePlaybackControlVisibility() (the only source of the timeDisplay argument)
// always produces a "<current>/<total>" string, so the separator is always found.
function renderTimeDisplay(timeDisplay: string) {
  const separatorIndex = timeDisplay.indexOf('/')

  return (
    <>
      <span>{timeDisplay.slice(0, separatorIndex)}</span>
      <span className={styles.timeSeparator}>/</span>
      <span>{timeDisplay.slice(separatorIndex + 1)}</span>
    </>
  )
}

export function PlaybackControlsOverlay({
  controlVisibility,
  subtitleContract,
  isFullscreen,
  isPaused,
  playbackRate,
  volume,
  volumeLabel,
  volumeIcon,
  effectiveDuration,
  currentTime,
  pendingSeekTime,
  rangeSeekElementRef,
  onRotateScreen,
  onSeekBy,
  onTogglePlay,
  onSetPlaybackRate,
  onPreviewSeekBarTime,
  onCommitSeekBarTime,
  onCancelSeekBarPreview,
  onToggleMute,
  onVolumeInput,
  onToggleSubtitle,
  onEnterPictureInPicture,
  onToggleFullscreen,
}: PlaybackControlsOverlayProps) {
  const playPauseLabel = isPaused ? '再生' : '一時停止'
  const playPauseIcon = isPaused ? 'play' : 'pause'

  return (
    <>
      {controlVisibility.showRotationButton && isFullscreen ? (
        <button
          aria-label="画面回転"
          className={styles.rotationButton}
          type="button"
          onClick={onRotateScreen}
        >
          <PlaybackIcon icon="screen-rotation" />
        </button>
      ) : undefined}
      <div className={styles.centerControls} data-testid="playback-center-controls">
        {controlVisibility.showFastSeekControls ? (
          <>
            <button aria-label="30秒戻る" type="button" onClick={() => onSeekBy(-30)}>
              <PlaybackIcon icon="rewind-30" />
            </button>
            <button aria-label="10秒戻る" type="button" onClick={() => onSeekBy(-10)}>
              <PlaybackIcon icon="rewind-10" />
            </button>
          </>
        ) : undefined}
        <button aria-label={playPauseLabel} type="button" onClick={onTogglePlay}>
          <PlaybackIcon icon={playPauseIcon} />
        </button>
        {controlVisibility.showFastSeekControls ? (
          <>
            <button aria-label="10秒進む" type="button" onClick={() => onSeekBy(10)}>
              <PlaybackIcon icon="forward-10" />
            </button>
            <button aria-label="30秒進む" type="button" onClick={() => onSeekBy(30)}>
              <PlaybackIcon icon="forward-30" />
            </button>
          </>
        ) : undefined}
      </div>
      {controlVisibility.showSpeedControls ? (
        <div className={styles.speedControls} data-testid="playback-speed-controls">
          <button
            aria-label="再生速度を上げる"
            type="button"
            onClick={() => onSetPlaybackRate(playbackRate + 0.1)}
          >
            <PlaybackIcon icon="plus-circle" />
          </button>
          <button
            aria-label="再生速度を標準に戻す"
            type="button"
            onClick={() => onSetPlaybackRate(1)}
          >
            X{playbackRate.toFixed(1)}
          </button>
          <button
            aria-label="再生速度を下げる"
            type="button"
            onClick={() => onSetPlaybackRate(playbackRate - 0.1)}
          >
            <PlaybackIcon icon="minus-circle" />
          </button>
        </div>
      ) : undefined}
      <div className={styles.bottomControls} data-testid="playback-bottom-controls">
        <input
          aria-label="シーク"
          disabled={!controlVisibility.canSeek}
          max={effectiveDuration}
          min={0}
          ref={rangeSeekElementRef}
          onChange={(event) => {
            onPreviewSeekBarTime(Number(event.currentTarget.value))
          }}
          onInput={(event) => {
            onPreviewSeekBarTime(Number(event.currentTarget.value))
          }}
          onMouseUp={() => onCommitSeekBarTime()}
          onBlur={() => onCommitSeekBarTime()}
          onKeyUp={() => onCommitSeekBarTime()}
          onPointerCancel={onCancelSeekBarPreview}
          onPointerUp={() => onCommitSeekBarTime()}
          onTouchEnd={() => onCommitSeekBarTime()}
          type="range"
          value={pendingSeekTime ?? currentTime}
        />
        <div className={styles.bottomControlsRow}>
          {controlVisibility.showBottomPlayButton ? (
            <button aria-label={playPauseLabel} type="button" onClick={onTogglePlay}>
              <PlaybackIcon icon={playPauseIcon} />
            </button>
          ) : undefined}
          <button aria-label={volumeLabel} type="button" onClick={onToggleMute}>
            <PlaybackIcon icon={volumeIcon} />
          </button>
          {controlVisibility.showVolumeSlider ? (
            <input
              aria-label="音量"
              max={1}
              min={0}
              onChange={(event) => {
                onVolumeInput(Number(event.currentTarget.value))
              }}
              step={0.1}
              type="range"
              value={volume}
            />
          ) : undefined}
          <span
            aria-label={controlVisibility.timeDisplay}
            className={styles.timeDisplay}
            data-testid="playback-time-display"
          >
            {renderTimeDisplay(controlVisibility.timeDisplay)}
          </span>
          {controlVisibility.showSubtitleButton ? (
            <button
              data-subtitle-enabled={String(subtitleContract.isShowSubtitle)}
              className={subtitleContract.isShowSubtitle ? undefined : styles.disabledControl}
              aria-label="字幕"
              type="button"
              onClick={onToggleSubtitle}
            >
              <PlaybackIcon icon="subtitles" />
            </button>
          ) : undefined}
          {controlVisibility.showPictureInPictureButton ? (
            <button
              aria-label="ピクチャーインピクチャー"
              type="button"
              onClick={onEnterPictureInPicture}
            >
              <PlaybackIcon icon="picture-in-picture" />
            </button>
          ) : undefined}
          <button
            aria-label={isFullscreen ? 'フルスクリーン終了' : 'フルスクリーン'}
            type="button"
            onClick={onToggleFullscreen}
          >
            <PlaybackIcon icon={isFullscreen ? 'fullscreen-exit' : 'fullscreen'} />
          </button>
        </div>
      </div>
    </>
  )
}
