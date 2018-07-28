EPGStation
====
[Mirakurun](https://github.com/Chinachu/Mirakurun) を使用した録画管理ソフトです  
iOS・Android での閲覧に最適化されたモバイルフレンドリーな Web インターフェイスが特徴です  
PC からの閲覧でもモダンな UI で操作可能です

## 機能
### 放送番組の視聴・録画・管理

- ブラウザでの Web インターフェイス操作
	- 番組表の表示
	- 番組検索
	- 番組単位の予約
		- 番組表からの手動予約
		- ルールによる自動予約
		- 予約の競合や重複の警告
	- 番組の視聴
		- 放送中番組のライブ視聴
		- 録画済み番組のストリーミング視聴
		- 録画済み番組のダウンロード
- WebAPIでのHTTP Request操作
	- [WebAPI Document](doc/webapi.md)

## スクリーンショット

|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/top.png)|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/live.png)|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/program.png)|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/recorded.png)|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/reserves.png)|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/rule.png)|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/search.png)|
|---|---|---|---|---|---|---|

## デモ

![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/demo.gif)

## 動作環境

- Linux / macOS / Window 
- [Node.js](http://nodejs.org/) : ^6.5.x || ~ 8 
- [Mirakurun](https://github.com/Chinachu/Mirakurun) : ^2.5.7 
- いずれかのデータベース
	- [MySQL](https://www.mysql.com/jp/) ([MariaDB](https://mariadb.org/))【推奨】
	- [PostgreSQL](https://www.postgresql.org/) (version 9.5 以上)
	- [SQLite3](https://www.sqlite.org/)（設定不要だが検索機能に制限あり）  
		- [SQLite3 使用時の正規表現での検索の有効化について](doc/sqlite3-regexp.md)
- [FFmpeg](http://ffmpeg.org/)
- for Linux / macOS
	- [Python 2.7](https://www.python.org/) node-gyp にて必要
	- [GCC](https://gcc.gnu.org/) node-gyp にて必要
- for Windows
	- [windows-build-tools](https://npmjs.com/package/windows-build-tools)

### 構築済み推奨環境
[docker-mirakurun-epgstation](https://github.com/l3tnun/docker-mirakurun-epgstation) で動作を確認しています

## セットアップ方法
### [Windows用セットアップマニュアル](doc/windows.md)

### [Linux / Mac OS用セットアップマニュアル](doc/linux-setup.md)

## アップデート方法

- 以下のコマンドを実行後に EPGStation を再起動する

	```
	$ git pull
	$ npm update
	$ npm update -D
	$ npm run build
	```

## 動作確認

- ブラウザから `http://<IPaddress>:<Port>/` にアクセスをする
- curlやwgetでWebAPIを叩く

	```
	$ curl -o - http://<IPaddress>:<Port>/api/config
	```

### ログの確認
#### [ログ出力の詳細設定](doc/log-manual.md)
#### EPGStation/logs/Operator

- 録画管理機能からのログが記録されています
	- `access.log`
		- 基本的に空ファイル
	- `stream.log`
		- 基本的に空ファイル
	- `system.log`
		- Mirakurun へのアクセスログ、コマンドの実行、録画等のログ

#### EPGStation/logs/Service

- Web インターフェイスからのログ記録されています
	- `access.log`
		- Web インターフェイスへのアクセスログ
	- `stream.log`
		- ストリーミング配信ログ
	- `system.log`
		- Web サーバ、エンコード等の動作ログ

## クライアント向け設定

- EPGStation を利用する端末向けの設定を行うと快適に利用可能です

### URL Scheme

- EPGStation上の動画再生をOS上のアプリケーションで行うことが出来ます
	- [iOS, Android 用の設定は config.json 内で設定](doc/conf-manual.md#mpegtsviewer)
	- [macOS 用の URL Scheme 設定方法](doc/mac-url-scheme.md)
	- [Windows 用の URL Scheme 設定方法](doc/win-url-scheme.md)

- 上記以外の環境での設定は WebUI の設定で各ブラウザごとに設定してください

### スマートフォン側の設定

config.json で設定したアプリをインストールしてください

## データベースのバックアップとレストア

データベースに含まれる以下の情報はバックアップが可能です  

- エンコード済み番組情報
- 録画済み番組情報
- 録画履歴
- 録画予約ルール

バックアップデータはデータベースに依存しないので MySQL でバックアップし、SQLite3 へレストアなども可能です

### 注意
以下のファイルとディレクトリはバックアップに含まれません  
別途手動でバックアップしてください

- 予約情報 (reserves.json)
- 録画ファイル (recorded)
- サムネイル (thumbnail)
- ログ (logs)
- 設定ファイル (config.json)

### バックアップ

- 以下のコマンドを実行

```
npm run backup FILENAME
```

### レストア

- config.json に新しいデータベース設定を記述後に以下のコマンドを実行

```
npm run restore FILENAME
```


## Tips
### Kodi との連携

[Kodi](https://kodi.tv/) との連携に対応しています  
詳細は [doc/kodi.md](doc/kodi.md) を参照してください

### Android での番組表の表示高速化

性能が低い Android 端末の場合番組表の描画に時間がかかる場合があります

- ナビゲーションを開く -> 設定 -> 番組表スクロール修正 を有効化

上記の操作をすると画面外の要素が描画されなくなるため動作が軽くなります

### Android 6.0 以上での注意

Android の設定 -> ユーザー補助 にて "操作の監視" が必要なサービスを ON にしていると、番組表の動作が著しく重くなります  
具体的なアプリは LMT Launcher や Pie Control などが挙げられます

該当サービスを OFF にするのが一番良いですが、それができない場合は以下の操作をしてください

設定ページにて

- 番組表スクロール修正 を有効化
- 番組表描画範囲の最小化 を有効化

さらに動作を軽くしたい場合は番組表時間で表示時間を短くしてください

## Licence

[MIT Licence](LICENSE)
