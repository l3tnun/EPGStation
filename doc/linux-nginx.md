# nginxを利用したリバースプロキシの動作設定
nginxを利用したリバースプロキシにてEPGstationを動かす場合の設定について解説します。

## config.json
### serverPort
#### EPGStation が Web アクセスを待ち受けるポート番号

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | 8888 | yes |

```json
"serverPort": 8888
```

### socketioPort
#### EPGStation が Socket.IO アクセスを待ち受けるポート番号

serverPort と同じポート番号を設定しても良い

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | serverPort + 1 | no |

```json
"socketioPort": 8888
```

### clientSocketioPort
### EPGStation の Web クライアントが接続する Socket.IO のポート番号

リバースプロキシを使用している場合は必須となる(リバースプロキシの受信ポートと同じにする事)

| 種類 | デフォルト値 | 必須 |
| --- | ---------- | --- |
| number | serverPort + 1 | no |

```json
"clientSocketioPort": 80
```

## nginx設定
下記の通り、リバースプロキシの設定を行います。  
※`localhost`は適宜変更してください。

```
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server{
    listen 80;

    add_header X-Frame-Options SAMEORIGIN;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    etag off;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Server $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;

    location / {
        proxy_pass http://localhost:8888/;
    }
}
```
