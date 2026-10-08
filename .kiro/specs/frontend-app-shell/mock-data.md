# Mock Data Contract: アプリケーションシェルとナビゲーション

## 目的

App Shell visual cases は、server configuration、settings、route title、socket event を synthetic data で固定する。実運用の URL、ロゴ、番組名、認証情報、環境固有 path は使わない。

## Dataset

### `serverConfigFull`

- navigation 生成に必要な feature flag をすべて enabled とする。
- broadcast wave は `GR`、`BS`、`CS`、`SKY` を enabled とする（`BS4K` も 5 つ目の broadcast wave として存在するが、既存 visual case の snapshot を変えないため、この fixture では含めない）。
- version 表示用には `version: "synthetic-version"` のような架空値を使う。
- URL scheme、Mirakurun URL、ffmpeg / ffprobe path は含めない。必要な場合は `<url-scheme-placeholder>` のような placeholder にする。

### `serverConfigMinimal`

- 条件付きで生成される navigation item は On Air（`liveStreamEnabled`）と Guide の item（enabled broadcast wave と `isEnableDisplayForEachBroadcastWave`）だけである。Storages を含むその他の item は server configuration に依らず常に表示する。
- この dataset は On Air を有効にし、enabled な broadcast wave を持つ。`settingsHideWaveGuide` と組み合わせて、broadcast-wave individual guide を出さず generic な「番組表」1 件だけを表示する最小構成にする。

### `settingsDefault`

- `frontend-settings-storage` の default settings object を使う。
- platform-dependent default は visual case の viewport と user agent 条件で明示する。

### `settingsGuideNavigation`

- `isEnableDisplayForEachBroadcastWave=true` とし、broadcast-wave Guide item の表示を確認できる状態にする。

### `settingsHideWaveGuide`

- `isEnableDisplayForEachBroadcastWave=false` とし、generic Guide item だけを表示する。

### `settingsDarkTheme`

- `shouldUseOSColorTheme=false`、`isForceDarkTheme=true` とし、dark theme を deterministic にする。

### `socketReconnect`

- connection lost と reconnect の UI feedback、application state update event を synthetic event として発火できる。
- host 名、IP address、実 endpoint は payload に含めない。

## Fixture Fields

全 dataset は layout generator が追加の推測をしないよう、次の field を持つ。

- `routeTitle` / `screenTitle`: TitleBar に表示する synthetic title。Dashboard 以外の routed screen placeholder でも必須とする。
- `initialDrawerState`: `none`、`userOpen`、`userClosed` のいずれか。
- `viewportCategory`: `desktop`、`tablet`、`mobile` のいずれか。
- `breakpointWidth`: drawer default open/closed 境界の assertion 用に `1263` または `1264` を明示する。
- `selectedRouteQuery`: `reserves.type`、`guide.type`、extra query、`timestamp` を synthetic query として固定する。
- `snackbarRequests`: `{ text, color, timeout, order }[]`。複数 request は queue ではなく newest visible + previous dismissed history として表現する。
- `connectionState`: `connected`、`disconnected`、`reconnected` のいずれか。
- `previousFullPath`: reconnect 後の route 維持確認用 synthetic path。
- `enabledBroadcastWaves`: `GR`、`BS`、`CS`、`SKY`、`BS4K` のうち enabled な wave 配列。既存 visual case の fixture では `BS4K` を含めない。
- `liveStreamEnabled`: navigation item `放映中` の表示可否。
- `versionBefore` / `versionAfter`: navigation drawer header の version 表示を refresh する case 用の synthetic version string。

## Visual Token Contract

- App Shell は feature visual cases が参照する shell owner として、drawer width 256px、desktop default open breakpoint 1264px、mobile/tablet overlay drawer を正とする。
- TitleBar、drawer、snackbar の exact UI-library pixel token は MUI で決めるが、visual regression fixture では `titleBarHeightClass: stable`、`drawerWidth: 256`、`snackbarPlacement: bottom`、`snackbarBehavior: newest-visible` を固定値として扱う。
- light/dark の exact color token は design.md の色の表の論理名と値で固定し、fixture では `themeVariant: light | dark` と contrast assertion を持つ。実 screenshot 由来の色値は fixture に含めない。

## 禁止事項

- 実 URL、実 host、実ロゴ、実番組名、実サムネイル、認証情報を含めない。
- runtime の current UI URL や machine 固有 path を fixture に固定しない。
- App Shell visual case 用 placeholder screen に、各 feature の実 screenshot や実データを埋め込まない。
