SQLite3 使用時の正規表現での検索の有効化について
===

[SQLite](https://www.sqlite.org/) は標準で REGEXP 関数をサポートしておらず正規表現での検索ができません。ただし、[Run-Time Loadable Extensions - SQLite](https://sqlite.org/loadext.html) にあるように実行時に自作の SQL 関数を読み込むことができます

この機能を使用して EPGStation で SQLite3 使用時でも正規表現を使えるようにする手順を紹介します

Debian 9.2 にて検証しています

## 1. shared library の作成

```
$ sudo apt-get -y install libpcre3-dev libsqlite3-dev
$ git clone https://github.com/l3tnun/sqlite3-pcre.git
$ cd sqlite3-pcre
$ make
```

```pcre.so``` が生成されますので適当な場所へ配置しましょう。このファイルを読み込みます。

## 2. EPGStation の修正

config.json に以下の項目を追加します。

```
    "sqlite3": {
        "extensions": [
            "/hoge/pcre.so"
        ],
        "regexp": true
    },
```

EPGStation を再起動したら以上で完了です