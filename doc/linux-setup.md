Linux / macOS 用 セットアップマニュアル
===
本マニュアルでは、Linux / macOS 環境におけるセットアップ手順を解説します

## セットアップ
1. **Node.js, Mirakurun, FFmpeg/FFprobe, Python2.7, GCC** がインストール済みであることを確認する

	```bash
	$ node --version
	$ curl -o - http://<MirakurunURL>:<Port>/api/version
	$ ffmpeg -version
	$ python --version
	$ gcc --version
	```

	FFmpeg/FFprobe についてデフォルトでは ```/usr/local/bin/``` にインストールされていると想定しています  
	違う場所にインストールされている場合は ```config.json``` を修正してください

2. EPGStation のインストール

	```
	$ git clone https://github.com/l3tnun/EPGStation.git
	$ cd EPGStation
	$ npm install --no-save
	$ npm run build
	```

3. 設定ファイルの作成

	```
	$ cp config/config.sample.json config/config.json
	$ cp config/operatorLogConfig.sample.json config/operatorLogConfig.json
	$ cp config/serviceLogConfig.sample.json config/serviceLogConfig.json
	```

4. 設定ファイルの編集

	- 詳細な設定は [詳細マニュアル](conf-manual.md) を参照

	```json
	"serverPort": 8888,
	"mirakurunPath": "http+unix://%2Fvar%2Frun%2Fmirakurun.sock/",
	```

	Mirakurun が別ホストで動作している場合は `"mirakurunPath": "http://<MirakurunURL>:<Port>"`

## EPGStationの起動 / 終了

- 手動で起動する場合

	```
	$ npm start
	```

- 自動で起動する場合
	- [pm2](http://pm2.keymetrics.io/) を利用して自動起動設定が可能です
	- 初回のみ以下の起動設定が必要です

	```
	$ sudo npm install pm2 -g
	$ sudo pm2 startup <OS名>
	$ pm2 start dist/server/index.js --name "epgstation"
	$ pm2 save
	```

- 手動で終了する場合

	```
	$ npm stop
	```

- 自動起動した EPGStation を終了する場合

	```
	$ pm2 stop epgstation
	```

## MySQL 使用時の注意

EPGStation 使用中は MySQL のバイナリログが大量に生成されてディスクを圧迫するので、MySQL の設定を変えることを推奨します

```
expire_logs_days = 1
```
