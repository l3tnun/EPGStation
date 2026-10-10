# Implementation Plan

- [x]   1. Search route、query-driven search、result rendering を実装する
    - `/search` route は keyword/channel/genre/rule/settings から query model と `POST /schedules/search`
      request を作る。
    - plain `/search` では user action 前の default search を発火せず、Socket.IO `updateStatus`
      でも検索実行済み状態がある場合だけ再検索する。
    - result header scroll action、loading/error/empty、route-driven state、searchLength/half-width/inclusion
      settings が観測できる。
    - _Depends: frontend-app-shell 5, frontend-settings-storage 2_
    - _Requirements: 1.1-1.22_

- [x]   2. Search からの reserve/rule workflow を実装する
    - search result ProgramDialog は Guide owned shared
      component の consumer として使い、reserve/rule/add/edit/delete/search handoff を重複実装しない。
    - rule add/edit form は form の値を local state で持ち、Zod の schema で payload を検証し、settings default、avoid duplicate、copy
      keyword、encode setting default を反映する。
    - action 成功後の route/refetch/snackbar/dialog cleanup と selection preservation が requirements と一致する。
    - _Depends: frontend-guide 4, frontend-reserves 2_
    - _Requirements: 2.1-2.41_

- [x]   3. Rule list、query、item actions、bulk edit を実装する
    - `/rule` route は page/keyword/settings から `GET /rules`
      query を作り、`isHalfWidth`、`limit`、`offset`、`type=normal`、optional keyword を送る。
    - rule item click/edit/delete、visible row selection preservation、page/keyword route change selection clear、bulk
      edit/select-all/exit を実装する。
    - card/table responsive layout は long keyword、複数 channel/genre、edit mode selection、action
      menu が同時に存在しても text overlap と horizontal overflow を発生させない。
    - delete success は optimistic removal せず、Socket.IO `updateStatus`、route
      change、または別 fetch による refetch-driven update に委ねる。
    - _Requirements: 3.1-3.35_

- [x]   4. Search / Rule の unit/E2E/visual regression を整備する
    - `unittest/spec` と `unittest/imp` で search query builder、Socket.IO default-search guard、rule payload、selection
      preservation、bulk action、snackbar 文言を検証する。
    - Playwright + MSW で Search form/result、ProgramDialog consumer、Rule list/edit/bulk、desktop/mobile visual
      cases を synthetic data で確認する。
    - fixture に実番組名、実 channel、実 URL、実 directory path、認証情報を含めない。
    - _Requirements: 1.1-1.22, 2.1-2.41, 3.1-3.35, 4.1-4.4_
- [x] 5. Search/Rule select の manual arrow と visible placeholder を除去し、keyword Enter
      submit の target default 正規化、Rule list width 100% contract、MUI checkbox/select regression guard を検証する。
- [x] 6. Rule list の enable switch (`.ruleSwitchButton`) の click/tap 領域が keyword 列と重ならないよう、MUI
      `Button` runtime style を上書きする selector specificity を修正し、390px list layout と desktop table
      layout の両方で geometry/click regression を e2e で検証する。
      - _Requirements: 3.33_
