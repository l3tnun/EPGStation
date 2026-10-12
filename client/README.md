# EPGStation React Client

`client/` は EPGStation の React / TypeScript / Vite frontend package です。root build、Docker、CI はこの package を install / build します。

## 主な script

- `npm run check`: lint、format check、typecheck、dev server の確認（`test:dev-server`）、`unittest/spec`、`unittest/imp`
- `npm run build`: Vite production build のみ（`bundle` の alias）
- `npm run build:verify`: lint、typecheck、unit test（`test:run`）、`build`
- `npm run bundle`: Vite production build のみ。Playwright が配信する `dist/` を作る
- `npm run e2e`: Playwright E2E smoke。`dist/` を `vite preview` で配信するだけで build はしない
- `npm run visual`: Playwright geometry regression smoke。build 前提は `e2e` と同じ

## ローカルでの確認

PR の `check` job が実行するのは lint・typecheck・format:check だけで、`npm run lint`、`npm run typecheck`、`npm run format:check` で流せます。`npm run check` は lint・format check・typecheck に加えて dev server の確認、`unittest/spec`、`unittest/imp` を実行します。bundle・e2e・visual まで含めた確認は、`npm run build:verify`、`npm run coverage:gate`、`npm run bundle`、`npm run e2e`、`npm run visual` を順に実行します。依存 package は事前に導入されている必要があります。
