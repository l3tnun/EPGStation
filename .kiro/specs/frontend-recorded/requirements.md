# 要求仕様書

## 概要

Recorded は録画済み一覧、詳細、watch/streaming/upload への入口を扱う。playback route の lifecycle は
`frontend-video-playback` に分離する。

## 境界コンテキスト

- **対象範囲**: `/recorded`、`/recorded/detail/:id`、Recorded list/detail
  menu/dialog、protect/delete/cleanup、encode/kodi/drop log、watch/streaming/upload への handoff。
- **対象外**: video player lifecycle、stream keep/stop。
- **隣接する期待事項**: settings は `frontend-settings-storage`、shell は `frontend-app-shell`、player は
  `frontend-video-playback` に従う。Recorded upload form の `/recorded/upload` route contract は
  `frontend-storages-upload` が所有し、本 spec は upload route への入口だけを持つ。

## 要求

### 要求 1: Recorded list

**目的:** ユーザーとして、録画済み番組を検索、閲覧、整理したい。

#### 受け入れ条件

1. `/recorded` を表示するとき、EPGStation フロントエンドは title `録画済み ` を表示する。
2. Recorded list 初期化時、EPGStation フロントエンドは settings と route query から list fetch option を作成する。
3. page query があるとき、EPGStation フロントエンドは page を検証し、invalid value では controlled error または page
   1 への正規化を行う。
4. list data を表示するとき、EPGStation フロントエンドは current responsive contract に従って table / large card / small
   card を切り替える。
5. thumbnail がない、または load に失敗したとき、EPGStation フロントエンドは no-image asset を表示する。
6. page change 時、EPGStation フロントエンドは current query を維持しつつ page query を更新する。
7. `GET /recorded` fetch option は
   `isHalfWidth=<isHalfWidthDisplayed>`、`limit=<recordedLength>`、`offset=(page-1)*recordedLength` を常に含める。
8. list route query の `keyword` は string として、`ruleId`、`channelId`、`genre` は parse して、`hasOriginalFile`
   は boolean true または string `true` のとき true として fetch option に反映する。
9. `ruleId=0` は手動録画のみを表す query として扱う。
10. Recorded list fetch に失敗したとき、EPGStation フロントエンドは `録画データ取得に失敗 ` を snackbar で通知する。
11. Recorded list が 0 件のとき、EPGStation フロントエンドは list content を表示せず、明示的 empty
    copy を追加しない。
12. route refresh 用 `timestamp` query は user-facing filter state と search menu state に露出しない。
13. settings の `isShowDropInfoInsteadOfDescription` が true で、録画完了済み item に `dropLogFile` があるとき、Recorded
    list の large card / small card は description の代わりに 
    `<dropCnt>/<errorCnt>/<scramblingCnt> <合計ファイルサイズ>` を表示する。合計ファイルサイズは全 `videoFiles[].size` を合算し、
     `B` / `KB` / `MB` / `GB` / `TB` / `PB`、1024 除算、1 桁小数で整形し、raw
    bytes 表記を表示しない。合計ファイルサイズが 0 の場合も `0.0B` を常に付ける。`dropCnt`、`errorCnt`、
    `scramblingCnt` のいずれかが 1 以上の場合、赤色かつ bold で表示する。
14. Recorded list の card/table responsive 判定は 2 列 card 確保の境界を使う。横幅
    616px 以上では large card または table を表示し、616px 未満では small card/list 表示へ切り替える。
