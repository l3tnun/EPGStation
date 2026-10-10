# 要求仕様書

## 概要

Video playback は live watch、recorded direct watch、recorded streaming watch の route validation、player mapping、stream lifecycle、platform constraints、subtitle/player settings を扱う。

## 境界コンテキスト

- **対象範囲**: `/onair/watch`、`/recorded/watch`、`/recorded/streaming/:videoFileId`、player params、HLS/WebM/MP4/direct playback、platform constraints、error/empty。
- **対象外**: On Air list、Recorded list/detail、settings key/default。
- **隣接する期待事項**: playback preference は `frontend-settings-storage`、entrypoint は `frontend-onair` / `frontend-recorded` に従う。

## 要求

### 要求 1: route validation と player state

**目的:** ユーザーとして、不正な playback route でも stale player ではなく controlled state を見たい。

#### 受け入れ条件

1. `/onair/watch` の required query が不足または invalid のとき、EPGStation フロントエンドは stale player を残さず controlled empty/error state を表示する。
2. `/recorded/watch` の `videoId` が不足または invalid のとき、EPGStation フロントエンドは raw video player を作成しない。
3. `/recorded/watch` の `recordedId` が invalid で `videoId` が valid のとき、EPGStation フロントエンドは player を維持し、info card を抑制する。
4. `/recorded/streaming/:videoFileId` の `videoFileId`、`mode`、`streamingType` が invalid のとき、EPGStation フロントエンドは invalid API URL を作成しない。
5. route update で valid から invalid へ変わったとき、EPGStation フロントエンドは stale player state を reuse しない。
6. `/onair/watch` は `type` を `hls`、`m2ts`、`m2tsll`、`webm`、`mp4` を valid とし、`m2ts` は server config が m2ts mode を持つ場合だけ player param を作成する。画面操作では `frontend-onair` の stream 選択が M2TS を URL scheme 経由の外部 player へ渡すため watch route に入らず、watch route の m2ts は通常の画面操作では到達しない直リンク専用の入口として valid にする。
7. `/onair/watch` の `channel` と `mode` は finite integer とし、選択可能な live stream config/mode に存在する場合だけ player param を作成する。
8. `/recorded/streaming/:videoFileId` は `videoFileId`、`mode` を finite integer とし、`streamingType` を `webm`、`mp4`、`hls` かつ server config 上その video file type で有効な mode として検証する。`recordedId` は info card 用の optional finite integer として検証する。
9. `/recorded/streaming/:videoFileId` で `videoFileId`、`mode`、`streamingType` が invalid の場合、EPGStation フロントエンドは `VideoContainer` と info card を作成せず、invalid API path を組み立てない。
10. `/recorded/streaming/:videoFileId` で `recordedId` だけが invalid または欠落している場合、EPGStation フロントエンドは streaming player を維持し、recorded info card だけ描画しない。
11. controlled empty/error state の表示文言、inline 表示、snackbar 有無は design.md の「制御されたエラー / 空 UI」で固定し、redirect は要求しない。
12. controlled empty/error state は stale media element、実 URL、stack trace、環境固有 path を表示せず、player container の stable dimensions を維持する。
13. route validation の結果が有効か無効かに関わらず、EPGStation フロントエンドは data 取得と初期描画に必要な処理が完了した時点で scroll-data completion を通知する。

### 要求 2: direct / streaming player mapping

**目的:** ユーザーとして、選択した media type に対応する player で視聴したい。

#### 受け入れ条件

