# config.json 詳細マニュアル
## コンフィグ逆引きレシピ

- [コンフィグ逆引きレシピ](#コンフィグ逆引きレシピ)
- [基本設定](#基本設定)
    - [readOnlyOnce](#readonlyonce)
    - [EPGStationの待ち受けポートを変えたい](#serverport)
    - [アクセス時にユーザー認証を行いたい](#basicauth)
    - [別マシンで動作するMirakurunを使いたい](#mirakurunpath)
    - [データベースの種類を変えたい](#dbtype)
    - [データベースにMySQLを利用したい](#mysql)
    - [データベースにPostgreSQLを利用したい](#postgresql)
    - [データベースにSQLite3を利用したい](#sqlite3)
    - [SQLite3のデータベース保存先を変更したい](#dbpath)
    - [利用するFFmpegを明示的に指定したい](#ffmpeg)
    - [利用するFFprobeを明示的に指定したい](#ffprobe)
    - [gid](#gid)
    - [uid](#uid)
    - [subDirectory](#subdirectory)
- [詳細設定](#詳細設定)
    - [録画時のMirakurun優先度を変更したい](#recpriority)
    - [録画重複時のMirakurun優先度を変更したい](#conflictpriority)
    - [データベースへのアクセス回数を減らしたい](#programinsertmax)
    - [データベースへのアクセス速度を落としたい](#programinsertwait)
    - [recordedHistoryRetentionPeriodDays](#recordedhistoryretentionperioddays)
    - [番組情報の更新頻度を変更したい](#reservesupdateintervaltime)
    - [予約情報更新時のログ出力を抑えたい](#suppressreservesupdatealllog)
    - [番組情報更新時のログ出力を抑えたい](#suppressepgupdatelog)
    - [チャンネルの並び順を変更したい](#serviceorder)
    - [特定のチャンネルは除外したい](#excludeservices)
- [ファイル保存先](#ファイル保存先)
    - [録画ファイルの保存先を変更したい](#recorded)
    - [録画ファイルのファイル名を変更したい](#recordedformat)
    - [録画ファイルの拡張子を変更したい](#fileextension)
    - [予約情報データの保存先を変更したい](#reserves)
    - [データベース情報の保存先を変更したい](#dbinfopath)
    - [サムネイル画像の保存先を変更したい](#thumbnail)
    - [サムネイル画像の解像度を変更したい](#thumbnailsize)
    - [サムネイル画像にする動画内の秒数を変更したい](#thumbnailposition)
    - [ファイルアップロード時の一時フォルダを変更したい](#uploadtempdir)
- [外部コマンド実行](#外部コマンド実行)
    - [録画予約時に外部コマンドを実行したい](#reservationaddedcommand)
    - [録画開始の前に外部コマンドを実行したい](#recordedprestartcommand)
    - [録画準備に失敗したら外部コマンドを実行したい](#recordedpreprecfailedcommand)
    - [録画開始時に外部コマンドを実行したい](#recordedstartcommand)
    - [録画終了時に外部コマンドを実行したい](#recordedendcommand)
    - [録画失敗時に外部コマンドを実行したい](#recordedfailedcommand)
    - [録画ファイルを自動でエンコードしたい](#encode)
    - [同時にエンコードを実行する数を制限したい](#maxencode)
    - [エンコード前に外部コマンドを実行したい](#tsmodify)
    - [録画後にデフォルトで元TSファイルを削除するようにしたい](#delts)
    - [録画先の空き容量が一定値を下回った時の動作を変えたい](#storagelimitaction)
    - [録画先の空き容量が一定値を下回ったら外部コマンドを実行したい](#storagelimitcmd)
    - [空き容量のしきい値を変更したい](#storagelimitthreshold)
    - [空き容量の確認頻度を変更したい](#storagelimitcheckintervaltime)
- [視聴設定](#視聴設定)
    - [録画番組の視聴アプリを変えたい](#recordedviewer)
    - [録画番組のダウンロードアプリを変えたい](#recordeddownloader)
    - [同時にライブ視聴できる数を制限したい](#maxstreaming)
    - [ライブ視聴時のMirakurun優先度を変更したい](#streamingpriority)
    - [ライブ視聴時のトランスコード設定を変更したい](#mpegtsstreaming)
    - [ライブ視聴の視聴アプリを変えたい](#mpegtsviewer)
    - [録画番組視聴時のトランスコード設定を変更したい](#recordedstreaming)
    - [HLS配信時の一時ファイルの出力先を変更したい](#streamfilepath)
    - [録画番組のHLS配信時の設定を変更したい](#recordedhls)
    - [ライブ視聴のHLS配信時の設定を変更したい](#livehls)
    - [ライブ視聴のWebM配信時の設定を変更したい](#livewebm)
    - [任意のKodiと連携させたい](#kodihosts)

---

## 基本設定
### readOnlyOnce
#### config.json の読み込みを1度だけに制限する
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| boolean | false | no |
```json
"readOnlyOnce": true
```
### serverPort
#### EPGStationがWebアクセスを待ち受けるポート番号
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number |8888| yes |
```json
"serverPort": 8888
```
### basicAuth
#### BASIC認証の設定
| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| user | string | yes | BASIC認証ログイン時のユーザー名 |
| password | string | yes | BASIC認証ログイン時のパスワード |
```json
"basicAuth": {
    "user": "username",
    "password": "password"
}
```
### mirakurunPath
#### 利用するMirakurunのパスもしくはURL
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string |  | yes |
```json
"mirakurunPath": "http://localhost:40772"
```
### dbType
#### 使用するデータベースの種類
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | mysql | no |
- 値は`mysql` `postgresql` `sqlite3`のいずれか
```json
"dbType": "mysql"
```
### mysql
#### MySQLの接続設定（MySQL使用時は必須）
| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| host | string | yes | MySQLが動作するホスト名 |
| port | number | no | MySQLが待ち受けるポート番号 |
| user | string | yes | DB接続用のユーザー名 |
| password | string | yes | DB接続用のパスワード |
| database | string | yes | 使用するデータベース名 |
| connectTimeout | number | no | 接続タイムアウト時間(ミリ秒) |
| connectionLimit | number | no | 同時接続上限数 |
```json
"mysql": {
    "host": "localhost",
    "port": 3306,
    "user": "username",
    "password": "password",
    "database": "databaseName",
    "connectTimeout": 20000,
    "connectionLimit": 10
} 
```
### postgresql
#### PostgreSQLの接続設定（PostgreSQL使用時は必須）
| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| host | string | yes | PostgreSQLが動作するホスト名 |
| port | number | yes | PostgreSQLが待ち受けるポート番号 |
| user | string | yes | DB接続用のユーザー名 |
| password | string | yes | DB接続用のパスワード |
| database | string | yes | 使用するデータベース名 |
| connectionTimeoutMillis | number | no | 接続タイムアウト時間(ミリ秒) |
| idleTimeoutMillis | number | no | アイドル状態の上限時間(ミリ秒) |
```json
"postgresql": {
    "host": "localhost",
    "port": 3306,
    "user": "username",
    "password": "password",
    "database": "databaseName",
    "connectionTimeoutMillis": 20000,
    "idleTimeoutMillis": 20000
} 
```
### sqlite3
#### SQLite3の接続設定（SQLite3使用時は必須）
| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| extensions | string[] | yes | 読み込む拡張機能のパス |
| regexp | boolean | yes | 正規表現検索の有効化 or 無効化 |
```json
"sqlite3": {
    "extensions": ["/hoge/regexp.so", "/foo/bar.so"],
    "regexp": true
} 
```
### dbPath
#### SQLite3使用時のdbファイルの保存場所
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | data/database.db | no |
```json
"dbPath": "~/hoge/database.db"
```
### ffmpeg
#### EPGStationが利用するFFMpegのパス
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | /usr/local/bin/ffmpeg | no |
```json
"ffmpeg": "/usr/bin/ffmpeg"
```
### ffprobe
#### 動画情報取得に使用するFFProbeのパス
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | /usr/local/bin/ffprobe | no |
```json
"ffprobe": "/usr/bin/ffprobe"
```
### gid
#### EPGStationが利用するグループID・グループ名
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string \| number |  | no |
```json
"gid": "hoge"
```
### uid
#### EPGStationが利用するユーザーID・ユーザー名
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string \| number |  | no |
```json
"uid": "fuga"
```
### subDirectory
#### サブディレクトリ（？）
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string |  | no |
```json
"subDirectory": "./subdir"
```
## 詳細設定
### recPriority
#### 録画時にMirakurunへ渡されるプライオリティ
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 2 | no |
```json
"recPriority": 20
```
### conflictPriority
#### 重複録画時にMirakurunへ渡されるプライオリティ
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 1 | no |
- 後から録画が開始される番組に適用される
```json
"conflictPriority": 10
```
### programInsertMax
#### DBへ番組情報を挿入するときの1回あたりの件数
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 10 | no |
- 1～10で指定可能
```json
"programInsertMax": 5
```
### programInsertWait
#### DBへ番組情報を挿入するときの1回あたりの待機時間
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 0 | no |
```json
"programInsertWait": 0
```
### recordedHistoryRetentionPeriodDays
#### ルール予約時の番組名を保存しておく期間
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 30 | no |
```json
"recordedHistoryRetentionPeriodDays": 90
```
### reservesUpdateIntervalTime
#### 予約情報を更新する時間の間隔 (分)
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 10 | no |
```json
"reservesUpdateIntervalTime": 15
```
### suppressReservesUpdateAllLog
#### 予約情報更新時のログ出力を抑えるか
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| boolean | false | no |
```json
"suppressReservesUpdateAllLog": true
```
### suppressEPGUpdateLog
#### EPG情報更新時のログ出力を抑えるか
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| boolean | false | no |
```json
"suppressEPGUpdateLog": true
```
### serviceOrder
#### チャンネルの並び順を指定
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number[] |  | no |
- `(Mirakurun URL)/api/services`で確認できるサービスIDを入力
```json
"serviceOrder": [1024, 1032, 1040, 1048, 1056, 1064, 1072]
```
### excludeServices
#### 除外するチャンネルを指定
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number[] |  | no |
- `(Mirakurun URL)/api/services`で確認できるサービスIDを入力
```json
"excludeServices": [1088, 23608]
```
## ファイル保存先
### recorded
#### 録画ファイルの保存先
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | recorded | no |
- フルパスで指定する
```json
"recorded": "/mnt/hoge/fuga"
```
### recordedFormat
#### 録画ファイルのファイル名テンプレート
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | %YEAR%年%MONTH%月%DAY%日%HOUR%時%MIN%分%SEC%秒-%TITLE% | no |
- 使用可能な変数は以下の通り

| 変数名 | 説明 | 変数名 | 説明 |
| -------- | --- | -------- | --- |
| %YEAR% | 年 | %SHORTYEAR% | 年 (下２桁) |
| %MONTH% | 月 | %DAY% | 日付 |
| %HOUR% | 時 | %MIN% | 分 |
| %SEC% | 秒 | %DOW% | 曜日 |
| %TYPE% | "GR" \| "BS" \| "CS" \| "SKY" | %CHID% | channel ID |
| %CHNAME% | チャンネル名 | %CH% | チャンネル番号 |
| %SID% | サービスID | %ID% | program id |
| %TITLE% | 番組タイトル |  |  |
```json
"recordedFormat": "%TITLE% [%CHNAME%] %YEAR%年%MONTH%月%DAY%日(%DOW%曜日)"
```
### fileExtension
#### 録画ファイルの拡張子
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | .ts | no |
- MPEG2-TSの拡張子は`.ts` `.mts` `.m2t` `.m2ts`のいずれかが望ましい
```json
"fileExtension": ".m2ts"
```
### reserves
#### 録画予約情報(reserves.json)の保存場所
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | data/reserves.json | no |
- フルパスで指定する
```json
"reserves": "~/hoge/reserves.json"
```
### dbInfoPath
#### データベース情報(dbinfo.json)の保存場所
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | data/dbinfo.json | no |
```json
"dbInfoPath": "~/hoge/dbinfo.json"
```
### thumbnail
#### サムネイル画像ファイルの保存先
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | thumbnail | no |
```json
"thumbnail": "/mnt/hoge/thumbs"
```
### thumbnailSize
#### サムネイル画像の解像度
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | 480x270 | no |
- 横解像度x縦解像度で記載する（xは小文字のエックス）
```json
"thumbnailSize": "320x180"
```
### thumbnailPosition
#### サムネイル画像を生成する再生時間（秒）
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 5 | no |
```json
"thumbnailPosition": 30
```
### uploadTempDir
#### ファイルアップロード時の利用する一時領域
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | data/upload | no |
```json
"uploadTempDir": "/tmp/upload"
```
## 外部コマンド実行
### reservationAddedCommand
#### 録画予約の新規追加時に実行されるコマンド
### recordedPreStartCommand
#### 録画準備の開始時に実行されるコマンド
### recordedPrepRecFailedCommand
#### 録画準備の失敗時に実行されるコマンド
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string |  | no |
- 実行時に渡される環境変数は以下の通り

| 変数名 | 種類 | 説明 |
| -------- | --- | ---- |
| PROGRAMID | number | program id |
| CHANNELTYPE | string | 'GR' \| 'BS' \| 'CS' \| 'SKY' |
| CHANNELID | number | channel id |
| CHANNELNAME | string \| null | 放送局名 |
| STARTAT | number | 開始時刻 (UNIX time) |
| ENDAT | number | 終了時刻 (UNIX time) |
| DURATION | number | 長さ (ms) |
| NAME | string | 番組名 |
| DESCRIPTION | string \| null | 番組概要 |
| EXTENDED | string \| null | 番組詳細 |
```json
"reservationAddedCommand": "/bin/node /home/hoge/fuga.js reserve",
"recordedPreStartCommand": "/bin/bash /home/hoge/foo.sh prestart",
"recordedPrepRecFailedCommand": "/usr/bin/logger prepfailed"
```
### recordedStartCommand
#### 録画開始時に実行するコマンド
### recordedEndCommand
#### 録画終了時に実行するコマンド
### recordedFailedCommand
#### 録画中のエラー発生時に実行するコマンド
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string |  | no |
- 実行時に渡される環境変数は以下の通り

| 変数名 | 種類 | 説明 |
| -------- | --- | ---- |
| RECORDEDID | number | recorded id |
| PROGRAMID | number | program id |
| CHANNELTYPE | string | 'GR' \| 'BS' \| 'CS' \| 'SKY' |
| CHANNELID | number | channel id |
| CHANNELNAME | string \| null | 放送局名 |
| STARTAT | number | 開始時刻 (UNIX time) |
| ENDAT | number | 終了時刻 (UNIX time) |
| DURATION | number | 長さ (ms) |
| NAME | string | 番組名 |
| DESCRIPTION | string \| null | 番組概要 |
| EXTENDED | string \| null | 番組詳細 |
| RECPATH | string | 録画ファイルのフルパス |
```json
"recordedStartCommand": "/bin/node /home/hoge/fuga.js start",
"recordedEndCommand": "/bin/bash /home/hoge/foo.sh end",
"recordedFailedCommand": "/usr/bin/logger recfailed"
```
### encode
#### エンコード設定
| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| name | string | yes | Webインターフェイス上で表示される名称 |
| cmd | string | yes | 実行するコマンド |
| suffix | string | no | 出力ファイルに付加される拡張子 |
| rate | number | no | 録画時間*rate後にタイムアウトする(デフォルト値は4.0) |
| default | boolean | no | 手動予約時のデフォルトに設定するか |
- `suffix` を空欄にした場合、非エンコードコマンドとして実行される
- `cmd` 内で置換される変数は以下の通り

| 変数名 | 説明 |
| -------- | --- |
| %INPUT% | 入力ファイルパス |
| %OUTPUT% | 出力ファイルパス |
| %ROOT% | EPGStation の root パス |

- 実行時に渡される環境変数は以下の通り

| 変数名 | 種類 | 説明 |
| -------- | --- | ---- |
| RECORDEDID | number | recorded id |
| INPUT | string | 入力ファイルパス |
| OUTPUT | string | 出力ファイルパス |
| FFMPEG | string | ffmpeg パス |
| DIR | string | 予約時に設定した directory 文字列 |
| NAME | string | 番組名 |
| DESCRIPTION | string \| null | 番組概要 |
| EXTENDED | string \| null | 番組詳細 |
| VIDEOTYPE | string \| null | "mpeg2" \| "h.264" \| "h.265" |
| VIDEORESOLUTION | string \| null | "240p" \| "480i" \| "480p" \| "720p" \| "1080i" \| "2160p" \| "4320p" | null |
| VIDEOSTREAMCONTENT | number \| null | video streamType |
| VIDEOCOMPONENTTYPE | number \| null | video componentType |
| AUDIOSAMPLINGRATE | number \| null | 16000 \| 22050 \| 24000 \|  32000 \| 44100 \| 48000 |
| AUDIOCOMPONENTTYPE | number \| null | audio componentType|
| CHANNELID | number | channelId mirakurun:40772/api/services で id を確認できる |
| GENRE1 | number | genre1 |
| GENRE2 | number | genre2 |
```json
"encode": [
        {
            "name": "H264",
            "cmd": "node %ROOT%/config/enc.js main",
            "suffix": ".mp4",
            "rate": 10.0
            "default": false
        },
        {
            "name": "checkts",
            "cmd": "/usr/local/bin/tsselect %INPUT%",
            "default": true
        }
    ],
```
### maxEncode
#### 同時に実行されるエンコードプロセスの上限数
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 0 | no |
```json
"maxEncode": 3
```
### tsModify
#### TSを直接加工するときの処理
| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| cmd | string | yes | 実行するコマンド |
| rate | number | no | 録画時間*rate後にタイムアウトする(デフォルト値は4.0) |
- encodeコマンドより前に実行される
- 置換される変数、渡される環境変数はencodeと同じもの
- maxEncodeを1以上に設定すること
```json
"tsModify": {
    "cmd": "node %ROOT%/config/hoge.js fuga %INPUT%",
    "rate": 2.0
}
```
### delts
#### 手動予約時の「TS削除」チェックボックスのデフォルト設定
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| boolean | false | no |
```json
"delts": true
```
### storageLimitAction
#### ストレージ空き容量が限界閾値を超えたときの動作 
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | none | no |
- `none`もしくは`remove`のみ
- `remove`設定時、最も古い録画ファイルから削除される
```json
"storageLimitAction": "remove"
```
### storageLimitCmd
#### ストレージ空き容量が限界閾値を超えたときに実行するコマンド
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string |  | no |
```json
"storageLimitCmd": "node /home/hoge/fuga.sh"
```
### storageLimitThreshold
#### ストレージ空き容量限界閾値 (MB)
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 0 | no |
```json
"storageLimitThreshold": 1000
```
### storageLimitCheckIntervalTime
#### ストレージの空き容量をチェックする間隔 (秒)
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 60 | no |
```json
"storageLimitCheckIntervalTime": 120
```
## 視聴設定
### recordedViewer
#### 録画済み番組を視聴するときのアプリ設定
| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| ios | string | no | 実行するコマンド |
| android | string | no | 実行するコマンド |
| mac | string | no | 実行するコマンド |
| win | string | no | 実行するコマンド |
```json
"recordedViewer": {
        "ios": "infuse://x-callback-url/play?url=http://ADDRESS",
        "android": "intent://ADDRESS#Intent;package=com.mxtech.videoplayer.ad;type=video;scheme=http;end"
    }
```
### recordedDownloader
#### 録画済み番組をダウンロードするときのアプリ設定
| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| ios | string | no | iOSでの録画ファイルのダウンロード設定 |
| android | string | no | Androidでの録画ファイルのダウンロード設定 |
| mac | string | no | MacでのURL Scheme設定 |
| win | string | no | WindowsでのURL Scheme設定 |
```json
"recordedDownloader": {
        "ios": "vlc-x-callback://x-callback-url/download?url=http://ADDRESS&filename=FILENAME",
        "android": "intent://ADDRESS#Intent;package=com.dv.adm;type=video;scheme=http;end"
    }
```
### maxStreaming
#### ストリーミング配信の同時配信数の上限
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 0 | no |
- `0`でチューナーと同じ数
```json
"maxStreaming": 1
```
### streamingPriority
#### ストリーミング配信時にMirakurunへ渡されるプライオリティ値
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 0 | no |
- `0`で録画時と同じ値
```json
"streamingPriority": 50
```
### mpegTsStreaming
#### ライブ視聴時のトランスコード設定
| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| name | string | yes | Webインターフェイス上で表示される名前 |
| cmd | string | no | エンコードコマンド |
- `cmd`が指定されない場合は無変換配信
- `cmd`で置換される変数は以下の通り

| 変数名 | 説明 |
| -------- | --- |
| %FFMPEG% | EPGStationが利用しているffmpegのパス |
```json
"mpegTsStreaming": [
        {
            "name": "720x480(libx264)",
            "cmd": "%FFMPEG% -re -dual_mono_mode main -i pipe:0 -c:a copy -c:v libx264 -s 720x480 -sws_flags area -vf yadif -preset ultrafast -tune fastdecode,zerolatency -movflags faststart -aspect 16:9 -vb 1000k -f mpegts pipe:1"
        },
        {
            "name": "無変換"
        }
    ],
```
### mpegTsViewer
#### ライブ視聴時のアプリ設定
| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| ios | string | no | iOSでのライブ視聴アプリの設定 |
| android | string | no | Androidでのライブ視聴アプリの設定 |
| mac | string | no | MacでのURL Scheme設定 |
| win | string | no | WindowsでのURL Scheme設定 |
- 設定内で置換される変数は以下の通り

| 変数名 | 説明 |
| -------- | --- |
| %ADDRESS% | EPGStationのMPEG-TS配信URL |
| %FILENAME% | 出力されるファイル名 |
```json
"mpegTsViewer": {
        "ios": "vlc-x-callback://x-callback-url/stream?url=http://ADDRESS",
        "android": "intent://ADDRESS#Intent;package=com.mxtech.videoplayer.ad;type=video;scheme=http;end"
    },
```
### recordedStreaming
#### 録画済み番組視聴時のトランスコード設定
| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| webm | 孫プロパティ[] | no | webm配信時の設定 |
| mp4 | 孫プロパティ[] | no | mp4配信時の設定 |
| mpegTs | 孫プロパティ[] | no | mpegts配信時の設定 |
- 孫プロパティは以下の通り


| 孫プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| name | string | yes | Webインターフェイス上で表示される名前 |
| cmd | string | yes | エンコードコマンド |
| vb | string | yes | 映像の目標ビットレート |
| ab | string | yes | 音声の目標ビットレート |

- `cmd`で置換される文字列は以下の通り

| 変数名 | 説明 |
| -------- | --- |
| %FFMPEG% | EPGStationが利用しているffmpegのパス |
| %RE% | `-re`オプション |
| %VB% | 映像の目標ビットレート |
| %VBUFFER% | 映像バッファオプション |
| %AB% | 音声の目標ビットレート |
| %ABUFFER% | 音声バッファオプション |
```json
"recordedStreaming": {
    "webm": [
        {
            "name": "WebM Stream",
             "cmd": "%FFMPEG% %RE% -i pipe:0 -c:a copy -c:v libx264 -s 720x480 -aspect 16:9 -vb %VB% -f webm pipe:1",
            "vb": "3000k",
            "ab": "128k"
        },
        {
            "name": "WebM 2",
            .....
        }
    ],
    "mp4": [
        {
            "name": "hogehoge",
            .....
        }
    ],
    "mpegTs": [
        {
            "name": "fugafuga",
            .....
        }
    ]
}
```
### streamFilePath
#### HLS配信時に使用される一時領域
| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | data/streamfiles | no |
```json
"streamFilePath": "/tmp/hlsfile"
```
### recordedHLS
#### 録画済みファイルをHLS配信するときに使用するオプション
### liveHLS
#### ライブ視聴をHLS配信するときに使用するオプション
### liveWebM
#### ライブ視聴をWebM配信するときに使用するオプション
| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| name | string | yes | Webインターフェイス上で表示される名前 |
| cmd | string | yes | エンコードコマンド |
- 設定内で置換される変数は以下の通り

| 変数名 | 説明 |
| -------- | --- |
| %FFMPEG% | EPGStationが利用しているffmpegのパス |
| %streamFileDir% | `streamFilePath`で指定したパス名 |
| %streamNum% | 一時ファイルのストリーム番号 |
```json
"recordedHLS": [
        {
            "name": "1280x720(main)",
            "cmd": "%FFMPEG% -dual_mono_mode main -i %INPUT% -f hls -hls_time 3 -hls_list_size 0 -hls_allow_cache 1 -hls_segment_filename %streamFileDir%/stream%streamNum%-%09d.ts -threads auto -c:a aac -ar 48000 -ab 192k -ac 2 -c:v libx264 -s 1280x720 -preset veryfast -aspect 16:9 -vb 3000k -flags +loop-global_header %OUTPUT%"
        },
        {
            "name": "720x480(main)",
            "cmd": "%FFMPEG% -dual_mono_mode main -i %INPUT% -f hls -hls_time 3 -hls_list_size 0 -hls_allow_cache 1 -hls_segment_filename %streamFileDir%/stream%streamNum%-%09d.ts -threads auto -c:a aac -ar 48000 -ab 128k -ac 2 -c:v libx264 -s 720x480 -preset veryfast -aspect 16:9 -vb 1500k -flags +loop-global_header %OUTPUT%"
        }
    ]
```
### kodiHosts
#### kodiへの配信時に使用するオプション
| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| name | string | yes | Webインターフェイス上で表示される名前 |
| host | string | yes | kodiが動作しているホストのURL |
| user | string | no | kodiのユーザー名 |
| pass | string | no | kodiのパスワード |
```json
"kodiHosts": [
    {
        "name": "Kodi host 1",
        "host": "http://192.168.1.1:8080",
        "user": "hogehoge",
        "pass": "fugafuga"
    }, 
    {
        "name": "Kodi host 2",
        "host": "http://192.168.1.2:8080"
    }
]
```