15. pagination は横スクロール回避のため、表示するページ番号数を絞る。viewport 幅が 500px 以下では current page
    周辺の最大 5 ページ番号のみを previous/next と同じ 1 段に表示する。500px を超える範囲では、pagination 要素の
    実測幅から求めた `maxButtons`（`Math.floor((実測幅 - 96) / 42)`。実測幅 137px 以下、および実測前は
    `maxButtons` を 0 以下として扱う）を使い、`maxLength`（`maxButtons` が正ならその値、0 以下なら総ページ数を
    使い、いずれも 12 で頭打ちにし、総ページ数自体も上限にする）を求める。総ページ数が `maxLength` 以下なら
    全ページ番号を previous/next と同じ 1 段に ellipsis なしで表示する。総ページ数が `maxLength` を超える場合、
    `left = floor(maxLength / 2)`、`isEven`（`maxLength` が偶数なら 1、奇数なら 0）、`right = 総ページ数 - left
    + 1 + isEven` を境に、current page の位置に応じて次の 4 通りに分かれる（`current` が `left` や `right` と
    一致する場合は中間の式をそのまま当てはめた値にはならない別の分岐になる）。
    - `left` 未満、または `right` より大きい: 先頭 `left` ページ + ellipsis + 末尾 `総ページ数 - right + 1`
      ページの固定の並びになり、この範囲内では current page の値によらず同じ表示になる。実測幅 600px 以上
      （`maxButtons` 12 以上、`left` 6）では `1 2 3 4 5 6 ... <last-4> <last-3> <last-2> <last-1> <last>`
      （先頭 6 + 末尾 5）、558px から 599px（`maxButtons` 11、`left` 5）では先頭 5 + 末尾 5、516px から 557px
      （`maxButtons` 10、`left` 5）では先頭 5 + 末尾 4、474px から 515px（`maxButtons` 9、`left` 4）では先頭 4 +
      末尾 4、432px から 473px（`maxButtons` 8、`left` 4）では先頭 4 + 末尾 3、390px から 431px（`maxButtons` 7、
      `left` 3）では先頭 3 + 末尾 3（例: 総ページ数 100 の 1 ページ目は `1 2 3 ... 98 99 100`）になる。
    - `left` と等しい: 先頭 `current + left - 1 - isEven` ページ + ellipsis + 最終ページ 1 個（末尾は常に 1
      ページだけ）になる。
    - `left` より大きく `right` より小さい: `start = current - left + 2`、`end = current + left - 2 - isEven`
      として、`1`、2 番目の要素（`start - 1` が `2` と等しければページ番号 `2`、そうでなければ ellipsis）、
      `start` から `end` までのページ番号、最後から 2 番目の要素（`end + 1` が `総ページ数 - 1` と等しければ
      ページ番号 `end + 1`、そうでなければ ellipsis）、最終ページの順に並べる。
    - `right` と等しい: 先頭ページ 1 個（先頭は常に 1 ページだけ）+ ellipsis + `current - left + 1` から最終
      ページまでのページ番号になる。

    総ページ数 13・`maxButtons` 11（`maxLength` 11、`left` 5、`right` 9）で実行すると、current page 1〜4 と
    10〜13 は `1 2 3 4 5 ... 9 10 11 12 13`、5（`left` と等しい）は `1 2 3 4 5 6 7 8 9 ... 13`、6 は
    `1 2 3 4 5 6 7 8 9 ... 13`（中間の式だが 5 と同じ見た目になる）、7 は `1 ... 4 5 6 7 8 9 10 ... 13`、8 は
    `1 ... 5 6 7 8 9 10 11 12 13`（中間の式だが 9 と同じ見た目になる）、9（`right` と等しい）は
    `1 ... 5 6 7 8 9 10 11 12 13` になる。

    432px 未満も同じ式を使う。264px から 305px（`maxButtons` 4、`left` 2、`right` = 総ページ数）、222px から
    263px（`maxButtons` 3、`left` 1、`right` = 総ページ数）、180px から 221px（`maxButtons` 2、`left` 1、
    `right` = 総ページ数 + 1）は `left` が 1〜2、138px から 179px（`maxButtons` 1、`left` 0、`right` =
    総ページ数 + 1）は `left` が 0 になる。`right` が総ページ数を超える場合、current page が `right` と等しい、
    または `right` を超える分岐には到達しない。

    `left` が 2 以下になる `maxButtons` 1〜4 の範囲では、上記の式のままだと 2 つの縮退が起こるため、次の 2 点を
    補正した結果を返す。1 点目: `current === left` 分岐の先頭 range（`1` から `current + left - 1 - isEven`）
    は終端が 1 未満になると空になり先頭ページ 1 自体が消えるため、先頭ページ 1 を必ず 1 個含める。2 点目:
    interior 分岐の 2 番目の要素と最後から 2 番目の要素が両方 ellipsis になり隣接する場合、連続する ellipsis
    を 1 個に統合する。

    総ページ数 100 で実行すると、`maxButtons` 1〜4 のいずれも、1 ページ目付近・最終ページ付近の current page は
    補正の影響を受けず元の式のまま（例: `maxButtons` 1 の 1 ページ目は `1 2 ... 100`、`maxButtons` 4 の
    最終ページは `1 ... 99 100`）、それ以外の中間の current page（例: 50 ページ目）はすべて `1 ... 100`
    （先頭ページ 1、ellipsis 1 個、最終ページのみ）になる。`maxButtons` 2 の 1 ページ目は、補正前は先頭側の
    range が空になり `... 100`（ページ 1 自体が表示されない）だったが、1 点目の補正により `1 ... 100` になる。
    `maxButtons` 5 以上ではこの 2 つの補正は一度も作動せず、元の式のまま（例: `maxButtons` 5 の 50 ページ目は
    `1 ... 50 ... 100`）になる。

    `maxButtons` が 0 以下（実測前を含む、実測幅 137px 以下、負値も含む）のときは、`maxLength` の計算上
    `maxButtons` が 12 のときと同じ値になるため、任意の総ページ数・current page の組み合わせで `maxButtons`
    12 と同じ結果になる。
16. settings の `isEnableExtendedPagination` が true のとき、Recorded list は上記 15 の従来 pagination に代えて、共有 component `AppPagination`（`frontend-app-shell` 要求 8.49）を通じて拡張 pagination（`frontend-app-shell` 要求 8.33-8.47）を表示する。false（default）のときは上記 15 の従来 pagination を変えずに表示する。page の移動は同じ `?page=` query の更新で行い、edit mode の保持など pagination 移動時の扱い（要求 1 の他の AC）も拡張・従来で変わらない。

### 要求 2: Recorded list actions

**目的:** ユーザーとして、録画済み item に対して削除、保護、検索、cleanup を実行したい。

#### 受け入れ条件

1. search menu から検索を実行したとき、EPGStation フロントエンドは non-empty condition だけを route
   query として反映する。
2. `/recorded/options` または `/rules/keyword` の search option 取得に失敗したとき、EPGStation フロントエンドは
   `録画検索オプションの取得に失敗 ` を snackbar で通知する。`/rules/:ruleId`
   completion 取得失敗は log のみに留め、snackbar を表示しない。
3. search menu の rule、channel、genre は `/rules/keyword` と `/recorded/options` の結果を option とする select
   control として表示し、mouse/touch/keyboard で選択した値を route query と list fetch
   query に反映する。`/recorded/options` のレスポンスは `channels[].channelId/cnt`、`genres[].genre/cnt`
   を正とし、channel は `/channels` の name/halfWidthName と件数を合成し、genre は大分類名と件数を合成して表示する。
   rule 欄は MUI `Autocomplete` を使い、入力のたびに `fetchRuleKeywords(<入力値>)`
   （`GET /rules/keyword?limit=1000&keyword=<入力値>`、`requests/listRequest.ts` の
   `buildRuleKeywordRequestUrl`）を呼び直し、結果で候補を丸ごと置き換える。channel/genre は絞り込みのない
   closed dropdown（固定候補の select）として表示する。`frontend-storages-upload` の
   `RecordedUploadPage.tsx` の rule autocomplete（`fetchRuleItemsForInput`）と同じ形で実装し、後勝ちの
   取得だけを反映する sequence guard（`ruleFetchSequence`）で古い応答による上書きを防ぐ。入力駆動の取得が
   失敗した場合は snackbar を出さない。dialog open 時の初回取得（引数なし、`limit=1000` の全件）失敗だけは
   `録画検索オプションの取得に失敗` を通知する。clear action（`ルールをクリア`）は MUI `Autocomplete` 標準の
   clear icon を使うが、AC35 の「選択済みかつ enabled state で常に表示する」契約に合わせ、常時表示に
   上書きしている。
4. table layout の recorded row は mouse hover で row 背景色を変える（light `#eeeeee`、dark `#616161`）。
   focus/selection/edit state の visual indication は hover style と混同せず、selected
   row では hover 色で selected color を上書きしない。
5. route query に `ruleId` があり `/rules/keyword` の一覧に該当 rule がないとき、EPGStation フロントエンドは
   `/rules/:ruleId` を取得し、`searchOption.keyword` を rule
   select の選択肢として補完する。補完取得失敗は log のみに留め、snackbar を表示しない。
