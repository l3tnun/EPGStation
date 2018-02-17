Kodi との連携について
===

EPGStation では [Kodi](https://kodi.tv/) と連携するためのオプションを幾つか用意しています

## WebUI から Kodi へ配信

録画済み番組の詳細に STREAM タブが追加され Kodi での再生ができるようになります

### 1. Kodi のリモートコントロールを有効にする

```Kodi 設定 -> サービス設定 -> コントロール -> HTTPを介したリモートコントロールを許可``` を有効化する

### 2. config.json の設定

以下のような設定を config.json に加えてください

```
    "kodiHosts": [
        {
            "name": "kodi1",
            "host": "http://KodiHost:Port",
            "user": "user",
            "pass": "password"
        }
    ]
```

## Kodi 本体から録画済み番組を再生する

[plugin.video.epgstation](https://github.com/l3tnun/plugin.video.epgstation) をインストールしてください

## IPTV Simple Client との連携

[IPTV Simple Client](https://kodi.wiki/view/Add-on:IPTV_Simple_Client) を使用して現在放映中の番組を Kodi で視聴できるようになります

### 1. config.json の設定

ライブ視聴の設定を追加してください

```
    "maxStreaming": 2,
    "mpegTsStreaming": [
        {
            "name": "1280x720(main)",
            "cmd": "%FFMPEG% -re -dual_mono_mode main -i pipe:0 -c:a aac -ar 48000 -ab 192k -ac 2 -c:v libx264 -s 1280x720 -vf yadif -preset veryfast -aspect 16:9 -vb 3000k -f mpegts pipe:1"
        },
        {
            "name": "720x480(main)",
            "cmd": "%FFMPEG% -re -dual_mono_mode main -i pipe:0 -c:a aac -ar 48000 -ab 128k -ac 2 -c:v libx264 -s 720x480 -vf yadif -preset veryfast -aspect 16:9 -vb 1500k -f mpegts pipe:1"
        },
        {
            "name": "無変換"
        }

```

### 2. IPTV Simple Client の設定

#### M3U プレイリストのURL


```
http://host:port/api/iptv/channel.m3u8?mode=2
```

```?mode=2``` の 2 は ```mpegTsStreaming``` の指定をしています。0 から数えるので上記の設定では ```無変換``` が指定されます

#### XMLTV URL

```
http://host:port/api/iptv/epg.xml
```

epg の日数を指定する場合は以下のようになります。1 ~ 8 まで指定できます

```
http://host:port/api/iptv/epg.xml?days=3
```

### 不要チャンネルの非表示

```Kodi 設定 -> PVR & Live TV settings -> 一般 -> チャンネルマネージャー``` にて設定する

設定が反映されない場合は詳細設定に切り替えて

```Kodi 設定 -> PVR & Live TV settings -> ガイド -> データクリア``` を実行する
