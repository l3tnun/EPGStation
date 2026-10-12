# Device Test Runner

この runner は Android Chrome と iOS Safari / Simulator の実 browser で、React client の主要 route と副作用のない workflow を確認する。

## Local Env

machine-specific な値は tracked file に書かない。template を local env file にコピーして編集する。

```bash
cp client/device/.device-lab.local.env.template client/device/.device-lab.local.env
$EDITOR client/device/.device-lab.local.env
```

runner は `client/device/.device-lab.local.env` を読む。同じ env 名が process env に存在する場合は process env を優先する。

```bash
source client/device/.device-lab.local.env
```

tracked file に書かないもの:

- 検証対象の実 URL。
- SSH host。
- Android SDK / JDK / AVD / Appium workdir の実 path。
- Mac 上の Appium workdir / log / pid file の実 path。
- token / cookie / credential。
- 実番組情報を含む screenshot / log。

## Artifacts

実データを含む可能性がある screenshot / manifest は git ignored の `client/device/artifacts/` 配下に保存する。

```bash
git check-ignore -v client/device/.device-lab.local.env
git check-ignore -v client/device/artifacts/android/example.png
git check-ignore -v client/device/artifacts/ios/example.png
```

## Commands

`client/` で実行する。

```bash
npm run device:smoke
npm run device:workflow
npm run device:visual
npm run device:all
```

片方だけ確認する場合:

```bash
EPGSTATION_DEVICE_TARGET=android npm run device:smoke
EPGSTATION_DEVICE_TARGET=ios npm run device:smoke
```

検証対象 URL を一時的に上書きする場合:

```bash
EPGSTATION_CURRENT_UI_URL='http://<client-host>:<port>/' npm run device:smoke
```

## Suites

### `device:smoke`

Android Chrome と iOS Safari で主要 route を直接開き、title、hash、body text、JavaScript 実行、viewport、screenshot 保存を確認する。

対象 route:

- `#/`
- `#/guide`
- `#/onair`
- `#/recorded`
- `#/reserves`
- `#/search`
- `#/rule`
- `#/encode`
- `#/storages`
- `#/settings`

### `device:workflow`

実 API に副作用を出さない操作だけを行う。予約作成、削除、保護変更、録画削除、保存確定などは押さない。

- Dashboard から navigation drawer 経由で番組表へ移動する。
- 放映中で stream dialog を開く。
- 番組表で program dialog を開く。
- 録画済み一覧から録画詳細へ移動する。
- 録画詳細で Streaming dialog を開く。
- 予約、検索、ルール、設定、エンコード、ストレージの初期表示を確認する。
- ダークモード切替後に主要画面の title/body が読め、失敗文言が出ないことを確認する。
- ダークモード切替後に navigation drawer を開き、drawer 内の visible text/icon/pseudo icon が背景と同化しないことを DOM computed style の contrast 検査で確認する。

### `device:visual`

実データ環境では baseline screenshot 比較を必須にしない。主要 route と workflow state の screenshot を保存し、redacted manifest を生成する。

workflow state には `dark-navigation-drawer-open` を含める。この state は dark theme を有効化し、Dashboard で navigation drawer を開いた状態を保存する。

manifest には device、suite、route/state、title、redacted href、viewport dimensions、timestamp、screenshot relative path だけを記録する。

## Android Setup Summary

Android runner は `.device-lab.local.env` の値を使って以下を行う。

1. `adb start-server`。
2. emulator が booted でなければ configured AVD を起動する。
3. boot 完了を待つ。
4. Appium UiAutomator2 server を起動する。
5. Chrome session を作成して Web context に切り替える。
6. test 後に Appium session を削除する。
7. runner が起動した Appium / emulator だけ停止する。

前提:

- KVM が利用できること。
- user-local JDK 21 が `EPGSTATION_ANDROID_JAVA_HOME` にあること。
- Android SDK command line tools、platform-tools、emulator、Android 35 Google APIs x86_64 image が `EPGSTATION_ANDROID_SDK_ROOT` に入っていること。
- `EPGSTATION_ANDROID_AVD_NAME` の AVD が作成済みであること。
- `EPGSTATION_ANDROID_APPIUM_WORKDIR` に Appium と UiAutomator2 driver が導入済みであること。

### Android Lab Setup Details

KVM が使えることを確認する。

```bash
test -e /dev/kvm && ls -l /dev/kvm
test -r /dev/kvm && test -w /dev/kvm && echo "KVM readable/writable"
rg -c 'vmx|svm' /proc/cpuinfo
```

