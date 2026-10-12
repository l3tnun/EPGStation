# Visual Cases: ビデオ再生

## 目的

Video Playback visual regression は、route validation、controlled error/empty UI、player surface、stream lifecycle feedback、subtitle / info card、platform constraints が media 実体に依存せず安定することを検証する。

`design.md` の Visual Implementation Contract にある player frame、controls density、subtitle safe area、responsive controls visibility を screenshot / geometry assertion の正本にする。

## Screenshot / Layout Cases

Viewport 列と dataset 列は設計時の SVG フレームの値と概念上の名前で、コード上の識別子ではない。実 test の fixture は `client/e2e/support/videoPlaybackMocks.ts` と `client/unittest/spec/support/videoPlaybackSpecSupport.tsx`、`settingsDarkTheme` は `frontend-app-shell` の mock-data.md で定義する。visual test（`client/visual/video-playback-geometry.spec.ts`）は desktop 1280x720 と narrow 390x740 の geometry を検査し、`toHaveScreenshot` は ready controls（1280x720）・controlled error・HLS loading・subtitle controls の 4 枚で、Desktop Chromium だけで撮る。各 case の不変条件は `unittest/spec`・`client/e2e/video-playback-*.spec.ts`・visual に分けて検証する。

| Case | Route / State | Viewport | Mock Dataset | Visual invariant |
| --- | --- | --- | --- | --- |
| playback-recorded-web | recorded playback route | 1440x900 | `recordedPlaybackWeb` | player surface、title/info、controls が centered max width 内に収まり、subtitle overlay が controls を覆わない。 |
| playback-live-web | live playback route | 1440x900 | `livePlaybackWeb` | live player と On Air owned info card が max width 1200 内で共存する。 |
| playback-mobile | recorded playback route | 390x844 | `recordedPlaybackWeb` | player aspect ratio と controls が mobile 幅で horizontal overflow を出さない。 |
| playback-controlled-error-invalid-route | invalid route | 1440x900 | `playbackControlledErrorInvalidRoute` | `再生条件が不正です` を inline 表示し、player と info card を mount せず、snackbar を表示しない。 |
| playback-controlled-error-unsupported | unsupported stream combination | 1440x900 | `playbackControlledErrorUnsupported` | `非対応ブラウザーです。` を player surface 内の controlled error として表示し、実 URL や stack trace を表示しない。 |
| playback-stream-loading | stream starting/loading | 1440x900 | `playbackStreamLoading` | loading/progress feedback が player container の stable dimensions を維持する。 |
| playback-subtitle | subtitle visible | 1440x900 | `playbackSubtitleSamples` | subtitle stroke setting が反映され、長い subtitle text が readable で controls と重ならない。 |
| playback-controls-paused-recorded | recorded playback, paused, controls visible | 1440x900 | `playerControlsRecordedPaused` | 16:9 player surface 上に center play icon、30/10 秒戻る、10/30 秒進む、右側中央 playback speed controls、bottom controls がすべて表示される。 |
| playback-controls-playing-recorded | recorded playback, playing, controls visible | 1440x900 | `playerControlsRecordedPlaying` | center と bottom の play/pause button が pause icon に切り替わり、seek bar、time、volume、subtitle、PiP、fullscreen が bottom overlay に収まる。 |
| playback-controls-live-duration-zero | live playback, duration zero | 1440x900 | `playerControlsLiveDurationZero` | fast seek controls と playback speed controls を表示せず、seek bar は disabled、time は `--:--/--:--` で表示する。 |
| playback-controls-no-subtitle-no-pip | recorded playback without subtitle / PiP | 1440x900 | `playerControlsNoSubtitleNoPip` | subtitle button と PiP button を非表示にし、bottom right controls の間隔が崩れない。 |
| playback-controls-idle-hidden | recorded playback, playing, 3000ms idle | 1440x900 | `playerControlsIdleHidden` | controls overlay と cursor hidden state を表現し、player surface の 16:9 黒背景と media placeholder だけが残る。 |
| playback-controls-narrow420 | recorded playback, narrow viewport | 390x844 | `playerControlsNarrow420` | playback speed controls、bottom play button、volume slider を非表示にし、center play/pause と bottom seek/time/actions が horizontal overflow なしで収まる。 |
| playback-autoplay-audio | recorded/onair watch route entered | 1440x900 | `playerAutoplayAudio` | video element は `autoplay` と `playsinline` を持ち、`muted` を持たない。play failure は snackbar を出さず、controls は user gesture で再生可能なまま残る。 |
| playback-recorded-stream-absolute-seek | recorded WebM/MP4 streaming, segment duration shorter than total duration | 1440x900 | `recordedStreamingAbsoluteSeek` | seek bar max は duration API の総尺になり、segment 外へ seek すると media URL の `ss` が absolute seconds に更新される。time display は absolute current time を表示する。 |
| playback-recorded-streaming-in-progress-duration | recorded WebM/MP4 streaming, in-progress recording | 1440x900 | `recordedStreamingInProgressDuration` | duration API の初期総尺に synthetic 1 秒 tick の経過分が加算され、time display の duration 側と seek bar max が固定値で止まらず増加する。 |
| playback-recorded-hls-restart | recorded HLS streaming, out-of-segment seek | 1440x900 | `recordedHlsSeekRestart` | seek bar drag/input 中は time display だけを preview し、stream start URL の `ss` を変更しない。pointer/touch/mouse/key/blur の commit 後だけ old stream lifecycle が cleanup され、新しい start URL の `ss` が absolute seconds になり、manifest ready 後に autoplay を試行する。loading/error 表示は player surface 内に収まる。 |
| playback-recorded-encoded-hls | recorded encoded/H.265 HLS streaming | 1440x900 | `recordedEncodedHls` | encoded file の HLS streaming は `/streams/recorded/:videoFileId/hls?mode=<mode>&ss=<absolute>` で stream start し、duration API の総尺、playlist URL、info card を維持して再生準備完了に到達する。 |
| playback-recorded-direct-stream-no-subtitle | recorded WebM/MP4 streaming | 1440x900 | `recordedStreamingDirectNoSubtitle` | WebM/MP4 direct stream では ARIB subtitle renderer を mount せず、保存済み `VideoPlayerSetting.isShowSubtitle` が true でも subtitle button を表示しない。bottom right controls は fullscreen/PiP の alignment を崩さない。 |
| playback-recorded-streaming-dark-info-card | recorded WebM/MP4 streaming, dark theme | 1440x900 / 390x844 | `recordedStreamingDirectNoSubtitle` + `settingsDarkTheme` | `/recorded/streaming/:videoFileId` の recorded info card は dark theme token の surface/text を使い、white card surface と black text を残さない。 |
| playback-live-direct-formats | `/onair/watch` direct live routes | 1440x900 | `livePlaybackWeb` | M2TS-LL、WebM、MP4、M2TS direct stream は HLS start/keep/stop API を使わず、`/streams/live/:channelId/:type?mode=<mode>` の media URL を video player に渡し、info card を表示する。M2TS は通常 entrypoint では `frontend-onair` の stream 選択が外部 player へ渡すため到達しないが、`/onair/watch?type=m2ts` 直リンクは valid な direct stream route である。 |
| playback-android-hls-loading-only | `/onair/watch` HLS, Android Chrome, stream readiness resolved but media event not fired | 390x844 | `livePlaybackWeb` | HLS lifecycle が `ready` になっても media element の `loadeddata` / `canplay` 等までは loading indicator と textless spinner だけを表示し、tap しても center/bottom controls を表示しない。media event 後は loading が消え、tap で controls を表示できる。 |
| playback-android-m2tsll-loading-only | `/onair/watch` M2TS-LL, Android Chrome, `play` fired before decoded media data | 390x844 | `livePlaybackWeb` | `play` / `playing` / `durationchange` / `loadedmetadata` だけでは loading を解除せず、`loadeddata` または `canplay` まで loading indicator と textless spinner だけを表示する。その間 center/bottom controls は表示しない。 |
| playback-recorded-hls-loading-release | `/recorded/streaming/:videoFileId` HLS, `fileType=ts`, stream readiness resolved | 390x844 / 1440x900 | `recordedEncodedHls` | recorded TS direct playback の canplay gate を HLS に流用しない。playlist URL ready 後に `loadeddata` / `loadedmetadata` / `canplay` / `durationchange` / `play` / `playing` のいずれかが発火したら loading が消え、subtitle renderer と controls が利用可能になる。 |

