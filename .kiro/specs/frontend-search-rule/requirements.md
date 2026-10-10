# 要求仕様書

## 概要

Search / Rule は番組検索、検索結果からの予約/rule 作成、rule list/search/edit/enable/delete を扱う。

## 境界コンテキスト

- **対象範囲**: `/search`、`/search?rule=...`、`/rule`、検索 form、result decoration、rule option、rule list action。
- **対象外**: App Shell navigation、settings default、Manual Reserve 詳細。
- **隣接する期待事項**: settings は `frontend-settings-storage`、program
  dialog 共通挙動は Guide/Recorded 各 spec と整合させる。

## 要求

### 要求 1: Search route と query-driven search

**目的:** ユーザーとして、URL query または form から番組を検索したい。

#### 受け入れ条件

1. `/search` を表示するとき、EPGStation フロントエンドは title `検索` を表示する。
2. `/search?rule=<ruleId>` を表示するとき、EPGStation フロントエンドは title `ルール編集` を表示する。
3. `/search` を plain route で表示したとき、EPGStation フロントエンドは user action 前に default
   search を実行せず、検索結果領域に empty/help text を追加表示しない。
4. `/search` に keyword/channel/genre などの query があるとき、EPGStation フロントエンドは query-driven
   auto-search を実行する。
5. Socket.IO updateStatus を受信したとき、EPGStation フロントエンドは plain `/search` で user action 前の default
   search を発火しない。この挙動は intentional
   fix とし、検索実行済み状態がある場合だけ再検索する。
6. search form から検索するとき、EPGStation フロントエンドは form-to-API mapping を適用する。
7. search result には reserve/conflict/skip/overlap decoration を 表示する。
7a. search result item の title は  16px /
    28px / font-weight 900 とし、description は 14px / 20px とする。iOS Safari でも title と
    description が button UA default font に縮小され、放送局名や日時より小さく表示されてはならない。
8. `/search` query は `keyword`、`channelId`、`genre`、`subGenre` を form に反映して auto-search する。Guide
   ProgramDialog の `検索` action から `/search?keyword=...` へ遷移した場合も同じ query-driven
   auto-search として扱い、route 表示後に user が検索 button を押さなくても `POST /schedules/search` を実行する。
9. `rule` query が存在する場合、EPGStation フロントエンドは query search values を無視し、rule edit mode を優先する。
10. `POST /schedules/search` body は `{ option, isHalfWidth, limit }` とし、`isHalfWidth` は
    `isHalfWidthDisplayed`、`limit` は `searchLength` を使う。
11. `option.times` は常に 1 件送信し、duration は秒へ変換し、period は両端が揃う場合だけ送る。
12. keyword / ignore keyword の target defaulting、channel / broadcast-wave、genre / subGenre、exclude options の API
    key mapping は form-to-API mapping table として design phase で固定する。keyword または ignore
    keyword が non-empty で `name` / `description` / `extended` の target がすべて OFF の場合、検索実行前の request
    body では `name=true`、`description=true` を自動適用する。keyword が empty の場合は keyword
    target を request body に残さない。
13. Search result は result が `null` でない場合 0 件でも `<n> 件ヒット` を表示し、pagination は持たず `searchLength`
    limit に依存する。
14. broadcast wave は channel 未選択時だけ API filter に使い、全 visible wave が enabled の場合は `GR` / `BS` / `CS` /
    `SKY` / `BS4K` key を omit する。visible wave がすべて disabled の場合は全 visible
    wave を enabled に戻してから検索する。この「戻す」対象は outgoing request body だけでなく検索条件
    form の表示（チェックボックス）にも及ぶ。詳細は要求 1.22。
15. time-specified rule payload では weekday が 0 件選択の場合、API には全曜日を表す `week=0x7f` を送る。
16. SearchResult header は `<n> 件ヒット` text と link icon button を表示し、link icon click で SearchRuleOption
    card へ scroll する。
17. 初回または query-driven の normal EPG search が失敗したとき、EPGStation フロントエンドは `検索に失敗`
    を snackbar で通知する。既存検索結果の refresh 失敗は要求 2 の `検索情報更新に失敗` を使う。
18. Search 画面は route leave/update 時に
    `searchOption`、`genreSelect`、`reserveOption`、`saveOption`、`encodeOption`、`isSearched` 相当の page
    state を保存し、history restore の場合だけ復元する。plain `/search` の初回表示では復元 state がない限り default
    search を発火しない。
    `client/src/app/scroll/scrollHistoryTypes.ts` の `ScrollHistoryState`
      インターフェースは `saveScrollData<T>` / `getScrollData<T>` / `isNeedRestoreHistory()` を
      持ち、`client/src/features/reserves/hooks/useManualReserveLoader.ts` が Manual Reserve 画面の
      form 相当データをこの機構で save/restore する。`client/src/features/search/rule/hooks/useSearchRuleFormState.ts`
      も同じ機構で page state を save/restore し、`useSearchRuleQueries.ts` は
      `useScrollHistoryPageReady` （scroll 位置復元の準備完了通知）を呼ぶ。`SearchRulePage` は他の
      route 同様 `react-router-dom` の通常の `<Route element={...}>` として mount/unmount される
      （`client/src/app/routes/managementRoutes.tsx` の `/search` の Route、`AppRoutes.tsx` の `<Routes>`）ため、plain `/search`
      で keyword を入力しただけ（未検索）の状態で他 route へ遷移し、ブラウザの戻る操作で `/search`
      へ戻った場合も入力内容を復元する必要があり、これを `client/src/features/search/rule/lib/searchPageInfo.ts` の
      `SearchPageInfo`（`form` / `isTimeSpecification` / `timeReserveForm` / `optionDraft` / 検索実行済み
      フラグ `isSearched`。`genreSelect` 相当は `form.selectedGenres` に含まれるため独立フィールドを
      持たない）で行う。`useManualReserveLoader.ts` と同じ形で、`useSearchRuleFormState.ts` は
      component の mount 時に一度だけ（lazy `useState` の初期値として）
      `routeState.mode === 'search'` かつ `scrollHistory.isNeedRestoreHistory()` が true の場合だけ
      `scrollHistory.getScrollData()` の値を `resolveSearchPageInfoForRoute` で検査して `form`/`isTimeSpecification`/`timeReserveForm`/
      `optionDraft`/`activeRequest` の初期値を組み立て、`isSearched` だった場合だけ `activeRequest` を
      種入れして再検索を発火する（`isSearched` が false のときは入力内容だけ復元し、検索は発火しない）。
      component の実際の unmount 時（`/search` を離れて他 route へ遷移する場合）にだけ、その時点の
      `routeState.mode`（`useRef` で保持）が `'search'` のときだけ `scrollHistory.saveScrollData(pageInfo)`
      を呼ぶ。ルール編集 route（`mode === 'rule-edit'`）を離れる場合や、`/search` の route param だけが
      変わり component が再 mount されない場合は、保存・復元のどちらも行わない。history restore 対象だが
      保存済み page info が存在しない場合（`getScrollData` が null）は通常の route query 由来の初期値へ
      fall back し、query が無ければ検索を発火しない（要求 1.3/1.4/1.5 を満たす）。
    - この復元は component の mount 時に一度だけ読む値であり、要求 1.21 の
      `useSearchRuleRouteEffects.ts` の `didRouteSearchChange` guard（同一 route 内の再 render で
      form/検索結果を reset しない）とは独立して動作する。mount 直後の初回 effect 実行では
      `previousRouteSearchRef` の初期値が同じ route search と一致するため `didRouteSearchChange` は
      false になり、復元した初期値を上書きしない。