1. recorded direct watch では、EPGStation フロントエンドは raw video API source を使う。
2. recorded streaming で `streamingType=hls` のとき、EPGStation フロントエンドは HLS player mapping を使う。
3. recorded streaming で `streamingType=webm` または `mp4` のとき、EPGStation フロントエンドは corresponding streaming media source を使う。
4. live watch では、EPGStation フロントエンドは selected live stream type/mode に対応する player mapping を使う。
5. recorded info card fetch に失敗しても、EPGStation フロントエンドは playback 自体を fatal にしない。
6. recorded info card fetch failure は playback 非 fatal とし、`番組情報取得に失敗` を snackbar で通知する。live info card fetch と `ストリーム情報取得に失敗` snackbar は `frontend-onair` が所有する。
7. recorded display data がない場合、EPGStation フロントエンドは recorded info card を描画しない。
8. recorded direct watch route は raw video API source を使うが、通常 entrypoint では encoded file かつ `isPreferredPlayingOnWeb=true` の場合だけ生成される。
9. HLS playback の readiness polling は `GET /streams?isHalfWidth=<isHalfWidthDisplayed>` を使い、対象 stream が enabled になるまで timer で確認する。`isHalfWidthDisplayed` は settings-storage の channel display contract から読む。
10. React dev server 経由で HLS playback を確認するとき、EPGStation フロントエンドは `/streamfiles/stream:streamId.m3u8` を backend へ proxy し、playlist response が Vite SPA fallback HTML ではなく HLS manifest (`#EXTM3U`) になる構成を維持する。
11. recorded info card は `name` が無い場合タイトルを空文字として表示し、`startAt` または `endAt` が無い場合は時間帯行を、`channelName` が無い場合はチャンネル名行を描画しない。

### 要求 3: stream lifecycle と platform constraints

**目的:** ユーザーとして、streaming playback が browser/platform constraints に従って安定して動作してほしい。

#### 受け入れ条件

1. HLS playback では、EPGStation フロントエンドは stream start/keep/stop と readiness check を lifecycle として扱う。
2. HLS readiness timer、keep interval、pending wait は、stream が enabled にならないまま component destruction された場合でも cleanup される。
3. out-of-range seek 後に stream を restart するとき、EPGStation フロントエンドは playback rate と paused/playing state を維持する。
4. iOS Safari の recorded direct playback は encode 生成 MP4 と raw TS のどちらも ready として扱う。raw TS direct playback に controlled unsupported UI は表示せず、media element の decode/network error に委ねる。
5. media decode/network error の shared overlay は、別途 player-error design が追加されるまで導入しない。
6. HLS lifecycle error は shared media decode/network overlay ではなく stream lifecycle error として扱う。
7. HLS start failure、missing stream id、readiness timeout/abort は loading のままにせず、recoverable error state を表示し、timer/keep interval/pending wait を破棄する。
8. HLS lifecycle snackbar は `ストリーム開始に失敗`、`ストリーム id 取得に失敗`、`ストリーム停止に失敗` を維持する。`ストリーム停止に失敗` は unmount 中の stop 失敗で出るため snackbar host が残らず、`unittest/imp` の HLS controller test が検証する。
9. WebM/MP4 recorded streaming と live WebM/MP4 は direct stream response を `<video>` に渡し、frontend は start/keep/stop API を呼ばない。
10. WebM/MP4 direct stream は backend が HTTP request close で keep/stop を管理する。
11. recorded WebM/MP4 の out-of-range seek は `ss` 付き URL rebuild で restart し、playback rate と paused/playing state を復元する。
12. live M2TS-LL は mpegts.js の MSE live playback support を必要とし、dialog preflight 未対応時は `再生に対応していません`、player 内未対応時は `非対応ブラウザーです。`、video element 欠落時は `video 要素がありません。` を表示する。video element 欠落は `PlaybackVideoElement` が常に `video` を描画するため画面からは到達しない防御的分岐で、`unittest/imp` が readiness 関数を直接呼んで検証する。
13. in-progress recording の recorded streaming では、duration が確定しない間も `/videos/:videoFileId/duration` の取得値に取得後経過秒を加えた推定総尺を使い、synthetic 1 秒 timeupdate ごとに current time / duration display と seek max を更新する。録画中の time display が `00:00/10:00` などの固定総尺で止まり続ける状態を禁止する。
14. live M2TS-LL は origin を含む absolute media URL を mpegts.js に渡す。sub directory 配下で動作する場合も `/api/streams/live/:channelId/m2tsll?mode=<mode>` を origin + sub directory で解決し、relative URL のまま渡してはならない。

