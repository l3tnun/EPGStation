# 要求仕様書

## 概要

On Air は放映中番組の一覧、broadcast-wave tab/list、program dialog、live stream select、live watch page への入口を提供する。

## 境界コンテキスト

- **対象範囲**: `/onair`、放映中 fetch、tab/list 表示、OnAirCard、program dialog、stream select dialog、live watch 情報 card。
- **対象外**: stream API lifecycle の詳細、settings key/default、App Shell navigation。
- **隣接する期待事項**: live/player の詳細は `frontend-video-playback`、settings は `frontend-settings-storage` に従う。

## 要求

### 要求 1: route と放映中一覧

**目的:** ユーザーとして、現在放映中の番組を放送波別または一覧で見たい。

#### 受け入れ条件

1. `/onair` を表示するとき、EPGStation フロントエンドは title `放映中` を表示する。
2. On Air は route deep watch immediate、Socket.IO `updateStatus`、次の表示中 program endAt、progress 10 秒 interval で更新する。
3. fetch 開始/終了時、EPGStation フロントエンドは既存 timer を clear/recreate し、destroy 時に listener/timer/interval を解除する。
4. On Air fetch は `GET /reserves/lists?startAt=now&endAt=now+1h` と `GET /schedules/broadcasting?isHalfWidth=<setting>` を使い、broadcasting には `time` を送らない。
5. reserve index は program id で normal、conflict、skip、overlap 順の上書き挙動を維持する。
6. `isOnAirTabListView` が true のとき、EPGStation フロントエンドは enabled broadcast wave の tab 表示を使う。
7. tab は server config enabled broadcast wave を `GR`、`BS`、`CS`、`SKY`、`BS4K` 順に作り、tab value は broadcast type とし、route query と同期しない。
8. tab 変更時、EPGStation フロントエンドは window top へ scroll する。
9. `isOnAirTabListView` が false のとき、EPGStation フロントエンドは単一 list 表示を使う。
10. On Air fetch に失敗したとき、EPGStation フロントエンドは `番組情報取得に失敗` を snackbar で通知する。
11. 放映中 schedule が 0 件のとき、EPGStation フロントエンドは no card、no empty message、no loading indicator の blank body を維持し、tabs を表示せず、次回 fetch を 1 秒後に予約する。
12. fetch 失敗時は fetch 開始時に clear した timer を再生成せず、`番組情報取得に失敗` snackbar を表示する。0 件時 1 秒 retry は fetch 成功かつ schedule 0 件の場合だけ行う。
13. On Air list は desktop / mobile のどちらでも centered single-column 表示を維持し、card text、progress、action entrypoint が互いに重ならない。
14. iOS / iPadOS fixed shell で tab 表示を使うとき、放送波 tab は title bar extension として title bar 高さに含め、main content は tab の下から開始する。On Air list が放送波 tab に重なる状態は regression failure とする。
15. schedule に program id や channel id が欠けているとき、EPGStation フロントエンドは各 schedule を program id、なければ channel id、なければ配列 index を key として個別の card に描画する。

### 要求 2: card と dialog

**目的:** ユーザーとして、放映中番組の進行状況と詳細 action を確認したい。

#### 受け入れ条件

