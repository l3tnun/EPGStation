Config.json
====

| プロパティ | 種類 | デフォルト値 | 必須 | 説明 |
| -------- | --- | ---------- | --- |  --- |
| readOnlyOnce | boolean | false | no | config.json の読み込みを1度だけに制限する |
| serverPort | number | | yes | ポート番号 |
| mirakurunPath | string | | yes | Mirakurunのパス(URL) |
| dbType | mysql \| sqlite3 \| postgresql | mysql | no | 使用する データベースを指定する |
| dbPath | string | EPGStation/data/database.db | no | SQLite3 使用時の db ファイルの保存場所 | 
| mysql | {} | | no | MySQL の設定 (dbType が mysql の場合は必須) |
| sqlite3 | {} | | no | SQLite3 の拡張設定 |
| postgresql | {} | | no | PostgreSQL の設定 (dbType が postgresql の場合は必須) |
| gid | string \| number | | no | gid の設定 |
| uid | string \| number | | no | uid の設定 |
| programInsertMax | number | 100 | no | DB へ番組情報を挿入するときの 1 回あたりの件数 |
| programInsertWait | number | 0 | no | DB へ番組情報を挿入するときの 1 回あたりの待機時間 |
| serviceOrder | number[] | | no | チャンネル並び替え mirakurun:40772/api/services で id を確認できる |
| excludeServices | number[] | | no | 除外するチャンネル mirakurun:40772/api/services で id を確認できる |
| reserves | string | EPGStation/data/reserves.json | no | reserves.json の保存場所 フルパスで指定する |
| dbInfoPath | string | EPGStation/data/dbinfo.json | no | dbinfo.json の保存場所 フルパスで指定する |
| recPriority | number | 2 | no | 録画時の優先度 |
| conflictPriority | number | 1 | no | 重複時の録画優先度 |
| recorded | string | EPGStation/recorded | no | 録画ファイル保存先 フルパスで指定する |
| recordedFormat | string | %YEAR%年%MONTH%月%DAY%日%HOUR%時%MIN%分%SEC%秒-%TITLE% | no | 録画フォーマット |
| fileExtension | string | .ts | no | 録画ファイル拡張子 |
| reservesUpdateIntervalTime | number | 10 | no| 予約情報を更新する時間の間隔 (分) 
| thumbnail | string | EPGStation/thumbnail | no | サムネイルファイルの保存先 |
| thumbnailSize | string | 480x270 | no |  サムネイルの解像度 |
| thumbnailPosition | number | 5 | no |  サムネイル生成の時間 (秒) |
| ffmpeg | string | /usr/local/bin/ffmpeg | no |  サムネイル生成に使用する ffmpeg のパス |
| recordedStartCommand | string | | no | 録画開始時に実行するコマンド |
| recordedEndCommand | string | | no | 録画終了時に実行するコマンド |
| maxEncode | number | 0 | no | エンコードプロセスの起動上限数 |
| encode | {}[] | | no | エンコード設定 |
| delts | boolean | false | no | 手動予約時の ts 削除チェックボックスのデフォルト設定 |
| tsModify | {} | | no | ts を直接加工する時の処理。encode 前に実行される |
| storageLimitCheckIntervalTime | number | 60 | no | ストレージ空き容量をチェックする間隔 (秒) |
| storageLimitThreshold | number | 0 | no | ストレージ空き容量限界閾値 (MB) |
| storageLimitAction | "remove" | "none" | no | ストレージ空き容量が限界閾値を超えたときの動作 remove で最も古い録画番組から削除される |
| storageLimitCmd | string | | no | ストレージ空き容量が限界閾値を超えたときに実行するコマンド |
| recordedViewer | {} | | no | 録画済み番組を ios, android で視聴するときのアプリ設定 |
| recordedDownloader | {} | | no | 録画済み番組を ios, android でダウンロードするときのアプリ設定 |
| maxStreaming | number | 0 | no | ストリーミング配信の上限数 |
| streamingPriority | number | 0 | no | ライブ視聴時の優先度 |
| mpegTsStreaming | {}[] | | no | ライブ視聴の設定 |
| mpegTsViewer | {} | | no | ライブ視聴を ios, android で視聴するときのアプリ設定 |
| streamFilePath | string | EPGStation/data/streamfiles | no | HLS 配信時に使用される一時領域 |
| recordedHLS | {}[] | | no | 録画済みファイルを HLS 配信時に使用するオプション |
| kodiHosts | {}[] | | no | kodi 配信時に使用するオプション |

