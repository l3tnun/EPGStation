# Mirakurun 3.9.0-beta.24 以降の MySQL(MariaDB) 設定について

MySQL(MariaDB) を使う場合、接続とデータベースの table の文字コードは `utf8mb4` にする必要があります。`utf8`（utf8mb3）で
は、4 byte 文字を含む番組情報を保存できず、囲み文字・絵文字などの 4 byte 文字を検索やルールのキーワードに使えません。
以下に確認方法と変更の手順を記載します。  
<br></br>

## 0. 現在の設定を確認する

接続の文字コードは `config/config.yml` の `mysql.charset` で決まります。未設定のときは `utf8mb4` です。`utf8` などが書かれて
いる場合は 1-1 のとおり `utf8mb4` にしてください。

table の文字コードは次の SQL で確認できます。`<database>` は `mysql.database` に設定したデータベース名です。

```sql
-- データベースの既定の文字コード(新しく作られる table はこれになる)
SELECT default_character_set_name FROM information_schema.schemata WHERE schema_name = '<database>';

-- utf8mb4 ではない文字列の列(結果が 0 件であれば問題なし)
SELECT table_name, column_name, character_set_name
FROM information_schema.columns
WHERE table_schema = '<database>' AND character_set_name IS NOT NULL AND character_set_name <> 'utf8mb4';
```

`utf8` や `utf8mb3` が返る場合は、2 の手順でデータベースを作り直してください。接続と table のどちらか一方でも `utf8mb4` で
ない場合、4 byte 文字を含むキーワードによる正規表現検索(大小区別をしない検索)は、データベースのエラーで失敗します。大小区
別をする検索は、4 byte 文字を 1 つずつ書いたキーワードならエラーにはなりませんが、4 byte 文字を含む番組には一致しないこと
があります。MySQL では、4 byte 文字の範囲(`[X-Y]`)を含むキーワードは、この場合もエラーになります。  
<br></br>

### 接続と table を utf8mb4 にした後の、大小区別をする検索の制限

大小区別をする正規表現検索は、文字ではなく byte を単位に照合されます。このため `utf8mb4` にしても、4 byte 文字（囲み文字・
絵文字など）を含むキーワードには次の制限があります。

-   4 byte 文字を 1 つずつ書いたキーワード(例: `🈟`)は、一致します。
-   `.` は、4 byte 文字 1 文字に一致しません。`[...]` は文字の集合ではなく byte の集合として扱われ、中に 4 byte 文字を書くと、
    意図しない 4 byte 文字にも一致します。
-   4 byte 文字の範囲(`[X-Y]`)は、MySQL ではデータベースのエラー(`ERROR 3697`)になり、検索が失敗します。MariaDB ではエラーにな
    りませんが、byte の範囲として照合されるため、意図しない番組に一致します。

大小区別をしない検索は文字を単位に照合されるので、`utf8mb4` であればこれらの制限はありません。4 byte 文字に `.` や範囲を使
うキーワードは、大小区別をしない検索で使ってください。  
<br></br>

## 1. EPGStation の設定を変更する

### 1-1. charset を追加する

`mysql.charset` は未設定のとき `utf8mb4` になります。`utf8` などが設定されている場合は、`config/config.yml` を開き `mysql.charset` を `utf8mb4` に設定するか、この行を削除する

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
sudo docker-compose kill epgstation && docker-compose rm -f epgstation # コンテナを落とす
sudo docker-compose run --rm --entrypoint sh epgstation # epgstation のコンテナの中に入る

# ここから epgstation のコンテナの中での作業
# データベースのバックアップを取ります
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

`docker-compose.yml` の `services -> mysql -> command` に、次の文字コードと照合順序の指定を入れる(他の指定は変更しない)。

```
# MySQL の場合
--character-set-server=utf8mb4 --collation-server=utf8mb4_0900_as_ci
```

```
# MariaDB の場合
--character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
```

### 2-5. バックアップからデータベースの内容を復元させる

```bash
# バージョンを固定していた場合はmirakuruのバージョンを変更しmirakurunとepgstationを更新する
sudo docker-compose pull && sudo docker-compose build --pull
# epgstation のコンテナの中に入る
sudo docker-compose run --rm --entrypoint sh epgstation

# ここから epgstation のコンテナの中での作業
npm run restore config/backup.json
exit # コンテナから出る
```