1. OnAirCard を表示するとき、EPGStation フロントエンドは channel、logo または channel name fallback、program title、description、`hh:mm ~ hh:mm` time、progress を表示する。
2. progress が 0-100 の範囲外になりうるとき、EPGStation フロントエンドは表示値を 0-100 に clamp する。
3. progress の計算元は `(now - startAt) / (endAt - startAt) * 100` とする。
4. logo があるときは channel logo API path を使って高さ 24px で表示し、ないときは channel name text を表示する。
5. channel/logo/title row を選択したとき、EPGStation フロントエンドは event propagation を止めて program dialog を開く。
6. card body を選択したとき、EPGStation フロントエンドは stream select dialog を開く。
7. OnAirCard 自体には reserve/conflict/skip/overlap class を表示せず、reserve index は program dialog を開くときだけ参照する。
8. program dialog では Guide ProgramDialog と同じ no reserve/manual/rule/skip/overlap action、API、route、snackbar、close-after-action contract を使う。
9. OnAirCard は channel logo がない場合も channel name fallback で同じ高さの header row を維持し、logo 有無で card layout を大きく変化させない。
10. program dialog の `検索`、`編集`、`ルール` route action から `/onair` へ戻った直後も、OnAirCard を再選択して後続の ProgramDialog action を継続できる。On Air consumer は Guide ProgramDialog の external unmount 時 setting 保存 callback を実装し、route leave 中に page close state 更新を再入させない。

### 要求 3: live stream handoff

**目的:** ユーザーとして、放映中番組を対応 stream で視聴したい。

#### 受け入れ条件

