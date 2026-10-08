# Mock Data Contract: ビデオ再生

## 目的

Video Playback visual cases は player metadata、media source placeholder、stream state、subtitle samples を synthetic data で固定する。実 stream URL、実 file path、実番組名は使わない。

この文書の dataset 名と固定値は設計時の参照値（SVG の frame 用）で、コード上の識別子ではない。test の fixture は `client/e2e/support/videoPlaybackMocks.ts` と `client/unittest/spec/support/videoPlaybackSpecSupport.tsx` にある。

## Dataset

### `recordedPlaybackWeb`

- recorded item metadata、video file metadata、duration、subtitle availability を含める。
- `title`、`shortDescription`、`durationSeconds`、`currentTimeSeconds`、`subtitleAvailability`、`sourceKind` (`encoded` / `direct`)、`preferredPlaybackOnWeb` を含める。
- media source は `mock-media-recorded-001` のような id とし、実 URL や実 path を含めない。
- visual fixture 値は `title: "Synthetic Recorded Program A"`、`shortDescription: "Synthetic recorded description for visual layout."`、`durationSeconds: 1800`、`currentTimeSeconds: 615`、`currentTimeLabel: "10:15"`、`durationLabel: "30:00"`、`subtitleAvailability: true`、`sourceKind: "encoded"`、`preferredPlaybackOnWeb: true`、`mediaSourceId: "mock-media-recorded-001"` に固定する。

### `livePlaybackWeb`

- live channel / program metadata と stream type/mode を含める。
- `channelLabel`、`programTitle`、`streamType`、`modeLabel`、On Air owned info card の compact fields を含める。
- source URL は placeholder にし、host、token、query secret を含めない。
- visual fixture 値は `channelLabel: "Synthetic Channel 01"`、`programTitle: "Synthetic Live Program"`、`streamType: "hls"`、`modeLabel: "Synthetic Mode"`、`mediaSourceId: "mock-media-live-001"` に固定する。
- On Air owned info card の compact fields は visual fixture では `channelLabel`、`programTitle`、`streamType`、`modeLabel`、`statusLabel: "ON AIR"` だけを表示する。番組詳細、実 channel logo、実 thumbnail、実放送局名は含めない。

### `playbackControlledErrorInvalidRoute`

- invalid route を表す controlled error dataset とする。
- `errorCode: "synthetic-invalid-route"`、`inlineCopy: "再生条件が不正です"`、`expectedSnackbar: null`、`playerMountExpected: false`、`infoCardMountExpected: false` を固定値とする。
- stack trace、実 endpoint、実 file path は含めない。

### `playbackControlledErrorUnsupported`

- unsupported stream combination を表す controlled error dataset とする。
- `errorCode: "synthetic-unsupported-player"`、`inlineCopy: "非対応ブラウザーです。"`、`expectedSnackbar: null`、`playerMountExpected: true`、`infoCardMountExpected: false` を固定値とする。
- 実 browser UA、実 endpoint、stack trace、実 file path は含めない。

### `playbackStreamLoading`

- starting、playlist fetching、playing、cleanup の state を deterministic に切り替えられる。
- `lifecycleStep`、`elapsedMs`、`timeoutState`、`abortState`、`snackbarCopyVariant`、`recoverableErrorSummary`、`cleanupCompleted` を含める。
- HLS playlist content は tracked fixture に含めない。
- visual fixture の loading frame は `lifecycleStep: "playlist-fetching"`、`elapsedMs: 1200`、`timeoutState: false`、`abortState: false`、`snackbarCopyVariant: "none"`、`recoverableErrorSummary: "Synthetic stream is preparing"`、`cleanupCompleted: false` に固定する。

### `playbackSubtitleSamples`

- short subtitle、long subtitle、multi-line subtitle を含める。
- `strokeEnabled`、`showSubtitle`、`lineWrappingMaxWidth`、`multiLineSampleCount`、`rendererMounted` を含める。
- subtitle text は架空文にし、実番組由来の字幕を使わない。
- visual fixture 値は `shortSubtitle: "Synthetic subtitle line"`、`longSubtitle: "Synthetic subtitle line wraps safely within the player surface"`、`multiLineSubtitle: ["Synthetic subtitle line one", "Synthetic subtitle line two"]`、`strokeEnabled: true`、`showSubtitle: true`、`lineWrappingMaxWidth: 760`、`multiLineSampleCount: 2`、`rendererMounted: true` に固定する。

### `playerControlsRecordedPaused`

