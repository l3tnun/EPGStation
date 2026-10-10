# Implementation Plan

- [x] 1. Guide route/query parser と schedule fetch lifecycle を実装する
  - `/guide` と `/guide/setting` の hash route/query を React Router で受け、settings と query から normal/single-channel fetch option を作る。
  - `type`、`time`、`channelId`、free filter、half-width display、Guide length を validated model に変換し、invalid query は design の controlled behavior に従う。
  - initial route、route/query change、Socket.IO `updateStatus` は TanStack Query invalidation/refetch と scroll restoration done signal に接続する。
  - history restore では schedule data と reserve index の取得、program grid DOM、channel header、time scale の準備が完了した後、user-visible content を表示完了扱いにする前に保存済み x/y scroll position を復元する。
  - _Depends: frontend-app-shell 5, frontend-settings-storage 2_
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 6.1, 6.2, 6.3_

- [x] 2. GuideGridRenderer と visual state を実装する
  - 大量 program cell DOM は GuideGridRenderer が React tree 外で所有し、HTMLElement、DOM index、scroll restoration 内部参照を React state に保存しない。
  - program cell の left/top/height、time scale、channel header、scroll sync、reserve/conflict/skip/overlap/genre/free visibility class を deterministic に描画する。
  - history restore では program grid の `scrollLeft` / `scrollTop`、channel header `scrollLeft`、time scale `scrollTop` を同期復元してから visibility update と表示完了扱いへ進む。
  - full guide の schedule 表示 channel は audio/video service を対象とし、reserve index window と imperative DOM renderer ownership を requirements に合わせる。
  - desktop/mobile と Android Chrome で grid scroll、lazy unmount/remount、layout stability が visual contract と一致する。
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 2.15, 2.16, 2.17, 2.18, 2.19, 2.20, 2.21, 2.22_

- [x] 3. Guide menu、表示設定、route update actions を実装する
  - date/time/channel/broadcast-wave/free filter/genre visibility/Guide size/menu actions を requirements の route/query/storage contract に接続する。
  - settings と adjacent storage key は Settings Storage の consumer として読み、GuideSizeSetting、GuideGenreSetting、GuideProgramDetailSetting の owner boundary を維持する。
  - action 後の route update、refetch、snackbar、scroll behavior が requirements で定義された挙動と intentional fix を区別して観測できる。
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17, 3.18, 3.19, 3.20, 3.21, 3.22, 3.23, 3.24, 3.25, 3.26, 3.27, 3.28, 3.29, 3.30, 3.31, 3.32, 3.33, 3.34, 3.35, 3.36_

- [x] 4. ProgramDialog と予約・除外・重複 action を実装する
  - ProgramDialog は Guide owned shared component として metadata、description、extended linkify、menu/action matrix、close animation 後 remove/remount を提供する。
  - reserve/add/delete/skip/unskip/overlap/unoverlap/search/rule は API request、snackbar、refetch-driven update の契約に従う。
  - `http://` / `https://` のみ anchor 化し、`target="_blank"` と `rel="noopener noreferrer"` を付与し、それ以外の scheme は plain text のまま扱う。
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 4.14, 4.15, 4.16, 4.17, 4.18, 4.19, 4.20, 4.21, 4.22, 4.23, 4.24, 4.24a, 4.24b, 4.25, 4.26, 4.27_

- [x] 5. live stream handoff を On Air owner contract に接続する
  - Guide から live stream dialog を開く場合、On Air shared stream dialog/storage contract の consumer として扱い、Guide は player lifecycle を所有しない。
  - stream option、saved selection、URL scheme use、watch route handoff は requirements の boundary に従って route/API/snackbar を発生させる。
  - handoff 後に Guide grid state が壊れず、dialog close cleanup と focus restoration が観測できる。
  - _Depends: frontend-onair 3_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 6. Guide の unit/E2E/visual regression を整備する
  - `unittest/spec` と `unittest/imp` で query builder、fetch option、grid geometry、storage key、ProgramDialog action、linkify security、Socket.IO refetch を検証する。
  - Playwright visual は program cell geometry、scroll sync、history restore の pre-visible scroll application、responsive breakpoint、reserve/conflict/skip/overlap class、loading/error/empty を synthetic data で確認する。
  - tracked artifact に実 screenshot、実番組名、実 URL、実ロゴ、実サムネイル、認証情報、環境固有値を含めない。
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 2.14, 2.15, 2.16, 2.17, 2.18, 2.19, 2.20, 2.21, 2.22, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17, 3.18, 3.19, 3.20, 3.21, 3.22, 3.23, 3.24, 3.25, 3.26, 3.27, 3.28, 3.29, 3.30, 3.31, 3.32, 3.33, 3.34, 3.35, 3.36, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13, 4.14, 4.15, 4.16, 4.17, 4.18, 4.19, 4.20, 4.21, 4.22, 4.23, 4.24, 4.24a, 4.24b, 4.25, 4.26, 4.27, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 7.1, 7.2, 7.3_
- [x] 7. Guide dark palette を channel/time/program cell token として確認し、ProgramDialog footer select/checkbox と mobile short dialog blank-area regression を検証する。
- [x] 8. ProgramDialog encode selector は shared `AppSelect` の既定 4.5 item cap をそのまま流用せず、通常の encode option 件数では listbox / Paper 内部スクロールを発生させない専用 visible item 上限、option item 高さ、Paper/listbox overflow override と E2E regression guard を持つ。
