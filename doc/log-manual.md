# ログ出力設定のマニュアル

本マニュアルでは、EPGStation のログ出力設定ファイルである

-   `config/epgUpdaterLogConfig.yml`
-   `config/operatorLogConfig.yml`
-   `config/serviceLogConfig.yml`

の設定について解説します

## EPGStation のログ出力

EPGStation ではログ出力に [log4js](https://npmjs.com/package/log4js) を利用しています  
設定ファイルについても、 log4js の設定に準拠した形式となっています

log4js のログレベルは以下の 6 段階となっています

| レベル | 内容                                                                                         |
| ------ | -------------------------------------------------------------------------------------------- |
| fatal  | アプリケーションの異常終了など、致命的なエラーが発生した際のみログが出力されます             |
| error  | アプリケーション内でエラーが発生し、例外が出力された際にログが出力されます                   |
| warn   | アプリケーションの実行には影響はないが、正しくない実装が含まれる際に警告がログに出力されます |
| info   | アプリケーションの動作時にユーザーが認知する必要のある場合に情報がログに出力されます         |
| debug  | デバッグ時に利用し、アプリケーションの動作に関する詳細な情報がログに出力されます             |
| trace  | デバッグ時に使用し、動作に関わるほぼ全ての情報がログに出力されます                           |

各レベルは自身より上位のログの出力も含むため、`warn` 設定時は `error` と `fatal` も出力されます

## 出力レベルを変更する

EPGStation では、デフォルトでは `info` レベルが設定されています  
`ffmpeg` のコマンド出力結果などをログに出力したい場合は `debug` 以下の受信設定が必要です

`config/operatorLogConfig.yml` あるいは `config/serviceLogConfig.yml` 内の以下を変更します

```yaml
categories:
    default:
        appenders:
            - console
            - stdout
        level: info
    system:
        appenders:
            - system
            - stdout
        level: info
    access:
        appenders:
            - access
            - stdout
        level: info
    stream:
        appenders:
            - stream
            - stdout
        level: info
```

`"level": "info"` となっている部分を、任意のログレベルに変更することで出力されるログレベルも変更可能です  
例えば、`ffmpeg` によるストリーミング出力時の変換ログを出力したい場合は

```yaml
stream:
    appenders:
        - stream
        - stdout
    level: info
```

上記部分を下記のように変更することで対応可能です

```yaml
stream:
    appenders:
        - stream
        - stdout
    level: debug
```

## ログファイルを変更する

コンフィグファイル内の `appenders` 項目を変更することで対応可能です

デフォルトではファイルサイズが 1024KB を超過するとログローテーションされます  
ログファイルは 3 世代分保存され、古い方から消去されていきます  
ログのファイル名は `system`, `access`, `stream` になっており、ローテーション時にファイル末尾に年月日が付加されます

```yaml
appenders:
    system:
        type: file
        maxLogSize: 1048576
        backups: 3
        filename: '%OperatorSystem%'
        pattern: '-yyyy-MM-dd'
```

`maxLogSize` を大きくすることでログローテーションの頻度を変更したり、`backups` の数を増やして管理世代数を増やすことが出
来ます

`filename` や `pattern` を編集することで、出力されるログファイル名を変更することも出来ます `type` に `dateFile` を指定す
ると、容量ではなく日付でファイルが切り替わるようになります
