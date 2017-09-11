EPGStation
====

[Mirakurun](https://github.com/Chinachu/Mirakurun) を使用した録画管理ソフト

## これはなに？

[Mirakurun](https://github.com/Chinachu/Mirakurun) を使用した録画管理ソフトです。

iOS, Android での操作感を重視しています。

## スクリーンショット

|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/top.png)|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/live.png)|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/program.png)|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/recorded.png)|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/reserves.png)|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/rule.png)|![](https://raw.githubusercontent.com/wiki/l3tnun/EPGStation/images/demo/search.png)|
|---|---|---|---|---|---|---|

## 動作環境

* [Node.js](http://nodejs.org/) ^6.x.x || ~ 8
* [Mirakurun](https://github.com/Chinachu/Mirakurun) ^2.5.7
* Linux or macOS
* MySQL or MariaDB (character-set-server = utf8)
* FFmpeg

[docker-mirakurun-epgstation](https://github.com/l3tnun/docker-mirakurun-epgstation) で動作を確認しています。

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

mirakurunPath, mysql, encode の設定をすればとりあえず動きます。

デフォルトでは ffmpeg のパスは ```/usr/local/bin/ffmpeg``` を想定しています。

詳細は [doc/config.md](doc/config.md) を参照してください。

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

デーモン化は [PM2](http://pm2.keymetrics.io/) で行うといいです。

root で動かす必要はないです。お好きなユーザーで起動してください。

## スマートフォン側の設定

config.json で設定したアプリをインストールしてください。

## API の確認

````
http://host:prot/api/debug
````

上記にアクセスすると Swagger UI で API の確認が可能です。

## Android 6.0 以上での注意

Android の設定 -> ユーザー補助 にて "操作の監視" が必要なサービスを ON にしていると、番組表の動作が著しく重くなります。

具体的なアプリは LMT Launcher や Pie Control などが挙げられます。

回避方法は以下のいずれかを行えば ok です

* サービスを OFF にする (推奨)
* EPGStation -> 設定 -> 番組表スクロール修正の有効化 -> 保存


番組表スクロール修正の有効化で完全に回避することは現状不可能です。

そのため更に動作を軽くしたい場合は、番組表時間で表示時間を短くしてください。

## Licence

MIT Licence
