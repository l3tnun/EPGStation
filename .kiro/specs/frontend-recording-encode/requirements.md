# 要求仕様書

## 概要

Recording / Encode は録画中 item と encode running/waiting job の一覧、pagination（`/recording` のみ）、edit mode、cancel/delete action を扱う。

## 境界コンテキスト

- **対象範囲**: `/recording`、`/encode`、list fetch、pagination（`/recording` のみ）、edit mode、single/bulk delete/cancel、blank state。
- **対象外**: Recorded list/detail の encode enqueue、AddEncodeDialog、video player、settings default。Encode queue page は `POST /encode` を発火しない。
- **隣接する期待事項**: page size と display setting は `frontend-settings-storage`、shell は `frontend-app-shell` に従う。

## 要求

### 要求 1: Recording list

**目的:** ユーザーとして、録画中 item を一覧で確認し、不要な video file を削除したい。

#### 受け入れ条件

1. `/recording` を表示するとき、EPGStation フロントエンドは title `録画中` を表示する。
2. route change 時、EPGStation フロントエンドは recording data を clear してから current page を fetch する。
3. Socket.IO `updateStatus` 時、EPGStation フロントエンドは existing selection を可能な限り維持して fetch する。Recording page は `updateStatus` だけを購読し、`updateEncode` は購読しない。サーバーは `updateStatus` を 200ms debounce して emit する（`src/model/service/socketio/SocketIOManageModel.ts` の `notifyClient`）。
4. recording item は active recording として表示し、reserve conflict/skip/overlap decoration を付与しない。
5. edit action を実行したとき、EPGStation フロントエンドは edit mode に入り、title を `<selectedCount> 件選択` に切り替える。
6. edit mode では item menu を表示せず、item click は selection toggle として扱う。selection UI は row/card click と selected color だけで表現し、item 右端に checkbox または別 selection control を表示してはならない。
7. edit mode の delete action を実行したとき、EPGStation フロントエンドは recorded multiple deletion dialog と同じ確認 dialog を開く。ただし delete option は表示/internal value ともに `全て` 固定で無効化し、option 非表示時の余白も表示しない。
8. bulk delete dialog を 0 件選択で開いたとき、EPGStation フロントエンドは dialog を閉じ、`番組を選択してください。` を snackbar で通知する。
9. bulk delete confirm 時、EPGStation フロントエンドは selected visible recording items の全 `videoFiles[].id` に対して `DELETE /videos/:videoFileId` を 1 件ずつ実行する。
10. bulk delete 成功時、EPGStation フロントエンドは `選択した番組を削除しました。`、一部または全件失敗時は `一部番組の削除に失敗しました。` を snackbar で通知する。
11. fetch に失敗したとき、EPGStation フロントエンドは `録画データ取得に失敗` を snackbar で通知する。
12. empty/loading/error body は blank presentation を維持する。
13. Recording fetch は `GET /recording` に `isHalfWidth=<isHalfWidthDisplayed>`、`offset=(page-1)*recordingLength`、`limit=<recordingLength>` のみを送信し、page 未指定は 1 とする。保存済み settings が読めない場合、`recordingLength=24` と `isHalfWidth=true` 相当の fallback を使う。
14. Recording item に `channelName` がなく `channelId` がある場合、EPGStation フロントエンドは `/channels` の shared channel index で表示名を解決し、`isHalfWidthDisplayed=true` では `halfWidthName` を優先する。`/channels` に該当 id がない場合だけ numeric channelId fallback を使う。
15. edit mode の select-all action は visible items をすべて選択し、すべて選択済みの場合はすべて解除する。
16. bulk delete confirm 時は selected visible recording items の全 `videoFiles[].id` に対して `DELETE /videos/:videoFileId` を 1 件ずつ実行し、request 前に selection を clear する。
17. Recording list の放送局表示は `channelName` を優先し、`channelName` がない場合だけ numeric `channelId` fallback を表示する。
18. Recording edit mode では table row height 48px と column layout を維持し、menu button 領域は空にして title / channel / time cell を崩さない。checkbox への置換は禁止する。
19. Recording bulk delete dialog は Recorded owner の bulk dialog を `disableOption=true` で使い、`削除対象` select と option 用の余白を表示せず、body `選択した <count> 件の番組を削除しますか。` と `キャンセル` / `削除` action を表示する。
20. normal mode では各 recording item に kebab menu を表示し、menu button / menu item の操作は row click による detail 遷移と競合しないよう扱う。
21. Recording item menu は `ruleId` が存在する場合だけ `rule` action を表示し、実行時は短い delay 後に `/search?rule=<ruleId>` へ遷移する。
22. Recording item menu の `search` action は、`ruleId` が存在する場合は `/recorded?ruleId=<ruleId>`、存在しない場合は recorded item name から生成した keyword で `/recorded?keyword=<keyword>` へ遷移する。
23. Recording item menu は `recordedItem.isProtected=true` の場合は `unprotect`、それ以外は `protect` を表示する。`protect` は `PUT /recorded/:recordedId/protect` を呼び、成功時 `保護に成功`、失敗時 `保護に失敗` を snackbar で通知し、icon は `frontend-recorded` owner contract の `mdi-lock` を使う。`unprotect` は `PUT /recorded/:recordedId/unprotect` を呼び、成功時 `保護解除に成功`、失敗時 `保護解除に失敗` を snackbar で通知し、icon は `frontend-recorded` owner contract の `mdi-lock-open` を使う。
24. Recording item menu は `recordedItem.isRecording=true` のため encode enqueue action を表示しない。`recordedItem.isEncoding=true` の stop action は `/recording` view では handler を接続しないため、 Recording item menu の実行可能 action として扱わず表示しない。
25. Recording item menu の `delete` action は短い delay 後に RecordedDeleteDialog を開き、dialog の API、partial video file 削除、success/error snackbar、close/remount 挙動は `frontend-recorded` の Recorded item delete contract に従う。
26. Recording title bar の edit action entrypoint は kebab menu ではなく `mdi-pencil` 相当の direct icon button とし、実行時に edit mode へ入る。
27. Recording list は desktop / mobile のどちらでも item title、progress/metadata、menu button、selection control が重ならない stable row/card height を維持する。
28. Recording edit mode の selection 状態は row/card の click 対象化と selected 色だけで表現し、checkbox や item ごとの selection 専用 label は追加しない。selection 表示のために table/card layout（row/card の高さ）を広げてはならない。
29. Recording list はビューポート幅 600px を閾値に表示形式を切り替え、600px 超では table を、600px 以下では card 一覧を表示する（`RECORDING_CARD_LAYOUT_MAX_WIDTH`、`RecordingPage.module.css` の `@media (max-width: 600px)`）。600px は App Shell の他画面と共通の値（MUI `sm` 相当）である。App Shell の drawer は viewport 幅 1264px 未満では overlay（`temporary`）でコンテンツ幅を圧迫せず、1264px 以上では drawer 分（256px）を引いてもコンテンツ幅は 1008px 以上を維持するため、600px 前後の切り替えでコンテナ幅とビューポート幅は実質的に一致し、ビューポート幅基準は observable な差を生まない。
30. route change 時および Socket.IO refresh 時、EPGStation フロントエンドは fetch 完了後に scroll-data completion を通知する。
31. edit mode の exit action は selection を clear する。
32. normal mode の item click は `/recorded/detail/:recordedId` へ遷移する。
33. Recorded shared item menu を使う場合も encode enqueue action は `recordedItem.isRecording !== true` の条件を満たす場合だけ表示する。
34. Recording empty/loading/error では item がある時だけ content wrapper を mount し、explicit empty copy を追加しない。
35. Recording list の pagination は、settings の `isEnableExtendedPagination` が `true` のとき、共有 component `AppPagination`（`frontend-app-shell` 要求 8.49）を通じて拡張 pagination（`frontend-app-shell` 要求 8.33-8.47）を表示し、`false`（default）のとき従来の pagination を変えずに表示する。page の移動は拡張・従来で同じ `?page=` query の更新で行い、page size は `recordingLength` のままとする。Encode list はページ送りを持たないので対象外とする。