### 要求 4: subtitle と player setting

**目的:** ユーザーとして、subtitle/player setting が route 間で一貫して反映されてほしい。

#### 受け入れ条件

1. HLS と live M2TS-LL の subtitle 表示を扱うとき、EPGStation フロントエンドは `VideoPlayerSetting` と `isForceEnableSubtitleStroke` を参照する。
1a. live M2TS-LL の ARIB 字幕は caption（data_identifier `0x80`、PES `stream_id` `0xbd`）と字幕スーパー / superimpose（data_identifier `0x81`、PES `stream_id` `0xbf`）を独立した aribb24 decoder（Feeder + Renderer の組）で受信・描画する。単一の decoder に両方の PES を渡してはならない。aribb24.js 2.x の Feeder は既定で `recieve.type: 'Caption'` のデータしか採用せず、superimpose データグループは黙って破棄するため、EPGStation フロントエンドは caption 用（既定 `recieve.type`）と superimpose 用（`recieve.type: 'Superimpose'`）を別々に mount し、`PES_PRIVATE_DATA_ARRIVED` の `stream_id` で振り分ける。
2. direct Normal playback と WebM/MP4 direct stream では、EPGStation フロントエンドは HLS/mpegts subtitle renderer (aribb24) を追加しない。subtitle button の表示可否は video の native text track が存在するかどうかで決め、`VideoPlayerSetting.isShowSubtitle` の値は表示可否に影響しない。
3. Picture-in-Picture が browser API として利用可能なとき、EPGStation フロントエンドは player control に表示できる。
4. HLS と M2TS-LL の aribb24 option は `isForceEnableSubtitleStroke` を参照し、subtitle 表示状態は `VideoPlayerSetting.isShowSubtitle` に保存・復元する。
5. shared player controls は live ではなく、かつ duration > 0 の時だけ seek/speed controls を表示し、mobile/iPadOS では volume slider を非表示にする。live 再生中は media element が duration に 0 以外の値を報告していても seek/speed controls を表示しない。
6. keyboard shortcuts、fullscreen fallback、`video.play()` failure は snackbar なしで log only、decode/network error overlay は追加しない挙動を維持する。
6a. player 上の keyboard shortcut は `Space`（再生/一時停止 toggle）、`k`（`Space` と同じ再生/一時停止 toggle）、`m`（mute toggle）、`f`（fullscreen toggle）、`ArrowLeft` / `ArrowRight`（live ではなく、かつ `duration > 0` の場合だけ 10 秒戻る/進む）を持つ。live 再生中は `duration` の報告値に関わらずこの shortcut を無効にする。
6b. fullscreen toggle は iPhone（iPad を除く）では container の `Element.requestFullscreen` を一切呼ばず、常に `HTMLVideoElement.webkitEnterFullscreen`（video 要素自身の native fullscreen）を使う。iPhone Safari の `Element.requestFullscreen()` は container 上でも呼び出せて promise が resolve し `document.fullscreenElement` も設定されるが、実際の描画は fullscreen 化前の小さい box のまま拡大されない（`!important` で 100vw/100vh を強制しても描画は変わらず、CSS では解決できない）。promise の resolve/reject だけでは判別できないため、`typeof container.requestFullscreen === 'function'` という機能検知ではなく端末判定（iPad を除く iPhone/iPod の user agent）で分岐する。iPad Safari の container fullscreen はこの問題を持たないため、iPad は container の `requestFullscreen` を使う。iPhone 以外の環境で container の `requestFullscreen` 自体が存在しない場合（`typeof requestFullscreen !== 'function'`）は同じ `webkitEnterFullscreen` へ fallback し、それも利用できない場合だけ CSS で画面全体を覆う非 native fallback 状態にする。一方、container の `requestFullscreen` は存在するが呼び出しが reject した場合は `webkitEnterFullscreen` へ fallback せず、直接 CSS の非 native fallback 状態にする（reject 時に native video fullscreen へ切り替えると、Apple 標準の video player UI になり、録画 HLS のシーク範囲が encode 済み範囲に制限され、PiP button も効かなくなる。呼び出せる API 自体は存在するのに1回 reject しただけでは「container fullscreen が本当に使えない」とは言えず、EPGStation 独自 UI・全範囲シーク・PiP を失う方が実害が大きいため、iPhone 以外はこの場合 native fullscreen を試みない）。native video fullscreen 中の fullscreen 状態は `webkitbeginfullscreen` / `webkitendfullscreen` event から同期し、終了操作は `video.webkitDisplayingFullscreen` が真の間 `video.webkitExitFullscreen()` を呼ぶ（`document.exitFullscreen()` ではない）。この分岐は M2TS-LL（ManagedMediaSource 経由の mpegts.js）を含むすべての media source 種別で同じに扱う。
6c. iPad で container の `Element.requestFullscreen` が存在しない場合（`typeof requestFullscreen !== 'function'`）、iPhone とは異なり `HTMLVideoElement.webkitEnterFullscreen`（native video fullscreen）へは fallback せず、直接 CSS の非 native fallback 状態にする。iOS のホーム画面に追加した PWA（standalone display-mode）では、同じ端末の Safari タブと異なり `Element.requestFullscreen` 自体が存在しない、または動作しないことがある。この状態で iPhone と同じ経路をたどり native video fullscreen へ進むと、6b と同じ理由（Apple 標準 UI になり録画 HLS のシーク範囲がエンコード済み範囲に制限され PiP button も効かなくなる）で EPGStation 独自 UI を失うため、iPad はこの分岐でも防御的に CSS fallback を使い EPGStation 独自 UI を維持する（iPhone の native fullscreen（6b）はこの分岐で変えない）。container の `requestFullscreen` が存在するのに reject する場合は既存の 6b の分岐（CSS fallback）がそのまま適用される。
6d. 6c の CSS fallback 状態（`.playerContainer[data-fullscreen-fallback='true']`）は `position: fixed` の box を `--app-viewport-height`（App Shell が `window.visualViewport.height ?? window.innerHeight` から実測し、`resize` / `orientationchange` / `visualViewport` の `resize`・`scroll` で更新する CSS 変数。`.kiro/specs/frontend-app-shell/design.md` 参照）で高さを決め、値が未設定な環境向けの fallback として `100vh` を残す。raw `100vh` を直接使わない理由: iPad の standalone PWA（ホーム画面に追加した状態）では、全画面にした直後に、シークバーより下の bottom controls（fullscreen 終了・字幕切替を含む）が画面外に出て操作できなくなることがある。standalone PWA では viewport の実測値が、回転などの実際の geometry 変化があるまで更新されないことがあり（landscape → portrait → landscape のように回転させて元の向きに戻すと直る）、フルスクリーンに入った時点の高さの実測値（またはそれを基にした CSS 値）が古いまま使われるためである。このため、CSS fallback の高さは `100vh` ではなく App Shell が実測し続けている `--app-viewport-height` を使い、かつ CSS fallback へ入る/出るタイミング（`isFullscreenFallback` の切り替え）でも明示的に再実測する（`usePlaybackFullscreen.ts` が `useFixedShellViewport.ts` の `syncViewportHeightVariable()` を呼ぶ）。Safari タブ、iPhone、desktop ブラウザでの CSS fallback の見た目は変えない。
7. player surface、subtitle overlay、shared controls は desktop / mobile のどちらでも互いに重ならず、subtitle stroke setting の切替で controls の位置を変えない。layout geometry なので visual test が検証する。
8. player surface は 16:9 の黒背景を維持し、読み込み中は player 中央に loading indicator を表示する。loading 表示は controls と media source placeholder の有無に依存して layout size を変えない。
8a. direct stream playback と HLS playback の loading indicator は media element readiness に基づいて解除する。WebM/MP4 direct stream と HLS は `loadeddata`、`loadedmetadata`、`canplay`、`durationchange`、`play`、または `playing` のいずれかで解除できる。live M2TS-LL は mpegts.js が `play` / `playing` / `durationchange` / `loadedmetadata` を media data 表示前に発火し得るため、それらだけでは解除してはならず、`loadeddata` または `canplay` まで loading indicator と textless spinner だけを表示し、center/bottom controls を出してはならない。HLS stream lifecycle の `ready` は playlist URL が決まっただけであり、media が再生準備完了になった根拠として loading を解除してはならない。autoplay が成功して `play` / `playing` が発火しているのに loading が残り続ける状態も、M2TS-LL 以外では禁止する。recorded TS direct playback の canplay 到達まで controls を抑止する gate は HLS へ適用しない。`fileType=ts` の recorded HLS でも HLS media event により loading が解除されること。
9. bottom control は seek bar、play/pause button、volume button、volume slider、current time / duration、subtitle button、Picture-in-Picture button、fullscreen button を同一 overlay 内に表示する。play/pause と fullscreen は再生状態または fullscreen 状態に応じて icon を切り替える。
10. live の場合、または live ではなく duration 未確定で `duration === 0` の場合、seek bar は表示しても操作不能とし、time display は 初期表示として `--:--/--:--` を使う。live、または duration が有限の正の値でない間は常に `--:--/--:--` を表示する。fast seek controls と playback speed controls は表示しない。live 判定は media element が報告する `duration` の値（0 以外を含む）に依存せず、再生対象が live stream であること自体で決まる。
11. volume button は volume が `0` のとき mute icon、`0 < volume <= 0.4` のとき medium icon、`volume > 0.4` のとき high icon を表示する。mobile/iPadOS または 420px 以下の narrow viewport では volume slider を非表示にし、volume button は維持する。
12. subtitle button は video text track が存在する場合だけ表示し、subtitle 非表示状態では disabled 表現を持つ。subtitle が存在しない動画では button 自体を表示しない。
13. Picture-in-Picture button は browser の Picture-in-Picture API が利用可能な場合だけ表示し、非対応環境では button 自体を表示しない。
13a. Picture-in-Picture の利用可否判定は、対象の `HTMLVideoElement` が `webkitSupportsPresentationMode` を持つ場合はそれを優先し、持たない場合だけ `document.pictureInPictureEnabled` にフォールバックする（`detectPictureInPictureEnabled(video)`）。`webkitSupportsPresentationMode('picture-in-picture')` は video が src 未設定・読み込み前の間は `false` を返し、`loadedmetadata`（`videoWidth` が確定した時点）以降に実際の対応状況を反映する値へ変わる。この判定は video 要素が mount された時点で一度だけ行ってはならず、`loadedmetadata` の後に評価し、media が入れ替わったとき（`emptied` / `loadstart`）は再評価する。一度だけ mount 時に評価する実装は、読み込み前に固定された `false` によって Safari タブでも PiP button が出なくなるため採らない。iOS/iPadOS のホーム画面に追加した PWA（standalone display-mode）では、`document.pictureInPictureEnabled` が `true` を返すにもかかわらず `requestPictureInPicture()` が機能しない既知の WebKit の問題がある（WebKit Bugzilla #303885）。`webkitSupportsPresentationMode` の方が正しく `false` を返すため、前者より優先する。
14. center control は play/pause button を中央に表示し、live ではなく、かつ `duration > 0` の場合だけ 30 秒戻る、10 秒戻る、10 秒進む、30 秒進む button を左右に表示する。各 seek action は 0 秒未満または duration 超過へ飛ばない。live 再生中はこれらの button を表示しない。
15. playback speed controls は live ではなく、かつ `duration > 0` の場合だけ player 右側中央に表示し、playback rate の `XN.N` 表示、0.1 刻みの speed up/down、1.0 reset を提供する。user-visible 配置は右側中央とする。420px 以下の narrow viewport、live 再生中、duration zero では表示しない。playback rate は 0.1 倍から 10 倍の範囲に clamp する。
16. mouse pointer が player control wrap 上で移動したとき、再生中の非 Android 環境では controls と cursor を表示する。control wrap 背景上で 3000ms 移動がない場合は controls と cursor を非表示にし、mouseleave でも再生中は controls を非表示にする。paused 状態では controls を表示し、cursor を隠さない。
16a. Android / coarse pointer 環境では、loading 中でない場合だけ player 背景または control 外周の tap で controls 表示を toggle する。loading 中は loading indicator と textless spinner だけを表示し、center/bottom controls を表示してはならない。button、slider、menu などの interactive control 上の tap は control 操作だけを行い、controls 表示 toggle に伝播させない。
17. `/recorded/watch` と `/recorded/streaming/:videoFileId` の recorded info card は App Shell dark theme token を継承し、dark theme で white card surface、black primary text、black description text を残してはならない。描画色なので E2E の dark theme test が検証する。
18. player setting restore で localStorage access が例外を投げた場合、EPGStation フロントエンドは player 描画を継続する。
19. mobile で fullscreen 化に成功したとき、EPGStation フロントエンドは screen orientation lock API が利用可能な場合 landscape へ lock し、bottom control の外側に回転 button を表示する。lock API が利用できない場合は回転 button を表示せず、fullscreen 中に lock API が利用可能になった場合は回転 button を表示する。mobile 以外では回転 button を表示しない。

