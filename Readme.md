# EPGStation

[Mirakurun](https://github.com/Chinachu/Mirakurun) を使用した録画管理ソフトです  
iOS・Android での閲覧に最適化されたモバイルフレンドリーな Web インターフェイスが特徴です  
PC からの閲覧でもモダンな UI で操作可能です

## 機能

### 放送番組の視聴・録画・管理

-   ブラウザでの Web インターフェイス操作
    -   番組表の表示
    -   番組検索
    -   番組単位の予約
        -   番組表からの手動予約
        -   ルールによる自動予約
        -   予約の競合や重複の警告
    -   番組の視聴
        -   放送中番組のライブ視聴
        -   [aribb24.js][] を使用する Web での字幕/文字スーパー表示機能
        -   [mpegts.js][] を使用する Web での[低遅延ライブ視聴機能](doc/caption-lowlatency-setup.md)
        -   録画済み番組のストリーミング視聴
        -   録画済み番組のダウンロード
-   API
    -   [WebAPI Document](doc/webapi.md)

[aribb24.js]: https://github.com/monyone/aribb24.js
[mpegts.js]: https://github.com/xqq/mpegts.js

## スクリーンショット

| ![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/v2/dashboard.png) | ![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/v2/live.png) | ![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/v2/program.png) | ![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/v2/recording.png) | ![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/v2/recorded.png) | ![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/v2/reserves.png) | ![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/v2/rule.png) | ![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/v2/search.png) |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |

---

## デモ

![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/v2/demo.gif)

## 動作環境

-   Linux / macOS / ~~Windows~~
-   [Node.js](http://nodejs.org/) : ^14.6.0 || ^16.6.1 || ^18.16.1
-   [Mirakurun](https://github.com/Chinachu/Mirakurun) : ^3.2.0
-   いずれかのデータベース
    -   [SQLite3](https://www.sqlite.org/)（設定不要だが検索機能に制限あり）[標準]
        -   [SQLite3 使用時の正規表現での検索の有効化について](doc/sqlite3-regexp.md)
    -   [MySQL](https://www.mysql.com/jp/) ([MariaDB](https://mariadb.org/))【推奨(要設定)】※文字コードは utf8mb4
        -   [Mirakurun 3.9.0-beta.24 以降の設定について](doc/mysql-mirakurun-3.9.0-beta.24.md)
    -   ~~[PostgreSQL](https://www.postgresql.org/) (version 9.5 以上)~~
-   [FFmpeg](http://ffmpeg.org/)

sqlite3 パッケージのインストール時にバイナリが存在しなかった場合は次の環境も必要

-   for Linux / macOS
    -   [Python v3.x](https://www.python.org/) node-gyp にて必要
    -   [GCC](https://gcc.gnu.org/) node-gyp にて必要
-   ~~for Windows~~
    -   ~~[windows-build-tools](https://npmjs.com/package/windows-build-tools) node-gyp にて必要~~

### 構築済み推奨環境

-   [docker-mirakurun-epgstation](https://github.com/l3tnun/docker-mirakurun-epgstation)

-   [nvenc + docker 環境での構築例](https://github.com/kazuki0824/EPGStation-nvenc-docker)
    [(created by kazuki0824)](https://github.com/kazuki0824)

---

## セットアップ方法

### [Linux / macOS 用セットアップマニュアル](doc/linux-setup.md)

### ~~[Windows 用セットアップマニュアル](doc/windows-setup.md)~~

### [字幕表示 / 低遅延配信用セットアップマニュアル](doc/caption-lowlatency-setup.md)

---

## アップデート方法

-   以下のコマンドを実行後に EPGStation を再起動する

    ```
    $ git pull
    $ npm run all-install
    $ npm run build
    ```

---

## v1 からの移行について

[doc/v1migrate.md](doc/v1migrate.md) を参照

---

## 動作確認

-   ブラウザから `http://<IPaddress>:<Port>/` にアクセスをする
-   curl や wget で API を叩く

    ```
    $ curl -o - http://<IPaddress>:<Port>/api/config
    ```

### ログの確認

#### [ログ出力の詳細設定](doc/log-manual.md)

#### logs/EPGUpdater

-   EPG 更新機能からのログが記録されています
    -   `access.log`
        -   基本的に空ファイル
    -   `stream.log`
        -   基本的に空ファイル
    -   `system.log`
        -   Mirakurun へのアクセスログ、番組情報の更新等のログ

#### EPGStation/logs/Operator

-   録画管理機能からのログが記録されています
    -   `access.log`
        -   基本的に空ファイル
    -   `stream.log`
        -   基本的に空ファイル
    -   `system.log`
        -   Mirakurun へのアクセスログ、コマンドの実行、録画等のログ

#### EPGStation/logs/Service

-   Web インターフェイスからのログ記録されています
    -   `access.log`
        -   Web インターフェイスへのアクセスログ
    -   `stream.log`
        -   ストリーミング配信ログ
    -   `system.log`
        -   Web サーバの動作ログ
    -   `encode.log`
        -   エンコード処理関連のログ

---

## クライアント向け設定

-   EPGStation を利用する端末向けの設定を行うと快適に利用可能です

### URL Scheme

-   EPGStation 上の動画再生を OS 上のアプリケーションで行うことが出来ます

    -   [config.yml 内の設定 (iOS, Android, macOS, Windows)](doc/conf-manual.md#urlscheme)
    -   [macOS 用の URL Scheme 設定方法](doc/mac-url-scheme.md)
    -   [Windows 用の URL Scheme 設定方法](doc/windows-url-scheme.md)

-   上記以外の環境での設定は WebUI の設定で各ブラウザごとに設定してください

### スマートフォン側の設定

config.yml で設定したアプリをインストールしてください

---

## データベースのバックアップとレストア

データベースに含まれる以下の情報がバックアップ可能です

-   予約情報
-   録画済み番組情報
-   録画履歴
-   録画予約ルール

バックアップデータはデータベースに依存しないので MySQL でバックアップし、SQLite3 へレストアなども可能です

### 注意

以下のファイルとディレクトリはバックアップに含まれません  
別途手動でバックアップしてください

-   録画ファイル (recorded)
-   サムネイル (thumbnail)
-   ドロップログ (drop)
-   ログ (logs)
-   設定ファイル (config.yml)

### バックアップ

-   以下のコマンドを実行

```
npm run backup FILENAME
```

### レストア

-   config.yml に新しいデータベース設定を記述後に以下のコマンドを実行

```
npm run restore FILENAME
```

---

## Tips

### Kodi との連携

[Kodi](https://kodi.tv/) との連携に対応しています詳細は [doc/kodi.md](doc/kodi.md) を参照してください

### Android 6.0 以上での注意

Android の設定 -> ユーザー補助 にて "操作の監視" が必要なサービスを ON にしていると、番組表の動作が著しく重くなります  
具体的なアプリは LMT Launcher や Pie Control などが挙げられます

該当サービスを OFF にするのが一番良いですが、それができない場合は Firefox での使用を試してみてください。

## Contributing

[CONTRIBUTING.md](.github/CONTRIBUTING.md)

## Licence

[MIT Licence](LICENSE)
