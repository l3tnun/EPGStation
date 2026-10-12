# v2 から v3 への移行

v2 の環境を v3 へ更新するときの注意点をまとめます  
v1 からの移行は [v1migrate.md](v1migrate.md) を参照してください

## 1. 更新前にバックアップを取る

v3 は起動時に、データベースのスキーマを自動で更新します（マイグレーションを自動実行します）  
v2 より新しいマイグレーションとして、録画予約ルールに BS4K を対象とするかどうかの列を追加する `AddRuleBS4K` があります  
更新後にデータベースの中身は v3 の形になり、v3 にはデータベースを v2 の形へ戻す機能がありません  
v2 へ戻すときは、更新前に取ったバックアップを戻します

更新の前に EPGStation を停止し、次のものをバックアップしてください

-   データベース
    -   SQLite の場合: `data/database.db`
    -   MySQL / MariaDB の場合: `mysqldump` などによるダンプ
    -   どちらの場合も、[README のバックアップ機能](../README.md#データベースのバックアップとレストア)（`npm run backup FILENAME`）でバックアップできます
-   `config/` ディレクトリ（`config.yml`、`enc.js`、ログ設定など）
-   必要に応じて、録画ファイル（`recorded`）とサムネイル（`thumbnail`）  
    `npm run backup` のバックアップには含まれません。失いたくない場合は別途取ってください

## 2. 動作環境の変更

-   Node.js は 24 以上が必要です（`package.json` の `engines` は `>=24`）  
    v2 は `^18.16.1` でした
-   データベースのドライバーが変わりました（SQLite は `sqlite3` から `better-sqlite3`、MySQL は `mysql` から `mysql2`）  
    依存パッケージは入れ直してください

更新の手順は [README のアップデート方法](../README.md#アップデート方法) と [Linux / macOS 用セットアップマニュアル](linux-setup.md) に従います

```bash
$ git pull
$ npm run all-install
$ npm run build
```

実行後に EPGStation を再起動してください

## 3. `config/enc.js` を更新する

v3 の `package.json` には `"type": "module"` があり、EPGStation のディレクトリ内の `.js` ファイル（`config/enc.js` を含む）は ES module として読み込まれます  
そのため、v2 の標準の `enc.js` のように `require(...)` を使っていると、起動直後に次のエラーで止まり、エンコードに失敗します

```
ReferenceError: require is not defined in ES module scope, you can use import instead
```

(Node.js 24.21.0 で確認した出力です)

`config.yml` の標準設定（`encode` の `cmd: '%NODE% %ROOT%/config/enc.js'`）を使っている場合は、v3 のテンプレートからコピーし直してください

```bash
$ cp config/enc.js.template config/enc.js
```

`config/enc-enhance.js.template` を使っていた場合は、同じように `config/enc-enhance.js.template` から作り直します

`enc.js` を自分で書き換えている場合は、`require` を `import` に書き換えてください

```js
// v2
const spawn = require('child_process').spawn;

// v3
import { spawn } from 'child_process';
```

`config.yml` の各種コマンド（`encode`、`recordingStartCommand` など）から `%NODE%` で実行している自作のスクリプトが EPGStation のディレクトリ内にある場合も、`require` を使っていると同じエラーになります  
`import` に書き換えるか、拡張子を `.cjs` にしてください（`config.yml` のコマンドの指定も合わせて直します）

## 4. `config.yml`

v2 の `config.yml` は、そのまま v3 で読み込めます  
v2 のテンプレートにあった項目で、v3 で削除・改名されたものは確認できませんでした

v3 で増えた項目はすべて省略可能です。省略した場合は既定値が使われます  
項目の詳細は [詳細マニュアル](conf-manual.md) を参照してください

-   SQLite: `sqlite.wal`（ジャーナル方式を WAL にする。既定は無効）、`sqlite.busyTimeout`（DB のロックを待つ最長時間。既定は 5000 ミリ秒）
-   MySQL: `mysql.socketPath`（UNIX ソケットで接続する）、`mysql.ssl`（TLS で接続する）
-   `!env`: 値を環境変数から読み込む（例: `user: !env MYSQL_USER`）
-   上限・タイムアウトの設定: `encodeQueueLimit`、`concurrentUploadNum`、`uploadReceiveTimeoutMs`、`thumbnailMaxPending`、`hookCommandMaxPending`、`hookCommandTimeoutMs`、`storageLimitCommandTimeoutMs`、`tunerRestRequestTimeoutMs`、`tunerStreamEstablishmentTimeoutMs`

既定値や標準の設定が変わった点は次のとおりです

-   `urlscheme.download.ios`
    -   iOS 用のダウンロードの URL scheme は、設定しない状態が既定になりました（v2 の `config.yml.template` では `vlc-x-callback` が設定されていました）  
        vlc-x-callback を経由すると、保存されるファイル名が Base64 化されるためです  
        `config.yml` に書いてある場合は、その値がそのまま使われます
-   `config.yml.template` のライブ視聴用コマンド（`stream.live.ts` の `m2ts`・`webm`・`mp4`・`hls`）から FFmpeg の `-re` が外れました  
    すでにある `config.yml` の `cmd` は書き換わりません。必要に応じて見直してください

## 5. MySQL / MariaDB を使っている場合

-   v3 は `mysql2` を使うため、`caching_sha2_password` で認証するユーザーに接続できます
-   MySQL 9 では認証方式 `mysql_native_password` が使えなくなっています  
    データベースサーバーも MySQL 9 に上げる場合は、EPGStation 用のユーザーが `mysql_native_password` で作られていないかを確認し、必要なら認証方式を変更してください  
    手順は MySQL の公式ドキュメントを参照してください
-   v3 のテストでは MySQL 9.7 と MariaDB 12.3 で動作を確認しています（[testing.md](testing.md)）
-   文字コードは従来どおり utf8mb4 です

## 6. Docker を使っている場合

-   イメージは `l3tnun/epgstation:debian`（`:latest` も同じ。Debian 13 trixie ベース）と `l3tnun/epgstation:alpine` です
-   対応するアーキテクチャは linux/amd64 と linux/arm64 のみです  
    32-bit ARM（linux/arm/v6、linux/arm/v7）のイメージはありません。Node.js 24 以降が 32-bit ARM 向けの build を公開していないためです
-   docker-mirakurun-epgstation を使っている場合は、次の移行手順を参照してください  
    <https://github.com/l3tnun/docker-mirakurun-epgstation/blob/v3/docs/migration.md>
