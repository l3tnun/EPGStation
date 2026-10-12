# Agent Skills

この directory は、EPGStation の仕様作成、実装、テスト、検証で使う agent skill の導入方法と役割を記録する。

## 共通ルール

- skill 追加後は Codex / Claude Code など利用中の agent process を再起動して認識させる。
- 実 URL、認証情報、runtime 固有 path、Mirakurun URL、ffmpeg / ffprobe 実 path は skill 用 docs や generated spec に書かない。
- `client/` は React frontend package の正本である。

## 導入済み skill

| Skill | Upstream | 導入 command | Project-local path |
| --- | --- | --- | --- |
| cc-sdd | `https://github.com/gotalab/cc-sdd` | `npx cc-sdd@latest --codex-skills --lang ja` | `.agents/skills/kiro-*` |
| solid | `https://github.com/ramziddin/solid-skills` | copy `skills/solid` from upstream repo | `.agents/skills/solid` |
| superpowers | `https://github.com/obra/superpowers` | copy selected `skills/*` from upstream repo | `.agents/skills/<skill-name>` |
| playwright-cli | `https://github.com/microsoft/playwright-cli` | `playwright-cli install --skills`, then copy generated skill | `.agents/skills/playwright-cli` |
| epgstation-server-testing | project-owned | repository に導入済み | `.agents/skills/epgstation-server-testing` |
| karpathy-guidelines | `https://github.com/nguyenphutrong/andrej-karpathy-skills-codex` | upstream の repo-scoped skill を copy | `.agents/skills/karpathy-guidelines` |
| caveman suite | `https://github.com/JuliusBrussee/caveman` | 必要な skill directory だけを copy | `.agents/skills/caveman*`, `.agents/skills/cavecrew` |

Project-local skill は `.agents/skills` を正とする。`$CODEX_HOME/skills` には project-local skill を置かない。

Claude Code は repository root に `CLAUDE.md` が無い場合、`AGENTS.md` を project instructions として直接読む（v2.1.277 以降。`CLAUDE.md` は作らない）。Claude Code 用にも同じ project-local skills を公開する。`.claude/skills` は `.agents/skills` を指す相対 symlink（`.claude/skills -> ../.agents/skills`）として git 管理下にあり、clone 後の手動作業は不要である。skill 本体は `.agents/skills/` だけを更新し、`.claude/skills/` に別 copy を作らない。

## karpathy-guidelines

目的:

- 実装・review・設計時に、前提の明示、最小変更、不要な抽象化の抑止、検証条件の固定を促す。
- upstream の Codex 向け repo-scoped skill を、この project だけで使う。

Project-local 導入:

```bash
tmp_dir=$(mktemp -d)
git clone --depth 1 https://github.com/nguyenphutrong/andrej-karpathy-skills-codex "$tmp_dir"
cp -R "$tmp_dir/.agents/skills/karpathy-guidelines" .agents/skills/
```

導入先:

```text
.agents/skills/karpathy-guidelines
```

確認:

```bash
test -f .agents/skills/karpathy-guidelines/SKILL.md
```

Codex を repository root で再起動後、`$karpathy-guidelines` が利用可能であることを確認する。upstream plugin を `$CODEX_HOME` へ install せず、project-local の skill discovery を使用する。

## caveman suite

目的:

- 通常の会話、commit message、review コメント、subagent 出力を簡潔にする。
- `cavecrew` は短い調査・小規模編集・review の delegation 判断に使用する。

Project-local 導入:

```bash
tmp_dir=$(mktemp -d)
git clone --depth 1 https://github.com/JuliusBrussee/caveman "$tmp_dir"
for name in \
  cavecrew \
  caveman \
  caveman-commit \
  caveman-compress \
  caveman-help \
  caveman-review \
  caveman-stats; do
  cp -R "$tmp_dir/skills/$name" ".agents/skills/$name"
done
```

導入先:

```text
.agents/skills/cavecrew
.agents/skills/caveman
.agents/skills/caveman-commit
.agents/skills/caveman-compress
.agents/skills/caveman-help
.agents/skills/caveman-review
.agents/skills/caveman-stats
```

確認:

```bash
for name in cavecrew caveman caveman-commit caveman-compress caveman-help caveman-review caveman-stats; do
  test -f ".agents/skills/$name/SKILL.md" || exit 1
done
```

upstream の `curl | bash` installer、global plugin install、global skills registry install は使わない。これらはこの project 以外の agent 設定も変更し得るためである。Codex / Claude Code を再起動してから、必要時だけ各 skill を明示して使う。

## cc-sdd

目的:

- source-backed spec draft から requirements / design / tasks を生成する。
- 仕様の承認 gate として使い、`.kiro/specs/<feature-name>/` の requirements / design / tasks を実装の input にする。

導入:

```bash
npx cc-sdd@latest --codex-skills --lang ja
```

dry-run で生成先を確認する場合:

```bash
npx cc-sdd@latest --codex-skills --lang ja --dry-run
```

主な生成物:

- `.agents/skills/kiro-spec-requirements/SKILL.md`
- `.agents/skills/kiro-spec-design/SKILL.md`
- `.agents/skills/kiro-spec-tasks/SKILL.md`
- `.agents/skills/kiro-review/SKILL.md`
- `.codex/agents/spec-reviewer.toml`
- `.kiro/settings/templates/specs/*.md`
- `AGENTS.md`

この project での使い方:

1. `.kiro/specs/frontend-*` の requirements / design / tasks と `.kiro/steering/` を正本として確認する。
2. 1 spec に詰め込みすぎず、App Shell、Dashboard、Guide、Recorded などの境界で分割する。
3. 最初の generation は App Shell / Navigation のような小さい境界から始める。
4. requirements / design / tasks は `.kiro/specs/<feature-name>/` に出力する。
5. design / tasks 生成前に人間レビューを挟む。