6. title bar menu の `編集 ` を実行したとき、EPGStation フロントエンドは edit mode に入り、title を
   `<selectedCount> 件選択 (<selectedTotalFileSize>)` に切り替える。edit mode は pagination（`goToPage`）による
   route 遷移では解除されない。`goToPage` が呼ぶ `buildRecordedPageSearch` は `timestamp` query を明示的に削除するため
   （`requests/searchPath.ts`）、この route 遷移は必ず `frontend-app-shell` 要求5 の AC22 が定める `timestamp` 補完 `replace`
   を経由する。この補完が `RecordedPage` を unmount せずに行われることが edit mode 維持の前提であり、`frontend-app-shell`
   側の実装がその契約を担保する。test: `client/unittest/spec/recorded/list-pagination-preserves-edit-state.spec.test.tsx`。
   なお選択状態（`selectedIds`）はこの route 遷移でも本要求 AC7 の preserve-visible narrowing の対象であり、pagination
   後の一覧に同じ id が無ければ選択は解除される。これは refetch のたびに動作する既存の意図的な挙動であり、この
   route 遷移固有の欠陥ではない。
7. edit mode の select-all action は Reserves と同じ toggle semantics を使う。表示中 recorded
   item がすべて選択済みの場合は表示中 item をすべて解除し、一部でも未選択がある場合は表示中 item をすべて選択する。visible
   list 外の selected id は preserve-visible で除外し、select-all 解除時は visible id だけを解除する。
   Recorded 自身の `toggleVisibleRecordedSelection`（`requests/listRequest.ts`）と Reserves の
   `toggleVisibleReserveSelection`（`features/reserves/lib/reserveSelection.ts`）はどちらも
   `preserve-visible`（visible 外の selected id を保持したまま visible id だけ toggle）action を持つ、同じ
   semantics の実装である。Recording の `toggleVisibleRecordingSelection`
   （`client/src/features/recording/recordingRequests.ts`）は `select-all` 分岐で `new Set()` /
   `new Set(visibleRecordingIds)` を返し、visible 外の selected id を preserve せず全解除・全置換する。これは
   `.kiro/specs/frontend-recording-encode/requirements.md` 要求 1 の AC15（「edit mode の select-all
   action は visible items をすべて選択し、すべて選択済みの場合はすべて解除する」、preserve-visible への
   言及なし）と一致しており、Recording 側の実装はそのスペック通りに正しく動作している。Recorded の
   preserve-visible は Recording が持たない拡張であり、本行の比較対象は「Recording」を含めず「Reserves」の
   みとする。
   Reserves（`features/reserves/ReservesPage.tsx` の `visibleReserveIds` に対する `useEffect`）と Recording
   （`features/recording/RecordingPage.tsx` の同種 `useEffect`）は、`records` の再取得（Socket.IO
   `updateStatus` 等、route 遷移を伴わない再取得を含む）のたびに `toggleVisibleRecordedSelection`/同等関数を
   `action: 'preserve-visible'` で呼び直し、その時点で表示されていない id を `selectedIds` から間引く
   effect を持つ。`client/src/features/recorded/RecordedPage.tsx` も同じ `useEffect`
   （`visibleRecordedIds` 変化時に `action: 'preserve-visible'` を実行）を持ち、選択済み item が再取得で
   一覧から消えたときに `selectedIds` へ id が残り続けることを防ぐ。test:
   `client/unittest/spec/recorded/list-actions-3.spec.test.tsx`
   （`[AC 2.7] narrows a stale selection to what refetched data still contains, like Recording/Reserves`）。
8. title bar menu の `クリーンアップ ` を実行したとき、EPGStation フロントエンドは cleanup dialog を開く。
9. title bar menu の `アップロード ` を実行したとき、EPGStation フロントエンドは menu の close transition 完了を
   待たず、即時に upload route へ遷移する。
10. edit mode で delete action を実行したとき、EPGStation フロントエンドは multiple deletion dialog を開く。
11. edit mode で 0 件選択の delete
    action を実行したとき、EPGStation フロントエンドは dialog を閉じ、`番組を選択してください。`
    を snackbar で通知する。
12. bulk delete dialog では `全て `、`オリジナルファイルだけ `、`エンコードファイルだけ ` の削除対象 option を表示する。
13. bulk delete 成功時、EPGStation フロントエンドは `選択した番組を削除しました。`、一部または全件失敗時は
    `一部番組の削除に失敗しました。` を snackbar で通知する。一括削除は `全て`/`オリジナルファイルだけ`/
    `エンコードファイルだけ` のいずれの option でも、選択した item の video file を列挙し
    `DELETE /videos/:videoFileId` で 1 件ずつ削除する（`全て` の場合も item 単位の `DELETE /recorded/:id` は
    使わない）。video file を持たない item は列挙対象から外れ、削除対象に含めない。列挙した video file の削除は
    途中で失敗しても中断せず最後まで実行し、全件処理を終えた時点で 1 件でも失敗があれば失敗表示とする。
14. item menu の rule search action では `ruleId` がある場合 `/search?rule=<ruleId>` へ遷移する。
15. item menu の recorded search action では `ruleId` がある場合 `/recorded?ruleId=<ruleId>`、ない場合は program
    name 由来 keyword query で `/recorded` へ遷移する。rule/search 遷移、encode dialog open、delete dialog
    open は Recorded list ではいずれも menu を閉じた直後に遅延なく実行する。`RecordedItemMenu.tsx` の
    `actionDelayMs` prop（既定 0）は rule 遷移と delete dialog open にだけ適用し、search 遷移と encode
    dialog open には適用しない。Recording 画面は 100ms を渡す。
16. protect action 成功時は `保護に成功 `、失敗時は `保護に失敗 ` を snackbar で通知する。item menu の `protect`
    表示は `mdi-lock` icon を使う。
17. unprotect action 成功時は `保護解除に成功 `、失敗時は `保護解除に失敗 ` を snackbar で通知する。item menu の
    `unprotect` 表示は `mdi-lock-open` icon を使い、`protect` と同じ閉じた鍵 icon にしてはならない。
