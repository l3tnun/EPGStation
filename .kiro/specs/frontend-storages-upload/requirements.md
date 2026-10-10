# 要求仕様書

## 概要

Storages / Recorded Upload は storage usage view と録画済み metadata/upload flow を扱う。

## 境界コンテキスト

- **対象範囲**: `/storages`、`/recorded/upload`、storage usage rendering、upload form、validation、progress
  dialog、rollback。
- **対象外**: Recorded list/detail、settings default、App Shell。
- **隣接する期待事項**: channel display setting は `frontend-settings-storage`、Recorded workflow は `frontend-recorded`
  と整合させる。

## 要求

### 要求 1: Storages

**目的:** ユーザーとして、録画 storage の使用量を確認したい。

#### 受け入れ条件

1. `/storages` を表示するとき、EPGStation フロントエンドは title `ストレージ ` を表示する。
2. Storages は initial route、route change、Socket.IO `updateStatus` で `GET /storages` を query/body なしで取得する。
3. route fetch 前、EPGStation フロントエンドは visible list を clear する。
4. storage data を表示するとき、EPGStation フロントエンドは `<name> - <total>`、progress `value=useRate`、footer left
   `<used> 使用済み `、footer right `<available> 空き ` を表示する。
5. size formatting は `B`、`KB`、`MB`、`GB`、`TB`、`PB` を使い、1024 で割り、値が `>=1000` の間 unit を進め、1
   decimal で表示する。unit は `PB` で頭打ちにし、それ以上は進めない。
6. `total > 0` の場合、use rate は `floor((used / total) * 100)` とする。
7. total が 0 のとき、EPGStation フロントエンドは usage calculation を guard し、0% として扱う。これは current
   implementation の division-by-zero 表示を避ける intentional fix とする。
8. route-driven Storages fetch に失敗したとき、EPGStation フロントエンドは `ストレージ情報取得に失敗 `
   を snackbar で通知し、cleared visible list を維持する。Socket.IO `updateStatus`
   による refetch 失敗は snackbar を追加しない。
9. empty/error presentation は title/app shell のみを表示し、explicit empty/error copy を追加しない。
10. storage name/path など環境固有値は requirements、fixture、tracked docs に固定しない。
11. Storages list は desktop / mobile のどちらでも storage name、usage bar、used/available footer が重ならず、usage
    value の大小で row/card width を変化させない。

### 要求 2: Recorded Upload form

**目的:** ユーザーとして、録画済み metadata と video files を upload したい。

#### 受け入れ条件

1. `/recorded/upload` を表示するとき、EPGStation フロントエンドは title `アップロード ` を表示し、main form width は max
   `800px` とする。
2. route init 時、EPGStation フロントエンドは upload state を reset し、video item counter を 0 に戻し、exactly one
   empty video-file block を作成する。
3. channel selector を作るとき、EPGStation フロントエンドは `isHalfWidthDisplayed` を参照する。3a. channel、genre、sub
   genre selector は empty value を持つ placeholder item を表示面の空状態としてだけ扱い、開いた listbox に
   `channel`、`genre`、`sub genre` という field-name label を選択肢として露出しない。3b. channel selector は channel
   model 由来の channel name / halfWidthName だけを表示し、recorded search option の `cnt` を流用した `(数値)`
   suffix や channel name 解決失敗時の数値だけの fallback option を露出しない。genre selector も `genre.name`
   （count suffix 除去後）だけを表示し、recorded search option の `(数値)` suffix を露出しない。
4. upload form は current add-only video block UI を維持し、remove-video-block action を追加しない。
5. route init の rule autocomplete data 取得に失敗したとき、EPGStation フロントエンドは `ルール情報取得に失敗 `
   を snackbar で通知する。input-driven autocomplete fetch の失敗は snackbar を追加しない。
6. required field が不足しているとき、EPGStation フロントエンドは upload API を開始せず `入力内容に問題があります。`
   を snackbar で通知する。
7. `リセット ` を実行したとき、EPGStation フロントエンドは route init と同じ状態再作成を行い、datetime
   picker を remount する。