19. Search form と search result list は desktop / mobile のどちらでも form controls と result
    action が重ならず、route state restore 後も control order を維持する。
20. Search 初期化に失敗したときは `初期化失敗` を snackbar で通知する。`スクロールに失敗` は SearchResult header の
    link icon（要求 1.16）または rule option card への scroll 遷移先要素が mount されていない場合にだけ通知し、
    scroll 先の高さ計算（title bar 高さ取得、`window.scrollTo` 自体の例外）を理由に通知してはならない。
    `client/src/features/search/rule/lib/pageScroll.ts` の
      `getTitleBarHeight()` は title bar 要素が見つからなければ `0` 扱いにし、`scrollToElementHead()` の
      `window.scrollTo` 呼び出し例外は握りつぶして `true` を返す。`scrollToTop` 呼び出し側
      （`client/src/features/search/rule/hooks/useSearchRuleActions.ts`）は failure 通知を発行しない。
      scroll 先 element が実際に mount されていない場合（`resultRef`/`ruleOptionRef` が
      `null`）だけ、`スクロールに失敗` を通知する。
    - 検索結果が一時的に消える現象は本項の scroll 通知の対象ではなく、要求 1.21 の再 render 由来の
      form/検索結果リセットの対象である。`スクロールに失敗` の snackbar 表示自体が ancestor 再 render を
      誘発し得るため、要求 1.21 のガードはこの再 render に対しても有効でなければならない。
    - 検索画面の検索 form 自体の content 高さは **1198px** である（`document.documentElement.scrollHeight`
      の実測）。viewport 高さがこれを下回る窓では検索前から縦 scrollbar が出ているが、これを上回る窓では
      **検索前に scrollbar が無い**。検索結果が描画されて page が overflow した瞬間に classic scrollbar が
      現れ、`window.innerWidth` が scrollbar 幅ぶん狭くなる。この幅変化は `useResolvedViewportWidth` を
      更新して shell を再 render させるため、要求 1.21 のガードはこの再 render に対しても有効でなければ
      ならず、これを外すと検索結果が一瞬だけ描画されて消え、scroll 先の `resultRef` が `null` になって
      `スクロールに失敗` の通知が出る。
    - この機構は `client/unittest/spec/searchRule.routeEffectsReplay.spec.test.tsx` の
      「keeps the result list when a scrollbar appearing narrows the viewport after a search」が
      fixture 上で固定する。この fixture は `?keyword=...` route query 由来の auto-search を使うため、
      要求 1.21 のガードを外しても同一内容の auto-search が再送されるだけで結果は変わらず、ガード欠如を
      検出しない。ガード欠如は同 file の `[AC 1.20]` テストおよび `[AC 2.9]` の「keeps a typed
      keyword and a selected channel when an unrelated re-render replays plain search mode」テスト、
      `searchRule.submit.spec.test.tsx` の `[AC 1.21]` テストが検出する。
21. plain `/search` および `/search?keyword=...` 等の query search の form state
    （keyword、除外 keyword、channel 選択、放送波チェック、時刻/期間 field、`activeRequest`/検索結果表示）は、
    URL の route（`location.search`）自体が変化した場合にだけ route 既定値へ reset してよい。同じ route
    のまま発生する再 render（snackbar 表示、他 field の操作、server config の非同期反映などに伴う
    ancestor 再 render で `settings`/`enabledBroadcastWaves` が中身は同じだが参照だけ新しい object/array に
    なるケースを含む）で、無関係な field の入力内容や検索結果を消してはならない。
    - route 変化の判定は effect の dependency 配列で行う。
      `client/src/features/search/rule/hooks/useSearchRuleRouteEffects.ts` の
      'search' mode 分岐は route 変化検知フラグ（`didRouteSearchChange`）を使い、これが false の
      ときは `setForm(routeForm)` / `setActiveRequest(...)` を実行しない。rule-edit 分岐側は同種の
      判定に `initializedRuleEditKeyRef` による guard を使う
      （`searchRule.routeEffectsReplay.spec.test.tsx` の `[AC 2.9]` テストで検証）。
    - この guard は、encode option の directory pulldown 操作のように
      `RuleOptionForm`/`RuleOptionField` のローカル state（`optionDraft`）しか更新しない操作の前後で
      起きる無関係な再 render（route 効果の再発火）に対しても有効でなければならない。pulldown 操作
      そのものは search state を直接書き換えないが、guard が無い場合はこの再 render が channel 選択、
      keyword/除外 keyword、検索結果、encode option を route 既定値へ戻してしまう。
