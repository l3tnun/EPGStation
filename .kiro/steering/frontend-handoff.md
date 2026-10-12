# Frontend Handoff 方針

## 一時資料と正規仕様

一時調査資料は React 移植完了後に削除され得るため、恒久的に必要な設計、owner 境界、API / storage / query contract、UI behavior、dialog / menu / snackbar、test gate、ADR 相当の判断は `.kiro/specs/frontend-*` または `.kiro/steering/` を正本とする。

tasks generation や implementation に進む前に、`.kiro` 外にしか存在しない design decision、API contract、UI behavior が残っていないことを確認する。

## 正規 Input

React implementation の正規 input は `.kiro/specs/frontend-*` の requirements / design / tasks と `.kiro/steering/` の project memory である。

source-backed draft、research notes、screenshots、runtime observation は、requirements / design / tasks へ昇格するまで調査根拠として扱う。

## Tasks 生成前 Gate

各 spec の tasks を生成する前に、以下を確認する。

1. requirements が人間レビュー済みであること。
2. design が人間レビュー済みであること。
3. source-backed-only state と screenshot-backed state が design 内で名前付きで扱われていること。
4. API endpoint、query parameter、request body、localStorage key、Socket.IO trigger、loading / error / snackbar state が design に列挙されていること。
5. dialog、menu button、bulk action、small button、empty/error/loading state が requirements / design から追跡できること。
6. `unittest/spec`、`unittest/imp`、E2E の検証方針が tasks に落とせること。
7. `.kiro` 外にだけ存在する恒久設計が残っていないこと。
8. secrets scan を実行し、tracked docs / specs / fixture に実 URL、番組名、認証情報、Mirakurun URL、ffmpeg / ffprobe 実 path、環境固有値が混入していないこと。
9. 実装前技術選定が `.kiro/steering/tech.md` と `.kiro/steering/testing.md` に反映済みであり、対象 spec の `design.md` がその方針を参照できること。

## React Implementation Gate

React frontend を変更する前に、以下を満たす。

1. 対象 spec の requirements / design / tasks が承認済みであること。
2. 実装前技術選定で build system、router、data fetching / cache、state management、UI component stack、form / validation stack、lint / format、test stack、Node pin が `.kiro/steering/tech.md` と `.kiro/steering/testing.md` に記録済みであること。
3. `client/` が React frontend の唯一の package boundary であり、server package が frontend implementation details を直接 import しないこと。
4. hash route compatibility を維持するか、移行する場合は release / rollback / reverse proxy 設定を含む ADR が承認済みであること。
5. implementation task ごとに対象 route、正規 spec file、API model、state transition、Socket.IO update behavior、responsive rules、dialog / menu / snackbar、platform constraints、必要な tests が明記されていること。

## Package Boundary Gate

`client/` は React / TypeScript / Vite frontend package である。root `package.json`、build script、Docker / release 手順、CI、README、ignore、developer docs は `client/` を frontend package として参照する。

## Review Gate

requirements / design / tasks / implementation の各段階で、横断 owner 境界を確認する。特に App Shell vs screen-specific UI、Settings Storage vs Settings Screen、Guide vs SearchRule ProgramDialog、OnAir vs Video Playback、Storages vs Recorded Upload は重複所有や抜け漏れが起きやすいため、レビュー対象に含める。
