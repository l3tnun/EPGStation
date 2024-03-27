# macOS でのカスタム URL Sceheme の設定

## config.yml の設定

urlscheme の各プロパティを下記のように `mac` プロパティを追加してください

```yaml
urlscheme:
    m2ts:
        ios: 'vlc-x-callback://x-callback-url/stream?url=PROTOCOL://ADDRESS"'
        android: 'intent://ADDRESS#Intent;package=org.videolan.vlc;type=video;scheme=PROTOCOL;end'
        mac: 'cvlc://ADDRESS'
    video:
        ios: 'infuse://x-callback-url/play?url=PROTOCOL://ADDRESS'
        android: 'intent://ADDRESS#Intent;package=com.mxtech.videoplayer.ad;type=video;scheme=PROTOCOL;end'
        mac: 'cvlc://ADDRESS'
```

## AppleScript でのカスタム URL Scheme アプリの作成

[Qiita: AppleScript でカスタム URL スキーム](http://qiita.com/CorecaraBiz/items/9a1fc60aada31858d582) を参考にしていま
す。詳しい解説はそちらを見てください

Safari での挙動についてはこちらの [issue](https://github.com/l3tnun/EPGStation/issues/324#issuecomment-633255822) を参照
してください

### 1. アプレットの作成

以下のコードを AppleScript Editor で記述してアプレットとして書き出してください

`/Applications/VLC.app` で渡された URL を開くようになっています

```
on open location url_scheme
	(*デリミタで文字列抽出*)
	set AppleScript's text item delimiters to {"cvlc://"}
	set txt_items to text items of url_scheme
	set AppleScript's text item delimiters to {""}
	set scheme_txt to txt_items as Unicode text

	do shell script ({"/Applications/VLC.app/Contents/MacOS/VLC ", "https://" & scheme_txt} as string)
end open location
```

### 2. info.plist の編集

書き出したアプレットの info.plist を編集します。

書き出したアプレットのを右クリック -> パッケージ内容を表示 -> Contents -> Info.plist

以下を追加してください

```
<key>CFBundleURLTypes</key>
<array>
    <dict>
        <key>CFBundleURLName</key>
        <string>biz.corecara.cvlc</string>
        <key>CFBundleURLSchemes</key>
        <array>
            <string>cvlc</string>
        </array>
    </dict>
</array>
```

### 3. 実行

macOS の Chrome or Firefox で EPGStation へアクセスして実際に動作するか確かめてください
