# Implementation Plan

- [x] 1. Recorded list route、query、fetch、rendering を実装する
  - `/recorded` list は settings と route query から page、keyword、ruleId、channelId、genre、hasOriginalFile、half-width、limit/offset を作る。
  - initial route、route/query change、Socket.IO `updateStatus` を TanStack Query invalidation/refetch に接続し、route fetch failure だけ `録画データ取得に失敗 ` を出す。
  - list title、empty/loading/error、table/card display、drop/description display、scroll restoration done signal が観測できる。
  - _Depends: frontend-app-shell 5, frontend-settings-storage 2_
  - _Requirements: 1.1-1.15_

- [x] 2. Recorded list menu、bulk edit、delete/encode/protect actions を実装する
  - RecordedItemMenu、RecordedDeleteDialog、RecordedBulkDeleteDialog、AddEncodeDialog の shared visual/action contract を実装し、Dashboard/Recording consumer へ export できる。
  - protect/unprotect、encode enqueue/stop、delete、send-video-file、recorded search handoff は API body、snackbar、dialog close cleanup に接続する。
  - action 成功後の visible label/state は optimistic update ではなく、requirements が求める refetch-driven update または snackbar-only behavior に従う。
  - _Requirements: 2.1-2.37_

- [x] 3. Recorded detail route、fetch、menu/dialog/handoff を実装する
  - `/recorded/detail/:id` detail は recorded data、video files、encode options、stream options、settings を取得し、metadata、video files、menu/action を表示する。
  - detail extended text は fetch 後に safe linkify し、new tab 相当で開き、実 URL を fixture に含めない。
  - detail menu、delete/protect/encode/send/playback/download handoff、Socket.IO refetch、scroll restoration が requirements と一致する。
  - _Requirements: 3.1-3.35_

- [x] 4. playback/upload handoff を隣接 owner contract に接続する
  - Recorded watch/streaming/upload/download/external URL scheme route handoff は Settings Storage と Video Playback owner contract を consumer として扱う。
  - `isPreferredPlayingOnWeb`、URL scheme fallback、placeholder replacement、recorded streaming saved setting を requirements に従って適用する。
  - invalid streaming handoff では `配信設定が正しく入力されていません ` または `番組 ID が不正です ` を出し、Video Playback へ title input `視聴 ` を渡す。
  - upload route へ遷移しても Recorded list/detail の action contract と ownership が重複しない。
  - _Depends: frontend-video-playback 1, frontend-storages-upload 2_
  - _Requirements: 4.1-4.10_

- [x] 5. Recorded の unit/E2E/visual regression を整備する
  - `unittest/spec` と `unittest/imp` で query builder、request body、action matrix、dialog initial state、Socket.IO no-snackbar refetch、linkify、handoff を検証する。
  - Playwright + MSW で list/detail/table/card/dialog/menu/empty/error/loading、desktop/mobile、shared component consumer state を確認する。
  - fixture に実番組名、実 channel、実 file path、実サムネイル、実 URL、Kodi host、認証情報を含めない。
  - _Requirements: 1.1-1.15, 2.1-2.37, 3.1-3.35, 4.1-4.10, 5.1-5.6_
- [x] 6. protect/unprotect 成功後の refetch、Recorded detail main container max-width 900px と 800px responsive breakpoint、Add Encode select height/theme、upload handoff と playback handoff の regression guard を検証する。
  - _Requirements: 2.16, 2.17, 2.21, 3.22, 3.28, 3.34, 4.1-4.10, 5.3_
- [x] 7. detail 画面の表示仕様の漏れを埋める（要求 3.20/3.22 参照）。
  - detail container max-width は 960px 未満は指定なし、960px 以上で `900px`、1264px 以上で `1185px`、1904px 以上で `1785px` の 3 段 breakpoint に従う。
  - detail の play/streaming/encode/kodi action button icon は `font-size:18px`、`height:18px`、`width:18px` で統一する。
  - detail の drop 情報表示は `dropLogFile` が無い item で要素ごと省略する現行挙動を維持する。
  - icon の vertical centering は、先頭 icon の `margin-left: -4px` と button label の `letter-spacing: 1.25px`/`line-height: 21px` で揃える。
  - _Requirements: 3.20, 3.22_
