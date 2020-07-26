# config.json 詳細マニュアル
## コンフィグ逆引きレシピ
- [基本設定](#基本設定)
    - [config.json の読み込みを起動時だけにしたい](#readonlyonce)
    - [EPGStation の待ち受けポートを変えたい](#serverport)
    - [EPGStation の Socket.IO 待ち受けポートを変えたい](#socketioport)
    - [クライアントが接続に使用する Socket.IO ポートを変えたい](#clientsocketioport)
    - [アクセス時にユーザー認証を行いたい](#basicauth)
    - [Mirakurun の設定](#mirakurunpath)
    - [データベースの種類を変えたい](#dbtype)
    - [MySQL の設定を変更したい](#mysql)
    - [PostgreSQL の設定を変更したい](#postgresql)
    - [SQLite3 の設定を変更したい](#sqlite3)
    - [SQLite3 のデータベース保存先を変更したい](#dbpath)
    - [番組名や概要に含まれる英数字記号を半角や全角に変換したい](#convertdbstr)
    - [利用する FFmpeg を明示的に指定したい](#ffmpeg)
    - [利用する FFprobe を明示的に指定したい](#ffprobe)
- [詳細設定](#詳細設定)
    - [録画時の Mirakurun の優先度を変更したい](#recpriority)
    - [録画競合時の Mirakurun の優先度を変更したい](#conflictpriority)
    - [チューナの使用状況に応じて番組末尾が切れることを許可する](#allowendlack)
    - [時刻指定予約時の開始マージンを変更したい](#timespecifiedstartmargin)
    - [時刻指定予約時の終了マージンを変更したい](#timespecifiedendmargin)
    - [番組情報を DB へ保存する際の負荷を抑えたい](#programinsertmax)
    - [番組情報を DB へ保存する際のスリープ設定を変更したい](#programinsertwait)
    - [録画重複の判定期間を延ばしたい](#recordedhistoryretentionperioddays)
    - [番組情報の更新頻度を変更したい](#reservesupdateintervaltime)
    - [予約情報更新時のログ出力を抑えたい](#suppressreservesupdatealllog)
    - [番組情報更新時のログ出力を抑えたい](#suppressepgupdatelog)
    - [チャンネルの並び順を変更したい](#serviceorder)
    - [チャンネルの並び順を変更したい(sid)](#servicesidorder)
    - [特定のチャンネルは除外したい](#excludeservices)
    - [特定のチャンネルは除外したい(sid)](#excludesid)
    - [自動起動時の GID を指定したい](#gid)
    - [自動起動時の UID を指定したい](#uid)
    - [録画時にドロップチェックを有効化したい](#isenableddropcheck)
    - [アクセス URL の設定をルートではなくサブディレクトリ下に変更したい](#subdirectory)
    - [番組検索結果の表示上限件数を変更したい](#searchLimit)
- [ファイル保存先](#ファイル保存先)
    - [録画ファイルの保存先を変更したい](#recorded)
    - [一時録画先を設定したい](#recordedtmp)
    - [簡易手動予約時のデフォルトディレクトリを設定したい](#recordedtsdefaultdirectory)
    - [簡易手動予約時のエンコードファイルのデフォルトディレクトリを設定したい](#recordedencodedefaultdirectory)
    - [録画ファイルのファイル名を変更したい](#recordedformat)
    - [録画ファイルの拡張子を変更したい](#fileextension)
    - [予約情報データの保存先を変更したい](#reserves)
    - [データベースリビジョン情報の保存先を変更したい](#dbinfopath)
    - [サムネイル画像の保存先を変更したい](#thumbnail)
    - [サムネイル生成コマンドを変更したい](#thumbnailcmd)
    - [サムネイル画像の解像度を変更したい](#thumbnailsize)
    - [サムネイル画像を生成する再生位置を変更したい](#thumbnailposition)
    - [ドロップチェック時に生成される .log ファイルの保存先を変更したい](#dropchecklogdir)
    - [ファイルアップロード時の一時フォルダを変更したい](#uploadtempdir)
- [外部コマンド実行](#外部コマンド実行)
    - [録画予約時に外部コマンドを実行したい](#reservationaddedcommand)
    - [録画開始前に外部コマンドを実行したい](#recordedprestartcommand)
    - [録画準備に失敗したら外部コマンドを実行したい](#recordedpreprecfailedcommand)
    - [録画開始時に外部コマンドを実行したい](#recordedstartcommand)
    - [録画終了時に外部コマンドを実行したい](#recordedendcommand)
    - [録画失敗時に外部コマンドを実行したい](#recordedfailedcommand)
    - [録画ファイルを自動でエンコードしたい](#encode)
    - [エンコード (トランスコード) プロセスの最大実行数を変更したい](#maxencode)
    - [エンコード前に外部コマンドを実行したい](#tsmodify)
    - [手動録画のエンコード完了後にデフォルトで元 TS ファイルを削除するようにしたい](#delts)
    - [録画先の空き容量が一定値を下回った時の動作を変えたい](#storagelimitaction)
    - [録画先の空き容量が一定値を下回ったら外部コマンドを実行したい](#storagelimitcmd)
    - [空き容量のしきい値を変更したい](#storagelimitthreshold)
    - [空き容量の確認頻度を変更したい](#storagelimitcheckintervaltime)
- [視聴設定](#視聴設定)
    - [ライブ視聴の視聴アプリを変えたい](#mpegtsviewer)
    - [録画番組の視聴アプリを変えたい](#recordedviewer)
    - [録画番組のダウンロードアプリを変えたい](#recordeddownloader)
    - [HLS 配信時に外部視聴アプリを設定したい](#hlsviewer)
    - [同時にライブ視聴できる数を制限したい](#maxstreaming)
    - [ライブ視聴時の Mirakurun の優先度を変更したい](#streamingpriority)
    - [ライブ視聴時のトランスコード設定を変更したい](#mpegtsstreaming)
    - [録画番組視聴時のトランスコード設定を変更したい](#recordedstreaming)
    - [HLS 配信時の一時ファイルの出力先を変更したい](#streamfilepath)
    - [録画番組の HLS 配信時の設定を変更したい](#recordedhls)
    - [ライブ視聴の HLS 配信時の設定を変更したい](#livehls)
    - [ライブ視聴の WebM 配信時の設定を変更したい](#livewebm)
    - [任意の Kodi と連携させたい](#kodihosts)

---

## 基本設定
### readOnlyOnce
#### config.json の読み込みを起動時の 1 度だけに制限する

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| boolean | false | no |

- デフォルトでは、エンコードコマンド実行時などにコンフィグファイルを読み込み直す

```json
"readOnlyOnce": true
```

### serverPort
#### EPGStation が Web アクセスを待ち受けるポート番号

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 8888 | yes |

```json
"serverPort": 8888
```

### socketioPort
#### EPGStation が Socket.IO アクセスを待ち受けるポート番号

serverPort と同じポート番号を設定しても良い

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | serverPort + 1 | no |

```json
"socketioPort": 8889
```

### clientSocketioPort
### EPGStation の Web クライアントが接続する Socket.IO のポート番号

リバースプロキシを使用している場合は必須となる

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | serverPort + 1 | no |

```json
"clientSocketioPort": 8889
```

### basicAuth
#### BASIC 認証の設定

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| {} | - | no |

- 子プロパティは以下の通り

| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| user | string | yes | BASIC 認証ログイン時のユーザー名 |
| password | string | yes | BASIC 認証ログイン時のパスワード |

```json
"basicAuth": {
    "user": "username",
    "password": "password"
}
```

### mirakurunPath
#### 利用する Mirakurun のパスもしくはURL

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | - | yes |

```json
"mirakurunPath": "http://localhost:40772"
```

### dbType
#### 使用するデータベースの種類

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | mysql | no |

- 値は `mysql` `postgresql` `sqlite3` のいずれか

```json
"dbType": "mysql"
```

### mysql
#### MySQL の接続設定（MySQL 使用時は必須）

| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| host | string | yes | MySQL が動作するホスト名 |
| port | number | no | MySQL が待ち受けるポート番号 |
| user | string | yes | DB 接続用のユーザー名 |
| password | string | yes | DB 接続用のパスワード |
| database | string | yes | 使用するデータベース名 |
| connectTimeout | number | no | 接続タイムアウト時間 (ミリ秒) |
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
#### PostgreSQL の接続設定（PostgreSQL 使用時は必須）

| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| host | string | yes | PostgreSQL が動作するホスト名 |
| port | number | yes | PostgreSQL が待ち受けるポート番号 |
| user | string | yes | DB 接続用のユーザー名 |
| password | string | yes | DB 接続用のパスワード |
| database | string | yes | 使用するデータベース名 |
| connectionTimeoutMillis | number | no | 接続タイムアウト時間 (ミリ秒) |
| idleTimeoutMillis | number | no | アイドル状態の上限時間 (ミリ秒) |

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
#### SQLite3 の接続設定（SQLite3 使用時は必須）

| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| extensions | string[] | yes | 読み込む拡張機能のパス |
| regexp | boolean | yes | 正規表現検索の有効化 or 無効化 |

```json
"sqlite3": {
    "extensions": ["/hoge/regexp.so"],
    "regexp": true
} 
```

### dbPath
#### SQLite3 使用時の db ファイルの保存場所

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | data/database.db | no |

```json
"dbPath": "/hoge/database.db"
```

### convertDBStr
#### 番組名や概要などに含まれる英数字記号の変換方式

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | - | no |

- "no": 英数字記号を変換しない **(非推奨設定)**
- "twoByte": 英数字記号を全角に変換
- "oneByte" or その他（未定義の場合も同様）: 英数字記号を半角に変換
- "oneByteWithCH": チャンネル名も含めて英数字記号を半角に変換

**変更後は ```npm run convert-str``` を実行して録画済み一覧を検索可能にすること。**

**"no" を設定した場合はエラーとなるので注意**

```json
"convertDBStr": "twoByte"
```


### ffmpeg
#### EPGStation が利用する FFmpeg のパス

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | /usr/local/bin/ffmpeg | no |

```json
"ffmpeg": "/usr/bin/ffmpeg"
```

### ffprobe
#### 動画情報取得に使用する FFprobe のパス

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | /usr/local/bin/ffprobe | no |

```json
"ffprobe": "/usr/bin/ffprobe"
```

## 詳細設定
### recPriority
#### 録画時に Mirakurun へ渡されるプライオリティ

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 2 | no |

```json
"recPriority": 20
```

### conflictPriority
#### 競合録画時に Mirakurun へ渡されるプライオリティ

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 1 | no |

- 予約が競合する番組に適用される

```json
"conflictPriority": 10
```

### allowEndLack
#### チューナの使用状況に応じて番組末尾が切れることを許可する

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| boolean | true | no |

- [#190](https://github.com/l3tnun/EPGStation/issues/190)
- false にすると番組冒頭の頭切れが発生する

```json
"allowEndLack": true
```

### timeSpecifiedStartMargin
#### 手動予約時の開始マージン(秒)

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 1 | no |

### timeSpecifiedEndMargin
#### 手動予約時の終了マージン(秒)

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 1 | no |

### programInsertMax
#### DB へ番組情報を挿入するときの 1 回あたりの件数

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 10 | no |

- 1 ～ 10 で指定可能

```json
"programInsertMax": 5
```

### programInsertWait
#### DB へ番組情報を挿入するときの 1 回あたりの待機時間

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 0 | no |

```json
"programInsertWait": 0
```

### recordedHistoryRetentionPeriodDays
#### 重複確認用に使用する番組名を保管する期間

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
| number[] | - | no |

- `http://<MirakurunAddress:port>/api/services` もしくは `http://<EPGStationAddress:port>/api/channels` で確認できる id を入力

```json
"serviceOrder": [3273601024, 3273701032, 3273801040, 3274101064, 3273901048, 3274201072, 3274001056]
```

### serviceSidOrder
#### sid でチャンネルの並び順を指定

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number[] | - | no |

- `http://<MirakurunAddress:port>/api/services` もしくは `http://<EPGStationAddress:port>/api/channels` で確認できる serviceId を入力

**serviceOrder が存在する場合はそちらが優先されるため注意**

```json
"serviceSidOrder": [1024, 1032, 1040, 1064, 1048, 1072, 1056]
```

### excludeServices
#### 除外するチャンネルを指定

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number[] | - | no |

- `http://<MirakurunAddress:port>/api/services` もしくは `http://<EPGStationAddress:port>/api/channels` で確認できる id を入力

```json
"excludeServices": [3239123608, 400231]
```

### excludeSid
#### sid で除外するチャンネルを指定

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number[] |  | no |

- `http://<MirakurunAddress:port>/api/services` もしくは `http://<EPGStationAddress:port>/api/channels` で確認できる serviceId を入力

```json
"excludeSid": [23608, 231]
```

### gid
#### EPGStation が利用するグループ ID or グループ名

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string \| number | - | no |

```json
"gid": "hoge"
```

### uid
#### EPGStation が利用するユーザー ID or ユーザー名

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string \| number | - | no |

```json
"uid": "fuga"
```

### isEnabledDropCheck
#### 録画時のドロップチェックを有効化する

| 種類 | デフォルト値 | 必須|
| --- | ---------- | --- |
| boolean | false | no |

```json
"isEnabledDropCheck": true
```

### subDirectory
#### サブディレクトリとして動作させる (リバースプロキシ利用時を想定)

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | - | no |

- `http://<IPaddress>:<Port>/<subDirectory>`として動作する

```json
"subDirectory": "subdir"
```

### searchLimit
#### 番組検索結果の表示上限数を指定する

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 300 | no |

```json
"searchLimit": 500
```

## ファイル保存先
### recorded
#### 録画ファイルの保存先

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | recorded | no |

- フルパスで指定する

```json
"recorded": "/hoge/fuga"
```

## 一時録画先
### recordedTmp
#### 録画ファイルの一時保存先

録画が完了したら recorded で指定したディレクトリへ移動する

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | - | no |

- フルパスで指定する

```json
"recordedTmp": "/hoge/fuga"
```

## 簡易手動予約時のデフォルトディレクトリ
### recordedTSDefaultDirectory
### 簡易手動予約時のデフォルトディレクトリ設定

WebUIでの簡易予約時に設定される TS ファイルのディレクトリ設定

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | - | no |

```json
"recordedTSDefaultDirectory": "hoge"
```

## 簡易手動予約時のエンコードファイルのデフォルトディレクトリ
### recordedEncodeDefaultDirectory
### 簡易手動予約時のエンコードファイルのデフォルトディレクトリ設定

WebUIでの簡易予約時に設定されるエンコードファイルのディレクトリ設定

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | - | no |

```json
"recordedEncodeDefaultDirectory": "hoge"
```

### recordedFormat
#### 録画ファイルのファイル名テンプレート

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | %YEAR%年%MONTH%月%DAY%日%HOUR%時%MIN%分%SEC%秒-%TITLE% | no |

- 使用可能な変数は以下の通り

| 変数名 | 説明 |
| -------- | --- |
| %YEAR% | 年 |
| %SHORTYEAR% | 年 (下２桁) |
| %MONTH% | 月 |
| %DAY% | 日付 |
| %HOUR% | 時 |
| %MIN% | 分 |
| %SEC% | 秒 |
| %DOW% | 曜日 |
| %TYPE% | "GR" \| "BS" \| "CS" \| "SKY" |
| %CHID% | Channel ID |
| %CHNAME% | チャンネル名 |
| %CH% | チャンネル番号 |
| %SID% | サービスID |
| %ID% | Program ID |
| %TITLE% | 番組タイトル |

```json
"recordedFormat": "%TITLE% [%CHNAME%] %YEAR%年%MONTH%月%DAY%日(%DOW%曜日)"
```

### fileExtension
#### 録画ファイルの拡張子

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | .ts | no |

- MPEG2-TSの拡張子は`.ts` `.mts` `.m2t` `.m2ts`のいずれかが望ましい
- ピリオド`.`を付け忘れないように

```json
"fileExtension": ".m2ts"
```

### reserves
#### 録画予約情報 (reserves.json) の保存場所

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | data/reserves.json | no |

- フルパスで指定する

```json
"reserves": "/hoge/reserves.json"
```

### dbInfoPath
#### データベースリビジョン情報 (dbinfo.json) の保存場所

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | data/dbinfo.json | no |

```json
"dbInfoPath": "/hoge/dbinfo.json"
```

### thumbnail
#### サムネイル画像ファイルの保存先

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | thumbnail | no |

```json
"thumbnail": "/hoge/thumbs"
```

### thumbnailCmd
#### サムネイル生成コマンド設定


| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | %FFMPEG% -ss %THUMBNAIL\_POSITION% -y -i %INPUT% -vframes 1 -f image2 -s %THUMBNAIL\_SIZE% %OUTPUT% | no |


- 置換される変数は以下の通り

| 変数名 | 説明 |
| -------- | --- |
| %FFMPEG% | ffmpegのファイルパス |
| %INPUT% | 入力ファイルパス |
| %OUTPUT% | 出力ファイルパス |
| %THUMBNAIL\_POSITION% | サムネイル生成位置(秒) |
| %THUMBNAIL\_SIZE% | サムネイルサイズ |

```json
"thumbnail": "/hoge/thumbs"
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
#### サムネイル画像を生成する再生位置（秒）

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 5 | no |

```json
"thumbnailPosition": 30
```

### dropCheckLogDir
#### ドロップチェック時に生成される .log ファイルの保存先

| 種類 | デフォルト値 | 必須|
| --- | ---------- | --- |
| string | - | no |

- フルパスで指定する
- dropCheckLogDir を指定する以前の .log ファイルが存在する場合は ```npm run move-log``` を実行すること

```json
"dropCheckLogDir": "/hoge/fuga",
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
| string | - | no |

- 実行時に渡される環境変数は以下の通り

| 変数名 | 種類 | 説明 |
| -------- | --- | ---- |
| PROGRAMID | number | Program ID |
| CHANNELTYPE | string | 'GR' \| 'BS' \| 'CS' \| 'SKY' |
| CHANNELID | number | Channel ID |
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
| string | - | no |

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
| LOGPATH | string\| null | ログファイルのフルパス |

```json
"recordedStartCommand": "/bin/node /home/hoge/fuga.js start",
"recordedEndCommand": "/bin/bash /home/hoge/foo.sh end",
"recordedFailedCommand": "/usr/bin/logger recfailed"
```

### encode
#### エンコード設定

| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| name | string | yes | Web インターフェイス上で表示される名称 |
| cmd | string | yes | 実行するコマンド |
| suffix | string | no | 出力ファイルに付加される拡張子 |
| rate | number | no | 録画時間 * rate 後にタイムアウトする ( デフォルト値は 4.0 ) |
| default | boolean | no | 手動予約時のデフォルトに設定するか |

- `suffix` を空欄にした場合、非エンコードコマンドとして実行される
- `cmd` 内で置換される変数は以下の通り

| 変数名 | 説明 |
| -------- | --- |
| %NODE% | nodeのファイルパス |
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
| CHANNELID | number | ChannelId mirakurun:40772/api/services で ID を確認できる |
| GENRE1 | number | genre1 |
| GENRE2 | number | genre2 |
| GENRE3 | number | genre3 |
| GENRE4 | number | genre4 |
| GENRE5 | number | genre5 |
| GENRE6 | number | genre6 |
| logPath | string \| null | ドロップ情報ログファイルパス |
| errorCnt | errorCnt \| null | error count |
| dropCnt | errorCnt \| null | drop count |
| scramblingCnt | errorCnt \| null | scrambling count |

```json
"encode": [
        {
            "name": "H264",
            "cmd": "%NODE% %ROOT%/config/enc.js main",
            "suffix": ".mp4",
            "rate": 10.0
        },
        {
            "name": "checkts",
            "cmd": "/usr/local/bin/tsselect %INPUT%",
            "default": true
        }
    ],
```

### maxEncode
#### エンコードやストリーミングで使用されるプロセスの上限数

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
- maxEncode を 1 以上に設定すること

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

- `none` もしくは `remove` のみ
- `remove` 設定時、最も古い録画ファイルから削除される

```json
"storageLimitAction": "remove"
```

### storageLimitCmd
#### ストレージ空き容量が限界閾値を超えたときに実行するコマンド

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| string | - | no |

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
### mpegTsViewer
#### ライブ視聴時のアプリ設定
### recordedViewer
#### 録画済み番組を視聴するときのアプリ設定
### recordedDownloader
#### 録画済み番組をダウンロードするときのアプリ設定
### HLSViewer
#### HLS 配信時に外部アプリで視聴するときのアプリ設定

| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| ios | string | no | iOS での視聴アプリの設定 |
| android | string | no | Android での視聴アプリの設定 |
| mac | string | no | Mac での URL Scheme 設定 |
| win | string | no | Windows での URL Scheme 設定 |

- 設定内で置換される変数は以下の通り

| 変数名 | 説明 |
| -------- | --- |
| ADDRESS | EPGStationのMPEG-TS配信URL |
| FILENAME | 出力されるファイル名 |

```json
"mpegTsViewer": {
    "ios": "vlc-x-callback://x-callback-url/stream?url=http://ADDRESS",
    "android": "intent://ADDRESS#Intent;package=com.mxtech.videoplayer.ad;type=video;scheme=http;end"
},
"recordedViewer": {
    "ios": "infuse://x-callback-url/play?url=http://ADDRESS",
    "android": "intent://ADDRESS#Intent;package=com.mxtech.videoplayer.ad;type=video;scheme=http;end"
},
"recordedDownloader": {
    "ios": "vlc-x-callback://x-callback-url/download?url=http://ADDRESS&filename=FILENAME",
    "android": "intent://ADDRESS#Intent;package=com.dv.adm;type=video;scheme=http;end"
},
"HLSViewer": {
    "ios": "vlc-x-callback://x-callback-url/download?url=http://ADDRESS&filename=FILENAME",
    "android": "intent://ADDRESS#Intent;package=com.dv.adm;type=video;scheme=http;end"
}
```

### maxStreaming
#### ストリーミング配信の同時配信数の上限

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 0 | no |

- `0`もしくは指定なしの場合、ストリーミング配信機能はオフ

```json
"maxStreaming": 1
```

### streamingPriority
#### ストリーミング配信時にMirakurunへ渡されるプライオリティ値

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 0 | no |

- `recPriority` より大きな値を指定した場合、録画が中断される可能性あり

```json
"streamingPriority": 50
```

### mpegTsStreaming
#### ライブ視聴時のトランスコード設定

| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| name | string | yes | Web インターフェイス上で表示される名前 |
| cmd | string | no | エンコードコマンド |

- `cmd` が指定されない場合は無変換配信
- `cmd` で置換される変数は以下の通り

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

### recordedStreaming
#### 録画済み番組視聴時のトランスコード設定

| 子プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| webm | 孫プロパティ[] | no | webm 配信時の設定 |
| mp4 | 孫プロパティ[] | no | mp4 配信時の設定 |
| mpegTs | 孫プロパティ[] | no | mpegts 配信時の設定 |

- 孫プロパティは以下の通り

| 孫プロパティ名 | 種類 | 必須 | 説明 |
| --- | --- | ---------- | --- |
| name | string | yes | Web インターフェイス上で表示される名前 |
| cmd | string | yes | エンコードコマンド |
| vb | string | yes | 映像の目標ビットレート |
| ab | string | yes | 音声の目標ビットレート |

- `cmd` で置換される文字列は以下の通り

| 変数名 | 説明 |
| -------- | --- |
| %FFMPEG% | EPGStation が利用している ffmpeg のパス |
| %RE% | `-re` オプション |
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
            // 以下略
        }
    ],
    "mp4": [
        {
            "name": "hogehoge",
            // 以下略
        }
    ],
    "mpegTs": [
        {
            "name": "fugafuga",
            // 以下略
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
| name | string | yes | Web インターフェイス上で表示される名前 |
| cmd | string | yes | エンコードコマンド |

- 設定内で置換される変数は以下の通り

| 変数名 | 説明 |
| -------- | --- |
| %FFMPEG% | EPGStationが利用している ffmpeg のパス |
| %streamFileDir% | `streamFilePath` で指定したパス名 |
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