- recorded の finite duration player を表す。`durationSeconds` は 1 時間未満、`currentTimeSeconds` は duration 内の中間位置にする。
- `isPaused: true`、`controlsVisible: true`、`cursorHidden: false`、`isLoading: false`、`durationPositive: true` を含める。
- center controls は `centerPlayIcon: "play"`、`seekButtonsVisible: true`、`rewindSeconds: [30, 10]`、`forwardSeconds: [10, 30]` を含める。
- playback speed controls は `speedControlsVisible: true`、`speedControlsPlacement: "right-center"`、`playbackRate: 1.0`、`speedStep: 0.1`、`minPlaybackRate: 0.1`、`resetPlaybackRate: 1.0` を含める。
- bottom controls は `seekBarDisabled: false`、`bottomPlayIcon: "play"`、`currentTimeLabel`、`durationLabel`、`volume`、`volumeIconExpected`、`volumeSliderVisible: true`、`subtitleButtonVisible`、`subtitleEnabled`、`pipAvailable`、`pipButtonVisible`、`isFullscreen`、`fullscreenIconExpected` を含める。
- visual fixture 値は `durationSeconds: 1800`、`currentTimeSeconds: 615`、`currentTimeLabel: "10:15"`、`durationLabel: "30:00"`、`volume: 0.8`、`volumeIconExpected: "high"`、`subtitleButtonVisible: true`、`subtitleEnabled: true`、`pipAvailable: true`、`pipButtonVisible: true`、`isFullscreen: false`、`fullscreenIconExpected: "enter"`、`mediaSourceId: "mock-media-recorded-001"` に固定する。

### `playerControlsRecordedPlaying`

- `playerControlsRecordedPaused` と同じ shape を使い、`isPaused: false`、`centerPlayIcon: "pause"`、`bottomPlayIcon: "pause"` にする。
- `volumeIconExpected` は `volume > 0.4` なら `high`、`0 < volume <= 0.4` なら `medium`、`volume === 0` なら `off` を指定する。
- `fullscreenIconExpected` は `isFullscreen: false` なら `enter`、`isFullscreen: true` なら `exit` を指定する。
- visual fixture 値は `currentTimeSeconds: 735`、`currentTimeLabel: "12:15"`、`durationLabel: "30:00"`、`volume: 0.3`、`volumeIconExpected: "medium"`、`playbackRate: 1.2`、`isFullscreen: false`、`fullscreenIconExpected: "enter"` に固定する。

### `playerControlsLiveDurationZero`

- live または duration 未確定 player を表す。`durationSeconds: 0`、`durationPositive: false`、`seekButtonsVisible: false`、`speedControlsVisible: false` を含める。
- seek bar は `seekBarVisible: true`、`seekBarDisabled: true` とする。
- visual case の time display は `currentTimeLabel: "--:--"`、`durationLabel: "--:--"` を固定値とする。duration が 0 以下の間は常に `--:--` を表示する。
- center play/pause、volume、fullscreen は通常の表示条件を維持する。subtitle と PiP は別 field の条件に従う。
- visual fixture 値は `isPaused: false`、`centerPlayIcon: "pause"`、`bottomPlayIcon: "pause"`、`volume: 0.8`、`volumeIconExpected: "high"`、`subtitleButtonVisible: false`、`pipAvailable: true`、`pipButtonVisible: true`、`isFullscreen: false`、`mediaSourceId: "mock-media-live-001"` に固定する。

### `playerControlsNoSubtitleNoPip`

- finite duration player を表す。`subtitleAvailability: false`、`subtitleButtonVisible: false`、`pipAvailable: false`、`pipButtonVisible: false` を含める。
- bottom right controls は fullscreen button を維持し、subtitle/PiP の空 placeholder を描画しない。
- visual fixture 値は `durationSeconds: 1800`、`currentTimeSeconds: 615`、`currentTimeLabel: "10:15"`、`durationLabel: "30:00"`、`volume: 0`、`volumeIconExpected: "off"`、`isFullscreen: false`、`fullscreenIconExpected: "enter"` に固定する。

### `playerControlsIdleHidden`

- playing 中の非 Android 環境を表す。`isPaused: false`、`controlsVisible: false`、`cursorHidden: true`、`idleElapsedMs: 3000`、`isAndroid: false` を含める。
- media placeholder は synthetic id のみを使い、実 frame、実 thumbnail、実 URL を含めない。
- paused idle case を追加する場合は `isPaused: true`、`controlsVisible: true`、`cursorHidden: false` とし、controls hidden と混同しない。
- visual fixture 値は `durationSeconds: 1800`、`currentTimeSeconds: 900`、`mediaSourceId: "mock-media-recorded-001"` に固定する。

### `playerControlsNarrow420`

