# 画面共通シェル・ナビゲーション機能

## 問題

EPGStation の利用者は、番組表、予約、録画済みなどすべての画面を同じ shell（navigation drawer、title bar、snackbar、theme）の中で操作する。shell の navigation が server 設定（放送波、live 配信の有無）と一致しない、選択中 item が現在 route と食い違う、切断時に何も表示されない、といった不具合は全画面に同時に波及し、利用者はどの画面にいても操作を誤る。運用者は version 更新や server 切断を shell からしか知ることができない。

## 現状

- entry `client/src/App.tsx` は `client/src/app/AppRoot.tsx` を描画するだけで、provider の配線、route table（`client/src/app/routes/`）、config / version の取得（`app/hooks/useServerConfigState.ts`）、snackbar host（`app/components/ShellSnackbarHost.tsx`、`app/hooks/useShellSnackbar.ts`）、Socket.IO 接続（`app/hooks/useRealtimeConnection.ts`）、scroll 復元（`app/hooks/useRouteScrollRestoration.ts`、`app/scroll/`）は `client/src/app/` に集約されている。
- shell layout は `client/src/app/AppShell.tsx` と `app/components/DrawerHost.tsx`、navigation は `client/src/app/navigation/`、title bar は `client/src/app/titleBar/`、theme は `client/src/app/theme.ts`、Socket.IO による query 無効化は `client/src/app/realtime.ts` / `realtimeInvalidation.ts` が担う。
- server API は `client/src/app/serverApi.ts`（`app/api/` の barrel）の fetch wrapper（`GET /config`、`GET /version`、`GET /channels`）を通す。
- test は `client/unittest/spec/appShell.*.spec.test.tsx` / `navigation.*.spec.test.tsx` / `titleBar.spec.test.tsx`、`unittest/imp/appShell.*.imp.test.ts` ほか、e2e `client/e2e/app-shell-*-workflow.spec.ts` / `realtime-refresh-*.spec.ts` / `dark-ui-*.spec.ts`、visual `client/visual/app-geometry.spec.ts`。

## 期待する結果

- navigation item が `GET /config` の内容（放送波、live 配信）と保存済み settings から決定的に生成され、現在 route に対応する item だけが選択状態になる。
- drawer が desktop では常設、mobile では overlay として振る舞い、item click で route 移動と drawer close が期待どおりに起きる。
- version 表示、切断 overlay と再接続 snackbar、theme 反映が全画面で同じ挙動になる。
- 各 routed screen は TitleBar / EditTitleBar の共通部品契約に従い、title と edit mode の切替を screen 側で描画できる。

## 方針

shell と navigation の user-visible behavior を本 spec の要求として固定し、settings の key / default / 補完は `frontend-settings-storage` を上流として参照する。screen 固有の title 文言、edit mode 遷移条件、snackbar 文言、API 詳細は各 screen spec が持つ。

## スコープ

- **In**: 共通 shell、main content 領域、TitleBar / EditTitleBar の部品契約、navigation item 生成、selected item 判定、drawer responsive と click 挙動、theme 反映、version 更新、切断 / 再接続の表示、Socket.IO 更新通知による query 無効化の host。
- **Out**: 各 routed screen の list / dialog / form / player 挙動、settings の default と補完、server 側 routing。

## 境界候補

- shell と routed screen の境目: TitleBar / EditTitleBar の描画責務は screen 側、部品契約は本 spec。
- shell と `frontend-settings-storage` の境目: navigation に影響する設定（番組表の表示対象など）の意味は storage spec、読んだ結果の描画は本 spec。
- shell と `frontend-video-playback` の境目: watch route での shell 表示切替は本 spec、player 本体は playback spec。

## 境界外

- Dashboard 以降の各 screen（`frontend-dashboard`、`frontend-guide`、`frontend-onair`、`frontend-recorded`、`frontend-recording-encode`、`frontend-reserves`、`frontend-search-rule`、`frontend-storages-upload`、`frontend-video-playback`）の本体。
- `/settings` 画面の layout（`frontend-settings-screen`）。
- server 側の config / version API の契約（`server-service-interface`、`server-configuration`）。

## 上流・下流

- **上流**: `frontend-settings-storage`（保存済み settings と隣接 storage key）、server の `GET /config` / `GET /version` と Socket.IO event（`server-service-interface`、`server-event-and-hook-delivery`）。
- **下流**: すべての frontend screen spec が shell の main content、title bar 部品、snackbar host、navigation host を利用する。

## 既存 spec との接点

- **拡張**: なし。
- **隣接**: `frontend-settings-screen`（保存後の navigation 再生成を要求する側）、`frontend-video-playback`（watch route の shell 表示）、`frontend-guide`（navigation の番組表 item と Guide 表示設定の共有）。

## 制約

- hash route（`#/...`）互換を維持する。
- API の base path（`./api`）は fetch wrapper が一度だけ付与し、endpoint 側で重ねない。
- 実 URL、認証情報、環境固有値を tracked file に書かない。