8. route init の initial video-file block と FAB で追加される video-file block の default は同一であり、first configured
   recorded directory name、`subDirectory=null`、`viewName=null`、`fileType=undefined`、`file=null` とする。
9. upload form は `放送局※`、`ジャンル `、`ルール `、`日付※`、`長さ※`、`番組名※`、`概要 `、`詳細 ` を持つ。
10. video-file block は `viewName`、`fileType`、`parentDirectoryName`、`subDirectory`、`file` を持ち、`fileType` は `ts`
    または `encoded` のみとする。
11. `parentDirectoryName` は configured recorded directory names であり、path や環境固有値を仕様・fixture に固定しない。
12. Rule autocomplete は route init と search input change で `GET /rules/keyword` を呼び、query は常に
    `limit=1000`、typed value が null でない場合のみ `keyword` を追加する。
13. Rule autocomplete items は `keyword` を表示し、`id` を値にする。
14. datetime picker は Japanese locale、Monday first day、`クリア ` / `設定 ` button を維持する。
15. reset は form state を再作成するが、route init と異なり rule autocomplete fetch を再実行しない。
16. Recorded Upload form は desktop / mobile のどちらでも required field、video-file block、FAB、reset/upload
    action が重ならず、video-file block 追加で既存 input の表示順を変えない。
17. upload form の text-like field は clearable
    相当として、`日付※`、`開始日時 `、`長さ※`、`番組名※`、`概要 `、`詳細 `、video block `name` / `sub directory`
    の non-empty enabled state で field 右端に clear button を表示し、押下で該当 field だけを空にする。file input、Rule
    autocomplete の内部 input は対象外とする。select のうち `channel`、`genre`、`sub genre` は `AppSelect`
    として、non-empty enabled state で clear action を表示し、押下で該当 select value だけを空にする。
18. `ジャンル ` と sub genre selector は横並び 2 分割で、selected text と dropdown text が折り返しや重なりを起こさない高さ
    `48px` の select とする。menu/listbox は最大 4.5 item 分、216px を超えない。
19. `日付※` input は直接 keyboard / automated input で `yyyy-MM-ddTHH:mm` を受け付け、同じ field から `日付選択 `
    dialog を開ける。field の text 部分、underline、空白部分のどこを click しても dialog が開き、click/focus/blur の順序差で即時に閉じたり、後続 input や submit
    button を覆い続けたりしてはならない。
20. `日付選択 ` dialog は title `日付選択 `、date picker 相当の `日付 ` input、time
    picker 相当の `時刻 ` input、`クリア `、`設定 ` action を持つ。`設定 ` は date/time の合成値を `日付※`
    に反映して閉じ、`クリア ` は値を空にして閉じる。単一の browser default `datetime-local`
    input だけを dialog 内容として出してはならない。
21. video-file block の file selection control は icon + selected filename + underline control とし、file
    selected 後は selected filename を表示して placeholder `video file` を重複表示しない。
22. `日付選択` dialog 内の `日付` input と `時刻` input は各々独立した clear button を持ち、押下すると該当 input だけを
    空にする。
23. Rule autocomplete の応答が入力順と逆に解決したとき、EPGStation フロントエンドは直近の入力に対応する応答だけを候補として
    表示し、先に入力された値の遅延応答を破棄する。
24. video-file block の `file type` / `directory` select は空値の placeholder item を持ち、これを選択すると値を空へ戻す。
25. video-file block を追加したとき、既存 video-file block の入力値は保持され、いずれかの block への入力は他の block に
    影響しない。
26. route init の channel/genre options 取得に失敗したとき、EPGStation フロントエンドは該当 select を空のまま表示し、
    snackbar を追加しない。
27. route init の channel/genre options 取得または rule autocomplete 取得が component unmount 後に解決したとき、
    EPGStation フロントエンドは解決結果を適用しない。

### 要求 3: upload sequence と rollback

**目的:** ユーザーとして、upload 中の進捗と失敗時の結果を把握したい。

#### 受け入れ条件