22. broadcast wave の自動復元（要求 1.14）は、outgoing request body だけでなく検索条件 form の
    表示状態（放送波チェックボックスの checked/unchecked）にも適用し、UI 上でチェックボックスが再チェック
    された状態を可視化する。channel が 1 件以上選択されている場合は、visible な放送波チェックボックスを
    全て unchecked 表示に戻す。
    `restoreVisibleBroadcastWaves`（`client/src/features/search/rule/lib/searchRequest.ts`）が
      request body 用の正規化を行い、`submitSearch`（`useSearchRuleActions.ts`）の `setForm` 呼び出しへ
      その結果を反映することで、表示中のチェックボックスも同じ値に更新する。
      channel 選択時に全 wave を disable へ戻す分岐も併せて実装している。
    - `enabledBroadcastWaves` は server config 読み込み前は fallback の 4 波
      （`LEGACY_BROADCAST_WAVE_ORDER`。5 波を持つ `BROADCAST_WAVE_ORDER` とは別に、
      config 未読込時だけ固定 4 波を返す）で form state を初期化するが、mount 時に一度だけ実行される `useState`
      初期化子は読み込み後に実際の有効波（例: GR/BS/CS の 3 波）へ絞られても再実行されないため、画面に
      出ない波（例: SKY）の `broadcastWaves` key が state に残り得る。これを放置すると「全 visible wave
      が disabled か」の判定を誤らせるため、`enabledBroadcastWaves` の実体セットが変化したときだけ
      `broadcastWaves` の key 集合を reconcile する effect を持つ（`useSearchRuleFormState.ts`）。これは
      要求 1.22 の挙動が成立するための前提条件である。

### 要求 2: Search からの reserve/rule workflow

**目的:** ユーザーとして、検索結果から予約や rule を作成・編集したい。

#### 受け入れ条件

1. search result の program dialog から reserve action を実行したとき、EPGStation フロントエンドは対応 reserve API
   workflow を実行する。
2. search result の program dialog は no reserve では encode selector、delete-original checkbox、`詳細`、`検索`、`予約`
   を表示する。
3. search result の program dialog は manual reserve（reserveItem に `ruleId` が無い）では、type（reserve/conflict/skip/
   overlap）に関わらず `編集`、`検索` と、状態に応じた `削除`、`除外解除`、`重複解除` を表示する。
4. search result の program dialog は rule reserve（reserveItem に `ruleId` がある）では `ルール`、`検索` と、状態に応じた
   `除外`、`除外解除`、`重複解除` を表示する。
5. no reserve の `詳細` は `/reserves/manual?programId=<programId>`、manual reserve の `編集` は
   `/reserves/manual?reserveId=<reserveId>`、rule reserve の `ルール` は `/search?rule=<ruleId>` へ遷移する。
6. no reserve の `予約` 成功時は `<programName> 予約`、失敗時は `<programName> 予約失敗` を snackbar で通知する。
7. program dialog の `除外`、`除外解除`、`重複解除` は Guide ProgramDialog と同じ reserve API contract と snackbar
   contract に従う。
8. rule option form から rule を作成するとき、EPGStation フロントエンドは settings の rule default を参照する。
9. `/search?rule=<ruleId>` を表示するとき、EPGStation フロントエンドは rule edit mode を読み込み、query search
   values を search condition として扱わない。
10. normal EPG search の refresh に失敗したとき、EPGStation フロントエンドは `検索情報更新に失敗`
    を snackbar で通知する。継続して失敗し続け、一度も成功しない場合も含めて、Socket.IO `updateStatus`
    経由の再取得失敗は常に `検索情報更新に失敗` を出す。
    判定基準は「同じ query key に対する応答が過去にあったか」（成功・失敗を問わない）という
      試行ベースとする。search query の key は新規の検索・rule submit（新しい `activeRequest`）の
      ときだけ変わるため、同じ key に対する 2 回目以降の応答は Socket.IO 経由の再取得でしかあり得ない。
      fixture test（`client/unittest/spec/searchRule.scrollAndRuleFailures.spec.test.tsx` の
      `[AC 2.10] reports the fixed refresh-failure text, ...`）がこれを検証する。
      `client/src/features/search/rule/hooks/useSearchRuleFormState.ts` の
      `hasAttemptedSearchResultRef`、`client/src/features/search/rule/hooks/useSearchResultEffects.ts`
      の該当 effect、`useSearchRuleActions.ts` の `submitSearch` での reset がこれに当たる。
    - この effect は同じ settled `currentSearchResponse` に対して二重に snackbar を発行しない。
      `encodeModes`/`settings` など、この effect の dependency 配列には含まれるが検索結果の中身とは
      無関係な prop が参照だけ新しくなる再 render（要求 1.21 のガードが対象とする再 render と同種）が
      起きても、直前に通知済みの応答と同一であれば再通知しない。`useSearchResultEffects.ts` の
      `handledFailureResponseRef`（直前に通知した `currentSearchResponse` を記録する ref）がこれを担い、
      `hasAttemptedSearchResultRef`（初回/再取得の文言選択にだけ使う）とは独立しているため互いを
      阻害しない。fixture test（`searchRule.scrollAndRuleFailures.spec.test.tsx` の `[Fix #40]` 2 test）
      がこれを検証する。
11. time-specified rule edit の refresh に失敗したとき、EPGStation フロントエンドは `予約情報更新に失敗`
    を snackbar で通知する。継続して失敗し続け、一度も成功しない場合も含めて、Socket.IO
    `updateStatus` 経由の再取得失敗は常に `予約情報更新に失敗` を出す。
    判定基準は AC 2.10 と同じ「試行ベース」とし、`hasAttemptedRuleReservesRef` を使う。
      rule-reserves query の key は同一 rule 編集 session の間変化しないため、2 回目以降の応答は
      Socket.IO 経由の再取得でしかあり得ない。fixture test（同ファイルの
      `[AC 2.11] reports the fixed refresh-failure text, ...`）がこれを検証する。