18. Encode action は item が録画中でなく server config で encode が有効な場合に表示し、add encode dialog を開く。
19. add encode 成功時は `エンコード追加 `、失敗時は `エンコード追加に失敗しました ` を snackbar で通知する。
20. stop encode action は encoding 中 item に表示し、成功時は `エンコード停止 `、失敗時は `エンコード停止に失敗 `
    を snackbar で通知する。
    stop encode action の表示条件は `isEncoding === true` のみとし、`isRecording` は条件に含めない。
    stop encode は `DELETE /recorded/:recordedId/encode`（`src/model/service/api/recorded/{recordedId}/encode.ts`）
    経由で `EncodeManageModel.cancelEncodeByRecordedId()`（`src/model/service/encode/EncodeManageModel.ts`）
    を呼ぶだけであり、その recordedId に紐づく running/waiting encode job を queue から取り除いて
    cancel するのみで、録画継続中かどうか（`isRecording`）は一切参照しない。したがって録画継続中の
    item に対して stop encode を実行しても、対象 item の元 video file への録画そのものには影響せず、
    その item に対して動いている encode job だけが安全に停止する。
    Recording（`RecordingPage.tsx`）と Dashboard の録画中 section（`DashboardRecordsSection.tsx`）は
    `frontend-recording-encode` 要求1 の AC24（Recording は add encode/stop encode を表示しない）を満たす
    ため、`RecordedItemMenu` へ渡す item を `{ ...item, isRecording: true, isEncoding: false }` として
    明示的に上書きする。これにより AC24 の contract は共有 component 側の `isRecording` 分岐にではなく、
    Recording/Dashboard consumer 側の明示的な override に依存する。
21. protect/unprotect/encode/delete action 成功後、EPGStation フロントエンドは必要な action だけ refetch-driven
    update を待って visible label と item
    state を更新する。protect/unprotect は snackbar のみを表示し、即時 refetch を要求しない。
22. cleanup action を実行したとき、EPGStation フロントエンドは cleanup API の成功/失敗を snackbar で通知する。
23. item menu の delete action は Recorded delete dialog を開く。
24. Recorded delete dialog は video file ごとに `<video name> (<size>)` の checkbox を表示し、初期値は
    `deleteRecordedDefaultValue` setting に従う。
25. Recorded delete dialog で 0 件選択されたとき、EPGStation フロントエンドは API
    call と snackbar なしで dialog を閉じる。
26. Recorded delete dialog で全 video file が選択されたとき、EPGStation フロントエンドは `DELETE /recorded/:recordedId`
    を呼ぶ。
27. Recorded delete dialog で一部 video file だけが選択されたとき、EPGStation フロントエンドは
    `DELETE /videos/:videoFileId` を呼ぶ。
28. Recorded delete 成功時は `<recordedItem.name> を削除 `、失敗時は `<recordedItem.name> を削除に失敗 `
    を snackbar で通知する。
29. cleanup dialog は Recorded list title bar action としてのみ提供し、Recorded detail more menu には表示しない。
30. cleanup dialog は `クリーンアップ中 ` progress を表示し、`POST /recorded/cleanup` が成功した場合だけ
    `POST /thumbnails/cleanup` を実行し、最低 1 秒 progress を維持する。
31. `POST /recorded/cleanup` が失敗した場合、EPGStation フロントエンドは thumbnails
    cleanup を実行せず、最低 1 秒 progress 後に `クリーンアップに失敗 ` を snackbar で通知する。
32. `POST /thumbnails/cleanup` が失敗した場合、EPGStation フロントエンドは最低 1 秒 progress 後に `クリーンアップに失敗 `
    を snackbar で通知する。
33. cleanup 成功時は `クリーンアップ完了 ` を snackbar で通知する。
34. recorded search menu の keyword は non-empty かつ disabled でないとき clear button を表示し、押下で該当 value
    だけを空にする。
35. recorded search menu の `ルール `、`放送局 `、`ジャンル ` select は `AppSelect` として、選択済みかつ
    enabled state で field 右端に clear action を表示し、押下で該当 select value だけを空にする。clear action は owner
    幅を変更せず、選択 text と placeholder/label text が重なって読めない状態を作ってはならない。検索 option が未取得または disabled
    の場合は clear action を表示しない。
36. `RecordedItemMenu` の item menu は再生アクションを含まない。playback への遷移は item
    menu 以外の手段で提供する。
37. item menu と detail more menu の overflow trigger button は icon font の glyph を表示し、raw
    な縦三点リーダー文字 (⋮) を表示しない。

### 要求 3: Recorded detail

**目的:** ユーザーとして、録画済み番組の詳細、再生、encode、送信、削除を操作したい。

#### 受け入れ条件

1. `/recorded/detail/:id` を表示するとき、EPGStation フロントエンドは `:id` を検証し、invalid value では controlled
   error/empty state を表示する。
2. detail data を取得したとき、EPGStation フロントエンドは thumbnail、metadata、video file、drop log、action
   button を表示する。これらの要素は `detailHero` 内に `RecordedThumbnail`、`itemTitle`/`itemChannelMeta`/
   `itemSubMeta`、`detailDropButton`、`actionRow` として描画する。
3. more menu search action で `ruleId` があるとき、EPGStation フロントエンドは `ruleId` target を優先し、`ruleId`
   がないときは program name 由来 keyword query で `/recorded` へ遷移し、double navigation を再現しない。
   `buildItemRecordedSearchPath()`（`requests/searchPath.ts`）は `ruleId` があれば即 return し、
   無い場合だけ keyword を組み立てる 1 つの分岐式であり、呼び出し側
   （`RecordedDetailMoreMenu.tsx`）は `navigate()` を 1 回しか呼ばないため double navigation は
   構造的に発生しない。
4. streaming dialog を開くとき、EPGStation フロントエンドは dialog state を open ごとに reset し、stale selected
   stream を残さない。
   open ごとに stream 候補を現在の video file と server config から作り直し、保存済み type/mode は
   作り直した候補に対して検証してから復元する。
   `RecordedStreamSelectDialog.tsx` は candidate を `file.type` と `streamConfig` から毎回導出し、open ごとに
   保存値を読み直して現在の候補に存在するときだけ復元し、無ければ選択を空に戻す。
