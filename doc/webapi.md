EPGStation WebAPI マニュアル
===
本マニュアルでは、EPGStation が提供する WebAPI について解説します

## EPGStation における WebAPI
EPGStation が提供する WebAPI は [express-openapi](https://www.npmjs.com/package/express-openapi) によって提供される、OpenAPI (Swagger) 準拠の RESTful API です  
利用可能な全てのAPIは **Swagger UI** 上で確認可能です  
`http://<hostname>:<port>/api/debug`

### API へのアクセス
各APIへのリクエストは `http://<hostname>:<port>/api/` から行います  
ターミナルからは `curl` を用いて確認が可能です
```bash
curl -o - -X {method} -H 'Content-type:{content-type}' http://<hostname>:<port>/api/{api-path}
```
#### Basic認証利用時のAPIアクセス
WebAPI へのアクセスにも認証が必要です
`http://<username>:<password>@<hostname>:<port>/api/{api-path}` とすることでURLのみで認証可能です
