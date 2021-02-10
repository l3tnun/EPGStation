# v1 からの移行方法

### 移行できる情報

移行される情報は以下になる

-   ルール情報
-   録画済み番組情報
-   録画履歴情報

以下の情報は移行されない

-   予約情報 (手動予約、ルールで除外した予約等)
-   ドロップ情報

## 1. 移行元の v1 環境を最新にする

以下コマンドで v1 の最新バージョンに更新する

```shell
$ git pull
$ git checkout v1
$ npm install --no-save
$ npm run build
```

一度起動して DB を最新状態にする。起動が完了したら終了させる。

```shell
$ npm start # (起動完了後 Ctrl + C で終了)
```

---

## 2. v1 環境のバックアップを取る

v2 環境へ移行する際に使用するバックアップファイルを生成する

```shell
$ npm run backup FILENAME
```

---

## 3. v2 環境を構築する

`master`ブランチへ移動した上で、それぞれの環境のセットアップ方法に従い v2 環境を構築する

- [Linux / macOS 用セットアップマニュアル](linux-setup.md)
- [Windows 用セットアップマニュアル](windows-setup.md)


## 4. 移行先の v2 の設定ファイルを移行元の v1 の設定ファイルと合わせる

### recorded

v1

```json
"recorded": "/hoge/huga",
```

v2

```yaml
recorded:
    - name: recorded
      path: '/hoge/huga'
```

### thumbnail

v1

```json
"thumbnail": "/hoge/fuga"
```

v2

```yaml
thumbnail: '/hoge/fuga'
```

### encode

v1

```
"encode": [
        {
            "name": "H264",
            "cmd": "%NODE% %ROOT%/config/enc.js",
            "suffix": ".mp4"
        }
    ],
```

v2

```
encode:
    - name: H.264
      cmd: '%NODE% %ROOT%/config/enc.js'
      suffix: .mp4
      rate: 4.0
```

---

### 5. v1 環境の後片付け

以下コマンドで v1 環境のDBや設定などのデータを削除する。  
削除するのが心配な場合には、基本的にはそのままで問題ないが、sqlliteを使用している場合、DB接続がうまく行かない場合がある。[^1]

```shell
$ rm -rf data
$ git checkout data
$ rm -f config/*.json
```

### 6. v2 環境に v1 環境のデータを反映させる

```shell
$ npm run v1migrate FILENAME
```

### 7. (Optional) 自動起動するように設定していた場合

スクリプトのパスが変わっているため、それぞれの環境でサービスの削除と再登録が必要になります。

- [Linux / macOS 用セットアップマニュアル](linux-setup.md#epgstation-の起動--終了)
- [Windows 用セットアップマニュアル](windows-setup.md#epgstation-の起動終了)

[^1]: `check db`を表示され続け`v1migrate`が終了しない