## プロパティ詳細解説

### mysql

| プロパティ | 種類 | 必須 | 説明 |
| -------- | ---- | ---- |--- |
| host | string | yse | mysql host |
| user | string | yes | user |
| password | string | yes |パスワード |
| database | string | yes | 使用するデータベース名 |
| connectTimeout | number | no | 接続タイムアウト時間 (ms) |
| connectionLimit | number | no | 同時接続数 |

----

### sqlite3

| プロパティ | 種類 | 必須 | 説明 |
| -------- | ---- | ---- |--- |
| extensions | string[] | yse | SQLite3 使用時に読み込む拡張のパス |
| regexp | boolean | yes | 正規表現検索が有効か |

拡張の詳細は[こちら](https://github.com/mapbox/node-sqlite3/wiki/Extensions)

----

### postgresql

| プロパティ | 種類 | 必須 | 説明 |
| -------- | ---- | ---- |--- |
| host | string | yse | postgresql host |
| user | string | yes | user |
| password | string | yes |パスワード |
| database | string | yes | 使用するデータベース名 |
| port | string | yes | port 番号 |
| idleTimeoutMillis | number | no | アイドル状態を維持できる時間 (ms) |
| connectionTimeoutMillis | number | no | 接続タイムアウト時間 (ms) |

----

### encode

| プロパティ | 種類 | 必須 | default| 説明 |
| -------- | ---- | ---- | --- | --- |
| name | string | yse | | web で表示される名前 |
| cmd | string | yse | | エンコードコマンド |
| suffix | string | yse | | ファイル名の後ろに付加される文字列 (拡張子) |
| rate | number | no | 4.0 | タイムアウト率 録画時間 * rate だけ待つ  |
| default | boolean | no | | 手動予約時のデフォルトのモードにするか |

#### cmd 実行時に渡される環境変数

| プロパティ | 種類 | 説明 |
| -------- | --- | ---- |
| INPUT | string | 入力ファイルパス |
| OUTPUT | string | 出力ファイルパス |
| FFMPEG | string | ffmpeg パス |
| VIDEOTYPE | string \| null | "mpeg2" \| "h.264" \| "h.265" |
| VIDEORESOLUTION | string \| null | "240p" \| "480i" \| "480p" \| "720p" \| "1080i" \| "2160p" \| "4320p" | null |
| VIDEOSTREAMCONTENT | number \| null | video streamType |
| VIDEOCOMPONENTTYPE | number \| null | video componentType |
| AUDIOSAMPLINGRATE | number \| null | 16000 \| 22050 \| 24000 \|  32000 \| 44100 \| 48000 |
| AUDIOCOMPONENTTYPE | number \| null | audio componentType|
| CHANNELID | number | channelId mirakurun:40772/api/services で id を確認できる |

#### cmd で置換される文字列

| プロパティ | 説明 |
| -------- | --- |
| %INPUT% | 入力ファイルパス |
| %OUTPUT% | 出力ファイルパス |
| %ROOT% | EPGStation の root パス |

-----

### tsModify

| プロパティ | 種類 | 必須 | default| 説明 |
| -------- | ---- | ---- | --- | --- |
| cmd | string | yse | | ts 処理コマンド |
| rate | number | no | 4.0 | タイムアウト率 録画時間 * rate だけ待つ  |

cmd 実行時の引数、環境変数は encode と同一

maxEncode を 1 以上に設定すること

----

### recordedStartCommand, recordedEndCommand

#### 実行時に渡される環境変数

| プロパティ | 種類 | 説明 |
| -------- | --- | ---- |
| RECORDEDID | number | recorded id |
| PROGRAMID | number | program id |
| CHANNELTYPE | string | 'GR' \| 'BS' \| 'CS' \| 'SKY' |
| STARTAT | number | 開始時刻 (UNIX time) |
| ENDAT | number | 終了時刻 (UNIX time) |
| DURATION | number | 長さ (ms) |
| NAME | string | 番組名 |
| DESCRIPTION | string \| null | 番組概要 |
| EXTENDED | string \| null | 番組詳細 |

---

### mpegTsStreaming

| プロパティ | 種類 | 必須 | 説明 |
| -------- | ---- | ---- | --- |
| name | string | yes | web で表示される名前 |
| cmd | string | no | エンコードコマンド 指定しない場合は無変換配信になる |

#### cmd で置換される文字列

| プロパティ | 説明 |
| -------- | --- |
| %FFMPEG% | ffmpeg パス |

----

### recordedViewer

| プロパティ | 種類 | 説明 |
| -------- | ---- | --- |
| ios | string | iOS での録画視聴アプリの設定 |
| android | string | Android での録画視聴アプリの設定 |
| mac | string | macOS での URL Scheme 設定 (Safari では動作しない) |

### recordedDownloader

| プロパティ | 種類 | 説明 |
| -------- | ---- | --- |
| ios | string | iOS での録画ファイルのダウンロードアプリの設定 |
| android | string | Android での録画ファイルのダウンロードアプリの設定 |
| mac | string | macOS での URL Scheme 設定 (Safari では動作しない) |

### mpegTsViewer

| プロパティ | 種類 | 説明 |
| -------- | ---- | --- |
| ios | string | iOS でのライブ視聴アプリの設定 |
| android | string | Android でのライブ視聴アプリの設定 |
| mac | string | macOS での URL Scheme 設定 (Safari では動作しない) |

#### recordedViewer, recordedDownloader, mpegTsViewer で置換される文字列

| プロパティ | 説明 |
| -------- | --- |
| ADDRESS | url |
| FILENAME | ファイル名 |

### recordedHLS

| プロパティ | 種類 | 説明 |
| -------- | ---- | --- |
| name | string | web で表示される名前 |
| cmd | string | エンコードコマンド |

#### cmd で置換される文字列

| プロパティ | 説明 |
| -------- | --- |
| %INPUT% | 入力ファイルパス |
| %OUTPUT% | 出力ファイルパス |
| %streamFileDir% | config. streamFilePath |
| %streamNum% | ストリーム番号 |
| %FFMPEG% | ffmpeg パス |

---

### kodiHosts
| プロパティ | 種類 | 必須 | 説明 |
| -------- | ---- | --- | --- |
| name | string | yes | web で表示される名前 |
| host | strgin | yes | kodi host url (例) http://192.168.0.2:8080 |
| user | string | no | kodi user 名 |
| pass | string | no | kodi パスワード |

----

#### recordedFormat の解説

| プロパティ | 説明 |
| -------- | --- |
| %YEAR% | 年 |
| %SHORTYEAR% | 年 (下２桁) |
| %MONTH% | 月 |
| %DAY% | 日付 |
| %HOUR% | 時 |
| %MIN% | 分 |
| %SEC% | 秒 |
| %DOW% | 曜日 |
| %TYPE% | "GR" | "BS" | "CS" | "SKY" |
| %CHID% | channelId |
| %CHNAME% | チャンネル名 |
| %CH% | channel |
| %SID% | sid |
| %ID% | program id |
| %TITLE% | 番組タイトル |