### 要求 2: Encode list

**目的:** ユーザーとして、running/waiting encode job を確認し、必要に応じて cancel したい。

#### 受け入れ条件

1. `/encode` を表示するとき、EPGStation フロントエンドは title `エンコード` を表示する。
2. Encode 初期化時、route change 時、Socket.IO `updateStatus`、Socket.IO `updateEncode` 時、EPGStation フロントエンドは running jobs と waiting jobs を取得して section 表示する。サーバーは `updateStatus`／`updateEncode` のどちらも 200ms の debounce（`setTimeout`）を挟んで `io.sockets.emit` するため、同一 tick 内の複数更新は 1 回の emit にまとめられる（`src/model/service/socketio/SocketIOManageModel.ts` の `notifyClient` / `notifyUpdateEncodeProgress`。Recording の `updateStatus` 契機も同じ debounce を共有する）。
3. route change 時、EPGStation フロントエンドは encode data を clear してから fetch し、scroll-data completion を通知する。
4. running item は `percent` と `log` が両方存在する場合のみ progress text/bar を表示する。
5. waiting item は waiting state として表示する。
6. edit mode 外では item 右上の close icon を表示し、実行時に single cancel dialog を開く。
7. single cancel dialog は `[<mode>] <recordedName> を停止しますか?`、`キャンセル`、`停止` を表示する。
8. single cancel confirm 時、EPGStation フロントエンドは `DELETE /encode/:encodeId` を呼び、成功時は `[<mode>] <recordedName> を停止しました`、失敗時は `[<mode>] <recordedName> の停止に失敗` を snackbar で通知する。
9. edit action を実行したとき、EPGStation フロントエンドは edit mode に入り、title を `<selectedCount> 件選択` に切り替える。
10. edit mode では close icon を非表示にし、item click は selection toggle として扱う。
11. edit mode の select-all action を実行したとき、EPGStation フロントエンドは running/waiting item の selection を toggle する。
12. edit mode の delete action を実行したとき、EPGStation フロントエンドは bulk cancel dialog を開く。
13. bulk cancel dialog は `選択した <total> 件の番組を削除しますか。`、`キャンセル`、`削除` を表示する。
14. bulk cancel dialog を 0 件選択で開いたとき、EPGStation フロントエンドは dialog を閉じ、`番組を選択してください。` を snackbar で通知する。
15. bulk cancel confirm 時、EPGStation フロントエンドは selected encode jobs に `DELETE /encode/:encodeId` を実行し、dialog と edit mode を閉じる。
16. bulk cancel 成功時、EPGStation フロントエンドは `選択したエンコードをキャンセルしました。`、一部または全件失敗時は `一部エンコードのキャンセルに失敗しました。` を snackbar で通知する。
17. Encode title bar の edit action entrypoint は kebab menu ではなく `mdi-pencil` 相当の direct icon button とし、実行時に edit mode へ入る。
18. Encode fetch に失敗したとき、EPGStation フロントエンドは `エンコード情報取得に失敗` を snackbar で通知する。
19. bulk cancel dialog の状態は mock API で再現でき、画面の確認（`visual-cases.md` の `encode-cancel-dialog`）はその mock で行う。
20. `GET /encode` には `isHalfWidth=<isHalfWidthDisplayed>` を送る。保存済み設定が読めない場合は `true` を使う。
21. empty state は content area を mount したまま section が空になる blank presentation とし、explicit copy を追加しない。
22. single cancel dialog と bulk cancel dialog は close animation 後に短い delay で remove/remount する。
23. Encode list は progress 更新、waiting/running state の切替、edit mode selection の切替によって item height が不安定に変化しない。
24. single cancel dialog と bulk cancel dialog は Paper max-width `300px`（width は固定しないため短文 body では 300px 未満に縮む）、content padding `16px 16px 0`、text color primary、action row min-height `52px`、action row padding `8px` を維持する。Dialog の見た目を page/card CSS から継承させず、dialog surface を直接検査できる owner class を持つ。
25. single cancel dialog と bulk cancel dialog の確認 action は、request が進行中の間に再度押しても `DELETE /encode/:encodeId` を重複実行せず、single cancel dialog は進行中は cancel 操作や dialog を閉じる操作でも閉じない。bulk cancel dialog は確認 action の直後に dialog と edit mode を閉じ（要求 2.15）、以後の二重実行は発生しない。
26. encode item のサムネイル画像取得に失敗した場合は非表示にし、recorded 名が存在しない場合は `#<id>` 形式のタイトルを表示する。
27. Socket.IO `updateStatus` / `updateEncode` 等の refresh 時、EPGStation フロントエンドは既存の edit mode selection を、更新後も存在する id に限定して維持する。実サーバー（`src/model/service/socketio/SocketIOManageModel.ts`）が `emit` する event 名は `updateStatus` と `updateEncode` の 2 つだけである。client は `connect` / `disconnect` / `updateStatus` / `updateEncode` の 4 つだけを購読する。実サーバーが emit しない名前を購読し、その名前で test を駆動すると、実サーバー相手には起こり得ない経路を覆うことになる。購読する名前が実サーバーの emit する集合と一致することは `client/unittest/imp/appShell.realtime.imp.test.ts` が固定する。
28. bulk cancel dialog の Paper は固定 height ではなく min-height `120px` 以上を使い、選択件数が増えても内部 scrollbar が発生する固定高さレイアウトに戻してはならない。
29. Socket.IO updateStatus 等の refresh 時にも、EPGStation フロントエンドは fetch 完了後に scroll-data completion を通知する。
30. Encode queue page は `POST /encode` を発火せず、encode job の追加操作を提供しない。

### 要求 3: encode empty と dark theme

**目的:** Encode の空状態表示と dark theme での可読性を保つ。

#### 受け入れ条件

1. Encode API が running/waiting ともに 0 件を返したとき、EPGStation フロントエンドは main content を空のまま維持し、`エンコード中` や `待機中` の section label だけを表示しない。
2. running/waiting section label は対象 item が 1 件以上ある場合だけ表示する。
3. Encode/Recording main content、item row/card、dialog、edit mode controls は dark theme で background、text、icon、border の contrast を維持する。
4. `/encode` の running/waiting item surface と `/recording` の desktop table container / mobile card surface は App Shell dark theme token を使い、CSS variable が未定義の環境でも white paper fallback に落ちてはならない。
5. `/recording` の desktop table は container、header、visible row、cell、action/menu cell を dark table owner として検査し、row や cell 単位で black foreground / white fallback を残してはならない。
