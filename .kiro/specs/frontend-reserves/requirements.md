# 要求仕様書

## 概要

Reserves は予約一覧、状態別 route、delete/unskip/unoverlap、edit mode、Manual Reserve add/edit を扱う。

## 境界コンテキスト

- **対象範囲**: `/reserves`、`/reserves/manual`、type query、list rendering、state variants、dialog/menu/snackbar、manual reserve form。
- **対象外**: App Shell navigation item の生成、settings default。
- **隣接する期待事項**: page size は `frontend-settings-storage`、shell は `frontend-app-shell` に従う。

## 要求

### 要求 1: Reserves list route と fetch

**目的:** ユーザーとして、予約を状態別に確認したい。

#### 受け入れ条件

1. `/reserves?type=normal`、`conflict`、`overlap`、`skip` を表示するとき、EPGStation フロントエンドは対応する予約 state list を取得する。
2. `/reserves` の no `type` では `GET /reserves` に `type=all` を送る。
3. unknown `type` では `GET /reserves` に `type=normal` を送る。
4. `GET /reserves` は常に `isHalfWidth=<isHalfWidthDisplayed>`、`limit=<reservesLength>`、`offset=(page-1)*reservesLength` を送る。
5. initial render、route path/query change、pagination query change、Socket.IO `updateStatus` で fetch する。
6. route-driven fetch では list を hidden state にして state を clear してから refetch し、完了後に表示を戻す。
7. Socket.IO fetch は現在 route option で更新する。
8. fetch に失敗したとき、EPGStation フロントエンドは `予約データ取得に失敗 ` を通知する。
9. API が 0 件を返したとき、EPGStation フロントエンドは explicit empty copy を追加しない。
10. Socket.IO fetch では route-driven fetch のように list を hidden state へ切り替えず、現在表示を維持したまま現在 route option で refetch する。
11. Socket.IO `updateStatus` による fetch が失敗したとき、EPGStation フロントエンドは snackbar 通知を行わず、直前まで表示していた list をそのまま維持する。
12. pagination は `total <= reservesLength`（0 件、または 1 ページに収まる件数）のとき非表示にし、`total > reservesLength` のときだけ表示する。ページ数は `total === 0` のとき 1、それ以外は `Math.ceil(total / reservesLength)` とする。 settings の `isEnableExtendedPagination` が `true` のときは、共有 component `AppPagination`（`frontend-app-shell` 要求 8.49）を通じて拡張 pagination（`frontend-app-shell` 要求 8.33-8.47）を表示し、`false`（default）のときは従来の pagination を変えずに表示する。表示の有無（`total <= reservesLength` で非表示）、ページ数、`?page=` query での移動は、拡張・従来で同じとする。
13. `page` query が非整数または 1 未満のとき、EPGStation フロントエンドは `page=1` として扱い、`GET /reserves` の `offset` を `0` に丸める。

### 要求 2: state variants と list actions

**目的:** ユーザーとして、予約状態を区別し、必要な action を実行したい。

#### 受け入れ条件

