# SQLite3 使用時の正規表現での検索の有効化について

[SQLite](https://www.sqlite.org/) は標準で REGEXP 関数をサポートしておらず正規表現での検索ができません。ただし
、[Run-Time Loadable Extensions - SQLite](https://sqlite.org/loadext.html) にあるように実行時に自作の SQL 関数を読み込む
ことができます

この機能を使用して EPGStation で SQLite3 使用時でも正規表現を使えるようにする手順を紹介します

## shared library の作成

### 1. ソースコードのダウンロード

[SQLite Download Page](https://www.sqlite.org/download.html) から `sqlite-amalgamation-*.zip` と `sqlite-src-*.zip` をダ
ウンロードし、適当な場所に解凍する

### 2. ソースコードの配置

`sqlite-src-*/ext/misc/regexp.c` を `sqlite-amalgamation-*` へコピーする

### 3. ビルド

`sqlite-amalgamation-*` へ移動し以下のコマンドを実行する

-   Linux の場合

```
gcc -g -fPIC -shared regexp.c -o regexp.so
```

-   macOS の場合

```
gcc -g -fPIC -dynamiclib regexp.c -o regexp.dylib
```

-   Windows (64bit) の場合

スタートメニュー -> Visual C++ Build Tools -> Visual C++ 2015 x64 Native Build Tools Command Prompt を開き
`sqlite-amalgamation-*` へ移動し以下のコマンドを実行する

```
cl regexp.c -link -dll -out:regexp.dll
```

### ファイルの配置

生成された regexp.so (Linux), regexp.dylib (macOS), regexp.dll (Windows) を適当な場所へ配置する

## EPGStation の修正

config.yml に以下の項目を追加します。

```yaml
sqlite:
    extensions:
        - '/hoge/regexp.so'
    regexp: true
```

Windows でのファイルパス指定は

```
C:\\hoge\\regexp.dll
```

ではなく

```
C:/hoge/regexp.dll
```

となるので注意しましょう

EPGStation を再起動したら完了です
