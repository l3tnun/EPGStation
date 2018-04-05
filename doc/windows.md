Windows でのインストール方法
===

## 必要なもの

* [Node.js](https://nodejs.org/ja/) LTS 版がおすすめです
* [FFmpeg](http://ffmpeg.org/download.html) 最新の安定版
* [MySQL](https://dev.mysql.com/) or [MariaDB](https://mariadb.org/) (※ SQLite3 で使用する場合は不要です)

## あると便利なもの

* [TeraPad](http://www5f.biglobe.ne.jp/~t-susumu/) config.json 等を編集するため
* [Git for Windows](https://git-for-windows.github.io/) EPGStation をアップデートするときに便利です

## Node.js のインストール

ダウンロードしてきたインストーラを実行してください

## FFmpeg のインストール

ダウンロードした ffmpeg.exe を適当な場所へ配置してくだい

## MySQL のインストール (※ SQLite3 で使用する場合は不要です)

5.7.19 においては [ Visual Studio 2013 の Visual C++ 再頒布可能パッケージ](https://www.microsoft.com/ja-jp/download/details.aspx?id=40784) が必要になるのでダウンロードしてインストールしておくといいと思います

MySQL のインストーラを起動したら、MySQL Server をインストールしてください

ユーザの作成も行えるので、EPGStation で使用するユーザを作成してください

インストール完了後、MySQL の Command Line Client 等を利用して MySQL に入り、文字コードが utf8 か確認してください

```
mysql> show variables like "char%";
+--------------------------+---------------------------------------------------------+
| Variable_name            | Value                                                   |
+--------------------------+---------------------------------------------------------+
| character_set_client     | utf8                                                    |
| character_set_connection | utf8                                                    |
| character_set_database   | utf8                                                    |
| character_set_filesystem | binary                                                  |
| character_set_results    | utf8                                                    |
| character_set_server     | utf8                                                    |
| character_set_system     | utf8                                                    |
| character_sets_dir       | C:\Program Files\MySQL\MySQL Server 5.7\share\charsets\ |
+--------------------------+---------------------------------------------------------+
8 rows in set, 1 warning (0.01 sec)
```

確認ができたら EPGStation で使用するデータベースの作成をしてください

```
mysql> create database database_name;
mysql> grant all on database_name.* to username@localhost identified by 'password';
mysql> quit
```

## ビルドツールのインストール

管理者権限で以下のコマンドを実行してください

```
npm install -g windows-build-tools
```
C++ のコンパイラや Python 2.7 がインストールされます

## ファイアウォールの設定
EPGStation で使用するポートを開放してください

## EPGStation のインストール

git をインストール済みの方は git で、そうでない方は zip で適当な場所へダウンロードしてください

あとは Readme に書いてあるとおりですが、config.json での設定で幾つか注意点があります。

### 改行コード

*.sample.json をメモ帳で開くと改行がなくなって表示されますが、これは改行コードの違いによるものです。

対応したエディタ (TeraPad 等) で開くと正常に表示されます。

### パス名区切り文字

unix 系では ```/``` を使用するため *.sample.json では ```/hoge/huga/piyo``` と書かれていますが、windows では ```\\hoge\\huga\\piyo``` このように書いてください

### config.json

#### mirakurunPath

名前付きパイプを使用するなら ```\\\\.\\pipe\\mirakurun```

http 接続なら ```http://host:port```

※ Windows に Mirakurun をインストールするのが面倒で名前付きパイプでは動作確認していません。動かなかったら教えていただけると助かります。

#### ffmpeg

ffmpeg のパスを ```C:\\ffmpeg\\ffmpeg.exe``` のように指定してください

#### encode

enc.sh を起動するようになっていますが、 windows では動かないので ```config/enc.js``` へ書き換えでください

```
"cmd": "C:\\PROGRA~1\\nodejs\\node.exe %ROOT%\\config\\enc.js main"
```

この ```PROGRA~1``` は 8.3 形式の表記方法で、 Program Files を指しています。cmd.exe にて ```dir /x c:\``` と打ち込むと確認できます

## サービス化

[winser](https://github.com/jfromaniello/winser) がインストールされている環境であれば、以下のコマンドを管理者権限で実行するとサービス化できます

```
npm run install-win-service
```

サービスから削除する場合は以下のコマンドを管理者権限で実行します

```
npm run uninstall-win-service
```
