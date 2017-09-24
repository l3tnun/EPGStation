Windows でのカスタム URL Protocol の設定
===

## config.json の設定

recordedViewer, recordedDownloader, mpegTsViewer に

```
"win" : "cvlc://http://ADDRESS"
```

のように設定してください

## URL Protocol 設定

### 0. VLC media player のインストール

[VLC media player](http://www.videolan.org/vlc/) をダウンロードしてインストールしてください

### 1. バッチファイルの作成

以下のコードを `C:\DTV\open-vlc.bat` に保存してください

```C:\Program Files (x86)\VideoLAN\VLC\vlc.exe``` で渡された URL を開くようになっています

```
set vlcdata=%1
"C:\Program Files (x86)\VideoLAN\VLC\vlc.exe" "%vlcdata:~8%"
```

### 2. レジストリへの登録

先程保存した open-vlc.bat を URL Protocol で呼び出せるようにレジストリを設定します

以下のコードを ```reg``` ファイルで保存して実行してください

```
Windows Registry Editor Version 5.00
 
[HKEY_CLASSES_ROOT\cvlc]
@="URL:VLC Protocol"
"URL Protocol"=""
 
[HKEY_CLASSES_ROOT\cvlc\DefaultIcon]
 
[HKEY_CLASSES_ROOT\cvlc\shell]
 
[HKEY_CLASSES_ROOT\cvlc\shell\open]
 
[HKEY_CLASSES_ROOT\cvlc\shell\open\command]
@="\"C:\\DTV\\open-vlc.bat\" \"%1"
```

アンインストール用のコードは以下のようになります

```
Windows Registry Editor Version 5.00
 
[-HKEY_CLASSES_ROOT\cvlc]
```

### 3. 実行

Windows で EPGStation へアクセスして実際に動作するか確かめてください
