EPGStation
====

[Mirakurun](https://github.com/Chinachu/Mirakurun) を使用した録画管理ソフト

## これはなに？

[Mirakurun](https://github.com/Chinachu/Mirakurun) を使用した録画管理ソフトです

iOS, Android での操作感を重視しています

## スクリーンショット

|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/top.png)|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/live.png)|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/program.png)|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/recorded.png)|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/reserves.png)|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/rule.png)|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/search.png)|
|---|---|---|---|---|---|---|

## 動作環境

* [Node.js](http://nodejs.org/) ^6.5.x || ~ 8
* [Mirakurun](https://github.com/Chinachu/Mirakurun) ^2.5.7
* Linux, macOS, Windows (実験的)
* [SQLite](https://www.sqlite.org/) or [MySQL](https://www.mysql.com/jp/) ( [MariaDB](https://mariadb.org/) ) (character-set-server = utf8)
* [FFmpeg](http://ffmpeg.org/)
* [Python 2.7](https://www.python.org/) diskusage で使用される node-gyp で必要
* [GCC](https://gcc.gnu.org/) diskusage で使用される node-gyp で必要

[docker-mirakurun-epgstation](https://github.com/l3tnun/docker-mirakurun-epgstation) で動作を確認しています

Windows については [doc/windows.md](doc/windows.md) を参照してください

## インストール方法
````
$ git clone https://github.com/l3tnun/EPGStation.git
$ cd EPGStation
$ npm install
$ npm run build
````

## アップデート方法
* 以下のコマンドを実行後に EPGStation を再起動する

```
$ git pull
$ npm update
$ npm run build
```

## 設定

#### config.json の設定

````
$ cp config/config.sample.json config/config.json
$ vim config/config.json
````

SQLite3 使用時は ```dbType``` を ```sqlite3``` に設定してください。

MySQL 使用時は ```mysql``` の設定を設定してください。

あとは ```mirakurunPath```, ```encode``` の設定をすればとりあえず動きます

ffmpeg のパスはデフォルトで ```/usr/local/bin/ffmpeg``` となっています

詳細は [doc/config.md](doc/config.md) を参照してください

mac での URL Scheme 設定については [doc/mac-url-scheme.md](doc/mac-url-scheme.md) を参照してください

windows での URL Scheme 設定については [doc/win-url-scheme.md](doc/win-url-scheme.md) を参照してください

その他の環境での URL Scheme の設定や個別に無効化したい場合については WebUI の設定で各ブラウザごとに設定してください

記述方法は [doc/config.md](https://github.com/l3tnun/EPGStation/blob/master/doc/config.md#recordedviewer-recordeddownloader-mpegtsviewer-%E3%81%A7%E7%BD%AE%E6%8F%9B%E3%81%95%E3%82%8C%E3%82%8B%E6%96%87%E5%AD%97%E5%88%97) に準じます

### log の設定

````
$ cp config/operatorLogConfig.sample.json config/operatorLogConfig.json
$ cp config/serviceLogConfig.sample.json config/serviceLogConfig.json
$ vim config/operatorLogConfig.json
$ vim config/serviceLogConfig.json
````

filename の部分をフルパスで設定してください

## 起動方法
````
$ npm start
````

or

````
$ node dist/server/index.js
````

デーモン化は [PM2](http://pm2.keymetrics.io/) で行うといいです

root で動かす必要はないです。お好きなユーザーで起動してください

## スマートフォン側の設定

config.json で設定したアプリをインストールしてください

## API の確認

````
http://host:prot/api/debug
````

上記にアクセスすると Swagger UI で API の確認が可能です

## Android 6.0 以上での注意

Android の設定 -> ユーザー補助 にて "操作の監視" が必要なサービスを ON にしていると、番組表の動作が著しく重くなります

具体的なアプリは LMT Launcher や Pie Control などが挙げられます

回避方法は以下のいずれかを行えば ok です

* サービスを OFF にする (推奨)
* EPGStation -> 設定 -> 番組表スクロール修正の有効化 -> 保存


番組表スクロール修正の有効化で完全に回避することは現状不可能です

そのため更に動作を軽くしたい場合は、番組表時間で表示時間を短くしてください

## Licence

MIT Licence
