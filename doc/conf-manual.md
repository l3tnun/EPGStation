# config.yml 詳細マニュアル

## コンフィグ逆引きレシピ

-   [基本設定](#基本設定)
    -   [EPGStation の待ち受けポートを変えたい](#port)
    -   [EPGStation の Socket.IO 待ち受けポートを変えたい](#socketioport)
    -   [クライアントが接続に使用する Socket.IO ポートを変えたい](#clientsocketioport)
    -   [Mirakurun の設定](#mirakurunpath)
    -   [データベースの種類を変えたい](#dbtype)
    -   [MySQL の設定を変更したい](#mysql)
    -   [SQLite3 の設定を変更したい](#sqlite)
    -   [利用する FFmpeg を明示的に指定したい](#ffmpeg)
    -   [利用する FFprobe を明示的に指定したい](#ffprobe)
-   [詳細設定](#詳細設定)
    -   [番組情報の囲み文字の設定を変更したい](#needtoreplaceenclosingcharacters)
    -   [録画時の Mirakurun の優先度を変更したい](#recpriority)
    -   [録画競合時の Mirakurun の優先度を変更したい](#conflictpriority)
    -   [時刻指定予約時の開始マージンを変更したい](#timespecifiedstartmargin)
    -   [時刻指定予約時の終了マージンを変更したい](#timespecifiedendmargin)
    -   [録画重複の判定期間を延ばしたい](#recordedhistoryretentionperioddays)
    -   [番組情報の更新頻度を変更したい](#epgupdateintervaltime)
    -   [番組情報更新時のログ出力を抑えたい](#issuppressreservesupdatealllog)
    -   [チャンネルの並び順を変更したい](#channelorder)
    -   [チャンネルの並び順を変更したい(sid)](#sidorder)
    -   [特定のチャンネルは除外したい](#excludechannels)
    -   [特定のチャンネルは除外したい(sid)](#excludesids)
    -   [自動起動時の GID を指定したい](#gid)
    -   [自動起動時の UID を指定したい](#uid)
    -   [録画時にドロップチェックを有効化したい](#isenableddropcheck)
    -   [ドロップログの保存先を変更したい](#dropLog)
    -   [アクセス URL の設定をルートではなくサブディレクトリ下に変更したい](#subdirectory)
    -   [Swagger UI で使用するサーバリストを変更したい](#apiservers)
    -   [CORS ヘッダーをすべて許可したい](#isallowallcors)
-   [ファイル保存先](#ファイル保存先)
    -   [録画ファイルの保存先を変更したい](#recorded)
    -   [一時録画先を設定したい](#recordedtmp)
    -   [録画ファイルのファイル名を変更したい](#recordedformat)
    -   [録画ファイルの拡張子を変更したい](#recordedfileextension)
    -   [空き容量確認頻度を変更したい](#storagelimitcheckintervaltime)
    -   [サムネイル画像の保存先を変更したい](#thumbnail)
    -   [サムネイル生成コマンドを変更したい](#thumbnailcmd)
    -   [サムネイル画像の解像度を変更したい](#thumbnailsize)
    -   [サムネイル画像を生成する再生位置を変更したい](#thumbnailposition)
    -   [ファイルアップロード時の一時フォルダを変更したい](#uploadtempdir)
-   [外部コマンド実行](#外部コマンド実行)
    -   [録画予約新規追加時に外部コマンドを実行したい](#reservenewaddtioncommand)
    -   [録画予約の更新時に外部コマンドを実行したい](#reserveupdatecommand)
    -   [録画予約の削除時に外部コマンドを実行したい](#reservedeletedcommand)
    -   [録画準備開始時に外部コマンドを実行したい](#recordingprestartcommand)
    -   [録画準備失敗時に外部コマンドを実行したい](#recordingpreprecfailedcommand)
    -   [録画開始時に外部コマンドを実行したい](#recordingstartcommand)
    -   [録画終了時に外部コマンドを実行したい](#recordingfinishcommand)
    -   [録画失敗時に外部コマンドを実行したい](#recordingfailedcommand)
    -   [エンコード終了時にコマンドを実行したい](#encodingfinishcommand)
    -   [エンコードやストリーミングで使用するプロセス数の上限を変更したい](#encodeprocessnum)
    -   [同時にエンコードするプロセス数の上限を更新したい](#concurrentencodenum)
    -   [録画ファイルを自動でエンコードしたい](#encode)
-   [視聴設定](#視聴設定)
    -   [ライブ視聴時の Mirakurun の優先度を変更したい](#streamingpriority)
    -   [視聴アプリを変更したい](#urlscheme)
    -   [HLS 配信時の一時ファイルの出力先を変更したい](#streamfilepath)
    -   [ストリーミング視聴の設定を変更したい](#stream)
    -   [任意の Kodi と連携させたい](#kodihosts)

---

## 基本設定

### port

#### EPGStation が http で Web アクセスを待ち受けるポート番号

| 種類   | デフォルト値 | 必須                               |
| ------ | ------------ | ---------------------------------- |
| number | -            | no (※https の設定が無い場合は必須) |

```yaml
port: 8888
```

### socketioPort

#### EPGStation が http で Socket.IO アクセスを待ち受けるポート番号

port と同じポート番号を設定しても良い

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | port と同じ  | no   |

```yaml
socketioPort: 8889
```

### clientSocketioPort

### EPGStation の Web クライアントが接続する Socket.IO のポート番号

リバースプロキシを使用している場合は必須となる

| 種類   | デフォルト値        | 必須 |
| ------ | ------------------- | ---- |
| number | socketioPort と同じ | no   |

```yaml
clientSocketioPort: 8889
```

### https

#### EPGStation が https で Web アクセスを待ち受ける設定

clientSocketioPort とは併用できないので注意

リバースプロキシを使用する場合は使用しないこと

| 子プロパティ名 | 種類   | 必須 | 説明                                     |
| -------------- | ------ | ---- | ---------------------------------------- |
| port           | number | yes  | 待ち受けポート番号                       |
| key            | string | yes  | 秘密鍵のファイルのフルパス               |
| cert           | string | yes  | 証明書のファイルのフルパス               |
| socketioPort   | number | no   | Socket.IO アクセスを待ち受けるポート番号 |

```yaml
https:
    port: 8443
    key: /hoge/huga/server.key
    cert: /hoge/huga/server.crt
    socketioPort: 8444
```

### mirakurunPath

#### 利用する Mirakurun のパスもしくは URL

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| string | -            | yes  |

```yaml
mirakurunPath: 'http://localhost:40772'
```

### dbtype

#### 使用するデータベースの種類

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| string | sqlite       | no   |

-   値は `mysql` `sqlite` のいずれか

```yaml
dbType: mysql
```

### mysql

#### MySQL の接続設定（MySQL 使用時は必須）

| 子プロパティ名 | 種類   | 必須 | 説明                         |
| -------------- | ------ | ---- | ---------------------------- |
| host           | string | yes  | MySQL が動作するホスト名     |
| port           | number | no   | MySQL が待ち受けるポート番号 |
| user           | string | yes  | DB 接続用のユーザー名        |
| password       | string | yes  | DB 接続用のパスワード        |
| database       | string | yes  | 使用するデータベース名       |
| charset        | string | no   | 使用する文字コード           |

```yaml
mysql:
    host: localhost
    port: 3306
    user: username
    password: password
    database: databaseName
```

### sqlite

#### SQLite3 の接続設定

| 子プロパティ名 | 種類     | 必須 | 説明                           |
| -------------- | -------- | ---- | ------------------------------ |
| extensions     | string[] | no   | 読み込む拡張機能のパス         |
| regexp         | boolean  | no   | 正規表現検索の有効化 or 無効化 |

```yaml
sqlite:
    extensions:
        - '/hoge/regexp.so'
    regexp: true
```

### ffmpeg

#### EPGStation が利用する FFmpeg のパス

| 種類   | デフォルト値          | 必須 |
| ------ | --------------------- | ---- |
| string | /usr/local/bin/ffmpeg | no   |

```yaml
ffmpeg: '/usr/bin/ffmpeg'
```

### ffprobe

#### 動画情報取得に使用する FFprobe のパス

| 種類   | デフォルト値           | 必須 |
| ------ | ---------------------- | ---- |
| string | /usr/local/bin/ffprobe | no   |

```yaml
ffprobe: '/usr/bin/ffprobe'
```

---

## 詳細設定

### needToReplaceEnclosingCharacters

#### 番組情報の囲み文字を [] で括った文字に置換するか

| 種類    | デフォルト値 | 必須 |
| ------- | ------------ | ---- |
| boolean | true         | no   |

```yaml
needToReplaceEnclosingCharacters: true
```

### recPriority

#### 録画時に Mirakurun へ渡されるプライオリティ

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 2            | no   |

```yaml
recPriority: 20
```

### conflictPriority

#### 競合録画時に Mirakurun へ渡されるプライオリティ

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 1            | no   |

-   予約が競合する番組に適用される

```yaml
conflictPriority: 10
```

### timeSpecifiedStartMargin

#### 手動予約時の開始マージン(秒)

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 1            | no   |

```yaml
timeSpecifiedStartMargin: 2
```

### timeSpecifiedEndMargin

#### 手動予約時の終了マージン(秒)

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 1            | no   |

```yaml
timeSpecifiedEndMargin: 2
```

### recordedHistoryRetentionPeriodDays

#### 重複確認用に使用する番組名を保管する期間

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 90           | no   |

```yaml
recordedHistoryRetentionPeriodDays: 180
```

### epgUpdateIntervalTime

#### 番組情報を更新する時間の間隔 (分)

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 10           | no   |

```yaml
epgUpdateIntervalTime: 15
```

### isSuppressReservesUpdateAllLog

#### 予約定期更新時のログ出力を抑えるか

| 種類    | デフォルト値 | 必須 |
| ------- | ------------ | ---- |
| boolean | false        | no   |

```yaml
isSuppressReservesUpdateAllLog: true
```

### channelOrder

#### チャンネルの並び順を指定

| 種類     | デフォルト値 | 必須 |
| -------- | ------------ | ---- |
| number[] | -            | no   |

-   `http://<MirakurunAddress:port>/api/services` もしくは `http://<EPGStationAddress:port>/api/channels` で確認できる
    id を入力

```yaml
channelOrder:
    - 3273601024
    - 3273701032
    - 3273801040
    - 3274101064
    - 3273901048
    - 3274201072
    - 3274001056
```

### sidOrder

#### sid でチャンネルの並び順を指定

| 種類     | デフォルト値 | 必須 |
| -------- | ------------ | ---- |
| number[] | -            | no   |

-   `http://<MirakurunAddress:port>/api/services` もしくは `http://<EPGStationAddress:port>/api/channels` で確認できる
    serviceId を入力

**channelOrder が存在する場合はそちらが優先されるため注意**

```yaml
sidOrder:
    - 1024
    - 1032
    - 1040
    - 1064
    - 1048
    - 1072
    - 1056
```

### excludeChannels

#### 除外するチャンネルを指定

| 種類     | デフォルト値 | 必須 |
| -------- | ------------ | ---- |
| number[] | -            | no   |

-   `http://<MirakurunAddress:port>/api/services` もしくは `http://<EPGStationAddress:port>/api/channels` で確認できる
    id を入力

```yaml
excludeChannels:
    - 3239123608
    - 400231
```

### excludeSids

#### sid で除外するチャンネルを指定

| 種類     | デフォルト値 | 必須 |
| -------- | ------------ | ---- |
| number[] | -            | no   |

-   `http://<MirakurunAddress:port>/api/services` もしくは `http://<EPGStationAddress:port>/api/channels` で確認できる
    serviceId を入力

```yaml
excludeSids:
    - 23608
    - 231
```

### gid

#### EPGStation が利用するグループ ID or グループ名

| 種類             | デフォルト値 | 必須 |
| ---------------- | ------------ | ---- |
| string \| number | -            | no   |

```yaml
gid: hoge
```

### uid

#### EPGStation が利用するユーザー ID or ユーザー名

| 種類             | デフォルト値 | 必須 |
| ---------------- | ------------ | ---- |
| string \| number | -            | no   |

```yaml
uid: fuga
```

### isEnabledDropCheck

#### 録画時のドロップチェックを有効化する

| 種類    | デフォルト値 | 必須 |
| ------- | ------------ | ---- |
| boolean | false        | no   |

```yaml
isEnabledDropCheck: true
```

### dropLog

#### ドロップチェック時に生成される .log ファイルの保存先

| 種類   | デフォルト値                                                          | 必須 |
| ------ | --------------------------------------------------------------------- | ---- |
| string | /hoge/EPGStation/drop (EPGStation 直下の drop ディレクトリのフルパス) | no   |

-   フルパスで指定する

```yaml
dropLog: '/hoge/fuga',
```

### subDirectory

#### サブディレクトリとして動作させる (リバースプロキシ利用時を想定)

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| string | -            | no   |

-   `http://<IPaddress>:<Port>/<subDirectory>`として動作する

```yaml
subDirectory: subdir
```

### apiServers

#### Suagger UI で使用するサーバリスト

| 種類     | デフォルト値                | 必須 |
| -------- | --------------------------- | ---- |
| string[] | [ 'http://localhost:8888' ] | no   |

```yaml
apiServers:
    - http://localhost:8888
    - http://xxx.xxx.xxx.xxx:8888
```

[WebAPI Document](./webapi.md)

### isAllowAllCORS

#### CORS ヘッダーをすべて許可する (いずれ真面目に実装した際に削除する予定)

| 種類    | デフォルト値 | 必須 |
| ------- | ------------ | ---- |
| boolean | false        | no   |

---

## ファイル保存先

### recorded

#### 録画ファイルの保存先

| 種類               | デフォルト値           | 必須 |
| ------------------ | ---------------------- | ---- |
| 子プロパティの配列 | 下記デフォルト値を参照 | no   |

-   デフォルト値

```yaml
recorded:
    - name: recorded
      path: /hoge/huge/EPGStation/recorded # EPGStation 直下にある recorded のフルパス
```

-   子プロパティは以下の通り

| 子プロパティ名 | 種類               | 必須 | 説明                                                                          |
| -------------- | ------------------ | ---- | ----------------------------------------------------------------------------- |
| name           | string             | yes  | Web インターフェイス上で表示される名前                                        |
| path           | string             | yes  | 保存先ディレクトリパス (フルパスで指定すること)                               |
| limitThreshold | number             | no   | 空き容量限界閾値 (単位 MB)。これを超えると action, limit で指定した動作を行う |
| action         | 'remove' \| 'none' | no   | 下記の limitThreshold 説明を参照                                              |
| limitCmd       | string             | no   | limitThreshold を超えた時に実行するコマンド                                   |

-   フルパスで指定する

##### limitThreshold 説明

-   remove
    -   limitThreshold 内に空き容量が収まるまで古い順に録画番組を自動削除する
-   none
    -   何もしない

```yaml
recorded:
    - name: hoge-name
      path: 'HOGE-HUGA'
```

### recordedTmp

#### 録画ファイルの一時保存先

録画が完了したら recorded で指定したディレクトリへ移動する

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| string | -            | no   |

-   フルパスで指定する

```yaml
recordedTmp: '/hoge/fuga'
```

### recordedFormat

#### 録画ファイルのファイル名テンプレート

| 種類   | デフォルト値                                           | 必須 |
| ------ | ------------------------------------------------------ | ---- |
| string | %YEAR%年%MONTH%月%DAY%日%HOUR%時%MIN%分%SEC%秒-%TITLE% | no   |

-   使用可能な変数は以下の通り

| 変数名              | 説明                          |
| ------------------- | ----------------------------- |
| %YEAR%              | 年                            |
| %SHORTYEAR%         | 年 (下２桁)                   |
| %MONTH%             | 月                            |
| %DAY%               | 日付                          |
| %HOUR%              | 時                            |
| %MIN%               | 分                            |
| %SEC%               | 秒                            |
| %DOW%               | 曜日                          |
| %TYPE%              | "GR" \| "BS" \| "CS" \| "SKY" |
| %CHID%              | Channel ID                    |
| %CHNAME%            | チャンネル名                  |
| %HALF_WIDTH_CHNAME% | チャンネル名 (半角)           |
| %CH%                | チャンネル番号                |
| %SID%               | サービス ID                   |
| %ID%                | Program ID                    |
| %TITLE%             | 番組タイトル                  |
| %HALF_WIDTH_TITLE%  | 番組タイトル (半角)           |

```yaml
recordedFormat: '%TITLE% [%CHNAME%] %YEAR%年%MONTH%月%DAY%日(%DOW%曜日)'
```

### recordedFileExtension

#### 録画ファイルの拡張子

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| string | .ts          | no   |

-   MPEG2-TS の拡張子は`.ts` `.mts` `.m2t` `.m2ts`のいずれかが望ましい
-   ピリオド`.`を付け忘れないように

```yaml
recordedFileExtension: .m2ts
```

### storageLimitCheckIntervalTime

#### ストレージの空き容量をチェックする間隔 (秒)

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 60           | no   |

```yaml
storageLimitCheckIntervalTime: 120
```

### thumbnail

#### サムネイル画像ファイルの保存先

| 種類   | デフォルト値                                                                    | 必須 |
| ------ | ------------------------------------------------------------------------------- | ---- |
| string | /hoge/EPGStation/thumbnail (EPGStation 直下の thumbnail ディレクトリのフルパス) | no   |

```yaml
thumbnail: '/hoge/thumbs'
```

### thumbnailCmd

#### サムネイル生成時のコマンド

| 種類   | デフォルト値                                                                                        | 必須 |
| ------ | --------------------------------------------------------------------------------------------------- | ---- |
| string | '%FFMPEG% -ss %THUMBNAIL_POSITION% -y -i %INPUT% -vframes 1 -f image2 -s %THUMBNAIL_SIZE% %OUTPUT%' | no   |

-   置換される変数は以下の通り

| 変数名               | 説明                                    |
| -------------------- | --------------------------------------- |
| %FFMPEG%             | EPGStation が利用している ffmpeg のパス |
| %INPUT%              | 入力ファイルパス                        |
| %OUTPUT%             | 出力ファイルパス                        |
| %THUMBNAIL_POSITION% | サムネイル再生位置 (秒)                 |
| %THUMBNAIL_SIZE%     | サムネイルの画像のサイズ                |

```yaml
thumbnailCmd: '%FFMPEG% -ss %THUMBNAIL_POSITION% -y -i %INPUT% -vframes 1 -f image2 -s %THUMBNAIL_SIZE% %OUTPUT%'
```

### thumbnailSize

#### サムネイル画像の解像度

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| string | 480x270      | no   |

-   横解像度 x 縦解像度で記載する（x は小文字のエックス）

```yaml
thumbnailSize: '320x180'
```

### thumbnailPosition

#### サムネイル画像を生成する再生位置（秒）

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 5            | no   |

```yaml
thumbnailPosition: 30
```

### uploadTempDir

#### ファイルアップロード時の利用する一時領域

| 種類   | デフォルト値                                                                        | 必須 |
| ------ | ----------------------------------------------------------------------------------- | ---- |
| string | /hoge/EPGStation/data/upload (EPGStation 直下の data/upload ディレクトリのフルパス) | no   |

```yaml
uploadTempDir: '/hoge/tmp/upload'
```

---

## 外部コマンド実行

### reserveNewAddtionCommand

-   録画予約の新規追加時に実行されるコマンド

### reserveUpdateCommand

-   録画情報の更新時に実行されるコマンド

### reservedeletedCommand

-   録画予約の削除時に実行されるコマンド

### recordingPreStartCommand

-   録画準備の開始時に実行されるコマンド

### recordingPrepRecFailedCommand

-   録画準備の失敗時に実行されるコマンド

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| string | -            | no   |

-   実行時に渡される環境変数は以下の通り

| 変数名                 | 種類           | 説明                          |
| ---------------------- | -------------- | ----------------------------- |
| PROGRAMID              | number         | Program ID                    |
| CHANNELTYPE            | string         | 'GR' \| 'BS' \| 'CS' \| 'SKY' |
| CHANNELID              | number         | Channel ID                    |
| CHANNELNAME            | string \| null | 放送局名                      |
| HALF_WIDTH_CHANNELNAME | string \| null | 放送局名(半角)                |
| STARTAT                | number         | 開始時刻 (UNIX time)          |
| ENDAT                  | number         | 終了時刻 (UNIX time)          |
| DURATION               | number         | 長さ (ms)                     |
| NAME                   | string         | 番組名                        |
| HALF_WIDTH_NAME        | string         | 番組名(半角)                  |
| DESCRIPTION            | string \| null | 番組概要                      |
| HALF_WIDTH_DESCRIPTION | string \| null | 番組概要(半角)                |
| EXTENDED               | string \| null | 番組詳細                      |
| HALF_WIDTH_EXTENDED    | string \| null | 番組詳細(半角)                |

```yaml
reserveNewAddtionCommand: '/bin/node /home/hoge/fuga.js reserve'
reserveUpdateCommand: '/bin/node /home/hoge/piyo.js update'
reservedeletedCommand: '/bin/bash /home/hoge/bar.sh deleted'
recordingPreStartCommand: '/bin/bash /home/hoge/foo.sh prestart'
recordingPrepRecFailedCommand: '/usr/bin/logger prepfailed'
```

### recordingStartCommand

-   録画開始時に実行するコマンド

### recordingFinishCommand

-   録画終了時に実行するコマンド

### recordingFailedCommand

-   録画中のエラー発生時に実行するコマンド

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| string | -            | no   |

-   実行時に渡される環境変数は以下の通り

| 変数名                 | 種類           | 説明                          |
| ---------------------- | -------------- | ----------------------------- |
| RECORDEDID             | number         | recorded id                   |
| PROGRAMID              | number         | program id                    |
| CHANNELTYPE            | string         | 'GR' \| 'BS' \| 'CS' \| 'SKY' |
| CHANNELID              | number         | channel id                    |
| CHANNELNAME            | string \| null | 放送局名                      |
| HALF_WIDTH_CHANNELNAME | string \| null | 放送局名(半角)                |
| STARTAT                | number         | 開始時刻 (UNIX time)          |
| ENDAT                  | number         | 終了時刻 (UNIX time)          |
| DURATION               | number         | 長さ (ms)                     |
| NAME                   | string         | 番組名                        |
| HALF_WIDTH_NAME        | string         | 番組名(半角)                  |
| DESCRIPTION            | string \| null | 番組概要                      |
| HALF_WIDTH_DESCRIPTION | string \| null | 番組概要(半角)                |
| EXTENDED               | string \| null | 番組詳細                      |
| HALF_WIDTH_EXTENDED    | string \| null | 番組詳細(半角)                |
| RECPATH                | string         | 録画ファイルのフルパス        |
| LOGPATH                | string\| null  | ログファイルのフルパス        |
| ERROR_CNT              | number \| null | エラーカウント                |
| DROP_CNT               | number \| null | ドロップカウント              |
| SCRAMBLING_CNT         | number \| null | スクランブルカウント          |

```yaml
recordingStartCommand: '/bin/node /home/hoge/fuga.js start'
recordingFinishCommand: '/bin/bash /home/hoge/foo.sh end'
recordingFailedCommand: '/usr/bin/logger recfailed'
```

### encodingFinishCommand

-   エンコード終了時に実行するコマンド

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| string | -            | no   |

-   実行時に渡される環境変数は以下の通り

| 変数名                 | 種類           | 説明                                   |
| ---------------------- | -------------- | -------------------------------------- |
| RECORDEDID             | number         | recorded id                            |
| VIDEOFILEID            | number \| null | video file id                          |
| OUTPUTPATH             | string \| null | エンコードしたビデオファイルのフルパス |
| MODE                   | string         | エンコードモード名                     |
| CHANNELID              | number         | channel id                             |
| CHANNELNAME            | string \| null | 放送局名                               |
| HALF_WIDTH_CHANNELNAME | string \| null | 放送局名(半角)                         |
| NAME                   | string         | 番組名                                 |
| HALF_WIDTH_NAME        | string         | 番組名(半角)                           |
| DESCRIPTION            | string \| null | 番組概要                               |
| HALF_WIDTH_DESCRIPTION | string \| null | 番組概要(半角)                         |
| EXTENDED               | string \| null | 番組詳細                               |
| HALF_WIDTH_EXTENDED    | string \| null | 番組詳細(半角)                         |

```yaml
encodingFinishCommand: '/bin/node /home/hoge/fuga.js finish'
```

### encodeProcessNum

#### エンコードやストリーミングで使用されるプロセスの上限数

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 0            | no   |

```yaml
encodeProcessNum: 3
```

### concurrentEncodeNum

#### 同時エンコード数

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 0            | no   |

```yaml
concurrentEncodeNum: 1
```

### encode

#### エンコード設定

| 子プロパティ名 | 種類   | 必須 | 説明                                                         |
| -------------- | ------ | ---- | ------------------------------------------------------------ |
| name           | string | yes  | Web インターフェイス上で表示される名称                       |
| cmd            | string | yes  | 実行するコマンド                                             |
| suffix         | string | no   | 出力ファイルに付加される拡張子                               |
| rate           | number | no   | 録画時間 \* rate 後にタイムアウトする ( デフォルト値は 4.0 ) |

-   `suffix` を定義しなければ、非エンコードコマンドとして実行される
-   `cmd` 内で置換される変数は以下の通り

| 変数名   | 説明                    |
| -------- | ----------------------- |
| %NODE%   | node のファイルパス     |
| %INPUT%  | 入力ファイルパス        |
| %OUTPUT% | 出力ファイルパス        |
| %ROOT%   | EPGStation の root パス |

-   実行時に渡される環境変数は以下の通り

| 変数名                 | 種類           | 説明                                                                          |
| ---------------------- | -------------- | ----------------------------------------------------------------------------- |
| RECORDEDID             | number         | recorded id                                                                   |
| INPUT                  | string         | 入力ファイルパス                                                              |
| OUTPUT                 | string         | 出力ファイルパス                                                              |
| FFMPEG                 | string         | ffmpeg パス                                                                   |
| FFPROBE                | string         | ffprobe パス                                                                  |
| DIR                    | string         | 予約時に設定した directory 文字列                                             |
| SUBDIR                 | string \| null | サブディレクトリ文字列                                                        |
| NAME                   | string         | 番組名                                                                        |
| HALF_WIDTH_NAME        | string         | 番組名(半角)                                                                  |
| DESCRIPTION            | string \| null | 番組概要                                                                      |
| HALF_WIDTH_DESCRIPTION | string \| null | 番組概要(半角)                                                                |
| EXTENDED               | string \| null | 番組詳細                                                                      |
| HALF_WIDTH_EXTENDED    | string \| null | 番組詳細(半角)                                                                |
| VIDEOTYPE              | string \| null | "mpeg2" \| "h.264" \| "h.265"                                                 |
| VIDEORESOLUTION        | string \| null | "240p" \| "480i" \| "480p" \| "720p" \| "1080i" \| "2160p" \| "4320p" \| null |
| VIDEOSTREAMCONTENT     | number \| null | video streamType                                                              |
| VIDEOCOMPONENTTYPE     | number \| null | video componentType                                                           |
| AUDIOSAMPLINGRATE      | number \| null | 16000 \| 22050 \| 24000 \| 32000 \| 44100 \| 48000                            |
| AUDIOCOMPONENTTYPE     | number \| null | audio componentType                                                           |
| CHANNELID              | number         | ChannelId mirakurun:40772/api/services で ID を確認できる                     |
| CHNNELNAME             | string         | チャンネル名                                                                  |
| HALF_WIDTH_CHANNELNAME | string         | チャンネル名 (半角)                                                           |
| GENRE1                 | number         | genre1                                                                        |
| GENRE2                 | number         | genre2                                                                        |
| GENRE3                 | number         | genre3                                                                        |
| SUBGENRE1              | number         | sub genre1                                                                    |
| SUBGENRE2              | number         | sub genre2                                                                    |
| SUBGENRE3              | number         | sub genre3                                                                    |
| START_AT               | number         | 番組開始時刻                                                                  |
| END_AT                 | number         | 番組終了時刻                                                                  |
| DROPLOG_ID             | number \| null | ドロップログ id                                                               |
| DROPLOG_PATH           | string \| null | ドロップログファイルパス                                                      |
| ERROR_CNT              | number \| null | エラーカウント                                                                |
| DROP_CNT               | number \| null | ドロップカウント                                                              |
| SCRAMBLING_CNT         | number \| null | スクランブルカウント                                                          |

```yaml
encode:
    - name: H.264
      cmd: '%NODE% %ROOT%/config/enc.js'
      suffix: .mp4
      rate: 4.0
```

---

## 視聴設定

### streamingPriority

#### ストリーミング視聴時に Mirakurun へ渡されるプライオリティ

| 種類   | デフォルト値 | 必須 |
| ------ | ------------ | ---- |
| number | 0            | no   |

```yaml
streamingPriority: 1
```

### urlscheme

#### 視聴 URL Scheme 設定

| 子プロパティ名 | 種類         | 必須 | 説明                                       |
| -------------- | ------------ | ---- | ------------------------------------------ |
| m2ts           | 孫プロパティ | no   | m2ts 形式視聴時の URL Scheme 設定          |
| video          | 孫プロパティ | no   | 録画ビデオ視聴時の URL Scheme 設定         |
| download       | 孫プロパティ | no   | 録画ビデオダウンロード時の URL Scheme 設定 |

| 孫プロパティ名 | 種類   | 必須 | 説明                                                  |
| -------------- | ------ | ---- | ----------------------------------------------------- |
| ios            | string | no   | iOS の URL Scheme 設定                                |
| android        | string | no   | Android の URL Scheme 設定                            |
| mac            | string | no   | [Mac の URL Scheme 設定](./mac-url-scheme.md)         |
| win            | string | no   | [Windows の URL Scheme 設定](./windows-url-scheme.md) |

-   設定内で置換される変数は以下の通り

| 変数名   | 説明                           |
| -------- | ------------------------------ |
| PROTOCOL | プロトコル                     |
| ADDRESS  | EPGStation の MPEG-TS 配信 URL |
| FILENAME | 出力されるファイル名           |

```yaml
urlscheme:
    m2ts:
        ios: 'vlc-x-callback://x-callback-url/stream?url=PROTOCOL://ADDRESS"'
        android: 'intent://ADDRESS#Intent;package=org.videolan.vlc;type=video;scheme=PROTOCOL;end'
    video:
        ios: 'infuse://x-callback-url/play?url=PROTOCOL://ADDRESS'
        android: 'intent://ADDRESS#Intent;package=com.mxtech.videoplayer.ad;type=video;scheme=PROTOCOL;end'
    download:
        ios: 'vlc-x-callback://x-callback-url/stream?url=PROTOCOL://ADDRESS'
```

### streamFilePath

#### HLS 配信時に使用される一時領域

| 種類   | デフォルト値                                                                                 | 必須 |
| ------ | -------------------------------------------------------------------------------------------- | ---- |
| string | hoge/EPGStation/data/streamfiles (EPGStation 直下の data/streamfiles ディレクトリのフルパス) | no   |

```yaml
'streamFilePath': '/tmp/hlsfile'
```

### stream

#### ストリーミング設定

| 子プロパティ名 | 種類               | 必須 | 説明                       |
| -------------- | ------------------ | ---- | -------------------------- |
| live           | ライブプロパティ   | no   | ライブストリーミング設定   |
| recorded       | 録画番組プロパティ | no   | 録画番組ストリーミング設定 |

-   ライブプロパティは以下の通り

| ライブプロパティ名 | 種類                           | 必須 | 説明                    |
| ------------------ | ------------------------------ | ---- | ----------------------- |
| ts                 | ライブストリーミングプロパティ | no   | m2ts ストリーミング設定 |

-   録画番組プロパティは以下の通り

| ライブプロパティ名 | 種類                         | 必須 | 説明                                   |
| ------------------ | ---------------------------- | ---- | -------------------------------------- |
| ts                 | 録画ストリーミングプロパティ | no   | m2ts ストリーミング設定                |
| encoded            | 録画ストリーミングプロパティ | no   | エンコード済みビデオストリーミング設定 |

-   ライブストリーミングプロパティは以下の通り

| ライブストリーミングプロパティ名 | 種類               | 必須 | 説明                              |
| -------------------------------- | ------------------ | ---- | --------------------------------- |
| m2ts                             | コマンドプロパティ | no   | m2ts コマンド設定                 |
| m2tsll                           | コマンドプロパティ | no   | m2tsll コマンド設定 (mpegts.js)用 |
| webm                             | コマンドプロパティ | no   | webm コマンド設定                 |
| mp4                              | コマンドプロパティ | no   | mp4 コマンド設定                  |
| hls                              | コマンドプロパティ | no   | hls コマンド設定                  |

-   録画ストリーミングプロパティは以下の通り

| 録画ストリーミングプロパティ名 | 種類               | 必須 | 説明              |
| ------------------------------ | ------------------ | ---- | ----------------- |
| webm                           | コマンドプロパティ | no   | webm コマンド設定 |
| mp4                            | コマンドプロパティ | no   | mp4 コマンド設定  |
| hls                            | コマンドプロパティ | no   | hls コマンド設定  |

-   コマンドプロパティは以下の通り

| 録画ストリーミングプロパティ名 | 種類   | 必須 | デフォルト値 | 説明                                   |
| ------------------------------ | ------ | ---- | ------------ | -------------------------------------- |
| name                           | string | yes  | -            | Web インターフェース上で表示される名前 |
| cmd                            | string | no   | -            | 変換コマンド                           |

-   `cmd` が指定されない場合は無変換配信
-   `cmd` で置換される変数は以下の通り

| 変数名          | 説明                                    |
| --------------- | --------------------------------------- |
| %FFMPEG%        | EPGStation が利用している ffmpeg のパス |
| %streamFileDir% | `streamFilePath` で指定したパス名       |
| %streamNum%     | 一時ファイルのストリーム番号            |
| %SS%            | 読み取り位置(秒)                        |
| %SPACE%         | 半角スペース                            |

```yaml
stream:
    live:
        ts:
            m2ts:
                - name: 720p
                  cmd:
                      '%FFMPEG% -re -dual_mono_mode main -i pipe:0 -sn -threads 0 -c:a aac -ar 48000 -b:a 192k -ac 2
                      -c:v libx264 -vf yadif,scale=-2:720 -b:v 3000k -preset veryfast -y -f mpegts pipe:1'
                - name: 無変換

            webm:
                - name: 720p
                  cmd:
                      '%FFMPEG% -re -dual_mono_mode main -i pipe:0 -sn -threads 3 -c:a libvorbis -ar 48000 -b:a 192k -ac
                      2 -c:v libvpx-vp9 -vf yadif,scale=-2:720 -b:v 3000k -deadline realtime -speed 4 -cpu-used -8 -y -f
                      webm pipe:1'
    recorded:
        ts:
            mp4:
                - name: 720p
                  cmd:
                      '%FFMPEG% -dual_mono_mode main -i pipe:0 -sn -threads 0 -c:a aac -ar 48000 -b:a 192k -ac 2 -c:v
                      libx264 -vf yadif,scale=-2:720 -b:v 3000k -profile:v baseline -preset veryfast -tune
                      fastdecode,zerolatency -movflags frag_keyframe+empty_moov+faststart+default_base_moof -y -f mp4
                      pipe:1'
        encoded:
            hls:
                - name: 720p
                  cmd:
                      '%FFMPEG% -dual_mono_mode main -ss %SS% -i %INPUT% -sn -threads 0 -ignore_unknown
                      -max_muxing_queue_size 1024 -f hls -hls_time 3 -hls_list_size 0 -hls_allow_cache 1
                      -hls_segment_filename %streamFileDir%/stream%streamNum%-%09d.ts -hls_flags delete_segments -c:a
                      aac -ar 48000 -b:a 192k -ac 2 -c:v libx264 -vf scale=-2:720 -b:v 3000k -preset veryfast -flags
                      +loop-global_header %OUTPUT%'
```

特定の配信方式を無効化したい場合は以下の例のように空配列を定義すること

例): ライブ視聴の m2ts 配信方式を無効化する場合

```yaml
stream:
    live:
        ts:
            m2ts: []
```

### kodiHosts

#### kodi への配信時に使用するオプション

| 種類               | デフォルト値           | 必須 |
| ------------------ | ---------------------- | ---- |
| 子プロパティの配列 | 下記デフォルト値を参照 | no   |

-   子プロパティは以下の通り

| 子プロパティ名 | 種類   | 必須 | 説明                                   |
| -------------- | ------ | ---- | -------------------------------------- |
| name           | string | yes  | Web インターフェイス上で表示される名前 |
| host           | string | yes  | kodi が動作しているホストの URL        |
| user           | string | no   | kodi のユーザー名                      |
| password       | string | no   | kodi のパスワード                      |

```yaml
kodiHosts:
    - name: kodi1
      host: http://xxx.xxx.xxx.xxx:8080
    - name: kodi2
      host: http://xxx.xxx.xxx.xxx:8080
      user: kodi
      password: pas
```

[kodi.md](./kodi.md)
