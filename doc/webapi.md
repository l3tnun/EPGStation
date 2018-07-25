EPGStation WebAPI マニュアル
===
本マニュアルでは、EPGStation が提供する WebAPI について解説します

## EPGStation における WebAPI
EPGStation が提供する WebAPI は [express-openapi](https://www.npmjs.com/package/express-openapi) によって提供される、OpenAPI (Swagger) 準拠の RESTful API です  
利用可能な全てのAPIは **Swagger UI** 上で確認可能です  
`http://<hostname>:<port>/api/debug`

### API へのアクセス
各APIへのリクエストは `http://<hostname>:<port>/api/` から行います  
ターミナルからは `curl` を用いて確認が可能です
```bash
curl -o - -X {method} -H 'Content-type:{content-type}' http://<hostname>:<port>/api/{api-path}
```
#### Basic認証利用時のAPIアクセス
WebAPI へのアクセスにも認証が必要です
`http://<username>:<password>@<hostname>:<port>/api/{api-path}` とすることでURLのみで認証可能です

---
# API一覧（オフライン版）
本ページに掲載される一覧は簡易版です  
より細かい内容については **Swagger UI** 上で確認を行ってください

- [channels](#channels)
    - [GET `/channels`](#get-channels)
    - [GET `/channels/{id}/logo`](#get-channelsidlogo)
- [config](#config)
    - [GET `/config`](#get-config)
- [iptv](#iptv)
    - [GET `/iptv/epg.xml`](#get-iptvepgxml)
    - [GET `/iptv/channel.m3u8`](#get-iptvchannelm3u8)
- [recorded](#recorded)
    - [GET `/recorded`](#get-recorded)
    - [POST `/recorded`](#post-recorded)
    - [GET `/recorded/{id}`](#get-recordedid)
    - [DELETE `/recorded/{id}`](#delete-recordedid)
    - [GET `/recorded/file`](#get-recordedfile)
    - [DELETE `/recorded/file`](#delete-recordedfile)
    - [POST `/recorded/{id}/upload`](#post-recordedidupload)
    - [POST `/recorded/{id}/encode`](#post-recordedidencode)
    - [DELETE `/recorded/{id}/encode`](#delete-recordedidencode)
    - [GET `/recorded/{id}/duration`](#get-recordedidduration)
    - [GET `/recorded/{id}/thumbnail`](#get-recordedidthumbnail)
    - [GET `/recorded/{id}/playlist`](#get-recordedidplaylist)
    - [POST `/recorded/{id}/kodi`](#post-recordedidkodi)
    - [POST `/recorded/delete`](#post-recordeddelete)
    - [GET `/recorded/tags`](#get-recordedtags)
    - [POST `/recorded/cleanaup`](#post-recordedcleanaup)
- [reserves](#reserves)
    - [GET `/reserves`](#get-reserves)
    - [POST `/reserves`](#post-reserves)
    - [GET `/reserves/all`](#get-reservesall)
    - [GET `/reserves/{id}`](#get-reservesid)
    - [DELETE `/reserves/{id}`](#delete-reservesid)
    - [PUT `/reserves/{id}`](#put-reservesid)
    - [GET `/reserves/skip`](#get-reservesskip)
    - [DELETE `/reserves/{id}/skip`](#delete-reservesidskip)
    - [GET `/reserves/overlaps`](#get-reservesoverlaps)
    - [DELETE `/reserves/{id}/overlaps`](#delete-reservesidoverlaps)
    - [GET `/reserves/conflicts`](#get-reservesconflicts)
- [rules](#rules)
    - [GET `/rules`](#get-rules)
    - [POST `/rules`](#post-rules)
    - [GET `/rules/list`](#get-ruleslist)
    - [GET `/rules/{id}`](#get-rulesid)
    - [PUT `/rules/{id}`](#put-rulesid)
    - [DELETE `/rules/{id}`](#delete-rulesid)
    - [PUT `/rules/{id}/enable`](#put-rulesidenable)
    - [PUT `/rules/{id}/disable`](#put-rulesiddisable)
- [schedule](#schedule)
    - [GET `/schedule`](#get-schedule)
    - [GET `/schedule/{id}`](#get-scheduleid)
    - [GET `/schedule/detail/{id}`](#get-scheduledetailid)
    - [GET `/schedule/broadcasting`](#get-schedulebroadcasting)
    - [PUT `/schedule/update`](#put-scheduleupdate)
    - [POST `/schedule/search`](#post-schedulesearch)
- [storage](#storage)
    - [GET `/storage`](#get-storage)
- [streams](#streams)
    - [GET `/streams/info`](#get-streamsinfo)
    - [GET `/streams/recorded/{id}/mpegts`](#get-streamsrecordedidmpegts)
    - [GET `/streams/recorded/{id}/mp4`](#get-streamsrecordedidmp4)
    - [GET `/streams/recorded/{id}/webm`](#get-streamsrecordedidwebm)
    - [GET `/streams/recorded/{id}/hls`](#get-streamsrecordedidhls)
    - [GET `/streams/recorded/{id}/mpegts/playlist`](#get-streamsrecordedidmpegtsplaylist)
    - [GET `/streams/live/{id}/mpegts`](#get-streamsliveidmpegts)
    - [GET `/streams/live/{id}/mpegts/playlist`](#get-streamsliveidmpegtsplaylist)
    - [GET `/streams/live/{id}/mp4`](#get-streamsliveidmp4)
    - [GET `/streams/live/{id}/webm`](#get-streamsliveidwebm)
    - [GET `/streams/live/{id}/hls`](#get-streamsliveidhls)
    - [DELETE `/streams/{id}`](#delete-streamsid)
    - [DELETE `/streams/forcedstop`](#delete-streamsforcedstop)

## channels
### GET `/channels`
#### チャンネル情報の一覧を取得します
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| - | - | - | - |

### GET `/channels/{id}/logo`
#### 指定したチャンネルのロゴ画像を取得します
##### Response Content Type: `image/png`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 取得するチャンネルの `channelId` |

## config
### GET `/config`
#### config.jsonの内容を取得します
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| - | - | - | - |

## iptv
### GET `/iptv/epg.xml`
#### Kodi連携用のxml形式 IPTV番組表を取得します
##### Response Content Type: `application/xml`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| days | integer | no | 取得する日数 (Default: 3) |

### GET `/iptv/channel.m3u8`
#### Kodi連携用のm3u8形式 IPTVチャンネルリストを取得します
##### Response Content Type: `application/x-mpegURL`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| mode | integer | yes | エンコードモードを指定します |

## recorded
### GET `/recorded`
#### 録画一覧を取得
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| limit | integer | no | 取得数の上限 (Default: 24) |
| offset | integer | no | 取得の開始位置 (Default: 0) |
| rule | integer | no | 予約ルールの `ruleId` |
| genre1 | integer | no | 大ジャンル番号 |
| genre2 | integer | no | 小ジャンル番号 |
| channel | integer | no | チャンネルの `channelId` |
| keyword | string | no | 検索キーワード |

### POST `/recorded`
#### 新規録画を作成
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| body | json | yes | 録画対象のprogram情報 |
- bodyの例
    ```json
    {
    "channelId": 0,
    "startAt": 0,
    "endAt": 0,
    "name": "string",
    "description": "string",
    "extended": "string",
    "genre1": 0,
    "genre2": 0,
    "videoType": "mpeg2",
    "videoResolution": "240p",
    "videoStreamContent": 0,
    "videoComponentType": 0,
    "audioSamplingRate": 16000,
    "audioComponentType": 0,
    "ruleId": 0
    }
    ```

### GET `/recorded/{id}`
#### 録画番組の情報を取得
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 取得する録画の `recrdedId` |

### DELETE `/recorded/{id}`
#### 録画番組を削除
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 削除する録画の `recordedId` |

### GET `/recorded/file`
#### 録画済みファイルを視聴、ダウンロード
##### Response Content Type: `video/mpeg`, `video/mp4`, `video/webm`, `application/octet-stream`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 取得する録画の `recordedId` |
| encodedId | integer | no | エンコードオプションのインデックス番号 |
| mode | string | no | `download` でダウンロードモード、空欄で視聴モード |

### DELETE `/recorded/file`
#### 録画済みファイルをファイル別に削除
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 削除する録画の `recordedId` |
| encodedId | integer | no | 削除する動画のエンコードオプションのインデックス番号 |

### POST `/recorded/{id}/upload`
#### 外部ファイルを録画一覧に追加
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 動画を追加する録画の `recordedId` |
| directory | string | no | 追加する動画が保存されるフォルダ名 |
| encoded | boolean | no | エンコード済みの動画か (Default: false)|
| name | string | no | WebUIに表示される種類の名前 (Default: TS)|
| file | file | yes | 追加する動画ファイル |

### POST `/recorded/{id}/encode`
#### 録画ファイルをエンコード開始
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | エンコードする録画の `recordedId` |
| body | json | yes | エンコード情報 |
- bodyの例
    ```json
    {
    "mode": 0,
    "encodedId": 0,
    "directory": "string",
    "isOutputTheOriginalDirectory": true
    }
    ```

### DELETE `/recorded/{id}/encode`
#### 実行中のエンコードをキャンセル
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | エンコードをキャンセルする録画の `recordedId` |

### GET `/recorded/{id}/duration`
#### 録画の実際の長さを取得
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 長さを取得する録画の `recordedId` |

### GET `/recorded/{id}/thumbnail`
#### 録画のサムネイル画像を取得
##### Response Content Type: `image/jpg`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | サムネイル画像を取得する録画の `recordedId` |

### GET `/recorded/{id}/playlist`
#### 録画済みファイルのプレイリストを取得
##### Response Content Type: `application/x-mpegURL`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | プレイリストを取得する録画の `recordedId` |
| encodedId | integer | no | 取得する録画のエンコードオプションのインデックス番号 |

### POST `/recorded/{id}/kodi`
#### 録画済みファイルをKodiへ送信
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 送信する録画の `recordedId` |
| body | json | yes | Kodiへ送信する情報 |
- bodyの例
    ```json
    {
        "kodi": 0,
        "encodedId": 0
    }
    ```

### POST `/recorded/delete`
#### 録画番組を複数個一括削除
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| body | json | yes | 削除する録画番組の情報 |
- bodyの例
    ```json
    {
        "recordedIds": [
            0, 1, 2
        ]
    }
    ```

### GET `/recorded/tags`
#### 録画番組のタグ情報（録画ルール、チャンネル、ジャンル）を取得
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| - | - | - | - |

### POST `/recorded/cleanaup`
#### ファイルの存在しない録画データをクリーンアップ
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| - | - | - | - |
- 以下に該当する録画番組の情報が削除される
    - データベース上に登録があるが実際にはファイルがないデータ
    - データベース上に登録されていないファイル
    - 空のディレクトリ
    
## reserves

### GET `/reserves`
#### 予約一覧を取得
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| limit | integer | no | 取得数の上限 (Default: 24) |
| offset | integer | no | 取得の開始位置 (Default: 0) |

### POST `/reserves`
#### 新規予約を追加
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| body | json | yes | 予約を追加する番組の情報 |
- bodyの例
    ```json
    {
    "programId": 0,
    "option": {
        "directory": "string",
        "recordedFormat": "string"
    },
    "encode": {
        "mode1": 0,
        "directory1": "string",
        "mode2": 0,
        "directory2": "string",
        "mode3": 0,
        "directory3": "string",
        "delTs": true
    }
    }
    ```

### GET `/reserves/all`
#### 予約している全ての番組の `programId` を取得
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| - | - | - | - |

### GET `/reserves/{id}`
#### 予約を番組単位で取得
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 取得する番組の `programId` |

### DELETE `/reserves/{id}`
#### 予約を削除
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 削除する番組の `programId` |

### PUT `/reserves/{id}`
#### 既存の予約情報を更新
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 更新する番組の `programId` |
| body | json | yes | 更新する番組情報 |
- bodyの例
    ```json
    {
    "option": {
        "directory": "string",
        "recordedFormat": "string"
    },
    "encode": {
        "mode1": 0,
        "directory1": "string",
        "mode2": 0,
        "directory2": "string",
        "mode3": 0,
        "directory3": "string",
        "delTs": true
    }
    }
    ```

### GET `/reserves/skip`
#### 除外している予約の一覧を取得
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| limit | integer | no | 取得数の上限 (Default: 24) |
| offset | integer | no | 取得の開始位置 (Default: 0) |

### DELETE `/reserves/{id}/skip`
#### 予約の除外状態を解除する
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 除外を解除する予約の `programId` |

### GET `/reserves/overlaps`
#### 過去の録画と重複した内容の予約一覧を取得
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| limit | integer | no | 取得数の上限 (Default: 24) |
| offset | integer | no | 取得の開始位置 (Default: 0) |

### DELETE `/reserves/{id}/overlaps`
#### 過去の録画との重複状態を解除
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 重複状態を解除する録画の `programId` |

### GET `/reserves/conflicts`
#### 同時録画時にチューナー数が不足する予約の一覧を取得
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| limit | integer | no | 取得数の上限 (Default: 24) |
| offset | integer | no | 取得の開始位置 (Default: 0) |

## rules

### GET `/rules`
#### 録画予約ルールの一覧を取得
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| limit | integer | no | 取得数の上限 (Default: 24) |
| offset | integer | no | 取得の開始位置 (Default: 0) |

### POST `/rules`
#### 録画予約ルールを新規追加
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| body | json | yes | 録画予約ルールの情報 |
- 録画予約ルールのbody値は複雑なため、詳細はSwagger UIで確認してください

### GET `/rules/list`
#### 録画予約ルールの簡易リスト（ルールIDとキーワードのみ）を取得
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| - | - | - | - |

### GET `/rules/{id}`
#### 録画予約ルールを個別に取得
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 取得するルールの `ruleId` |

### PUT `/rules/{id}`
#### 録画予約ルールを更新
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 更新するルールの `ruleId` |
| body | json | yes | 更新するルールの情報 |
- 録画予約ルールのbody値は複雑なため、詳細はSwagger UIで確認してください

### DELETE `/rules/{id}`
#### 録画予約ルールを削除
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 削除するルールの `ruleId` |

### PUT `/rules/{id}/enable`
#### 録画予約ルールを有効化
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 有効化するルールの `ruleId` |

### PUT `/rules/{id}/disable`
#### 録画予約ルールを無効化
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 無効化するルールの `ruleId` |

## schedule

### GET `/schedule`
#### 番組表を取得
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| type | string | yes | 放送波の種類 (GR \| BS \| CS \| SKY) |
| time | integer | no | 取得する時間の指定 (YYMMDDHH) |
| length | integer | no | 一度に取得する番組数を指定 (Default: 24) |

### GET `/schedule/{id}`
#### チャンネル別に番組表を取得
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 取得するチャンネルの `channelId` |
| days | integer | no | 取得する日数 (Default: 7) |
| time | integer | no | 取得する時間の指定 (YYMMDDHH) |

### GET `/schedule/detail/{id}`
#### 番組を指定して番組情報の詳細を取得
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 取得したい番組の `programId` |

### GET `/schedule/broadcasting`
#### 放送中の番組データを取得
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| time | integer | no | 現在時刻に加算する分数 (Default: 0) |

### PUT `/schedule/update`
#### 予約情報の更新を開始
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| - | - | - | - |

### POST `/schedule/search`
#### 番組情報を検索して結果を取得
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| body | json | yes | 検索する際の情報 |
- bodyの例
    ```json
    {
        "keyword": "string",
        "ignoreKeyword": "string",
        "keyCS": true,
        "keyRegExp": true,
        "title": true,
        "description": true,
        "extended": true,
        "GR": true,
        "BS": true,
        "CS": true,
        "SKY": true,
        "station": 0,
        "genrelv1": 0,
        "genrelv2": 0,
        "startTime": 0,
        "timeRange": 0,
        "week": 0,
        "isFree": true,
        "durationMin": 0,
        "durationMax": 0,
        "avoidDuplicate": true,
        "periodToAvoidDuplicate": 0
    }
    ```

## storage

### GET `/storage`
#### ストレージの情報を取得
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| - | - | - | - |

## streams

### GET `/streams/info`
#### ストリーム情報を取得
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| - | - | - | - |

### GET `/streams/recorded/{id}/mpegts`
### GET `/streams/recorded/{id}/mp4`
### GET `/streams/recorded/{id}/webm`
#### 録画済みファイルのストリーミング配信を開始
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | ストリーミング配信する録画の `recordedId` |
| mode | integer | yes | エンコードオプションのインデックス番号 |
| ss | integer | no | 再生開始時刻（秒） (Default: 0) |

### GET `/streams/recorded/{id}/hls`
#### 録画済みファイルのHLS配信を開始
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | ストリーミング配信する録画の `recordedId` |
| mode | integer | yes | エンコードオプションのインデックス番号 |
| encodedId | no | エンコード済み動画の `encodedId` |

### GET `/streams/recorded/{id}/mpegts/playlist`
#### 録画済みファイルのmpegtsストリーミング配信のプレイリストを取得
##### Response Content Type: `application/x-mpegURL`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | ストリーミング配信する録画の `recordedId` |
| mode | integer | yes | エンコードオプションのインデックス番号 |

### GET `/streams/live/{id}/mpegts`
### GET `/streams/live/{id}/mpegts/playlist`
### GET `/streams/live/{id}/mp4`
### GET `/streams/live/{id}/webm`
### GET `/streams/live/{id}/hls`
#### 放送中番組のライブストリーミング配信を開始
##### Response Content Type: `application/x-mpegURL`, `video/MP2T`, `video/mp4`, `video/webm`, `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | ライブ視聴するチャンネルの `channelId` |
| mode | integer | yes | エンコードオプションのインデックス番号 | 

### DELETE `/streams/{id}`
#### ストリーミングを停止
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| id | integer | yes | 停止したいストリーミングの `streamId` |

### DELETE `/streams/forcedstop`
#### 全てのストリーミングを強制停止
##### Response Content Type: `application/json`
| パラメータ | 種類 | 必須 | 詳細 |
| --- | --- | --- | --- |
| - | - | - | - |