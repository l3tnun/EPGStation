import { CORE_SCHEMA, defineScalarTag } from 'js-yaml';

/**
 * config.yml の値に `!env 環境変数名` と書くと、その環境変数の値（文字列）に置き換わるタグ。
 * 環境変数が定義されていないときは読み込みを失敗させる（空文字列は定義済みとして扱う）。
 * 読み込みのたびに `process.env` を参照するので、再読み込みでは最新の値になる。
 * あわせて、アンカー・別名の merge key `<<` も展開する（v2 の既定の解釈と同じ）。
 * それ以外の YAML の解釈は既定（`CORE_SCHEMA`）のまま変えない。
 *
 * 起動時の `Configuration` と、データ構造更新の CLI が読む `ormconfig.js`（build 後の
 * `dist/model/ConfigYaml.js` を読み込む）が同じ定義を使う。
 */
export const ENV_TAG = defineScalarTag('!env', {
    resolve: (name: string) => {
        const value = process.env[name];
        if (typeof value === 'undefined') {
            throw new Error(`environment variable ${name} is not defined`);
        }
        return value;
    },
    identify: () => false,
});

/** config.yml を `js-yaml` の `load` で読むときの option。 */
export const CONFIG_YAML_OPTIONS = { schema: CORE_SCHEMA.withTags(ENV_TAG) };

/**
 * `dbtype` の `better-sqlite3` を `sqlite` と同じ値として扱うために読み替える。
 * それ以外の値（未設定を含む）はそのまま返す。
 */
export const normalizeDBType = <T>(dbtype: T): T | 'sqlite' =>
    <unknown>dbtype === 'better-sqlite3' ? 'sqlite' : dbtype;