- viewport width が 420px 以下の recorded finite duration player を表す。`targetViewport: "narrow420"`、`viewportWidthPx <= 420` を含める。
- `speedControlsVisible: false`、`bottomPlayVisible: false`、`volumeSliderVisible: false`、`volumeButtonVisible: true` を期待値として含める。
- center play/pause、seek bar、time、subtitle、PiP、fullscreen は各表示条件を満たす限り維持する。
- visual fixture 値は `viewportWidthPx: 390`、`viewportHeightPx: 844`、`durationSeconds: 1800`、`currentTimeSeconds: 615`、`currentTimeLabel: "10:15"`、`durationLabel: "30:00"`、`volume: 0.8`、`volumeIconExpected: "high"`、`playbackRate: 1.0`、`subtitleButtonVisible: true`、`pipButtonVisible: true` に固定する。

## Responsive Fields

- `targetViewport`: `desktop`、`mobile`、`narrow420` のいずれか。
- `themeVariant`: `light` または `dark`。
- `mobileOrIpad`: volume slider visibility の判定用 boolean。
- `pipAvailable`: Picture-in-Picture button visibility の判定用 boolean。
- `volumeSliderVisible`: expected value。
- `durationPositive`: seek/speed controls visibility の判定用 boolean。
- `controlsVisible`: player overlay controls の expected value。
- `cursorHidden`: mouse cursor hidden state の expected value。
- `desktopFrameWidthPx`: desktop visual frame は `1440`。
- `desktopFrameHeightPx`: desktop visual frame は `900`。
- `recordedPlayerWidthPx`: desktop recorded player は content 幅（最大 `1200`）。
- `recordedPlayerHeightPx`: recorded player の高さは width の 9/16。
- `livePlayerWidthPx`: desktop live player は content 幅（最大 `1200`）。
- `livePlayerHeightPx`: live player の高さは width の 9/16。
- `liveInfoCardMaxWidthPx`: live info card の最大幅は `800`。player の下に縦積みする（recorded の info card も同じ）。
- `mobileFrameWidthPx`: mobile/narrow visual frame は `390`。
- `mobileFrameHeightPx`: mobile/narrow visual frame は `844`。
- `mobilePlayerWidthPx`: mobile/narrow player は `390`。
- `mobilePlayerHeightPx`: mobile/narrow player は `219.375`。
- `seekButtonsVisible`: center fast seek controls の expected value。
- `speedControlsVisible`: playback speed controls の expected value。
- `speedControlsPlacement`: `right-center` を固定値とする。historical class name `left-buttons` は synthetic dataset に使わない。
- `bottomPlayVisible`: bottom row play/pause button の expected value。
- `seekBarDisabled`: duration zero / live 時の seek bar disabled expected value。
- `subtitleButtonVisible`: text track availability に基づく subtitle button expected value。
- `pipButtonVisible`: Picture-in-Picture API availability に基づく PiP button expected value。
- `playerTokenPalette`: `surfaceBlack`、`bottomGradientStart`、`controlWhite`、`trackGrey`、`disabledOpacity`、`visibleControlOpacity` を含める。
- `iconSemanticName`: Material Design Icons 相当の `mdi-*` semantic role を fixture 上で識別するための field。実 icon path は含めない。
- `frameBackground`: `#f5f5f5`。
- `appShellChromeVisible`: `false`。
- `desktopContentTopMarginPx`: `24`。
- `mobileContentTopMarginPx`: `0`。
- `fontFamily`: `Arial, sans-serif`。
- `bodyFontSizePx`: `14`。
- `captionFontSizePx`: `12`。
- `titleFontSizePx`: `16`。
- `letterSpacingPx`: `0`。
- `infoCardBackground`: `#ffffff`。
- `infoCardBorder`: なし（box-shadow で浮き上がりを表現する）。
- `infoCardBorderRadiusPx`: `4`。
- `infoCardPaddingVerticalPx`: `12`。
- `infoCardPaddingHorizontalPx`: `16`。
- `infoCardRowSpacingPx`: `2`。
- `controlledErrorPanelMaxWidthPx`: `960`。
- `controlledErrorPanelMinHeightPx`: `180`（16:9）。
- `controlledErrorPanelBackground`: `#ffffff`。
- `controlledErrorPanelBorder`: `1px` の半透明。
- `controlledErrorPanelBorderRadiusPx`: `4`。
- `iconLabelMap`: `{ play: "PLAY", pause: "PAUSE", rewind30: "R30", rewind10: "R10", forward10: "F10", forward30: "F30", speedUp: "SPD+", speedReset: "XN.N", speedDown: "SPD-", volumeHigh: "VOL+", volumeMedium: "VOL~", volumeOff: "MUTE", subtitle: "SUB", pip: "PIP", fullscreenEnter: "FULL", fullscreenExit: "EXIT", rotation: "ROT" }`。

## 禁止事項

- 実番組名、実 media URL、実 file path、実サムネイル、認証情報、token、cookie を含めない。