## Interaction / Geometry Cases

- direct / streaming player mapping の切替で player container の aspect ratio が崩れない。
- `/onair/watch` live direct mapping は M2TS-LL、WebM、MP4、M2TS それぞれで `data-playback-kind=live`、`data-playback-source-kind=direct-stream`、`data-playback-lifecycle-mode=direct-response`、`data-playback-lifecycle-state=ready` を確認する。HLS は `hls-api` lifecycle と playlist URL を別 case で確認する。
- 実 backend を使う HLS 確認では、React dev server origin の `/streamfiles/stream:streamId.m3u8` が backend に proxy され、HTTP 200 かつ body 先頭 `#EXTM3U` を返すことを before/after 証跡に含める。body 先頭が `<!doctype html>` / `<!DOCTYPE html>` の場合は Vite fallback を受けており、HLS 再生確認として失敗扱いにする。
- HLS lifecycle cleanup 後に stale video element や snackbar が次 route に残らない。
- unsupported platform combination は controlled error または snackbar として表示し、media source placeholder を実 URL として表示しない。
- App Shell chrome はこの feature の visual case では描画しない。frame background は `#f5f5f5`、desktop content top margin は `24px`、mobile/narrow content top margin は `0px` とする。
- typography は `Arial, sans-serif`、body `14px`、caption/time `12px`、section/title `16px`、controlled error `16px`、player icon label `12px`、letter spacing `0` とする。
- info card は synthetic compact panel とし、background `#ffffff`、border は持たず box-shadow で elevation を表現し、border radius `4px`、padding は垂直 `12px`・水平 `16px`、行の間は `margin-top: 2px` を使う。recorded / live ともに player の下に縦積みで置く。
- desktop frames は 1440x900 viewport を正とする。recorded / live の player は content 幅（最大 1200px）の 16:9 とし、recorded / live の info card はどちらも player の下に縦積みし、最大幅 800px で置く。mobile/narrow frames は 390x844 viewport、player は 390x219.375 とする。
- controlled error invalid-route panel は 16:9、最大幅 960px、最小高 180px の compact panel を content の中央に置く（`margin: 0 auto`）。unsupported player error（M2TS-LL 非対応）は panel を使わず、player surface の中央に padding `16px` の中央揃え text として出す（`.lifecycleError`）。
- player surface は 16:9 黒背景を正とし、420px 以下では playback speed controls、bottom play button、volume slider を非表示にする。
- loading case は player 中央に loading indicator を置き、player surface の aspect ratio と bottom overlay の予約寸法を変えない。HLS では stream readiness と media readiness を分け、playlist URL が決まっただけの状態では loading-only 表示を維持する。M2TS-LL は `play` / `playing` / `durationchange` / `loadedmetadata` を readiness 証跡にせず、`loadeddata` / `canplay` 前に controls が見える場合は failure とする。
- center controls は play/pause button を常に中央に置き、live ではなく、かつ `duration > 0` の場合だけ 30/10 秒戻ると 10/30 秒進むを表示する。各 seek button は center play/pause を押し広げて player 外へ出してはならない。
- playback speed controls は desktop では player 右側中央に縦配置し、`XN.N` 表示を挟んで speed up/down を置く。live/duration zero と 420px 以下では表示しない。historical class name `left-buttons` を layout 上の左配置と解釈しない。
- bottom overlay は seek bar を上段、button/time/action row を下段とする。play/pause、volume icon、volume slider、time、subtitle、PiP、fullscreen の順序を維持し、subtitle/PiP hidden case でも fullscreen button の右端 alignment を維持する。
- time display は live/duration zero visual case では `--:--/--:--` を正とする。live、または duration が有限の正の値でない間は常に `--:--/--:--` を表示する。
- volume / playback / fullscreen / seek / subtitle / PiP icon は fixed semantic label で識別する。SVG では実 icon path の pixel parity ではなく、`PLAY`、`PAUSE`、`R30`、`R10`、`F10`、`F30`、`SPD+`、`XN.N`、`SPD-`、`VOL+`、`VOL~`、`MUTE`、`SUB`、`PIP`、`FULL`、`EXIT`、`ROT` の識別性を visual invariant とする。
- recoverable HLS error summary を loading と同時に表示する場合は loading indicator 直下の中央揃え inline message とし、player surface 外へ出さない。
- mouse idle case は playing 中の非 Android で 3000ms 無操作後に controls overlay と cursor を hidden とする。paused case では controls visible と cursor visible を期待する。
- recoverable HLS error の inline message は `playbackStreamLoading.recoverableErrorSummary` を使い、snackbar copy は mock-data の `snackbarCopyVariant` で固定する。
- theme palette は App Shell owner token へ委譲し、Video Playback は player surface / controls / subtitle の contrast と geometry、recorded/live info card の light/dark surface/text contrast を固定する。
- recorded streaming absolute seek cases は同一 synthetic duration、同一 segment duration、同一 `ss` value で desktop/mobile を確認し、segment-local duration を seek bar 上限として扱う regression を不一致にする。
- in-progress recorded streaming case は initial duration 600 秒、recorded info `isRecording=true`、synthetic tick 1 回以上を固定し、time display が `00:00/10:01` 以上へ進むことを確認する。`data-playback-synthetic-timeupdates` だけが増えて duration label が `10:00` のままの場合は failure とする。
- recorded encoded/H.265 HLS case は `data-playback-kind=recorded-streaming`、`data-playback-source-kind=hls-stream`、`data-playback-lifecycle-mode=hls-api`、`data-playback-lifecycle-state=ready`、`data-playback-stream-start-url`、`data-playback-playlist-url`、`data-recorded-stream-duration` を検査する。
- player は content 幅（最大 1200px）の 16:9、mobile player 390x219.375、recorded / live の info card はどちらも最大幅 800px、controls hit area 36px（`PlaybackPage.module.css` の指定値）、seek bar track height 4px、time text 12px（Arial）、bottom overlay は高さ 60px・padding `0 8px`・行間 gap `8px` とする。
- subtitle assertion は text `#ffffff`、stroke enabled `#000000`、controls visible 時に controls top と重ならないことを確認する。desktop font 28px / mobile font 20px / line-height 1.35 / stroke 3px は aribb24.js 2.x の `CanvasRendererOption` に font size・line-height・stroke 幅の設定項目が無く（`font.normal`/`font.arib` と `color.stroke` の色指定のみ）、実装に出典が無いため、実 subtitle renderer の pixel 契約ではなく、この visual case の synthetic SVG fixture だけが固定して使う描画専用の期待値として扱う。
