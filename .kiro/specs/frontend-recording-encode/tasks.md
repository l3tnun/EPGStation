# Implementation Plan

- [x] 1. Recording list route、fetch、menu、edit mode を実装する
  - `/recording` route は settings と query から page/limit/offset/half-width を作り、initial route、route/query change、Socket.IO `updateStatus` で fetch する。
  - recording item click、normal item click、edit mode、select-all、exit、single/bulk delete、Recorded owned dialog/menu consumer state を実装する。
  - Recording title bar edit entrypoint は direct icon button とし、desktop/mobile で item title、progress/metadata、menu、selection control が重ならない。
  - delete success は requirements の refetch/no-refetch boundary と snackbar 文言に従い、Encode queue page では `POST /encode` を発火しない。
  - _Depends: frontend-recorded 2, frontend-app-shell 5_
  - _Requirements: 1.1-1.34_

- [x] 2. Encode running/waiting list と cancel workflow を実装する
  - `/encode` route は running/waiting list、loading/error/empty、Socket.IO `updateStatus` / `updateEncode` refetch を扱う。
  - single/bulk cancel、edit mode、select-all、exit、cancel dialog open/close cleanup を requirements の snackbar/API contract に接続する。
  - cancel dialog は close animation 後に remove/remount し、progress 更新や edit mode selection で item height が不安定に変化しない。
  - waiting/running item の display、progress、button visibility、empty state が visual contract と一致する。
  - _Requirements: 2.1-2.30_

- [x] 3. Recording / Encode の unit/E2E/visual regression を整備する
  - `unittest/spec` と `unittest/imp` で fetch query、Socket.IO refetch、edit mode selection preservation、delete/cancel API body、dialog cleanup、snackbar を検証する。
  - Playwright + MSW で recording list、encode running/waiting、cancel/delete target、bulk edit、desktop/mobile visual state を確認する。
  - fixture に実番組名、実録画 file path、実サムネイル、ffmpeg / ffprobe 実 path、encoder command、認証情報を含めない。
  - _Requirements: 1.1-1.34, 2.1-2.30, 3.1-3.5_
- [x] 4. Encode bulk cancel dialog の max-width/action density と short body no-scroll contract、dark token 継承を検証する。
  - _Requirements: 2.24, 2.28, 3.3_