12. new rule 保存では `POST /rules` を呼び、成功時は `ルール追加に成功`、失敗時は `ルール追加に失敗`
    を snackbar で通知し、成功後は既存 delay 後に前の route へ戻る。
13. rule edit 保存では `PUT /rules/:ruleId` を呼び、成功時は `ルール更新に成功`、失敗時は `ルール更新に失敗`
    を snackbar で通知し、成功後は既存 delay 後に前の route へ戻る。
14. validation failure では、EPGStation フロントエンドは field-level validation を追加せず generic snackbar-only
    behavior を維持する。
15. no reserve の `予約` は `POST /reserves` に `{ programId, allowEndLack: true }` と、TS 以外選択時の
    `encodeOption.mode1` / `isDeleteOriginalAfterEncode` を送る。
16. manual reserve の `削除` は `DELETE /reserves/:reserveId` を呼び、snackbar は `<programName> キャンセル` /
    `<programName> キャンセル失敗` を維持する。
17. time-specified rule edit 初期表示では `GET /reserves?type=all&ruleId=<ruleId>&isHalfWidth=<isHalfWidthDisplayed>`
    を取得して reserve cards を表示し、初期取得失敗は `予約情報取得に失敗` を snackbar で通知する。reserve が 1 件以上の
    場合だけ `予約数 <n> 件` を見出しに表示し、0 件（未取得中を含む）の場合は件数テキストを表示しない。
    `TimeSpecifiedReserveSection.tsx` は reserve が 1 件以上のときだけ `予約数 <n> 件` を表示し、
    0 件のときは件数テキストも一覧も表示しない。
18. Rule add/update body は `isTimeSpecification`、`searchOption`、`reserveOption`、`saveOption`、optional
    `encodeOption` の生成規則を維持する。
19. `encodeOption` は mode1/2/3 が全て null の場合 omit し、そうでなければ `isDeleteOriginalAfterEncode`
    と選択済み mode/directory を含める。
20. Rule option は normal
    search 完了後に 0 件結果を含めて表示でき、time-specified が ON の場合は検索実行前でも rule 作成 UI を表示できる。
21. rule default は
    `searchLength`、`rulesLength`、`isHalfWidthDisplayed`、`isEnableCopyKeywordToDirectory`、`isEnableEncodingSettingWhenCreateRule`、`isCheckAvoidDuplicate`、`isCheckDeleteOriginalAfterEncode`、`isEnableAutoScrollWhenEditingRule`
    を参照する。
22. `isEnableAutoScrollWhenEditingRule` は `/settings` の検索 section で保存された値を読み、`/search?rule=<ruleId>`
    の EPG rule edit 初期表示で、rule
    detail から復元した条件による初回検索結果へ自動 scroll するかどうかだけを制御する。設定が `false`
    の場合は初回検索が成功しても検索結果へ自動 scroll してはならない。time-specified rule edit、history
    restoration、query-driven `/search?keyword=...`、user
    submit、検索結果 header の「録画設定へ移動」はこの設定の対象外である（=これらは設定値に関わらず常に scroll する）。scroll target は form
    section ではなく検索結果 region であり、座標は  target top + pageYOffset - title bar
    height - offset で算出する。
    `useSearchRuleRouteEffects.ts` は `needsResultScrollRef.current` を rule-edit-preload
    分岐（設定値で gate）、user submit（`useSearchRuleActions.ts`、常に true）、'search' mode の
    `didRouteSearchChange` 分岐（`routeState.shouldAutoSearch` が true の場合）の 3 箇所で設定し、さらに初回 mount の初期値
    （`useSearchRuleFormState.ts`。復元した page info が無く、'search' mode で `routeState.shouldAutoSearch` が true のとき true）でも
    true にする。
    test: `searchRule.ruleEdit.spec.test.tsx` の `[AC 2.22] auto-scrolls a query-driven
    /search?keyword=`。
23. `/reserves`、`/recorded`、`/recorded/details`、program dialog、rule list など別 screen から
    `/search?rule=<ruleId>` を開く handoff は、遷移元で auto-scroll を抑止してはならない。
    `isEnableAutoScrollWhenEditingRule=true` の場合は初回検索結果へ自動 scroll し、`false` の場合だけ抑止する。
23a. Search route の top FAB は、drawer が閉じているときは
     viewport 左端から 12px、1264px 以上で permanent drawer が開いているときは drawer 右端から 12px の位置に表示し、
     drawer に重なって欠けてはならない。`left: calc(var(--app-main-offset, 0px) + 12px); right: auto;
     bottom: 16px;`（`client/src/features/search/rule/SearchRulePage.module.css` の `.scrollFab`）とする。
23b. Search route の top FAB を操作したとき、EPGStation フロントエンドは通常環境では `window`、iOS / iPadOS の
     fixed shell では active page scroll container である `shell-main` を `top=0` へ smooth scroll する。
24. `GET /reserves/lists` は search result の reserve/conflict/skip/overlap decoration と ProgramDialog action
    state のために取得する。search result item は reserve 状態に応じて `reserve`（予約済み）/`conflict`（重複）/`skip`
    （除外）/`overlap`（重複警告）のいずれかを視覚的に区別できる装飾を持つ。
    `frontend-guide` が持つ `GuideReserveIndex` / `ReserveVisualState`（`reserve`/`conflict`/`skip`/
    `overlap`）の型と `transformReserveListsToIndex`（内部で `assignReserveIndex`）を再利用し、search result item にも同じ 4 状態の装飾を
    付与する（`SearchResultSection.tsx` が `data-reserve-state` 属性として付ける）。
25. rule edit の refetch では visible rows に残る selected rule id を維持し、page/keyword route
    change では selection を clear する。
    出典: design.md データモデル節（「RuleListState」）は「refetch 時は visible rule ids との
    intersection で selectedRuleIds を preserve する」と定義する。
    `RuleListPage.tsx` は route change 時に `selectedIds` を空へ reset する。加えて、route を
    伴わない refetch（Socket.IO `updateStatus` 等）を含む refetch のたびに、現在の rule 一覧と
    `selectedIds` の積集合を取り、表示から消えた id だけを `selectedIds` から取り除く effect を持つ。
