# EPGStation WebAPI マニュアル

本マニュアルでは、EPGStation が提供する WebAPI について解説します

## EPGStation における WebAPI

EPGStation が提供する WebAPI は [express-openapi](https://www.npmjs.com/package/express-openapi) によって提供される
、OpenAPI (Swagger) 準拠の RESTful API です  
利用可能な全ての API は **Swagger UI** 上で確認可能です  
`http://<hostname>:<port>/api/debug`

### API へのアクセス

各 API へのリクエストは `http://<hostname>:<port>/api/` から行います  
ターミナルからは `curl` を用いて確認が可能です

```bash
curl -o - -X {method} -H 'Content-type:{content-type}' http://<hostname>:<port>/api/{api-path}
```

#### Servers び設定

localhost 以外からアクセスする場合は `config.yml` の `apiServers` の設定が必要です。

[doc/manual.md](conf-manual.md#apiservers) を参照