Android SDK は Android 35 Google APIs x86_64 image を使う。Android command line tools と SDK package の導入例:

```bash
source client/device/.device-lab.local.env

export JAVA_HOME="$EPGSTATION_ANDROID_JAVA_HOME"
export ANDROID_SDK_ROOT="$EPGSTATION_ANDROID_SDK_ROOT"
if [ -n "${EPGSTATION_ANDROID_AVD_HOME:-}" ] && [ "$EPGSTATION_ANDROID_AVD_HOME" != "<android-avd-home>" ]; then
  export ANDROID_AVD_HOME="$EPGSTATION_ANDROID_AVD_HOME"
fi
export PATH="$ANDROID_SDK_ROOT/platform-tools:$ANDROID_SDK_ROOT/emulator:$ANDROID_SDK_ROOT/cmdline-tools/latest/bin:$JAVA_HOME/bin:$PATH"

yes | sdkmanager --licenses
sdkmanager \
  "platform-tools" \
  "emulator" \
  "platforms;android-35" \
  "system-images;android-35;google_apis;x86_64"
```

JDK 21 や Android command line tools を user-local に導入する場合、archive URL や local zip path は local env や local note
だけに置き、tracked docs へ固定 URL を書かない。JDK は `EPGSTATION_ANDROID_JAVA_HOME/bin/java` が存在する layout に展開し、
command line tools は `EPGSTATION_ANDROID_CMDLINE_TOOLS_ZIP` から `cmdline-tools/latest` へ展開する。

emulator 36.5.11 で GRPC server 起動直後に終了する場合、emulator 35.6.9 へ downgrade する。archive URL や local zip
path は `EPGSTATION_ANDROID_EMULATOR_ZIP_35_6_9` に置き、tracked file には書かない。

```bash
source client/device/.device-lab.local.env

tmpdir="$(mktemp -d)"
case "$EPGSTATION_ANDROID_EMULATOR_ZIP_35_6_9" in
  http://*|https://*) curl -L -o "$tmpdir/emulator.zip" "$EPGSTATION_ANDROID_EMULATOR_ZIP_35_6_9" ;;
  *) cp "$EPGSTATION_ANDROID_EMULATOR_ZIP_35_6_9" "$tmpdir/emulator.zip" ;;
esac

unzip -q "$tmpdir/emulator.zip" -d "$tmpdir"
backup="$EPGSTATION_ANDROID_SDK_ROOT/emulator-backup-$(date +%Y%m%d-%H%M%S)"
mv "$EPGSTATION_ANDROID_SDK_ROOT/emulator" "$backup"
cp -a "$tmpdir/emulator" "$EPGSTATION_ANDROID_SDK_ROOT/emulator"
rm -rf "$tmpdir"
"$EPGSTATION_ANDROID_SDK_ROOT/emulator/emulator" -version
```

AVD は Google APIs image で作成する。

```bash
echo no | avdmanager create avd \
  -n "$EPGSTATION_ANDROID_AVD_NAME" \
  -k "system-images;android-35;google_apis;x86_64" \
  -d pixel_8 \
  --force
```

emulator 起動が不安定な場合は、AVD の `config.ini` に `hw.gsmModem = no` を設定する。`config.ini` の実 path は
`avdmanager list avd` で local shell だけで確認し、tracked file に書かない。

```bash
avd_path="$(avdmanager list avd | awk -v name="$EPGSTATION_ANDROID_AVD_NAME" '
  $1 == "Name:" && $2 == name {found=1}
  found && $1 == "Path:" {print $2; exit}
')"

if rg -q '^hw.gsmModem' "$avd_path/config.ini"; then
  perl -0pi -e 's/^hw\.gsmModem\s*=.*$/hw.gsmModem = no/m' "$avd_path/config.ini"
else
  printf '\nhw.gsmModem = no\n' >> "$avd_path/config.ini"
fi
```

日本語 UI と番組時刻を確認する場合は、AVD 側を `ja-JP` / `Asia/Tokyo` に揃える。

```bash
adb shell setprop persist.sys.locale ja-JP
adb shell setprop persist.sys.language ja
adb shell setprop persist.sys.country JP
adb shell setprop persist.sys.timezone Asia/Tokyo
adb shell stop
sleep 3
adb shell start
adb shell cmd activity get-config
adb shell date
```

