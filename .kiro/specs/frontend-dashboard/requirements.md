# 要求仕様書

## 概要

Dashboard は録画中、録画済み、予約の summary を表示し、各 list/detail workflow へ移動する入口である。

## 境界コンテキスト

- **対象範囲**: Dashboard route/title、summary layout、recording/recorded/reserves API fetch、more link、item menu/dialog、responsive/theme。
- **対象外**: 各 list/detail 画面の全機能、再生 player、settings contract。
- **隣接する期待事項**: page size と表示設定は `frontend-settings-storage`、shell は `frontend-app-shell` に従う。

## 要求

### 要求 1: route と summary 表示

**目的:** ユーザーとして、トップ画面で主要状態を素早く把握したい。

#### 受け入れ条件

1. `/` を表示するとき、EPGStation フロントエンドは Dashboard として version string を title に使う。
2. Dashboard を表示するとき、EPGStation フロントエンドは録画中、録画済み、予約の summary section を表示する。
3. Dashboard 初期化時、route path/query change 時、Socket.IO `updateStatus` 時、EPGStation フロントエンドは `GET /reserves/cnts`、`GET /recording`、`GET /recorded`、`GET /reserves` を取得する。
4. Dashboard fetch option は settings の `isHalfWidthDisplayed`、`recordingLength`、`recordedLength`、`reservesLength` を参照し、summary request は Dashboard route `page` query を offset へ反映せず page 1 相当の `offset=0` を使う。recorded は Dashboard route query の `keyword`、`ruleId`、`channelId`、`genre`、`hasOriginalFile` を反映し、reserves は `type=normal` を送る。この `offset=0` 固定は Dashboard summary の page query 混入を避ける intentional fix とする。
5. data load 前、EPGStation フロントエンドは Dashboard 本体を表示せず、load 完了後に transition で表示する。
6. section は `録画中 `、`録画済み `、`予約 ` の順で表示し、各 title は `表示件数/総件数 ` 形式とする。
7. API が 0 件を返したとき、EPGStation フロントエンドは追加の empty copy を表示せず、`0/0` を含む現在の summary title 表示を維持する。
8. fetch 失敗時、EPGStation フロントエンドは snackbar 文言を使い、`GET /reserves/cnts` は `予約情報取得に失敗 `、録画中 data は `録画中データ取得に失敗 `、録画済み data は `録画済みデータ取得に失敗 `、予約 data は `予約データ取得に失敗 ` として区別する。
9. Dashboard は録画中、録画済み、予約の 3 section の scroll position を route leave/update 時に保存し、history restore の場合だけ復元する。通常の route 表示や summary refresh では保存済み scroll position を強制復元しない。

### 要求 2: more link と item action

**目的:** ユーザーとして、Dashboard から詳細画面や対象 action へ移動したい。

#### 受け入れ条件

