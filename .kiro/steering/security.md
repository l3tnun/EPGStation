# セキュリティと秘密情報

## 原則

ローカル runtime 値と個人環境に依存する値を repository に記録しない。仕様書には挙動と contract を書き、private な環境値は書かない。

## Tracked File に書かないもの

- 現行稼働環境や既存システムの実 URL。
- 実番組名、実ユーザー名、実運用データ。
- Mirakurun URL。
- ffmpeg path。
- ffprobe path。
- 認証情報、token、cookie、session 値。
- 特定開発者の machine でしか意味を持たない absolute path。

## 書いてよいもの

placeholder と環境変数名のみ使用する。

```text
EPGSTATION_CURRENT_UI_URL=<current-epgstation-ui-url>
EPGSTATION_IOS_MAC_SSH_HOST=<mac-ssh-host>
EPGSTATION_ANDROID_SDK_ROOT=<android-sdk-root>
```

## ローカル専用ファイル

実環境値や実データを含む可能性があるものは git に含めない（`.gitignore` で除外している）。

- `.env.local`
- `config/` 配下の設定 file（`*.template` と `*.sample.yml` を除く）
- `client/device/.device-lab.local.env`（雛形は `client/device/.device-lab.local.env.template`）
- `client/device/artifacts/`

## Verification Gate

docs、specs、test fixture、snapshot を追加または更新した後は、secrets scan を実行する。scan は `.githooks/pre-commit` が呼ぶ `tools/check-tracked-secrets.py`（private network host と credential）と `tools/check-betterleaks-scan.py`（secret と個人情報）である。検出された URL / path / runtime 値が policy 文言や placeholder ではなく実値である場合、tracked file から削除する。