26. time-specified rule edit の reserve cards は `frontend-reserves` owned `ReserveListItem` を
    `needsDecoration=true`、`disableEdit=true` 相当で consume し、SearchRule 側は reserve card の edit/delete/unlock
    action を発火しない。
    `TimeSpecifiedReserveSection.tsx` は `isEditMode=true` を渡し、
    `ReserveListItem.tsx` は `isEditMode=true` の場合 menu 自体を描画しない（delete/unlock も
    含め一切の action を発火不能にする）。これは design.md の「ProgramDialog とルールアクション表」節が、
    time-specified rule edit 内では reserve card から action を発火しないと決めた設計判断である。
27. Rule option form の `有効`、`状況に応じて末尾がかけることを許可`、`録画済み番組を排除`、`元ファイルの自動削除`
    checkbox と、`日数`、`directory`、`sub directory`、`file format`、`mode1-3`、`directory1-3`、`sub directory1-3`
    fields は read-only 表示ではなく編集可能な controlled control とする。`directory` / `directory1-3` は server
    config の recorded directory を option に持つ select/combobox、`mode1-3` は server config の encode
    modes を option に持つ select/combobox とし、直接 text input に置き換えない。server config に encode
    mode がある場合、`isEnableEncodingSettingWhenCreateRule=false`
    でも encode1/2/3 の fields は表示時に編集可能な draft を持ち、mode 選択前に sub
    directory を入力しても値が消えてはならない。編集値は `POST /rules` / `PUT /rules/:ruleId` body の
    `reserveOption`、`saveOption`、`encodeOption` に反映する。ただし `mode1` / `mode2` / `mode3`
    が全て null の場合は `encodeOption` を request
    body から omit する。Search/Rule の checkbox は MUI `Checkbox` / `FormControlLabel` を使い、raw native
    checkbox を直接描画してはならない。keyword target、ignore keyword target、broadcast wave、weekday、genre
    sub-toggle、free flag、rule option checkbox は同一 `SearchCheckbox` owner を共有する。
28. Rule option の accordion/panel
    summary は pointer と keyboard で開閉でき、開閉時に非 0ms のアニメーションを持つ。表示 title が CSS 疑似要素であっても DOM 上の summary は操作可能な target として残す。
29. Search form の `サブジャンル表示` checkbox は read-only ではなく編集可能な controlled
    control とし、OFF のときは subGenre button 群を非表示にし、hidden subGenre 選択を search/rule payload に残さない。
    `SearchGenreRow.tsx` は OFF 切替時に選択済み subGenre を同じ genre の top-level
    選択へ正規化し、hidden な subGenre 選択を残さない（`searchRule.formComponents.spec.test.tsx`
    の `[AC 2.34]` の test が検証する）。
30. Search form の `期間` は `開始` / `終了` の日時 picker dialog として表示し、text
    field は直接ミリ秒入力ではなく dialog activator として扱う。各 dialog は月・曜日を日本語で表示し、
    週の始まりを月曜にした calendar（先頭の列が月曜）、24 時間表記の時刻の選択、`クリア` / `設定`
    action を持つ（Recorded Upload、Manual Reserve と共通の部品）。calendar で日を選び `設定` を押すと
    field に `yyyy-MM-ddTHH:mm` で反映し、`クリア` は値を空にする。両端が揃うまで `searchPeriods` を送らない。
31. Search form の `検索` button を実行して検索結果を取得したとき、EPGStation フロントエンドは
    SearchResult section の先頭へ scroll する。SearchResult header の link icon は検索条件ではなく Rule
    option card の先頭へ scroll する。
32. Search form の `クリア` / `検索` action row は action
    row の上に divider を持ち、card 末尾には追加 divider を描画しない。dark theme では divider を dark
    token に置き換える。
33. Search form の `放送局`、ジャンル一覧の絞り込み、`時刻 start`、`時刻 range` は
    select/combobox として表示し、直接数値入力 field に置き換えない。`放送局` は `/channels` の channel
    id/name を option として表示し、rule edit で現在の channel id が一覧にない場合も既存 rule の channel
    name を fallback option として保持する。ジャンル select は検索対象の単一 genre 値ではなく、下のジャンル一覧を
    `すべて` または top-level genre で絞り込むための control とする。`start` は 0-23 時、`range`
    は 1-23 時間の option として扱い、選択値を `times[0].start` / `times[0].range` に反映する。
34. Search form のジャンル一覧は 複数の top-level genre / subGenre をクリックで選択できる。top-level
    genre を選択した場合は `{ genre }` を search/rule payload に含め、subGenre を選択した場合は `{ genre, subGenre }`
    を含める。ジャンル一覧の `クリア`
    は選択済み top-level/subGenre だけを解除し、一覧の絞り込み select は維持する。`サブジャンル表示`
    を OFF にした場合は subGenre
    button 群を非表示にし、既存の subGenre 選択は同じ genre の top-level 選択へ正規化する。ジャンル一覧の hover は selected
    state と同じ青背景/青文字を表示してはならない。選択状態だけが blue
    tint を持ち、hover だけでは選択済みと誤認させない。
35. Search form / Search result / Rule option card は max-width `800px`
    と同じ幅契約を共有し、keyword 入力 card と結果/録画設定 card の最大横幅がずれてはならない。Search form の `長さ`
    にある `最小(分)` / `最大(分)` fields は 各 field の最大幅を 100px 程度に抑え、form
    row 全幅へ引き伸ばさない。Rule option form の `日数` は 90px 程度、`directory` / `directory1-3` / `mode1-3`
    select は 150px 程度を上限とし、`sub directory` / `file format` は available width を使える text field とする。
