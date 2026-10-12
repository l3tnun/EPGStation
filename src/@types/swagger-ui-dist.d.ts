// swagger-ui-dist は型を同梱しない。使うのは配布物の場所を返す 1 つだけなので、そこだけ宣言する。
//
// package の entry (index.js) は browser 向けの bundle を読み込む。その bundle は評価時に
// localStorage へ触るため、Node 26 では ExperimentalWarning が stderr へ出る。配布物の場所を
// 返すだけの absolute-path.js を直接指して、bundle を読まないようにする。
declare module 'swagger-ui-dist/absolute-path.js' {
    const getAbsoluteFSPath: () => string;
    export default getAbsoluteFSPath;
}