1. upload 開始時、EPGStation フロントエンドは persistent `アップロード中 ` progress dialog を表示する。
2. upload sequence では recorded metadata 作成後に video file upload を実行する。
3. video file upload に失敗したとき、EPGStation フロントエンドは作成済み recorded data の rollback を試みる。
4. upload 成功後、EPGStation フロントエンドは current form route に留まり、`アップロード完了 `
   を snackbar で通知して progress dialog を閉じる。
5. recorded metadata 作成に失敗したとき、EPGStation フロントエンドは rollback なしで `アップロードに失敗 `
   を snackbar で通知して progress dialog を閉じる。
6. video file upload に失敗したとき、EPGStation フロントエンドは `DELETE /recorded/:recordedId`
   の rollback を試み、rollback 失敗は記録に留め、元の失敗として `アップロードに失敗 ` を snackbar で通知して progress
   dialog を閉じる。
7. Validation は intentional fix として、program name と video `viewName` の empty/blank
   string を不正とし、入力済み video block の required fields を upload API 開始前に検証する。完全な video block が 1 件も無い form（video が無い form）も不正とし、upload API を呼ばない。
8. EPGStation フロントエンドは完全に空の video block を upload target から除外するが、一部だけ入力された不正な video
   block を upload loop で silently skip して成功扱いにしない。完全に空とは `viewName=null` かつ `file=null`
   であり、default `parentDirectoryName` は空判定に影響しない。
9. `POST /recorded` body は required `channelId`、`startAt`、computed `endAt`、`name`、optional
   `ruleId`、`description`、`extended`、`genre1`、`subGenre1` を送る。
10. `POST /videos/upload` multipart は `recordedId`、`parentDirectoryName`、optional non-empty
    `subDirectory`、`viewName`、`fileType`、`file` を送る。
11. video uploads は validated blocks を順に実行する。
12. Progress dialog は persistent `アップロード中 ` と indeterminate progress を表示し、close 後は current close
    animation 維持のため短い delay で remove/remount する。
13. upload 成功後、EPGStation フロントエンドは current form values を維持しつつ、route を
    `/recorded/upload?timestamp=<number>` へ更新する。
14. EPGStation フロントエンドは、アップロード成功後の close-remount timer、失敗時の rollback 完了、および recorded
    metadata 作成の resolve が page unmount 後に発生した場合、post-unmount の state 更新や UI 反映を行わず、console
    error/warning を出力しない。
15. upload 実行中に route を離脱したとき、EPGStation フロントエンドは進行中の recorded metadata 作成または video file
    upload の完了を待って作成済み recorded metadata の rollback を試み、離脱後は `アップロード完了` /
    `アップロードに失敗` の snackbar を表示しない。

### 要求 4: dark theme coverage

**目的:** dark theme と select 契約で Storages / Recorded upload の操作性を保つ。

#### 受け入れ条件

1. Storages と Recorded upload の main content、directory list、upload form、progress dialog は dark
   theme で background、text、icon、input border、progress surface の contrast を維持する。
2. Recorded upload の genre/subGenre control は selected genre 変更時に sub genre items を再計算し、React
   Compiler の memoization 制約に依存しない。
3. Recorded upload の channel、genre、sub genre、video file block の select は shared `AppSelect` / MUI
   `TextField select` の `combobox` として mouse/touch/keyboard で操作でき、選択後の値を form state と upload
   request に反映する。browser-default select、MUI native-select variant、表示用 overlay を独自 CSS で包む実装に戻し
   てはならない。
4. Recorded upload の video file block 内 field label は `name`、`file type`、`directory`、`sub directory`、`video file` を使い、日本語に翻訳しない。block number
   suffix は row title `ビデオファイル<n>` にだけ付け、各 field label には付けない。
5. Recorded upload の video file block 内 `file type` と `directory` select は MUI standard input で 次の select 密度を維持し、48px height、透明 background、0px border radius、underline、MUI select
   icon を表示する。browser default appearance、または独自に実装した dropdown arrow を使ってはならない。
6. Recorded upload form の `放送局※`、`日付※`、`長さ※`、`番組名※` の required row title は light/dark theme とも
   赤色で表示する。dark theme の row title 一括 color override で required red を白へ上書きしてはならない。
