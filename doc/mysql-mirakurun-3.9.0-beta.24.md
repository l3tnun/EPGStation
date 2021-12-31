# Mirakurun 3.9.0-beta.24 以降の MySQL(MariaDB) 設定について

Mirakurun 3.9.0-beta.24 以降から Unicode 処理が変更された影響により、従来の EPGStation の文字コード設定(utf8)ではデータ
ベースが更新できない不具合が発生しました。以下に対処方法を記載します。  
<br></br>

## 1. EPGStation の設定を変更する

### 1-1. charset を追加する

`config/config.yml` を開き `mysql.charset` を `utf8mb4` に設定する

```yaml
dbtype: mysql
mysql:
    host: 127.0.0.1
    port: 3306
    user: epgstation
    password: epgstation
    database: epgstation
    charset: utf8mb4
```

### 1-2. 囲み文字の置換設定を行う

今までどおり囲み文字を置換する場合(デフォルト設定)

```yaml
needToReplaceEnclosingCharacters: true
```

囲み文字の置換をしない場合  
※ DB に MySQL を使用し、`collation`を`utf8mb4_0900_as_ci`へ変更する必要あり

```yaml
needToReplaceEnclosingCharacters: false
```

<br></br>

## 2. MySQL(MariaDB) の文字コード設定を utf8mb4 へ変更する

[docker-mirakurun-epgstation](https://github.com/l3tnun/docker-mirakurun-epgstation) を使用している場合は以下のようにし
てください。  
そうでない場合は自力で文字コードを utf8mb4 に変更してください。(サーバの設定とデータベースの文字コードを両方変更すること
)

### 2-1. データベースのバックアップ作成

```bash
sudo docker-compose down # コンテナを落とす
sudo docker-compose run --rm --entrypoint sh epgstation # epgstation のコンテナの中に入る

# ここから epgstation のコンテナの中での作業
# データベースのバックアップを取ります
cd /app
npm run backup config/backup.json # バックアップファイルは docker-compose.yml の volumes でマウントしている先を指定すること
exit # コンテナから出る
```

### 2-2. バックアップファイルが存在するか確認する

`docker-mirakurun-epgstation/epgstation/config` 下にバックアップファイルが生成されていることを確認してください。

### 2-3. データベース削除

```bash
sudo docker-compose down -v
```

### 2-4. MySQL(MariaDB) の設定を変更

`docker-compose.yml` の `services -> mysql -> command` を以下のように変更する。

```
# MySQL の場合
command: --character-set-server=utf8mb4 --collation-server=utf8mb4_0900_as_ci --performance-schema=false --expire_logs_days=1 --default-authentication-plugin=mysql_native_password
```

```
# MariaDB の場合
command: --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci --performance-schema=false --expire_logs_days=1
```

### 2-5. バックアップからデータベースの内容を復元させる

```bash
sudo docker-compose run --rm --entrypoint sh epgstation # epgstation のコンテナの中に入る

# ここから epgstation のコンテナの中での作業
cd /app
npm run restore config/backup.json
exit # コンテナから出る
```