36. Search form の keyword text
    field で Enter を押した場合、EPGStation フロントエンドは現在 DOM/input に入力されている最新 keyword 値を使って検索を実行する。React
    state の遅延により直前入力が欠落した stale request を送ってはならない。Enter submit と `検索` button
    submit は同一の request body 正規化を使う。keyword が non-empty で番組名、概要、詳細の全 target
    checkbox が OFF の場合、Enter submit と `検索` button
    submit は番組名と概要を ON にした request を送る。target checkbox が一つ以上 ON の場合は user
    selection を変更しない。ignore keyword が non-empty で ignore の番組名、概要、詳細 target
    checkbox がすべて OFF の場合も、Enter submit と `検索` button
    submit は同じ正規化で ignore 番組名と ignore 概要を ON にした request を送る。ignore target
    checkbox が一つ以上 ON の場合は user selection を変更しない。
37. Search form、Rule option form、Rule search menu の text/number/datetime text field と clearable select
    相当の select/combobox は、値が non-empty かつ disabled/read-only でないとき field 右端に clear
    button を表示し、押下で該当 field の値だけを空にする。Search form では keyword、ignore keyword、duration min/max、period dialog の datetime field、channel、start time、range を対象にする。Rule option form では `日数`、`directory`、`sub directory`、`file format`、`mode1-3`、`directory1-3`、`sub directory1-3` を対象にする。`file format` は select ではなく clearable な text field として扱う。通常検索 UI の `range` select と時刻指定 UI の `終了` field は、いずれも確認対象として扱い、対象外として省略してはならない。
38. plain `/search` の `時刻指定` switch は  rule
    edit 中以外は操作可能であり、OFF では通常検索 card、ON では番組名/channel/開始/終了/曜日の time-specified rule
    card を表示する。ON のときは検索実行前でも Rule option form を表示し、通常検索結果 request を発火してはならない。
39. Search form の select 行と checkbox 行の間、Rule option card の field label の余白は既存の margin-top /
    padding-top を維持し、keyword target checkbox 行は 288px 幅でも折り返して 2 行になる content-sized レイアウトを維持する
    (3 分割の均等幅レイアウトへ変更しない)。
40. keyword、ignore keyword、channel の各 field は値が空のとき floating label を縮小前の等倍位置（placeholder と同じ高さ）に表示し、値が
    入力または選択された場合だけ label を縮小して上へ shift する。
41. rule edit mode と plain search mode の間で route が切り替わったとき、EPGStation フロントエンドは切替前の
    mode で表示していた検索結果を新しい mode の検索結果が表示される前に残さない。cache された rule detail や
    進行中の request があっても、切替前 mode の keyword による結果を新しい mode の結果として誤表示してはならない。

### 要求 3: Rule list と item actions

**目的:** ユーザーとして、録画 rule を検索、編集、有効化、削除したい。

#### 受け入れ条件

1. `/rule` を表示するとき、EPGStation フロントエンドは title `ルール` を表示し、rule list を取得する。
2. keyword query があるとき、EPGStation フロントエンドは keyword filter を rule list fetch に反映する。
3. rule list fetch に失敗したとき、EPGStation フロントエンドは `ルールデータ取得に失敗` を snackbar で通知する。
   page content 内に別の error 要素は描画しない。
4. title bar の検索 icon を実行したとき、EPGStation フロントエンドは `/search` へ遷移せず、Rule search menu を開く。
5. Rule search menu は keyword query の現在値を `キーワード` field に反映し、`閉じる` と `検索` action を表示する。
6. Rule search menu の `検索` action は menu を閉じて約 300ms 待ってから `/rule?keyword=<keyword>`
   へ遷移し、keyword が空の場合は `/rule` へ遷移する。
7. edit mode 外では rule enable switch を表示する。
8. rule enable action を実行したとき、EPGStation フロントエンドは `PUT /rules/:ruleId/enable` を呼び、成功時は
   `有効化: <keyword>` を snackbar で通知する。
9. rule disable action を実行したとき、EPGStation フロントエンドは `PUT /rules/:ruleId/disable` を呼び、成功時は
   `無効化: <keyword>` を snackbar で通知する。
10. rule enable/disable action は API result を待ち、失敗時は UI state を戻し、`ルールの有効化に失敗` /
    `ルールの無効化に失敗` を snackbar で通知する。
11. item menu の edit action を実行したとき、EPGStation フロントエンドは `/search?rule=<ruleId>` へ遷移する。
12. item menu の recorded search action を実行したとき、EPGStation フロントエンドは `/recorded?ruleId=<ruleId>`
    へ遷移する。
13. item menu の delete action を実行したとき、EPGStation フロントエンドは item menu を閉じてから
    約 300ms 待って single delete dialog を開く。
    MUI `Menu` の close transition は約 290ms かけて DOM から消える一方、同じ 0ms 遅延で開いた
    `Dialog` は `.MuiModal-root` として同じ z-index 1300 に mount されるため、close 中の menu 項目と
    open 直後の dialog backdrop が重なって見える visual glitch が実際に発生する（番組表のジャンル
    設定 dialog でも同じ MUI `Menu`/`Dialog` の組み合わせで同じ機構的原因により同じ glitch が起こる）。
    `RuleListPage.tsx` の `deleteRuleOpenTimer` と `openDeleteRuleAfterDelay()` は `delete` MenuItem
    クリック時に menu を閉じてから 300ms 後に `setDeleteRule` する。test:
    `unittest/spec/searchRule.ruleListMenus.spec.test.tsx` の
    `waits for the closing item menu animation before opening the delete confirmation dialog`
    （300ms 未満では dialog が開かず、300ms 経過後に開くことを確認する）。
14. single delete dialog は title `ルール削除`、body `<keyword> を削除しますか?`、`キャンセル`、`削除` を表示し、confirm で
    `DELETE /rules/:ruleId` を呼ぶ。
    `RuleDeleteDialogs.tsx` は `DialogTitle` に `ルール削除` を設定し、`aria-labelledby` で dialog の
    accessible name にする（`searchRule.ruleList.spec.test.tsx` の
    `findByRole('dialog', { name: 'ルール削除' })` で検証する）。bulk delete dialog（要求 3.28）と
    同じ title 構成である。