### 要求 5: recorded streaming の再生契約

**目的:** recorded streaming の再生・seek・字幕契約を定める。

#### 受け入れ条件

1. playback page へ遷移したとき、EPGStation フロントエンドは  `<video autoplay playsinline>` を使い、音声を mute しない。
2. recorded WebM/MP4 streaming は `GET /videos/:videoFileId/duration` の総尺を seek bar と time display に使い、現在読み込まれている encoded segment の duration だけを上限にしない。総尺の取得に失敗した場合は `動画長の取得に失敗` を snackbar で通知し、media の duration へ fallback して再生を続ける。
3. recorded WebM/MP4 streaming で現在 segment 外へ seek したとき、EPGStation フロントエンドは `ss=<absoluteSeconds>` 付き stream URL に rebuild し、playback rate と paused/playing state を復元する。
4. recorded HLS streaming の seek bar 操作では、drag/input 中は user-visible current time 表示だけを更新し、stream start URL の `ss` 更新や HLS lifecycle 再開始を発火しない。pointer/touch/mouse/key/blur による seek commit 時に、目標時刻が現在 segment 内なら `video.currentTime` を相対秒へ更新し、現在 segment 外なら stream start URL の `ss` を絶対秒へ更新して lifecycle を再開始し、manifest ready 後に autoplay を試行する。
5. recorded HLS streaming は ARIB 字幕 renderer を mount し、`VideoPlayerSetting.isShowSubtitle` と `isForceEnableSubtitleStroke` を live HLS/live M2TS-LL と同じ契約で反映する。recorded WebM/MP4 streaming は direct stream として扱い、ARIB 字幕 renderer は mount しないが、video に native text track が存在する場合は subtitle button を表示する。
6. recorded streaming の current time は `activeBaseSeekSeconds`（segment の開始秒）と `video.currentTime` の和 として扱い、segment restart 中も user-visible seek position は絶対再生位置を維持する。