1. more button は各 section の `total > 表示件数 ` の場合だけ表示する。
2. ユーザーが recording / recorded / reserves の more action を実行したとき、EPGStation フロントエンドはそれぞれ `/recording?page=2`、`/recorded?page=2`、`/reserves?page=2` へ遷移する（URL には `timestamp` query が付く）。
3. ユーザーが recorded item または recording item を選択したとき、EPGStation フロントエンドは recorded detail workflow へ遷移する（URL には `timestamp` query が付く）。
4. ユーザーが reserve card を選択したとき、EPGStation フロントエンドは `ReserveDialog` を開き、番組名、channel、日時、genre、description、extended を表示する。extended 内の `http://` / `https://` URL は `frontend-reserves` の shared dialog contract として link 化する。
5. ReserveDialog の日時を選択したとき、EPGStation フロントエンドは `/guide?time=<YYMMddhh>` へ遷移し、settings `isEnableDisplayForEachBroadcastWave=true` かつ channel lookup で解決できる場合だけ `type=<wave>` を付与する（URL には `timestamp` query が付く）。
6. reserve item の kebab menu は `ReserveMenu` として扱い、recorded search、edit、delete、unlock を提供する。
7. 予約 conflict badge は conflict count が 1 以上のとき表示し、badge と、それを含む section title 全体（ラベル文字部分を含む）のどちらを click しても `/reserves?type=conflict` へ遷移する（URL には `timestamp` query が付く）。conflict count が 0 のときは section title を click しても遷移しない。
8. protect/unprotect は `PUT /recorded/:id/protect` / `PUT /recorded/:id/unprotect` を呼び、`保護に成功 ` / `保護に失敗 `、`保護解除に成功 ` / `保護解除に失敗 ` を snackbar で通知する。Dashboard は owner menu の icon contract を再利用し、`protect` は `mdi-lock`、`unprotect` は `mdi-lock-open` を表示する。
9. stop encode は `DELETE /recorded/:id/encode` を呼び、`エンコード停止 ` / `エンコード停止に失敗 ` を snackbar で通知する。
10. recorded delete は全選択で `DELETE /recorded/:id`、一部選択で `DELETE /videos/:videoFileId`、0 選択では API call と snackbar なしで閉じる。
11. reserve delete は `DELETE /reserves/:id`、unlock は skip/overlap ごとに `DELETE /reserves/:id/skip` または `DELETE /reserves/:id/overlap` を呼び、文言は `frontend-reserves` の action contract に従う。
12. Dashboard 上の recorded/recording item menu は `frontend-recorded` / `frontend-recording-encode` の action contract を再利用し、add encode handoff は `RecordedItemMenu` 相当の dialog と `POST /encode` body contract に従う。
13. Dashboard は `frontend-reserves` が named export する `ReserveDialog` / `ReserveMenu` / `ReserveDeleteDialog` と、`frontend-recorded` が named export する `RecordedItemMenu` / `RecordedDeleteDialog` / `AddEncodeDialog` を consumer として使う。Dashboard はこれらの API body、delete/encode/protect/unlock snackbar 文言、dialog body contract を再定義しない。
14. Dashboard 上の recorded/recording item menu の search action は `frontend-recorded` の route builder をそのまま使い、`ruleId` がある item は `/recorded?ruleId=<ruleId>`、`ruleId` がない item は番組名由来の `/recorded?keyword=<keyword>` へ遷移する。Dashboard は item name の bracket / episode suffix 除去規則や `ruleId` 優先順位を再実装せず、owner contract に委譲する。
15. Dashboard の recording item は thumbnail を表示せず、Recorded summary item は thumbnail がない場合 `img/noimg.png` の no-image fallback を height `100px`、`flex-basis:30%`、`max-width:200px` の領域で表示する。Recorded summary item は settings `isShowDropInfoInsteadOfDescription` に従って description/drop display を切り替える。詳細な card rendering contract は `frontend-recorded` と `frontend-recording-encode` を参照する。
16. Dashboard の予約 summary item は開始時刻と終了時刻を `05/05(火) 10:15 ~ 10:45 (30分)` の形式で表示し、レガシー ReservesCard の分単位ラベル表記に従う。

### 要求 3: responsive と visual state

**目的:** ユーザーとして、desktop/mobile と light/dark theme で Dashboard を同じ意味で使いたい。

#### 受け入れ条件

1. viewport 幅が変わったとき、EPGStation フロントエンドは Dashboard summary layout を responsive contract に従って切り替える。
2. dark theme のとき、EPGStation フロントエンドは Dashboard card/list 表示を dark theme に適合させる。
3. conflict badge や more button 境界 state は、`client/visual/dashboard-geometry.spec.ts` の screenshot（`dashboard-dark-conflict`）と `client/e2e/dashboard-workflow.spec.ts` で固定する。
4. Dashboard layout は default で max width 600px の縦積み、1023px 以上で横並び（各 section 33.3%、section 内 list が縦 scroll）とする。1023px 未満では list は scroll を持たず、main content が縦 scroll する。
5. 1264px 以上では drawer 初期 open の content 領域内で横並びを維持し、iOS/iPadOS では横並び幅以上で address bar 補正を保持する。1264px は `frontend-app-shell` の `APP_SHELL_DESKTOP_BREAKPOINT`（`client/src/app/drawerLayout.ts`、drawer 幅 `APP_SHELL_DRAWER_WIDTH` は 256px）に由来する。
6. Dashboard main content は viewport 内に収まり、body/main に 1px 程度の不要な縦スクロールを発生させない。
7. Dashboard section の internal scroll は各 summary list に閉じ、page 全体の微小 scroll で layout がずれない。
8. dark theme で Dashboard から開く recorded item menu は portal rendering 後も text と icon/pseudo icon が dark surface と同化せず、owner menu の `rule`、`search`、`protect/unprotect`、`encode`、`stop`、`delete` 項目を readable に表示する。
