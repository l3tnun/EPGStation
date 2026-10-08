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

placeholder、環境変数名、記号 root のみ使用する。

```text
EPGSTATION_MIRAKURUN_URL=<mirakurun-url>
EPGSTATION_FFMPEG_PATH=<ffmpeg-path>
EPGSTATION_FFPROBE_PATH=<ffprobe-path>
EPGSTATION_CURRENT_UI_URL=<current-ui-url>
FRONTEND_APP_ROOT=<frontend-app-root>
```

## ローカル専用ファイル

実環境値や実データを含む可能性があるものは git に含めない。

- `.env.local`
- `config/config.yml.local`
- 一時調査資料配下の local notes。
- 一時調査資料配下の research screenshots。

## Verification Gate

docs、specs、test fixture、snapshot を追加または更新した後は、secrets scan を実行する。検出された URL / path / runtime 値が policy 文言や placeholder ではなく実値である場合、tracked file から削除する。