## solid

目的:

- SOLID、TDD、clean architecture、clean code 観点で仕様、design、実装 slice をレビューする。
- 実装中は、component / state / API boundary が過度に密結合していないかを確認する。

Project-local 導入:

```bash
git clone --depth 1 https://github.com/ramziddin/solid-skills /tmp/solid-skills
cp -R /tmp/solid-skills/skills/solid .agents/skills/solid
```

導入先:

```text
.agents/skills/solid
```

この project での使い方:

- cc-sdd requirements review では、要求が実装詳細に寄りすぎていないかを見る。
- cc-sdd design review では、責務境界、依存方向、テスト可能性を見る。
- 実装 review では、TDD、型安全性、責務分離、不要な抽象化の有無を見る。

## superpowers

目的:

- agentic software development workflow と review gate を補助する。
- 長い作業を plan、実行、検証、review の段階に分ける。

Project-local 導入:

```bash
git clone --depth 1 https://github.com/obra/superpowers /tmp/superpowers
for name in \
  brainstorming \
  dispatching-parallel-agents \
  executing-plans \
  finishing-a-development-branch \
  receiving-code-review \
  requesting-code-review \
  subagent-driven-development \
  systematic-debugging \
  test-driven-development \
  using-git-worktrees \
  using-superpowers \
  verification-before-completion \
  writing-plans \
  writing-skills; do
  cp -R "/tmp/superpowers/skills/$name" ".agents/skills/$name"
done
```

導入先:

```text
.agents/skills/<skill-name>
```

この project での使い方:

- 仕様作成では review gate、仕様分割の進行管理に使う。
- 実装では task ごとの TDD / review / verification loop に使う。
- この repository では git worktree 作成や branch 操作は、ユーザーが明示した場合だけ行う。

## playwright-cli

目的:

- Playwright browser 操作を CLI skill として使う。
- 現行 UI の screenshot / snapshot / DOM 確認、React 実装の検証に使う。

事前確認:

```bash
playwright-cli --help
playwright --version
```

導入:

```bash
playwright-cli install --skills
```

`playwright-cli install --skills` は workspace 側の `.claude/skills/playwright-cli` を導入先にする。この project では `.claude/skills` は `.agents/skills` への symbolic link なので、導入後の実体は `.agents/skills/playwright-cli` になる。copy や `.claude` の削除は不要であり、既存 link は維持する。

```bash
test -f .agents/skills/playwright-cli/SKILL.md
```

この project での使い方:

- 現行 UI 調査は、対象 spec の requirements / design / tasks と `.kiro/steering/testing.md` のルールに従う。
- Dashboard 以外は route path を直接開かず、Dashboard から navigation / UI 操作で辿る。
- screenshot 本体は git ignored の一時 artifact directory に保存し、tracked file に実 URL や実番組情報を含めない。
- screenshot 保存前に loading 完了、theme class、thumbnail 描画、対象画面の DOM text を確認する。

## epgstation-server-testing

目的:

- EPGStation server の単体・結合テストで、coverage 数値だけでは検出できない値域、状態遷移、失敗、timeout、race、resource lifecycle の漏れを防ぐ。
- `unittest/spec`、`unittest/imp`、integration の責務を区別し、Acceptance Criteria から test evidence まで追跡可能にする。
- broad exclusion だけで品質 gate を通さない。
- 仕様、source、test、runtime evidence が食い違う場合に、production を test に合わせて安易に変更しない。

導入先:

```text
.agents/skills/epgstation-server-testing
```

この project での使い方:

1. server の test 設計、test 実装、coverage 除外、test review を行うときに `$epgstation-server-testing` を使う。
2. `.kiro/steering/server-testing.md` を正本として読み、対象 Requirements / Design / Tasks の承認状態を確認する。
3. 契約、test 種別、値域、状態、時間・順序、資源、外部境界、証跡を test matrix にする。
4. 挙動を変更する場合は、失敗する target test を先に確認してから最小変更を行う。characterization test と read-only review では現在の証跡を固定し、失敗を捏造しない。
5. この skill は server 専用であり、`client/` の test 方針には適用しない。

この skill は repository に導入済みであり、global の `$CODEX_HOME/skills` へ重複配置しない。追加または更新後は Codex を再起動し、available skills に表示されることを確認する。

## 再確認 command

```bash
find .agents/skills -maxdepth 2 -name SKILL.md | sort
find "${CODEX_HOME:-$HOME/.codex}/skills" -maxdepth 4 -name SKILL.md | sort
playwright-cli --help
```

`$CODEX_HOME/skills` 側は system skills だけが残る状態にする。project-local に置いた skill を global に重複配置しない。

## 再起動

skill 導入後、現在動いている agent process は新しい skill を即時認識しない場合がある。導入後は Codex を再起動してから、利用可能 skill 一覧に反映されているか確認する。

## Codex 認識確認

日付付きの available skills 一覧を正本にしない。skill追加・更新後はCodexを再起動し、次を確認する。

1. `.agents/skills/epgstation-server-testing/SKILL.md` がproject-local skillとして表示される。
2. `$epgstation-server-testing` を明示指定したtest-only probeがskill本文を読み、clientへ適用しない。
3. global の `${CODEX_HOME:-$HOME/.codex}/skills` に同じskillを重複配置していない。

cc-sddは`cc-sdd`という単一skill名ではなく、`kiro-*` skillsとして導入される。利用可能skillの表示はCodexのversionやsessionで変わり得るため、filesystem上の導入確認と再起動後のavailable skills確認を分けて記録する。