5. Kodi dialog は behavior として保存済み host の復元、送信先 host 選択、`POST /videos/:videoFileId/kodi`、成功/失敗 snackbar、close 後の stale
   host 復元を保持する。ただし復元した host 名が現在の server config の `kodiHosts` に存在しない場合は、
   その値をそのまま使わず先頭の host（無ければ未選択）へ補正する。
   `resolveKodiHostName()`（`requests/settingsStorage.ts`）は復元値が現在の `hosts` に含まれる場合
   だけ採用し、含まれなければ `hosts[0]`（無ければ `null`）へ補正し、存在しない host への送信を防ぐ。
6. delete dialog は video file ごとに `<video name> (<size>)` の checkbox を表示し、初期値は
   `deleteRecordedDefaultValue` setting に従う。
7. detail delete dialog で video file が 0 件選択されたとき、EPGStation フロントエンドは API
   call と snackbar なしで dialog を閉じる。
   `RecordedDeleteDialogs.tsx` の `executeDelete()` は `selectedIds.size === 0` のとき早期 return する。
8. delete dialog で全 video file が選択されたとき、EPGStation フロントエンドは `DELETE /recorded/:id` を呼ぶ。
   `executeDelete()` は `selectedIds.size === allFileIds.length` のとき `apiRepository.deleteRecorded(itemId)`
   （`DELETE /recorded/:id`）を呼ぶ。
9. delete dialog で一部 video file だけが選択されたとき、EPGStation フロントエンドは選択された video file
   すべてに対して `DELETE /videos/:videoFileId` を呼ぶ。途中の 1 件が失敗しても残りの選択済み video file への
   呼び出しを打ち切ってはならない。
   `deleteSelectedVideoFiles()`（`RecordedDeleteDialogs.tsx`）は全件を試行してから成否をまとめる。
10. delete 成功時は `<recordedItem.name> を削除 `、失敗時は `<recordedItem.name> を削除に失敗 ` を snackbar で通知する。
    snackbar は `AppShell`（`client/src/app/AppShell.tsx`）がルーティングされる画面の外側で保持する shell
    状態であり、`navigate(-1)` で画面が切り替わっても同じ `ShellSnackbarHost` が表示を継続するため、遅延なく
    表示する。
11. detail delete dialog で全 video file delete が成功したとき、EPGStation フロントエンドは previous
    route へ戻り、削除済み detail に留まらない。
    一部だけの削除成功では戻らない。`RecordedDetailPage.tsx` は `onDeletedAllFiles={() => navigate(-1)}`
    を `RecordedDetailMoreMenu` に渡し、`RecordedDetailMoreMenu.tsx` は
    `onDeleteSuccess={(result) => { if (result.allFilesDeleted) onDeletedAllFiles() }}` で全件削除成功の
    ときだけ呼び出す。
12. detail extended text 内の `http://` / `https://` URL は link 化し、生成 anchor は new tab 相当で開く。
    `requests/extendedText.ts` の `linkifyRecordedExtendedText()` は文字列を token 配列へ分解し、React 要素
    として描画する（`dangerouslySetInnerHTML` を使わない）。
13. detail more menu の rule search action は `ruleId` がある場合 `/search?rule=<ruleId>`
    へ遷移し、protect/unprotect は list item menu と同じ API、snackbar 文言、`mdi-lock` / `mdi-lock-open`
    icon contract を使う。
    `RecordedDetailMoreMenu.tsx`（`buildItemRuleSearchPath`、`runProtect`、
    `data-recorded-menu-icon={item.isProtected ? 'unprotect' : 'protect'}`）と `RecordedItemMenu.tsx` は
    同じ関数・同じ snackbar 文言・同じ 2 値 icon 切替を共有する。icon は `data-recorded-menu-icon` 属性 +
    CSS glyph で描画し、protect と unprotect で異なる icon を使う。
14. detail more menu の download action は download dialog を開き、video file download button は URL
    scheme が有効なら scheme、そうでなければ `GET /videos/:videoFileId?isDownload=true`、playlist button は
    `GET /videos/:videoFileId/playlist` に遷移する。
    `RecordedDownloadDialog.tsx` は `buildVideoUrlSchemeHandoffUrl()` が有効な scheme を返せばそれを、
    返さなければ `buildVideoDownloadUrl()`（`GET /videos/:videoFileId?isDownload=true`）を `href` に使い、
    playlist button は常に `buildVideoPlaylistUrl()`（`GET /videos/:videoFileId/playlist`）を使う。
15. Kodi dialog は保存済み host を復元または初期選択し、`POST /videos/:videoFileId/kodi` に `{ kodiName }`
    を送信し、成功時は `送信しました `、失敗時は `送信に失敗しました ` を snackbar で通知する。
    `SendVideoFileToKodiDialog.tsx` の `send()` は `apiRepository.sendVideoFileToKodi({ videoFileId,
    kodiName: hostName })` を呼び、結果に応じてこの 2 文言を snackbar へ渡す（host 復元の検証強化は条件 5
    に記載）。
16. drop log は `dropLogFile` があり、かつ録画中ではない detail item の場合のみ
    `GET /dropLogs/:dropLogFileId?maxsize=512` を呼び、失敗時は `ログファイル取得に失敗しました `
    を snackbar で通知する。`dropLogFile` がない場合または `isRecording === true` の場合、drop/error/scrambling
    metadata は表示せず、click action は no-op とする。
    `formatRecordedDropInfo()`（`lib/recordedFormat.ts`）は
    `item.isRecording === true || item.dropLogFile === undefined` のとき `null` を返し、
    `RecordedDetailPage.tsx` は `item.dropLogFile !== undefined && dropInfo !== null` の場合だけ
    drop button を描画するため、`dropLogFile` が無い場合と録画中の場合はどちらも button ごと省略され
    click action も存在しない（no-op と同値）。fetch は同 button の `onClick` からのみ呼ばれ、
    `dropLogFileId` を `maxsize=512` 付きで渡し、失敗時 `ログファイル取得に失敗しました` を snackbar へ渡す
    （`RecordedDetailPage.tsx`）。
17. add encode dialog は source video、preset、parent directory、subdirectory、same directory、remove
    original を入力として持ち、`POST /encode` body と close 時 storage 保存 contract は `frontend-recording-encode`
    ではなく Recorded workflow が所有する。`AddEncodeDialog.tsx`（`client/src/features/recorded/components/`）
    は source/preset/recorded/sub directory/same directory/remove original の 6 入力を持ち、`POST /encode`
    body 生成（`buildAddEncodeRequestBody`）と close 時 storage 保存（`writeAddEncodeSetting`、
    `requests/settingsStorage.ts`）はいずれも `features/recorded` 配下にあり、`features/encode` 配下には
    存在しない。