15. single delete 成功時は `<keyword> を削除`、失敗時は `<keyword> を削除に失敗` を snackbar で通知する。
16. edit mode では enable switch を表示せず、item click は selection toggle として扱う。
    `RuleListRow.tsx` は edit mode 中、switch の grid track 幅を保った空 `<span aria-hidden>` に
    置き換え、有効化/無効化操作と選択操作が同一行で競合しないようにする。
17. bulk delete dialog は `選択した <total> 件のルールを削除しますか。` を表示する。
18. 0 件選択で一括削除を実行したとき、EPGStation フロントエンドは bulk delete dialog を開かず、`ルールを選択してください。`
    を snackbar で通知する。
19. bulk delete 成功時は `選択したルールを削除しました。`、一部または全件失敗時は `一部ルールの削除に失敗しました。`
    を snackbar で通知する。
20. rule delete action 成功後、EPGStation フロントエンドは non-optimistic refetch-driven list update を行う。
21. rule list が 0 件のとき、EPGStation フロントエンドは explicit empty message を追加しない。
22. `/rule` fetch は
    `offset=(page-1)*rulesLength`、`limit=rulesLength`、`type=normal`、`isHalfWidth=<isHalfWidthDisplayed>`、optional
    `keyword` を `GET /rules` に渡す。`isHalfWidth` query 送信は維持する。
23. `isHalfWidthDisplayed` は `GET /rules` query の `isHalfWidth` に使い、取得後の channel name 表示変換にも使う。
    `isHalfWidthDisplayed=false` の場合は、channel の半角名 (`halfWidthName`) ではなく全角名 (`name`)
    を表示に使う。この変換は rule list に限らず、同じ channel index を共有する search result・rule
    detail・rule edit の time-specified reserve cards にも一貫して適用する。
    `client/src/features/search/rule/api/channelNames.ts` の `adaptChannelIndex()` は
    `isHalfWidth: boolean` 引数を取り、`client/src/features/search/rule/api/repository.ts`
    の channel index cache は「生の `/channels` 応答をキャッシュし、呼び出しごとに
    `isHalfWidth` を適用して Map を組み立てる」方式とする。`fetchRules`/`fetchRuleReserves` は
    request の `isHalfWidth`、`searchSchedules` は body の `isHalfWidth`、`fetchRule`/`fetchSearchChannels`
    は呼び出し元 hook（`useSearchRuleQueries.ts`）が持つ `settings.isHalfWidthDisplayed` をそれぞれ渡す。
24. delete 成功後は row を optimistic に削除せず、表示更新は Socket.IO `updateStatus` による refetch、route
    change、または別 fetch によって反映する。
25. edit mode は Reserves / Recorded / Recording と同じ shared `EditTitleBar` contract を使い、`<selectedCount> 件選択`
    title、close icon による exit、select-all icon、delete icon を表示する。独自の text button row を title
    bar に並べてはならない。exit で選択解除、select-all の visible rows toggle、refetch 後も visible な rule
    id の selection preservation を維持する。選択済み rule row/card は outline-only ではなく Recorded /
    Recording と同じ filled blue selection として item 全体に適用する。
26. Rule list layout は container width 780px 境界で card/table を切り替え、keyword fallback `-`、channel/genre first +
    `他<n>`、`reservesCnt` fallback 0 を維持する。table layout の outer list は table layout
    と同じく利用可能な content width に対して `width: 100%` で伸縮し、任意の固定 `max-width`
    で 1160px などに頭打ちしてはならない。ただし `/search` と `/rule` が共有する page wrapper の上限
    `1600px` は除き、それより狭い viewport では一覧は content 幅に追従する。
    `RuleListPage` が自身の描画する `<section className={styles.page}>` に `ref` を張り、
    `useMeasuredContainerWidth`（`client/src/shared/useMeasuredContainerWidth.ts`、`ResizeObserver` で
    実際の `clientWidth` を測定する。navigation drawer の開閉による content 幅の変化はこの実測値に
    自動的に反映されるため、定常状態の判定を window/viewport 幅による近似で置き換えない。
    `ResizeObserver` の初回測定は mount より 1 frame 程度遅れて届くため、それまでの初期値には
    viewport 幅を使い、固定の desktop 幅を仮定しない。狭い container で table を選ぶと、list へ
    置き換わるまでの間だけ section の高さが増え、既に復元した scroll 位置がブラウザの
    scroll anchoring でずれる。`ReservesPage` と `RecordedPage` も同じ理由で viewport 幅を
    初期値に使う。table/list 切り替えは
    `resolveRuleLayout`（`client/src/features/search/rule/lib/ruleLayout.ts`）が実測 container 幅
    (`>= 780px` で table、それ未満で list) から判定し、`.page` 要素へ `data-rule-layout` 属性として
    反映する。CSS はこの属性を `.page[data-rule-layout='list'] .ruleHeader` のように参照する属性
    セレクタで参照する（`755px` の media query 自体は `.searchCard`/`.searchRow`/`.rulePanel` など
    rule list と無関係な検索フォームの responsive 宣言のために存在し、rule list layout の切替には
    使わない）。

    `containerWidth` prop は test 用に実測を bypass する override であり、production では渡さない。
    優先順位は `containerWidth` ?? 実測値 ?? `viewportWidth` prop の順とする。production は実 viewport 幅を `viewportWidth` に渡し、既定値 `1440` は test 用である。

    `.page` は `box-sizing: border-box` かつ `padding: 12px` であり、`ref` を張った `.page` 自身の
    `clientWidth` はこの padding を含む。閾値は `780px`（`RULE_TABLE_LAYOUT_MIN_WIDTH`）とし、
    drawer が開いて container が狭くなってもこの閾値は幅によらず保たれる。この閾値は
    `client/e2e/search-rule-responsive-theme.spec.ts` の "keeps Search result cards and Rule list
    width responsive" test が固定する。
