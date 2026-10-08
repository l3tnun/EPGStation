# Implementation Plan

- [x] 1. Reserves list route、query、fetch lifecycle を実装する
  - `/reserves` route は `type`、page、settings page size、half-width から fetch option を作る。
  - initial route、route/query change、pagination、Socket.IO `updateStatus` は TanStack Query invalidation/refetch に接続し、route-driven fetch では list hidden/clear を行う。
  - fetch failure snackbar、loading/error/empty、scroll restoration done signal、Socket.IO no-hidden refetch が観測できる。
  - _Depends: frontend-app-shell 5, frontend-settings-storage 2_
  - _Requirements: 1.1-1.13_

- [x] 2. reserve state variants、shared list item、menu actions を実装する
  - normal/conflict/skip/overlap state、state class priority、ReserveDialog、ReserveMenu、ReserveListItem export surface を実装する。
  - recorded search、edit、delete、unlock、time click Guide route、shared dialog linkify を requirements の route/API/snackbar contract に接続する。
  - edit mode は selected count title、exit selection clear、visible rows select-all、refetch 後の visible item selection preservation を維持する。
  - 単体 delete 成功後は optimistic removal せず明示的に refetch し、unlock と bulk delete 成功後は Socket.IO/route/fetch trigger による refetch-driven update に委ねる。
  - _Requirements: 2.1-2.24_

- [x] 3. delete dialog と bulk edit を実装する
  - Reserve delete dialog、bulk edit title、select-all、exit、delete/unskip/unoverlap actions を App Shell EditTitleBar contract に接続する。
  - 0 件 selection、dialog close cleanup、snackbar 文言、API target selection が requirements と一致する。
  - task 完了時に normal/card/table layout と edit mode visual state が synthetic fixture で観測できる。
  - _Requirements: 3.1-3.12_

- [x] 4. Manual Reserve add/edit flow を実装する
  - manual add/edit route、time-specified mode、program-info fetch、existing reserve fetch、no-query add guard、reserveId precedence を実装する。
  - Manual Reserve form は React Hook Form + Zod で payload validation を行い、settings と channel/program data から default/input state を作る。
  - Manual Reserve dialog/page layout は desktop/mobile のどちらでも target field、option panels、save/cancel action が重ならない。
  - Manual Reserve の channel/directory/mode select は MUI select contract に従い、visible empty placeholder item を表示しない。
  - submit success/failure、fetch failure snackbar、Socket.IO time-specified no-op、route leave cleanup が requirements と一致する。
  - _Requirements: 4.1-4.31_

- [x] 5. Reserves の unit/E2E/visual regression を整備する
  - `unittest/spec` と `unittest/imp` で route query、fetch option、state class priority、menu/dialog/action API、Manual Reserve payload、Socket.IO behavior を検証する。
  - Playwright + MSW で list table/card、dialog/menu、bulk edit、Manual Reserve add/edit、desktop/mobile visual cases を確認する。
  - fixture に実番組名、実 channel 名、実 URL、実ロゴ、認証情報を含めない。
  - _Requirements: 1.1-1.13, 2.1-2.24, 3.1-3.12, 4.1-4.31, 5.1-5.5, 6.1-6.3_