18. detail data 取得では `GET /recorded/:id` に `isHalfWidth=<isHalfWidthDisplayed>` を渡し、取得失敗時は
    `録画データ取得に失敗 ` を snackbar で通知する。
    `RecordedDetailPage.tsx` は `useQuery` で `fetchRecordedDetail` を呼び、`recordedApi.ts` が
    `buildRecordedDetailRequestUrl({ recordedId, isHalfWidth })`（`GET /recorded/:id?isHalfWidth=<bool>`）で URL を組み立てる。
    失敗時は `RECORDED_FAILURE_MESSAGE`（`requests/constants.ts` = `` `録画データ取得に失敗` ``）を
    `onFetchFailure` へ渡す。
19. add encode dialog の `POST /encode` body は
    `recordedId`、`sourceVideoFileId`、`mode`、`removeOriginal`、`isSaveSameDirectory`、`parentDir`、`directory`
    を定義した分岐に従って生成する。
    `buildAddEncodeRequestBody()`（`requests/addEncode.ts`）は `isSaveSameDirectory` が true/false
    いずれの場合も key を常に明示送信する。server `src/model/api/encode/EncodeApiModel.ts` は
    `!!addOption.isSaveSameDirectory === false` という truthy 比較で判定するため、`parentDir`/`directory`
    必須判定の分岐には影響しない。
20. detail の drop/error/scrambling metadata は録画完了済みかつ `dropLogFile` がある場合だけ表示し、クリックで drop log
    dialog を開ける button semantics を持つ。`dropCnt`、`errorCnt`、`scramblingCnt` がすべて 0 の場合は neutral
    text とし、いずれかが 1 以上の場合だけ warning color/background を付ける。
    `dropLogFile` がない場合は button 要素ごと省略し、click しても何も起きない空要素を残さない
    （`RecordedDetailPage.tsx` の `formatRecordedDropInfo()` と、`dropLogFile !== undefined && dropInfo
    !== null` の条件で描画を制御する）。
21. Socket.IO `updateStatus` による list/detail refetch 失敗は snackbar を追加せず、route-driven
    fetch 失敗だけが `録画データ取得に失敗 ` を通知する。
    Socket.IO の `updateStatus` は `REALTIME_UPDATE_STATUS_QUERY_KEYS`
    （`client/src/app/realtimeInvalidation.ts`、`RECORDED_QUERY_KEY`/`RECORDED_DETAIL_QUERY_KEY` を含む）
    経由で `queryClient.invalidateQueries()` するだけであり、`RecordedDetailPage.tsx` の
    `useEffect` は `handledRouteKey.current === routeKey` なら（= route 由来の初回 fetch を処理済みなら）
    即 return するため、invalidate 由来の background refetch が失敗しても `onFetchFailure` は呼ばれない。
    route が変わったとき（`handledRouteKey.current !== routeKey`）だけ `onFetchFailure` を呼ぶ。
22. detail main content の max width は viewport 幅に応じた 3 段 breakpoint に従う。960px 未満は max width を指定せず、960px 以上で `900px`、
    1264px 以上で `1185px`、1904px 以上で `1785px` とし、content padding は breakpoint に関わらず常に
    `12px` とする（`RecordedPage.module.css` `.recordedDetailPage`）。
    top section は viewport width `800px` 以上で thumbnail 400px と metadata を横並び・垂直中央揃えにし、
    `799px` 以下で縦積みにする。channel metadata は 16px/28px、genre/time metadata は 14px/22px、extended
    text は padding-top `0` とする。

    detail の play/streaming/encode/kodi action button は icon を label の前に描画する。button 内の icon は
    `font-size:18px`、`height:18px`、`width:18px` とし（`RecordedPage.module.css` `.detailActionIcon`）、
    先頭 icon には `margin-left: -4px` を付ける。label は `letter-spacing: 1.25px`、`line-height: 21px`
    とする。icon は `@mdi/font` の glyph 文字を直接 `<span>` に埋め込み、play は `mdi-play`（U+F040A）、
    streaming は `mdi-play-circle`（U+F040C）、encode は `mdi-plus-circle-outline`（U+F0419）、kodi は
    `mdi-cast`（U+F0118）を使う。
23. Recorded は `RecordedDeleteDialog`、`RecordedBulkDeleteDialog`、`RecordedItemMenu`、`AddEncodeDialog`
    を shared component export として所有する。`POST /encode` body と `AddEncodeSeting` 保存契約を Recorded
    workflow が所有するため `AddEncodeDialog` は Recorded export とする。`RecordedBulkDeleteDialog` は
    `RecordedDeleteDialogs.tsx` 内の関数コンポーネント名であり、`RecordedMultipleDeletionDialog` という別名は
    使わない。
    `client/src/features/recorded/index.ts` は `AddEncodeDialog`、`RecordedBulkDeleteDialog`、
    `RecordedDeleteDialog`、`RecordedItemMenu` を export する。`AddEncodeDialog` は
    `client/src/features/recorded/components/AddEncodeDialog.tsx` にあり、`client/src/features/encode/`
    配下には存在しない。
24. `RecordedItemMenu` consumer は Dashboard と Recording を含む。Dashboard は protect/unprotect/delete/stop encode/add
    encode の action contract を再利用し、Recording は protect/unprotect/delete/search/rule だけを使い、add
    encode と stop encode は表示しない。consumer は protect/unprotect の icon を再定義せず、Recorded owner の
    `mdi-lock` / `mdi-lock-open` 表示をそのまま使う。
    `client/src/features/dashboard/components/DashboardRecordsSection.tsx` は
    `RecordedItemMenu` へ `isEncodeEnabled={kind === 'recorded' && isEncodeEnabled}` を渡し、`recording`
    種別の item だけ `isRecording: true` を強制する（`recorded` 種別は encode/stop encode を含むフル
    contract、`recording` 種別は Recording と同じ制限を受ける）。`client/src/features/recording/
    RecordingPage.tsx` は常に `isRecording: true` を強制し `isEncodeEnabled={false}` を固定する
    ため、`RecordedItemMenu.tsx` 側の表示条件（`isRecording !== true` で encode、`isEncoding === true` で
    stop）により add encode/stop encode は出ない。どちらの consumer も `data-recorded-menu-icon`
    （`protect`/`unprotect`）をそのまま使い、icon を再定義しない。`list-shared-consumers.spec.test.tsx` の
    `[AC 3.24]` test がこの 2 consumer 状態を確認する。
