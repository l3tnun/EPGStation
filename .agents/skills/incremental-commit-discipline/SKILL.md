---
name: incremental-commit-discipline
description: Use when making multi-file or long-running changes where work should be committed in verified, reviewable units and uncommitted changes must not accumulate unnoticed.
---

# Incremental Commit Discipline

## 概要

検証済みの作業を未コミットのまま積み上げてはいけない。複数ファイル、長時間作業、UI 修正、テスト追加を伴う作業では、意味のある小さな単位で検証し、その単位ごとにコミットする。

「まだ全体が完了していないからコミットしない」は禁止ではないが、検証済みの独立した成果まで未コミットで放置する理由にはならない。

## 使う場面

- 複数ファイルを変更する作業
- UI parity / visual regression / スクショ比較を伴う作業
- 実装修正とテスト修正が混在する作業
- 長時間のバグ修正
- docs、skill、テスト、実装が同じセッションで発生する作業
- ユーザーが後で `commitして` と言う可能性がある作業

## 基本ルール

1. 作業開始時に、想定コミット単位を決める。
2. 1 つのコミットには 1 つの目的だけを入れる。
3. 各単位で必要な検証を実行する。
4. 検証済みの単位は、次の別作業に進む前にコミットする。
5. 未コミットのまま残す場合は、対象ファイルと理由を記録する。
6. 最終報告前に必ず `git status --short` を確認する。

## コミット単位の決め方

良い単位:

- `fix: align recorded item menu with legacy UI`
- `fix: repair search result mobile layout`
- `fix: open guide program dialog from grid cells`
- `test: cover recorded mobile card geometry`
- `docs: add UI parity checklist`
- `docs: add UI parity verification skill`

悪い単位:

- `fix stuff`
- `phase5 work`
- `ui changes`
- `misc`
- UI 修正、テスト、skill、docs を全部まとめた巨大コミット

## 作業開始時の手順

作業が複数ファイルまたは長時間になりそうな場合、最初に以下を行う。

```bash
git status --short
```

次に、想定コミット単位を短く書き出す。

例:

- 録画済みカードのモバイル崩れ修正
- 検索結果レイアウト修正
- 番組表ダイアログクリック修正
- 再発防止テスト追加
- UI 確認 skill 追加

既に dirty worktree の場合は、ユーザー変更や別作業変更を混ぜない。自分の作業範囲が不明なファイルは勝手に stage しない。

## 各コミット前の手順

コミット前に必ず確認する。

```bash
git status --short
git diff --stat
git diff --cached --stat
```

まだ stage していない場合は、コミット対象のファイルだけを明示して stage する。

```bash
git add path/to/file-a path/to/file-b
```

stage 後に、コミット対象が目的と一致しているか確認する。

```bash
git diff --cached --stat
git diff --cached --name-status
```

関係ない変更、未検証変更、ユーザー変更が混ざっている場合はコミットしない。

## 検証とコミット

各単位で、その変更に必要な検証を実行する。

例:

- TypeScript / unit test
- 対象 Playwright test
- visual / geometry test
- 実ブラウザ確認
- スクショ比較
- docs/skill の読み直し

検証が通ったらコミットする。

```bash
git commit -m "fix: describe the verified unit"
```

検証できなかった場合は、原則としてコミットしない。ただし、ユーザーが未検証コミットを明示的に求めた場合は、コミットメッセージや報告で未検証であることを明記する。

## 未コミット変更の扱い

未コミット変更が残っている場合、最終報告で必ず以下を出す。

- 残っているファイル
- 自分の変更か、ユーザー/別作業の可能性があるか
- なぜコミットしないのか
- 次に必要な検証または判断

未コミット変更があるのに、理由を説明せず「完了」と言ってはいけない。

## ユーザーから commit を依頼された場合

ユーザーが `commitして` と言った場合、まず staged と unstaged を分けて確認する。

```bash
git status --short
git diff --cached --name-status
```

解釈ルール:

- `add したから commitして`: staged 済みの変更だけをコミットする。
- `これまでの変更を commitして`: 自分が行った変更範囲を確認し、必要なファイルを stage してコミットする。
- 範囲が曖昧で、ユーザー変更を混ぜる危険がある場合: どのファイルを含めるか確認する。

staged だけをコミットした場合、unstaged が残っていればその旨を報告する。

## 最終報告前の必須確認

最終回答前に必ず実行する。

```bash
git status --short
```

結果が空でない場合:

- 完了報告は禁止。
- ただし、未コミットの理由とファイル一覧を明示した「未完了」または「残作業あり」の報告はできる。

## 禁止事項

- 長時間作業の最後まで全変更を未コミットで積み上げる
- unrelated な修正を 1 コミットに混ぜる
- 未検証変更を検証済みのようにコミットする
- ユーザー変更を勝手に stage する
- staged されていた一部だけをコミットし、残りの自分の変更を説明しない
- `git status --short` を確認せずに最終報告する
- dirty worktree のまま理由なく「完了」と言う

## 完了条件

以下のどちらかを満たすこと。

1. 自分の変更がすべて意味のある単位でコミット済みで、`git status --short` に自分由来の未コミット変更が残っていない。
2. 未コミット変更が残っているが、ファイル一覧、理由、未検証内容、次の判断が明記されている。

検証済みの独立単位を未コミットで残したまま、次の無関係な作業へ進んではいけない。

