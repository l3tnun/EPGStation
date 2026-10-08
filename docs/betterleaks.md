# betterleaks による個人情報・secret 検査

commit しようとしている staged な変更に、開発者個人の home directory path のような
個人情報や、API key・private key のような secret が入っていないかを
[betterleaks](https://github.com/betterleaks/betterleaks) で検査します

pre-commit hook（`.githooks/pre-commit` → `tools/check-betterleaks-scan.py`）から
実行されます。clone した repository ごとに 1 回 `git config core.hooksPath .githooks`
を実行して hook を有効にします。有効にした後は、通常の開発では意識する必要はありません。ここでは install
方法・検査内容・false positive の扱い方を説明します

## install

pinned version の release binary を checksum 検証してから `~/.local/bin` などの
user local な場所へ配置することを推奨します（`sudo` 不要、システム全体に影響しない）

```
version=1.8.1
curl -fsSL -o checksums.txt \
    "https://github.com/betterleaks/betterleaks/releases/download/v${version}/checksums.txt"
curl -fsSL -o "betterleaks_${version}_linux_x64.tar.gz" \
    "https://github.com/betterleaks/betterleaks/releases/download/v${version}/betterleaks_${version}_linux_x64.tar.gz"

# checksums.txt に記載された sha256 と一致するか確認する
grep "linux_x64" checksums.txt | sha256sum -c -

mkdir -p ~/.local/bin
tar xzf "betterleaks_${version}_linux_x64.tar.gz" betterleaks
install -m 0755 betterleaks ~/.local/bin/betterleaks
betterleaks version   # 1.8.1 と表示されることを確認
```

`checksums.txt` の各行の sha256 は、GitHub の Releases API が独立に計算する
asset の `digest` field とも一致することを確認済みです（片方だけが改変されていた場合
に検知できるよう、両方を突き合わせるのが望ましいです）。`cosign` が使える環境では
`checksums.txt.sigstore.json` で checksums.txt 自体の署名も検証できます

macOS や他 arch 向けの asset 名は release page
(https://github.com/betterleaks/betterleaks/releases) を参照してください
（Homebrew: `brew install betterleaks` でも導入できますが、pinned version と
checksum 検証を優先する場合は上記の release binary 方式を使ってください）

`~/.local/bin` を `PATH` に含めていない場合は shell の rc file へ追加してください

## 何を検査しているか

`tools/check-betterleaks-scan.py` は `betterleaks git --staged` を 2 回に分けて
実行します

1. **default rule set（secret）**: betterleaks 同梱の rule（API key、private key 等）で
   staged diff を検査します
2. **personal-info（個人情報）**: `tools/personal-info.betterleaks.toml` の汎用 rule
   （`/home/<user>/...`、`/Users/<user>/...` のような per-user home directory path を
   username を問わず検出する regex）に、実行時の `$HOME`・実行 user 名・非公開の作業 directory
   から生成した rule を追記した一時 config で staged diff を検査します。非公開の
   作業 directory は、環境変数 `EPGSTATION_PRIVATE_DIRS`（`:` 区切り、複数可）で
   渡した directory と、repository と同じ階層にある隠し directory のうち名前が
   `.<repository の directory 名>-` で始まるもの（大文字小文字は区別します）です。
   それぞれについて絶対 path と directory 名の 2 つの rule を作るため、
   `../<名前>` や `$HOME/work/<名前>` のような相対の言及も検出します。該当する
   directory が 1 つも無ければこの rule は作りません

2 回に分けているのは、betterleaks の default config の global filter が
`/home/...` や `/Users/...` 形式の文字列を「よくある無害な path」として意図的に
除外しているためです。personal-info 用の rule をこの filter を継承する形
（`[extend] useDefault = true`）で書くと、個人情報の finding ごと握り消されることを
実測で確認したため、personal-info 用の config は `[extend]` を使わない独立した
config にしています

`tools/personal-info.betterleaks.toml` と `tools/check-betterleaks-scan.py` 自身には
実際の username・home directory・非公開の作業 directory の path や名前を書きません。実際の値は
実行時に環境から読み、一時 file にだけ書き出します。これは検査対象の tracked file
自身が個人情報を含んでしまうことを避けるためです

## commit 前に betterleaks が無いとどうなるか

`betterleaks` が `PATH` に無い場合、hook は検査を skip せず commit を止めます。
黙って skip すると、個人情報や secret が未検査のまま commit されてしまうためです。
表示される案内に従って上記の install 手順を行ってください

## 全 tracked file を手動で scan する

pre-commit hook は staged な変更（diff）だけを検査します。それとは別に、
HEAD の tracked な全 file を一括で検査したい場合は次のコマンドを使います

```
bash tools/scan-tracked-personal-info.sh
```

`git archive HEAD` で作った clean な export に対して default rule set（secret）
と personal-info（`tools/personal-info.betterleaks.toml` の汎用 rule +
実行時の `$HOME`・実行 user 名・非公開の作業 directory から生成した rule）の
2 回を実行し、どちらかで finding があれば non-zero で終了します。export の
一時 dir は `$TMPDIR`（未設定なら repository 内の ignore された `test/server/.artifacts/tmp`）配下に作られ、実行後に
削除されます。`/tmp` に大きな export を置いてメモリを消費しないための配慮です

## false positive の扱い方

-   **default rule set 側**（secret 検出）: repo root の `.gitleaksignore` に
    `path:rule-id:line` の形式で fingerprint を追記してください。fingerprint は
    `betterleaks git --staged --report-format json --report-path -` の出力の
    `Fingerprint` field で確認できます。追記する前に、本当に secret ではないこと
    （test 用の synthetic な値である、doc の placeholder である等）を確認し、
    ignore file 内のコメントに理由を書いてください
-   **personal-info 側**（個人情報検出）: 個人情報ではないと判断できる場合
    （doc の例示用 username、CI runner の既定 user 等）は
    `tools/personal-info.betterleaks.toml` の該当 rule の `filter` へ、
    その具体的な文字列だけを対象にした条件を追記してください。個人情報検出の
    rule そのもの（`/home/...` を汎用的に検出する regex）は緩めないでください