1. live stream action を実行したとき、EPGStation フロントエンドは stream select dialog を表示する。
2. On Air から開いた stream select dialog では `番組表` button を表示しない。
3. stream type は `useURLScheme=true` なら M2TS config がある場合だけ `M2TS`、`useURLScheme=false` なら configured `M2TS-LL`、`WebM`、`MP4`、`HLS` の順に生成する。
4. dialog open 時、EPGStation フロントエンドは saved `useURLScheme/type/mode` を復元し、無効 type は先頭、範囲外 mode は 0 に戻し、close 時に選択値を保存する。
5. `M2TS` は常に live watch route へ遷移せず、外部アプリ URL scheme が生成できればそれを開き、なければ live M2TS playlist API path を開く。playlist API path は文書の path を基準とする相対 URL とし、EPGStation を subDirectory 配下で公開しても同じ配下の API を開く。この遷移先は設定 `isPreferredPlayingLiveM2TSOnWeb` の値および browser の mpegts live playback 対応状況に依存しない。
6. `M2TS` の視聴 URL は、外部アプリ URL scheme が無い場合も live M2TS playlist API path の相対 URL を常に生成できる。`視聴` button は channel が指定されるまで押せないため、URL を生成できない状態で押される場面は無く、生成失敗の通知は持たない。
7. `M2TS-LL`、`WebM`、`MP4`、`HLS` は `/onair/watch` へ遷移する。
8. `M2TS-LL` が browser support check に失敗したとき、EPGStation フロントエンドは `再生に対応していません` を snackbar で通知する。
9. watch route への navigation に失敗したとき、EPGStation フロントエンドは `視聴ページへの移動に失敗` を snackbar で通知する。
10. `/onair/watch` への route builder、serialized `type` query、navigation failure snackbar は `frontend-onair` が所有する。`/onair/watch` route の query validation、player param 作成、player lifecycle、subtitle、controls は `frontend-video-playback` が所有する。
11. live watch page の info card は `frontend-onair` が所有し、`GET /streams?isHalfWidth=<setting>` から route query の `channel` と `mode` に一致する stream info がある場合だけ表示する。matching は `channelId` と `mode` で行い、backend 内部 `type` と route query の stream type は直接比較しない。player mount 可否と player param は `frontend-video-playback` の route validation result に従う。
12. stream info fetch 失敗時、EPGStation フロントエンドは `ストリーム情報取得に失敗` を snackbar で通知する。matching stream の `endAt` を次回更新 timer に使い、stream info が 0 件または `endAt - now <= 0` のときは 1 秒後に再試行する。
13. stream info fetch 失敗時も次回 stream info refresh を 1 秒後に予約する。
14. stream select dialog で `useURLScheme` を切り替えたとき、EPGStation フロントエンドは現在の候補 list を再構築し、選択 type を先頭候補へ、mode を 0 へ補正する。
15. `/onair/watch` route を表示するとき、EPGStation フロントエンドは title `視聴` を表示する。physical route と player validation は `frontend-video-playback` が所有し、On Air は title と live info card だけを所有する。
16. stream select dialog は常設 `キャンセル` button と `視聴` 確定 button を表示する。`キャンセル` は API call なしで dialog を閉じ、`視聴` は選択中 stream の handoff を実行する。`番組表` button は呼び出し元から show-guide prop を受けたときだけ表示する。
17. On Air は `LiveStreamSelectDialog` を shared component export として所有する。consumer は On Air screen 自身と Guide とする。consumer は stream 候補生成、`OnAirSelectStreamSetting` の保存/復元/invalid 補正、URL scheme / playlist fallback / watch route 生成、`再生に対応していません`、`視聴ページへの移動に失敗` の snackbar を再定義しない。
18. On Air の live playback verification は `M2TS` の external/playlist handoff、`M2TS-LL` / `WebM` / `MP4` の direct stream watch route、`HLS` の stream start/readiness lifecycle を個別に確認する。`M2TS` 以外の watch route では player container が mount され、media URL または HLS playlist URL が `frontend-video-playback` の mapping と一致することを証跡化する。
19. `/onair/watch?type=m2ts` を直接表示した場合は direct route として `frontend-video-playback` に委譲し、M2TS direct stream player を mount する。受け入れ条件 5 のとおり On Air entrypoint からの選択はこの route へ遷移しないが、direct route（bookmark や URL 直接入力）自体の player mapping を未検証扱いにしてはならない。
20. `番組表` button を押下したとき、EPGStation フロントエンドは選択中 channel の channelId を使い、現在 route の time query が有効な値ならその time を維持して `/guide` route へ遷移し、dialog を閉じる。channel が無いときは遷移も close も行わない。
21. channel が指定されていないとき、EPGStation フロントエンドは `視聴` button を無効化し、クリックしても API 呼び出しや route 遷移を行わない。dialog の内容（select、switch、`視聴`/`キャンセル`/`番組表` button を含む card 自体）は channel の有無に関わらず常に描画され、`視聴` button だけが channel 未指定または候補 0 件のときに無効化される。
22. stream select dialog の `外部アプリで開く` switch は、切り替え時に background-color と位置を 150ms の transition で変化させる。
23. live watch page の info card は Socket.IO `updateStatus` 通知を受けたとき、`GET /streams` を再 fetch する。
24. 設定 `isPreferredPlayingLiveM2TSOnWeb` は `M2TS` の遷移先を変化させない。同設定は Settings 画面の `放映中` section に、mpegts live 再生に対応する browser でだけ表示される compatibility control として存在するのみで、live stream handoff の挙動を読んで変える consumer を持たない。`M2TS-LL` はこの設定に依らず常に live watch route へ遷移する。
25. stream select dialog で配信方式（type）を変更したとき、EPGStation フロントエンドは新しい配信方式の画質候補に現在選択中の mode index が存在する場合はその mode を維持し、存在しない場合だけ mode を 0 に補正する。

### 要求 4: live playback と dark theme

**目的:** watch page への遷移で player 契約を守り、dark theme で可読性を保つ。

#### 受け入れ条件

1. On Air から watch page へ遷移したとき、player は `frontend-video-playback` の autoplay、音声 on、subtitle、controls contract に従う。
2. On Air main content、stream select dialog、program info card、action icon は dark theme で background、text、icon の contrast を維持する。
3. `/onair/watch` の live watch info card は App Shell dark theme token を使い、CSS variable が未定義の環境でも white paper fallback に落ちてはならない。channel、time、title、description は dark surface 上で `textPrimary` / `textSecondary` 相当の contrast を維持する。
4. On Air の live 読み込み中 spinner は 50px 四方の寸法を維持し、色は App Shell の `primary` token 経由（light `#1976d2` / dark `#90caf9`）で決まる。この色は `frontend-app-shell` design.md が確定した primary token 契約（MUI default 採用）にそのまま従う。