25. `RecordedDeleteDialog` consumer は Recorded list/detail、Dashboard、Recording を含む。detail で全 video file
    delete が成功した場合、dialog host は previous route へ戻る責務を持つ。
    `client/src/features/recorded/index.ts` が export する `RecordedDeleteDialog` は
    `RecordedDetailMoreMenu.tsx`（detail）と `RecordedItemMenu.tsx`（list・Dashboard・Recording の item menu）
    から import される。list は `RecordedListItemView.tsx`、Dashboard は `DashboardRecordsSection.tsx`、
    Recording は `RecordingPage.tsx` から `RecordedItemMenu` を経由して使う。`AddEncodeDialog` は
    `RecordedItemMenu.tsx` と `RecordedDetailPage.tsx` から import される。detail host
    （`RecordedDetailPage.tsx`）は `onDeletedAllFiles={() => navigate(-1)}` を渡し、`RecordedDetailMoreMenu`
    の `onDeleteSuccess` が `allFilesDeleted === true` のときだけこれを呼ぶ（条件 11 と同じ contract）。
    「前の画面へ戻る」責務は dialog 自身ではなく host 側にある。
26. `RecordedBulkDeleteDialog` consumer は Recorded list 編集モードと Recording 編集モードを含む。Recorded list では
    `全て `、`オリジナルファイルだけ `、`エンコードファイルだけ ` の削除対象 option を表示し、Recording 編集モードでは
    `disableOption=true` 相当で削除対象 option を表示しない。consumer は dialog body、selection 0 件 snackbar、bulk
    delete 成功/失敗 snackbar、video file delete iteration を再定義しない。
    `client/src/features/recorded/components/RecordedDeleteDialogs.tsx` の
    `RecordedBulkDeleteDialog` は `disableOption` prop で削除対象 option の表示を切り替える。
    `RecordedPage.tsx`（Recorded list 編集モード）は `disableOption` を渡さず（default `false`、option
    表示）、`client/src/features/recording/RecordingPage.tsx` は `disableOption={true}` を渡す。
    `list-shared-consumers.spec.test.tsx` の `[AC 3.26]` test が `disableOption=true` 時に option・
    listbox が表示されないことを確認する。
27. drop log dialog は max width `600px`、content padding `16px 16px 0`、pre text `14px/20px`、light text
    `rgba(0, 0, 0, 0.87)`、dark text `rgba(255, 255, 255, 0.87)` を維持し、monospace browser
    default のまま 16px 表示に戻してはならない。
    `RecordedDetailMoreMenu.tsx` の `DropLogDialog`（`RecordedPlainDialog` へ `maxWidth={600}` を渡す）で
    実装する。
28. add encode dialog は max width `500px` を維持し、open state で horizontal
    overflow を出さない。`source`、`preset`、`recorded` select は shared `AppSelect` / MUI
    Select として実装し、browser-default `<select>` / `<option>` や MUI native-select
    variant を使ってはならない。各 select は owner width を変更せず、`AppSelect` の compact control
    高さ（`controlHeight=32`）、underline、transparent background、0px border radius を維持し、open menu は
    最大 4.5 item 分、216px を超えて縦に広がってはならない。
    `client/src/features/recorded/components/AddEncodeDialog.tsx`（source/preset/recorded の 3 select）は
    いずれも `AppSelect` へ `controlHeight={32}` を明示指定する。同じ detail 画面内の streaming select
    （`RecordedStreamSelectDialog.tsx` の `legacySelectField`）と Kodi host select
    （`SendVideoFileToKodiDialog.tsx` の `kodiHostField`）も同じ 32px compact 高さを使い、
    `RecordedPage.module.css` の `.addEncodeField` 系クラスが `min-height:32px` を CSS 側でも固定する。
    test: `component-encode-kodi-stream.spec.test.tsx`。
29. add encode dialog の `元ファイルと同じ場所に保存する ` が ON のとき、`recorded` select と `sub directory`
    input は disabled になり、`POST /encode` body は `isSaveSameDirectory: true` を送り、`parentDir` と `directory`
    を送らない。
    `AddEncodeDialog.tsx` は `recorded` select に
    `disabled={isSaveSameDirectory || recordedDirectories.length === 0}`、`sub directory` input に
    `disabled={isSaveSameDirectory}` を持ち、`buildAddEncodeRequestBody()`（`requests/addEncode.ts`）は
    `!input.isSaveSameDirectory` のときだけ `parentDir`/`directory` を body に足す。
30. detail more menu、streaming dialog、add encode dialog、download dialog は dark theme で visible text、menu
    icon、select、checkbox、button の contrast を維持する。MUI portal 配下でも App Shell の dark
    theme が届くことを検査対象に含める。
    MUI 標準要素（Menu/MenuItem/Checkbox/Button/Dialog）自体は portal を含め App Shell の
    `ThemeProvider` context をそのまま受け取るため個別対応が不要な一方、bespoke な要素には
    `RecordedPage.module.css` の `:global([data-theme-mode='dark'])` selector で個別に contrast を与える:
    detail more menu の `.legacyMenuItem`/`.legacyMenuIcon`、streaming dialog の
    `.streamSelectTitle`/`.legacySelectField` 内 `.MuiInput-underline`/span、add encode dialog の
    `.addEncodeTitle`/`.addEncodeField`（input/span/disabled/clear button）、download dialog の
    `.downloadTitle`/`.downloadSectionLabel`。test: `list-styles.spec.test.tsx` の `[AC 3.30]`
    （4 画面それぞれの dark override の存在を確認する）。
31. add encode dialog の `sub directory` は non-empty かつ disabled でないとき clear button を表示し、押下で該当
    value だけを空にする。
    `AddEncodeDialog.tsx` の `sub directory` は plain `<input>` と自前の clear button
    （`directory === '' || isSaveSameDirectory ? null : <button onClick={() => setDirectory('')}>`）で実装
    する。test: `component-encode-kodi-stream.spec.test.tsx` の `[AC 3.31]`（非空時の clear button 押下で
    `directory` state が空になることを確認する）。