1. `/reserves` を query なしまたは `type=normal` で表示するとき、EPGStation フロントエンドは title `予約 ` を表示する。
2. `/reserves?type=conflict` を表示するとき、EPGStation フロントエンドは title `競合 ` を表示する。
3. `/reserves?type=overlap` を表示するとき、EPGStation フロントエンドは title `重複 ` を表示する。
4. `/reserves?type=skip` を表示するとき、EPGStation フロントエンドは title `除外 ` を表示する。
5. reserve card class を決めるとき、EPGStation フロントエンドは priority `skip`、`conflict`、`overlap`、`reserve` を維持する。
6. 1 件の reserve item で `isSkip`/`isConflict`/`isOverlap` が同時に複数 true になる異常データが来た場合でも、EPGStation フロントエンドは 2.5 の priority (`skip` > `conflict` > `overlap` > `reserve`) を単一の if/else-if 分岐で決定的に解決し、複数 class が同時に付かないようにする。複数 item 間の「list grouping」という grouping 機構は存在しない。
7. title bar menu の `編集 ` を実行したとき、EPGStation フロントエンドは edit mode に入り、title を `<selectedCount> 件選択 ` に切り替える。
8. title bar menu の `予約情報更新 ` を実行したとき、EPGStation フロントエンドは `POST /reserves/update` を呼び、成功時は `予約情報の更新開始 `、失敗時は `予約情報の更新を開始できませんでした。` を snackbar で通知する。
9. list item を edit mode 外で選択したとき、EPGStation フロントエンドは reserve dialog を開き、name、channel、time、genre、description、extended text を表示する。
10. reserve dialog の time row を選択したとき、EPGStation フロントエンドは dialog を閉じ、番組開始 hour の Guide route へ遷移する。settings `isEnableDisplayForEachBroadcastWave=true` かつ channel lookup で broadcast wave が解決できる場合だけ `type=<wave>` を付与する。
11. item menu の recorded search action で `ruleId` があるとき、EPGStation フロントエンドは `/recorded?ruleId=<ruleId>` へ遷移する。
12. item menu の edit action では、manual reserve は `/reserves/manual?reserveId=<reserveId>`、rule reserve は `/search?rule=<ruleId>` へ遷移する。
13. conflict reserve では、EPGStation フロントエンドは delete と unlock action を表示しない。
14. conflict ではなく skip/overlap でもない reserve では、EPGStation フロントエンドは delete action を表示し、single delete dialog を開く。
15. skip reserve では、EPGStation フロントエンドは unlock action を表示し、`DELETE /reserves/:reserveId/skip` を呼び、成功時は `<name> 除外解除 `、失敗時は `<name> 除外解除失敗 ` を snackbar で通知する。
16. overlap reserve では、EPGStation フロントエンドは unlock action を表示し、`DELETE /reserves/:reserveId/overlap` を呼び、成功時は `<name> 重複解除 `、失敗時は `<name> 重複解除失敗 ` を snackbar で通知する。
17. 単体 delete action 成功後、EPGStation フロントエンドは optimistic removal を行わず、即座に list を明示的に refetch する。unlock action（skip 除外解除・overlap 重複解除）成功後および bulk delete action 成功後は、この明示的な refetch を行わず、後続の Socket.IO `updateStatus`、route change、または別 fetch による refetch-driven update に委ねる。単体 delete だけがこの非対称な即時 refetch を持つことは意図的な仕様である。`予約情報更新 ` action 成功後は 2.18 を正とする。
18. `予約情報更新 ` 成功後、EPGStation フロントエンドは直接 list refetch を行わず、表示更新は後続の `updateStatus` または route/fetch trigger に委ねる。
19. Reserves screen では state class priority を維持するが、通常 card layout は `needsDecoration` を渡さず、table layout も state class を付けないため、conflict/skip/overlap の visible decoration は出さない。
20. Reserves は `ReserveDialog`、`ReserveMenu`、`ReserveDeleteDialog`、`ReserveListItem` を shared component export として所有する。Reserves screen、Dashboard、SearchRule の time-specified rule edit はこれらを consumer として使い（Dashboard は `ReserveMenu`・`ReserveDialog`・`ReserveDeleteDialog` を使い、行は Dashboard 自身が描画する）、card rendering、dialog body、API body、delete/unlock/edit/recorded-search route、success/failure snackbar 文言を再定義しない。
21. `ReserveListItem` の consumer は Reserves screen と SearchRule の time-specified rule edit である。Reserves screen は `needsDecoration=false` 相当で使い、SearchRule の time-specified rule edit は `needsDecoration=true`、`disableEdit=true` 相当で使う。
22. Reserve list は list container width（`.reservesPage` の実測幅、左右 padding 8px を含む）915px 以下で card/list layout、916px 以上で table layout を表示する。padding を除いた content 幅では 899px 以下／900px 以上に当たる。desktop 1440x900 の visual case は通常 table layout を正とし、card layout は mobile / narrow container case で確認する。
23. `ReserveListItem` の card layout は、reserve に channel 情報がない場合 channel 表示要素を省略し、start/end timestamp がない場合は時刻表示要素を省略する。
24. title bar の menu は action を選ばずに dismiss されたとき、state を変えずに閉じる。

### 要求 3: delete dialog と bulk edit

**目的:** ユーザーとして、単一予約または複数予約を確認後に取り消したい。

#### 受け入れ条件