27. Rule list card/table は long keyword、複数 channel/genre、edit mode selection、action menu が同時に存在しても text
    overlap と horizontal overflow を発生させない。
    `SearchRulePage.module.css` の `.ruleItemMain > span` は
    `overflow:hidden`、`overflow-wrap:anywhere`、`text-overflow:ellipsis`、`white-space:nowrap` を持ち、
    list layout（`data-rule-layout='list'`、container 幅 780px 未満）では keyword 列（`:nth-child(1)`）だけ `white-space:normal`、`word-break:break-all` に切り替え、
    `.ruleActions{flex-wrap:nowrap}` で action menu の折り返しを防ぐ。
28. Rule list の一括削除確認は title bar 下の inline content ではなく modal dialog として表示し、title
    `ルール削除`、body `選択した <total> 件のルールを削除しますか。`、`キャンセル`、`削除` text action を持つ。dialog
    paper は  max-width 300px を上限とする。
29. Rule row/card は pointer hover と focus-within で背景色が変化し、light/dark
    theme のどちらでも隣接 row と区別できる。hover state は transparent のままにしない。
30. Rule enable
    switch は checked/unchecked の track と thumb 位置を即時に UI へ反映し、300ms 程度の transition を持つ。enable/disable
    API 成功後は refetch 待ちだけに依存せず、現在行の accessible action label と visual checked state を更新する。
31. `/rule` の右下追加 FAB は pink surface + white plus icon を正とし、light/dark theme のどちらでも plus icon が黒色や背景同化色になってはならない。
32. Rule list の keyword、予約数、overflow menu アイコンなど list item 内の text 表示要素は、iOS シミュレータの
    Safari が button 要素へ適用する UA default font に上書きされてはならず、意図した font-family（overflow menu
    アイコンではアイコンフォント）を維持する。overflow menu アイコンは raw な `⋮` 文字ではなくアイコンフォントの
    疑似要素で表示する。
33. Rule の有効/無効は enable switch（`.ruleSwitchButton`）でだけ切り替わる。switch の click/tap 領域は keyword 列を含む
    他のどの列の text/area とも重ならず、keyword text や row の他の content を click/tap しても有効/無効状態は変化しない。
34. list layout（`data-rule-layout='list'`、container 幅 780px 未満）の行選択領域（`.ruleItemMain`）は、switch 列と
    action menu 列を除いた行全体を占める実ボックスであり、keyword text の右側の余白を含む行のどこを click/tap しても
    edit mode の選択状態を切り替える。この領域は switch 列・action menu 列のどちらの text/area とも重ならない。
35. Rule list の pagination は、共有 component `AppPagination`（`frontend-app-shell` 要求 8.49）が `isEnableExtendedPagination` に従って選ぶ。`true` のときは `frontend-app-shell` 要求 8.33-8.47 の拡張 pagination を、`false`（default）のときは従来の `LegacyPagination` を、見た目も動作も変えずに表示する。page の移動は拡張・従来のどちらでも同じ `?page=` query の更新で行い、page size は `rulesLength` のままとする。この設定は録画済み・録画中・予約の各画面の pagination も同時に切り替える（それぞれの spec が定める）。

### 要求 4: dark theme coverage

**目的:** dark theme で Search と Rule の可読性を保つ。

#### 受け入れ条件

1. Search と Rule の main content、filter/menu surface、list card/table、dialog、pagination は dark
   theme で background、text、icon、divider、input border の contrast を維持する。
   `SearchRulePage.module.css` は `searchCard`、`ruleList`、
   `ruleOptionCard`、checkbox、`ruleSearchMenu` など多数の箇所で明示的な
   `:global([data-theme-mode='dark'])` token 上書きを持つ。dialog
   （`RuleDeleteDialogs.tsx`）は独自の色指定を持たず MUI `Dialog` の既定に委ね、pagination は
   `frontend-*` 共通の `AppPagination`、`LegacyPagination`、拡張 pagination（`frontend-app-shell` 要求 8.33-8.49。いずれも本 spec の対象外）に委ねる。dark の検査は
   `unittest/spec/searchRule.layout.spec.test.tsx`・`searchRule.ruleList.spec.test.tsx` と
   `e2e/search-rule-responsive-theme.spec.ts`・`dark-ui-cards.spec.ts`・`dark-ui-controls.spec.ts` が持ち、dialog と pagination の
   dark contrast は MUI の既定 palette と共有 component の契約に委ねる。
2. dark theme で rule/search action menu の icon と label は背景と同化せず、hover/focus/selected
   state でも可読性を維持する。
   `client/src/features/search/rule/components/RuleItemMenu.tsx`（MUI `MenuItem`）と
   `RuleSearchMenu.tsx` はどちらも text/icon の color を明示せず、MUI の `Menu`/`MenuItem` 既定の
   palette 依存 color に委ねている。`.ruleMenuIcon`（`SearchRulePage.module.css`）も
   color 未指定で親要素の `currentColor` を継承する。`client/src/app/theme.ts` は
   `createShellTheme(mode)` で MUI `palette.mode` を `'dark'` に設定しており、MUI の `MenuItem` は
   `palette.text.primary` / `action.hover` 等 mode 依存の値を自動適用する。
3. `/rule` の card breakpoint では、rule keyword だけでなく予約数表示と mobile menu affordance の疑似要素も dark theme
   token または `currentColor` 派生色を使い、黒系固定色を残してはならない。overflow menu の表示用疑似要素は、親 icon
   text を transparent にする場合でも transparent な `currentColor` を継承してはならず、light/dark それぞれの text
   token を明示して可視状態を保つ。
   `.ruleItemMain > span:nth-child(5)`（`SearchRulePage.module.css`）は
   `color: color-mix(in srgb, currentColor 54%, transparent)` を使い、`.ruleActionIcon`/`::before` は color を明示せず、かつ祖先要素にも `color: transparent` を設定する箇所が無いため、
   本 AC が禁止する「transparent 継承」状態は現在のコードには発生しない。
4. `/rule` の追加 FAB は dark theme でも 白い plus icon を維持する。
   `SearchRulePage.module.css` は `.ruleFab:global(.MuiFab-root){color:#fff}` を
   light 用に定義し、`:global([data-theme-mode='dark']) .ruleFab:global(.MuiFab-root){color:#fff}`
   で dark theme 時も同じ白色を明示的に維持する。