32. 録画詳細ページの detail data 取得が完了するまでの間、EPGStation フロントエンドは loading 表示を追加せず、既存の空
    body を維持する。
33. detail genre metadata は `genre1/subGenre1`、なければ `genre2/subGenre2`、なければ `genre3/subGenre3` の
    最初に取れた 1 組を、genre 定義相当の大分類/小分類名で表示する。API が `genres` string 配列と数値 genre/subGenre を両方返した場合も、数値
    genre/subGenre を優先し、サブジャンルを落として大分類だけにしてはならない。
34. add encode dialog の `mode`（`preset` ラベルの `encodeMode` select）と `directory`（`recorded` ラベルの
    `parentDirectory` select）は shared `AppSelect` の compact な control 高さ（`controlHeight=32`）を維持し、
    同じ dialog 内の streaming/Kodi host select と同じ寸法で表示する。
    条件 28 と本行はいずれも `controlHeight=32` の compact な control 高さを規定しており、記述は一致する。
    「他 screen」は要求 3 が扱う detail 画面内の他 select（streaming select、Kodi host select）を指し、
    要求 3 の範囲外にある画面（guide、search/rule、storages/upload 等）は対象外である。これらは
    `controlHeight` を指定せず `AppSelect` の default 48px のまま表示する。
35. detail の streaming action は server config が recorded stream を有効にしている video file だけを候補にし、
    候補が 0 件のときは streaming action 自体を表示しない。`ts` file は `streamConfig.recorded.ts` がある場合だけ、
    `encoded` file は `streamConfig.recorded.encoded` がある場合だけ候補にする。
    server `src/model/api/config/ConfigApiModel.ts` は `isEnableTSRecordedStream` を
    `config.stream.recorded.ts` の、`isEnableEncodedRecordedStream` を `config.stream.recorded.encoded` の
    存在と等価に設定するため、両 flag は `streamConfig.recorded.ts` / `streamConfig.recorded.encoded` の
    有無で判定できる。この判定と、候補 0 件時の action 非表示は `RecordedDetailPage.tsx` で行う。

### 要求 4: playback/upload handoff

**目的:** ユーザーとして、Recorded workflow から適切な playback または upload route へ移動したい。

#### 受け入れ条件

1. `/recorded/detail/:id` を表示するとき、EPGStation フロントエンドは title `録画詳細 ` を表示する。
2. encoded recorded playback action を実行したとき、EPGStation フロントエンドは settings と file type に応じて web
   watch または external handoff を選択する。
3. streaming action を実行したとき、EPGStation フロントエンドは selected stream type/mode を query として streaming
   route へ渡す。
4. upload route への入口は `frontend-storages-upload` の upload requirements に従う。
5. watch handoff は encoded file かつ `isPreferredPlayingOnWeb=true` のときだけ
   `/recorded/watch?videoId=<videoFileId>&recordedId=<recordedId>` を生成する。
6. web watch を使わない場合、EPGStation フロントエンドは external view URL scheme を使い、解決できない場合は video
   playlist API の相対 URL（文書の path を基準とする `./api/videos/:videoFileId/playlist`）へ fallback する。
7. streaming handoff は
   `/recorded/streaming/:videoFileId?recordedId=<recordedId>&streamingType=<webm|mp4|hls>&mode=<modeIndex>&fileType=<ts|encoded>`
   を生成する。`fileType` が `ts` でも `encoded` でもない場合は invalid route を生成せず、type/mode 欠落と同じ
   `配信設定が正しく入力されていません ` を snackbar で通知する。
   `fileType` は playback 側の route 検証に使う。`client/src/features/video/playback/playbackRoutes.ts` の
   `resolveRecordedStreamingWatchRoute` は、`fileType` が `ts` でも `encoded` でもなければ route を invalid とし、
   `streamConfig.recorded[fileType]` の mode 数で `mode` の範囲を検証する。query 1 個の追加で
   route 単体から playback 条件を確定できる。
8. streaming handoff に必要な type または mode が欠ける場合、EPGStation フロントエンドは invalid route を生成せず
   `配信設定が正しく入力されていません ` を snackbar で通知する。
9. streaming handoff に必要な recordedId または videoFileId が欠ける場合、EPGStation フロントエンドは invalid
   route を生成せず `番組 ID が不正です ` を snackbar で通知する。
10. `/recorded/watch` または `/recorded/streaming/:videoFileId` を表示するとき、Recorded workflow は watch route title
    input として `視聴 ` を提供する。physical route component、route validation、player lifecycle は
    `frontend-video-playback` が所有し、Video Playback は title 文言を再定義せず中継する。

### 要求 5: detail dialog と playback handoff の契約

**目的:** detail dialog と playback handoff の契約、dark theme での可読性を保つ。

#### 受け入れ条件

1. detail more menu の download dialog は heading を追加せず、`録画ダウンロード ` dialog label、video
   files、play lists の構成を維持する。
2. download dialog は backdrop click で閉じ、close 後に DOM から remove される。download link と playlist link の URL
   contract は既存の `GET /videos/:videoFileId?isDownload=true` と `GET /videos/:videoFileId/playlist` を維持する。
   download dialog は backdrop click に加えて `閉じる ` button でも閉じられる。
   この button は他の Recorded dialog（delete、add encode、streaming、Kodi）と同様に明示的な閉じる手段を
   提供するためのものであり、dialog label と本文構成（要求 5.1）を変えず、heading も追加しない。
3. recorded streaming handoff から playback page に遷移した後の autoplay、絶対 seek、HLS restart、ARIB 字幕 renderer は
   `frontend-video-playback` の要求 5 に従う。
4. Recorded list/detail/upload の dark theme は main content、item surface、dialog surface、menu
   icon、pagination を含めて背景と文字/icon の contrast を維持する。
5. Recorded list の table layout は dark theme で table container、header、row、cell、menu cell が App Shell table dark
   token を継承し、white table surface や black cell foreground を残してはならない。
6. Recorded upload form の required label（`放送局※`、`日付※`、`長さ※`、`番組名※`）、MUI select（`file type`、
   `directory` など）、date dialog（`日付`、`時刻`）、video file control（`name`、`video file` など）は、light
   theme と dark theme のそれぞれで、次の visible text を表示し、48px height の select/input 密度を維持し、text は
   contrast 比 4.5 以上、icon/border など非 text 要素は 3 以上を維持する。
