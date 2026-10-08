# Implementation Plan

- [x] 1. On Air route、tab/list state、fetch lifecycle を実装する
  - `/onair` route は settings の `isOnAirTabListView`、`isHalfWidthDisplayed`、route/query から tab/list 表示と fetch option を決定する。
  - initial route、route/query change、timer、Socket.IO `updateStatus`、0 件 retry、reserve index fetch を TanStack Query invalidation/refetch に接続する。
  - fetch failure では timer を再生成せず、0 件 retry は fetch 成功かつ schedule 0 件の場合だけ予約する。
  - title、loading/error/empty、tab ordering、progress timer が user-visible contract と一致する。
  - _Depends: frontend-app-shell 5, frontend-settings-storage 2_
  - _Requirements: 1.1-1.15_

- [x] 2. On Air card、ProgramDialog consumer、reserve action を実装する
  - On Air card は progress、channel/program metadata、reserve state、list/tab responsive contract を表示する。
  - ProgramDialog は Guide owned shared component の consumer として扱い、On Air は duplicate dialog implementation を持たない。
  - channel logo がない場合も channel name fallback で header row height を維持し、logo 有無で layout を大きく変化させない。
  - reserve/search/detail action は Guide owned ProgramDialog の snackbar/refetch/route handoff に接続し、dialog close cleanup が観測できる。
  - _Depends: frontend-guide 4_
  - _Requirements: 2.1-2.10_

- [x] 3. live stream dialog と watch handoff を実装する
  - stream option fetch、saved `OnAirSelectStreamSetting` restore/save、URL scheme toggle、M2TS/M2TS-LL/WebM/MP4 choice を React Hook Form + Zod 境界で扱う。
  - live watch info card fetch、failure snackbar、M2TS no-watch route boundary、external URL scheme handoff、`/onair/watch` route handoff を実装する。
  - unsupported M2TS-LL preflight、stream saved setting、dialog close cleanup、watch route query が deterministic test で観測できる。
  - _Requirements: 3.1-3.25_

- [x] 4. On Air の unit/E2E/visual regression を整備する
  - `unittest/spec` と `unittest/imp` で fetch trigger、timer、0 件 retry、reserve index、tab ordering、stream selection、watch handoff を検証する。
  - Playwright + MSW で card layout、progress、dialog、error/empty、desktop/mobile、Android Chrome/iOS Safari handoff constraints を確認する。
  - fixture に実 channel、実番組名、実配信 URL、実ロゴ、実サムネイル、認証情報を含めない。
  - _Requirements: 1.1-1.15, 2.1-2.10, 3.1-3.25, 4.1-4.4_
- [x] 5. On Air live stream select の width/theme/menu cap、HLS playback handoff、watch info card dark coverage、Android mobile playback controls contract を検証する。
  - _Requirements: 4.1-4.4_