1. single delete dialog は `<name> を削除しますか?` を表示し、name がない場合は `予約id: <reserveId>` を fallback として表示する（半角スペースを含まない）。
2. single delete dialog は `キャンセル ` と `削除 ` button を表示し、`削除 ` で `DELETE /reserves/:reserveId` を呼ぶ。
3. single delete 成功時、EPGStation フロントエンドは `<name> を削除 `、失敗時は `<name> を削除に失敗 ` を snackbar で通知する。
4. edit mode で item を選択したとき、EPGStation フロントエンドは選択状態を toggle し、item click で reserve dialog を開かない。選択状態は Recorded / Recording と同じ filled blue selection として item 全体に適用し、table layout では `td` の背景で row selection が欠けてはならない。
5. edit mode の終了 action を実行したとき、EPGStation フロントエンドは selection を clear する。
6. edit mode の select-all action を実行したとき、EPGStation フロントエンドは表示中 item の selection を toggle する。
7. edit mode の delete action を実行したとき、EPGStation フロントエンドは bulk delete dialog を開く。
8. bulk delete dialog は max width 300、visible title を表示せず、`選択した <total> 件の番組を削除しますか。`、`キャンセル `、`削除 ` だけを表示する。accessibility name は `予約一括削除 ` として保持する。
9. bulk delete dialog を 0 件選択で開いたとき、EPGStation フロントエンドは dialog を即座に閉じ、`番組を選択してください。` を snackbar で通知する。
10. bulk delete confirm 時、EPGStation フロントエンドは edit mode を終了して selection を clear し、選択予約に `DELETE /reserves/:reserveId` を順次実行する。
11. bulk delete 成功時、EPGStation フロントエンドは `選択した番組の予約をキャンセルしました。`、一部または全件失敗時は `一部番組のキャンセルに失敗しました。` を snackbar で通知する。
12. edit mode の selection は、Socket.IO 由来の refetch で一覧の行 object が入れ替わっても、同一 reserveId の selection 状態を維持する。

### 要求 4: Manual Reserve

**目的:** ユーザーとして、番組からの予約、時刻指定予約、既存予約編集を行いたい。

#### 受け入れ条件

1. `/reserves/manual` を表示するとき、EPGStation フロントエンドは title `番組詳細予約 ` を表示する。
2. `/reserves/manual` を query なしで表示したとき、EPGStation フロントエンドは guidance text や placeholder を一切表示せず、time specification は初期 off とする。
3. programId query があるとき、EPGStation フロントエンドは program information を取得して program-based reserve mode を表示する。
4. reserveId query があるとき、EPGStation フロントエンドは existing reserve edit mode を表示する。`reserveId` と `programId` が同時にある場合は `reserveId` を優先する。
5. edit mode では 時刻指定 switch と時刻指定 mode の 番組名/放送局/開始/終了 field を disabled とし、予約対象の program または時刻の変更を許可しない。
6. time-specified validation に失敗したとき、EPGStation フロントエンドは generic snackbar-only validation を維持する。
7. time-specified mode の Socket.IO refresh では program-info fetch target がないため、no-op とする。
8. add mode の保存では、program mode または time-specified mode の valid target がある場合だけ `POST /reserves` を呼び、成功時は `予約を追加しました。`、失敗時は `予約の追加に失敗しました。` を snackbar で通知する。no-query add mode で時刻指定 off のまま保存した場合は API call せず `予約の追加に失敗しました。` を通知する。
9. edit mode の保存では、EPGStation フロントエンドは `PUT /reserves/:reserveId` を呼び、成功時は `予約を更新しました。`、失敗時は `予約の更新に失敗しました。` を snackbar で通知する。
10. add/edit 成功後、EPGStation フロントエンドは既存 delay を維持して前の route へ戻る。
11. cancel action を実行したとき、EPGStation フロントエンドは API call なしで前の route へ戻る。
12. programId mode では `GET /schedules/detail/:programId?isHalfWidth=<setting>` 成功後、program information を表示し、name、channelId、startAt、endAt を `timeSpecifiedOption` へコピーする。
    時刻指定 switch を on にした場合、EPGStation フロントエンドは program information section を非表示にし、代わりに time-specified target fields を表示する。switch を off に戻した場合は program information section を再表示し、time-specified target fields を非表示にする。
