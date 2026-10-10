# Implementation Plan

- [x] 1. Storages route、fetch、usage rendering を実装する
  - `/storages` route は title `ストレージ` を表示し、initial route、route change、Socket.IO `updateStatus` で query/body なしの `GET /storages` を取得する。
  - route fetch 前に visible list を clear し、route fetch failure は `ストレージ情報取得に失敗` snackbar、Socket.IO refetch failure は no-snackbar にする。
  - size formatting、use rate floor、total=0 guard、desktop/mobile stable layout が observable に確認できる。
  - _Depends: frontend-app-shell 5_
  - _Requirements: 1.1-1.11_

- [x] 2. Recorded Upload route と form state を実装する
  - `/recorded/upload` route は title `アップロード`、route init reset、video item counter reset、exactly one empty video-file block を作る。
  - channel selector、rule autocomplete、datetime picker、add-only video block、FAB、reset action、required fields を React Hook Form + Zod 境界で扱う。
  - reset は route init と同じ form state を再作成し、datetime picker を remount するが、rule autocomplete fetch を再実行しない。
  - _Depends: frontend-settings-storage 2, frontend-app-shell 5_
  - _Requirements: 2.1-2.27_

- [x] 3. upload sequence、progress dialog、rollback を実装する
  - upload 開始時は persistent `アップロード中` progress dialog を表示し、recorded metadata 作成後に validated video blocks を順に upload する。
  - metadata failure は rollback なし、video upload failure は作成済み recorded data の rollback を試み、rollback failure は元の失敗として扱う。
  - success は `/recorded/upload` に留まり form values を維持して `アップロード完了` snackbar、failure は `アップロードに失敗` snackbar、progress dialog close/remount delay を維持する。
  - _Requirements: 3.1-3.15_

- [x] 4. Storages / Upload の unit/E2E/visual regression を整備する
  - `unittest/spec` と `unittest/imp` で storage fetch no-query、formatting、total=0 guard、autocomplete query、validation、multipart body、rollback sequence を検証する。
  - Playwright + MSW で storage usage view、upload form、progress dialog、rollback/error state、desktop/mobile geometry を synthetic data で確認する。
  - fixture に実 storage path、実 file path、実 upload file、実 URL、認証情報、ffmpeg / ffprobe path を含めない。
  - _Requirements: 1.1-1.11, 2.1-2.27, 3.1-3.15, 4.1-4.6_
- [x] 5. Recorded upload select の MUI theme/dark token、4.5 item menu cap、channel/genre/subgenre clear action、file type/directory hidden placeholder を検証する。
  - _Requirements: 2.1-2.27, 4.1-4.6_
