# Kodi との連携について

EPGStation では [Kodi](https://kodi.tv/) と連携するためのオプションを幾つか用意しています

## WebUI から Kodi へ配信

録画済み番組の詳細に STREAM タブが追加され Kodi での再生ができるようになります

### 1. Kodi のリモートコントロールを有効にする

`Kodi 設定 -> サービス設定 -> コントロール -> HTTPを介したリモートコントロールを許可` を有効化する

### 2. config.yml の設定

以下のような設定を config.yml に加えてください

```yaml
kodiHosts:
    - name: kodi1
      host: http://KodiHost:Port
      user: user
      password: password
```

## Kodi 本体から録画済み番組を再生する

[plugin.video.epgstation](https://github.com/l3tnun/plugin.video.epgstation) をインストールしてください

## IPTV Simple Client との連携

[IPTV Simple Client](https://kodi.wiki/view/Add-on:IPTV_Simple_Client) を使用して現在放映中の番組を Kodi で視聴できるようになります

### 1. config.yml の設定

ライブ視聴の設定を追加してください

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
```

### 2. IPTV Simple Client の設定

#### M3U プレイリストの URL

```
http://host:port/api/iptv/channel.m3u8?mode=1
```

`?mode=1` の 1 は `stram/live/ts/m2ts` の指定をしています。0 から数えるので上記の設定では `無変換` が指定されます

#### XMLTV URL

```
http://host:port/api/iptv/epg.xml
```

epg の日数を指定する場合は以下のようになります。1 ~ 8 まで指定できます

```
http://host:port/api/iptv/epg.xml?days=3
```

### 不要チャンネルの非表示

`Kodi 設定 -> PVR & Live TV settings -> 一般 -> チャンネルマネージャー` にて設定する

設定が反映されない場合は詳細設定に切り替えて

`Kodi 設定 -> PVR & Live TV settings -> ガイド -> データクリア` を実行する
