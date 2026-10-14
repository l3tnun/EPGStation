---
name: epgstation-pr-review
description: Use when reviewing an EPGStation pull request or deciding whether to accept and merge one, including contributor PRs and your own branch before it goes to master.
---

# EPGStation PR Review

PR を受け入れてよいかを判断するときの観点。各観点で、PR の差分・spec・test・実行結果を実際に開いて確かめ、確かめた file と結果を review に書く。確かめていない観点は「未確認」と書き、通ったことにしない。

server の test の書き方は `epgstation-server-testing`、client は `epgstation-client-testing` の skill に従う。見た目・リアルタイム更新が変わる PR は `ui-parity-verification` も使う。

## 観点

### 1. spec に振る舞いの境界が書かれているか

- 変更した振る舞いが `.kiro/specs/` の requirements・design・tasks に書かれ、実装と test が同じ内容になっているか（spec → test → 実装の順。`AGENTS.md` の Development Rules）。
- 境界の扱いが書かれているか。例: 時間帯の始まりと終わりの時刻ちょうど、サマータイムの切り替え（時刻が飛ぶ・重なる）、0 件・上限・上限を超える値、再起動・異常終了のときに途中の処理（依頼・録画・配信）をどう扱うか。
- design に古い API 名や予定（PLANNED）の記述が残っていないか。

### 2. process をまたぐ動きを結合 test で確かめているか

- 単体 test（`unittest/spec`・`unittest/imp`）だけでなく、親 process と Web・API 側 process の間の IPC、子 process（ffmpeg など）、DB、file system をまたぐ動きを、結合 test（`test/server/**/*.integration.test.ts`）で確かめているか。
- 時刻・タイムゾーンに依存する動きは、`TZ` を変えた子 process で確かめているか（同じ process の中では `TZ` の変更が効かないことがある）。
- client の変更は、e2e（`client/e2e/`）で利用者の操作から画面の反映までを確かめているか。放送波のデータを test に使っていないか（合成の映像・字幕を使う）。

### 3. DB の migration を両方の DB で作り、戻す向きも確かめているか

- entity を変えたら、`src/db/migrations/sqlite` と `src/db/migrations/mysql` の両方に migration があるか。
- `down` が `up` を正しく戻すか（`test/server/persistence/` の migration の test）。
- 型の違いを考えているか。例: SQLite では `integer` の主キーは行番号の別名になり、値を渡さないと自動で採番される。
- 管理情報のバックアップ・復元（`src/DBTools.ts`）で、足した table をどう扱うか（含める・消す・触らない）を決めているか。

### 4. 設定の項目を足すとき、説明書・template・既定値の test が揃っているか

- `src/model/IConfigFile.ts` の型、`config/config.yml.template`、`docs/conf-manual.md` の説明が揃っているか。
- 項目を省いたときの既定値と、不正な値を拒否することを test で確かめているか。

### 5. 全体の検査を最終の tree で 3 回通しているか

- `npm run preflight -- --all` を merge する tree で 3 回流し、3 回とも `summary.tsv` の全 step が `exit=0` か（手順は `docs/testing.md`）。1 回だけでは、たまにしか落ちない test を見逃す。
- 途中で 1 回でも落ちたら、再実行で通ったことにせず、原因を調べて直す。直したら 3 回を数え直す。
- mutation testing の対象を変えた PR は、report を集計し、`docs/mutation-known-survivors.md` に無い新しい生き残りを扱ったか（test を足すか、理由を付けて一覧に足す）。

## そのほかに確かめること

- product code（`src/**`、Dockerfile、config、`package.json` の依存）の変更が、PR の目的に必要な範囲に収まっているか。
- commit message・PR 本文に、変更の内容と理由が書かれているか。