Chrome Web context を操作する場合は Chrome version に合う Chromedriver が必要になる。Appium server は Chromedriver
auto-download を許可して起動する。

```bash
mkdir -p "$EPGSTATION_ANDROID_APPIUM_WORKDIR"
cd "$EPGSTATION_ANDROID_APPIUM_WORKDIR"
if [ ! -f package.json ]; then
  printf '%s\n' '{"name":"epgstation-android-automation","private":true,"type":"module"}' > package.json
fi
npm install appium webdriverio --save-dev
./node_modules/.bin/appium driver install uiautomator2 || true
./node_modules/.bin/appium driver list --installed
./node_modules/.bin/appium --version

./node_modules/.bin/appium \
  --address 127.0.0.1 \
  --port 4725 \
  --base-path / \
  --allow-insecure 'uiautomator2:chromedriver_autodownload'
```

短命 shell から `nohup emulator ... &` で起動すると shell 終了後に emulator も終了する環境がある。調査時は emulator
を前景 process として維持する terminal/session を 1 つ開いたままにする。

手動 cold boot で問題を切り分ける場合は、`adb kill-server && adb start-server` 後に以下のような flag を使う。実 AVD 名や
path は local env から読み、tracked file へ書かない。

```bash
emulator -avd "$EPGSTATION_ANDROID_AVD_NAME" \
  -no-window \
  -no-audio \
  -no-boot-anim \
  -wipe-data \
  -no-snapshot-load \
  -no-snapshot-save \
  -no-metrics \
  -no-sim \
  -gpu swiftshader_indirect \
  -camera-back none \
  -camera-front none
```

Chrome 初回起動で privacy / account dialog が出る場合は、screenshot を確認してから `Use without an account` などを選ぶ。座標は
emulator の解像度や density で変わるため、固定座標を tracked docs へ残さない。

Chrome の翻訳 popup は EPGStation UI 仕様に含めない。表示された場合は Chrome 側 popup として local validation log に記録し、必要なら Chrome settings で翻訳を無効化する。設定手順や screenshot は実環境依存なので tracked file に残さない。

## iOS Setup Summary

iOS runner は `.device-lab.local.env` の値を使って以下を行う。

1. SSH 経由で Simulator を起動する。
2. booted simulator の UDID を取得する。
3. Mac 側で Appium XCUITest server を起動する。
4. SSH port forward を張る。
5. Safari session を作成して Web context に切り替える。
6. test 後に Appium session を削除する。
7. runner が起動した port forward / Appium を停止する。

前提:

- Mac に Xcode と対象 iOS Simulator runtime が入っていること。
- repository 側から `EPGSTATION_IOS_MAC_SSH_HOST` へ SSH 接続できること。
- Mac 側の `EPGSTATION_IOS_MAC_APPIUM_WORKDIR` に Appium と XCUITest driver が導入済みであること。
- `EPGSTATION_IOS_APPIUM_URL` が SSH port forward 後に到達可能であること。

### iOS Lab Setup Details

Mac 側の Xcode / Simulator runtime / license を確認する。実 host 名は `.device-lab.local.env` から読み、tracked file には書かない。

```bash
source client/device/.device-lab.local.env

ssh "$EPGSTATION_IOS_MAC_SSH_HOST" 'xcodebuild -version'
ssh "$EPGSTATION_IOS_MAC_SSH_HOST" 'xcrun simctl list runtimes'
ssh "$EPGSTATION_IOS_MAC_SSH_HOST" 'xcrun simctl list devices available'
```

license が未承認の場合は Mac 側で承認する。

```bash
ssh "$EPGSTATION_IOS_MAC_SSH_HOST" 'sudo xcodebuild -license accept'
```

Simulator の起動、URL open、screenshot 取得は `xcrun simctl` を使う。

```bash
ssh "$EPGSTATION_IOS_MAC_SSH_HOST" \
  "open -a Simulator && xcrun simctl boot \"$EPGSTATION_IOS_SIM_DEVICE_NAME\" || true"

ssh "$EPGSTATION_IOS_MAC_SSH_HOST" 'xcrun simctl list devices booted'
ssh "$EPGSTATION_IOS_MAC_SSH_HOST" "xcrun simctl openurl booted '$EPGSTATION_CURRENT_UI_URL'"
ssh "$EPGSTATION_IOS_MAC_SSH_HOST" 'xcrun simctl io booted screenshot /tmp/epgstation-ios-check.png'
```