13. Manual Reserve の fetch failure は、existing reserve fetch 失敗で `予約情報取得に失敗 `、program fetch 失敗で `番組情報取得に失敗 ` を snackbar で通知する。
14. add payload は `allowEndLack` に加え、program mode では `programId`、time-specified mode では `{ name, channelId, startAt, endAt }` milliseconds を送る。
15. edit payload は `programId` と `timeSpecifiedOption` を送らず、`allowEndLack` と非 null の save/encode option だけを送る。
16. add mode だけ route leave/update 時に form state を scroll history に保存し、edit mode では保存しない。
17. Manual Reserve init では option panels index `[0, 1, 2, 3, 6]` を open する。
18. history restore は `programId` add mode で history state がある場合だけ実行し、no-query add mode と edit mode では復元しない。
19. existing reserve edit mode で取得した reserve が `programId` を持つ場合、EPGStation フロントエンドは `GET /schedules/detail/:programId?isHalfWidth=<setting>` を追加取得し、program information 表示だけを補完する。edit payload の target field は引き続き変更不可とする。
20. `saveOption` は UI 上の保存設定 option object が存在する場合、空 object でも body に含め、存在しない場合は omit する。`encodeOption` は選択済み mode が 1 件以上ある場合だけ body に含め、mode/directory と `isDeleteOriginalAfterEncode` を `encodeOption` 内に配置する。mode が全て null の場合は `encodeOption` を omit する。
21. Manual Reserve の option panels index `[0, 1, 2, 3, 6]` は初期 open state として扱い、panel header は pointer と keyboard で開閉できる。option panel は click / keyboard activation のたびに非 0ms の開閉アニメーションを持ち、閉じた panel の入力 control はアニメーション完了後に DOM から外し、再度開いたときに同じ draft value を維持する。
22. Manual Reserve の `エンコード2` / `エンコード3` panel は初期 closed だが、開いた場合は mode、directory、sub directory の control を表示し、選択値を `encodeOption.mode2/directory2` および `encodeOption.mode3/directory3` として payload builder に渡す。
23. Manual Reserve の時刻指定 start/end input は UI 上 `yyyy-MM-dd HH:mm` 形式で表示・編集し、API payload では milliseconds number の `startAt` / `endAt` を送る。
    UI input に UNIX milliseconds の裸値を表示してはならない。start/end input を click すると、月・曜日を日本語で表示し週の始まりを月曜にした calendar（先頭の列が月曜）と 24 時間表記の時刻の選択を持つ日時 picker dialog（Recorded Upload、Search の期間と共通の部品）を開き、calendar で日を選んで `設定` を押すと input に反映し、`クリア` は値を空にする。disabled の input は dialog を開かない。
24. Manual Reserve の encode mode option は `/api/config` の `encode` array と normalized `encodeModes` array のどちらからも取得でき、string 以外の値は option に出さない。
25. Manual Reserve の時刻指定 `番組名 `、start/end、保存 `sub directory`、`file format`、encode1-3 の `sub directory` は clearable として、値が non-empty かつ disabled でないとき field 右端に clear button を表示し、押下で該当 field だけを空にする。channel/directory/mode select は対象外とする。
26. programId mode では program information の取得が完了するまで、EPGStation フロントエンドは `保存` button を disabled にする。
27. add/edit の保存 action は、実行中に連続 click されても API call を一度だけ行い、保存処理中は `保存` button を disabled にする。
28. add mode の保存 成功後、query 変更や画面 unmount が先に発生した場合、EPGStation フロントエンドはその submit に由来する snackbar 表示、route 遷移、および pending の遷移 timer を発火させない。
29. manual reserve の server option (channel/directory/encode mode) 取得が失敗した場合、EPGStation フロントエンドは空 option へ fallback して画面表示を継続する。取得完了前に画面が unmount された場合は、成功/失敗いずれの取得結果も適用しない。
30. Manual Reserve の `エンコード1`、`エンコード2`、`エンコード3`、`ファイル削除` の option panel は、`/api/config` から取得した encode mode option が 1 件以上ある場合だけ表示する。encode mode option が 0 件の場合、EPGStation フロントエンドはこの 4 panel を描画しない。
31. Manual Reserve の時刻指定 `番組名` field の label は `name` とする。
32. Manual Reserve は server option（encode mode）の取得が終わるまで、スクロール復元の完了を知らせない。encode panel の表示の有無が決まって画面の高さが確定してから、戻ったときの位置を復元する。

### 要求 5: Reserves dark theme

**目的:** ユーザーとして、ダークモードでも予約一覧と予約操作を判読・操作したい。

#### 受け入れ条件

1. `/reserves` card/list/table surface は dark theme で `background.paper` 相当の暗い paper 色を使い、白い card/list/table surface を残さない。
2. card layout の title、channel、datetime、description、title icon、menu icon は dark theme で背景との contrast を維持し、後続の card 専用 CSS によって黒系色へ戻ってはならない。
3. title bar menu と item menu は MUI portal 配下でも dark theme token を継承し、menu item text と icon が黒色のまま残ってはならない。
4. bulk delete dialog は dark theme で title、body、`キャンセル `、`削除 ` の text/control contrast を維持する。
5. dark theme visual verification は list default、title menu open、item menu open、bulk delete dialog open の open state を個別に検査する。

### 要求 6: dark theme coverage

**目的:** dark theme で Reserves の可読性を保つ。

#### 受け入れ条件

1. Reserves normal/conflict/overlap/manual の main content、card/table、dialog、action menu、pagination は dark theme で background、text、icon、divider の contrast を維持する。
2. reserve dialog と manual reserve form は dark theme で description/extended text、link、disabled field、option panel の可読性を維持する。
3. desktop table layout の table card、visible row、cell、menu cell は dark theme で `background.paper` 相当の暗い surface と text/icon token を使い、row 単位の white fallback を残してはならない。