Mac 側 Appium workdir へ Appium と XCUITest driver を導入する。

```bash
ssh "$EPGSTATION_IOS_MAC_SSH_HOST" "
  set -e
  export PATH=\"$EPGSTATION_IOS_MAC_NODE_BIN_DIR:\$PATH\"
  mkdir -p \"$EPGSTATION_IOS_MAC_APPIUM_WORKDIR\"
  cd \"$EPGSTATION_IOS_MAC_APPIUM_WORKDIR\"
  if [ ! -f package.json ]; then
    printf '%s\n' '{\"name\":\"epgstation-ios-automation\",\"private\":true,\"type\":\"module\"}' > package.json
  fi
  npm install appium webdriverio --save-dev
  ./node_modules/.bin/appium driver install xcuitest || true
  ./node_modules/.bin/appium driver list --installed
"
```

Appium は Mac 側 `127.0.0.1` bind で起動し、repository 側から SSH port forward 経由で接続する。

```bash
ssh "$EPGSTATION_IOS_MAC_SSH_HOST" "
  set -e
  export PATH=\"$EPGSTATION_IOS_MAC_NODE_BIN_DIR:\$PATH\"
  cd \"$EPGSTATION_IOS_MAC_APPIUM_WORKDIR\"
  nohup ./node_modules/.bin/appium \
    --address 127.0.0.1 \
    --port 4723 \
    --base-path / \
    > \"$EPGSTATION_IOS_MAC_APPIUM_LOG\" 2>&1 &
  echo \$! > \"$EPGSTATION_IOS_MAC_APPIUM_PID_FILE\"
"

ssh -N -L 4723:127.0.0.1:4723 "$EPGSTATION_IOS_MAC_SSH_HOST"
```

Safari session では WebView context を取得できるように `appium:includeSafariInWebviews=true` を使う。

```json
{
  "capabilities": {
    "alwaysMatch": {
      "platformName": "iOS",
      "appium:automationName": "XCUITest",
      "appium:udid": "<booted-device-udid>",
      "browserName": "Safari",
      "appium:newCommandTimeout": 300,
      "appium:includeSafariInWebviews": true
    }
  }
}
```

Safari Web Inspector は console / network 調査に使える。`document.body.innerText`、network log、screenshot には実 URL
や実番組情報が含まれ得るため、tracked file に残さない。

iOS Safari の操作調査では、raw coordinate tap より先に DOM click または element click を使う。Safari browser chrome、
status bar、safe area により native screenshot 座標と WebView 座標がずれるため、raw tap を使う場合は
`innerWidth`、`innerHeight`、`visualViewport.width`、`visualViewport.height`、`visualViewport.offsetTop`、
`visualViewport.offsetLeft` を validation log に記録してから pointer action を使う。実 URL、番組名、座標付き screenshot は
tracked file に残さない。

## Release Checklist

公開前に実 device verification を実施する場合は、`client/` で以下を実行する。

```bash
npm run build
npm run visual
npm run device:smoke
npm run device:workflow
npm run device:visual
npm run device:all
git status --short
```

`git status --short` で、`client/device/.device-lab.local.env`、`client/device/artifacts/`、実 URL / host、実番組情報を含む
log や screenshot が tracked change に混ざっていないことを確認する。

## Failure Checks

- `client/device/.device-lab.local.env` が存在し、placeholder のまま残っていないことを確認する。
- Android は `adb devices` と `adb shell getprop sys.boot_completed` を確認する。
- Android Appium は `EPGSTATION_ANDROID_APPIUM_WORKDIR` で `appium --version`、`appium driver list --installed`、UiAutomator2 driver の存在を確認する。
- iOS は Mac 側で `xcrun simctl list devices booted` を確認する。
- iOS で `xcrun simctl openurl` が失敗する場合は URL typo、Mac Safari からの到達性、Simulator network が Mac host と同じ LAN へ到達できることを確認する。
- Appium は configured URL の `/status` が応答することを確認する。iOS session 作成に失敗する場合は Xcode license、booted device、Mac 側 Appium log、XCUITest driver の導入状態を確認する。
- iOS Web context が出ない場合は、Safari が対象 URL を開いていること、`appium:includeSafariInWebviews` が `true` であること、page load 後に数秒待ってから contexts を取得していることを確認する。
- 失敗時の標準出力は redacted される。実 host / URL / path が必要な調査は local shell のみで行い、tracked file へ貼らない。
