import { TunerProductDetector, TunerRequestOptions, TunerServerProduct } from '../types.js';

/** probe要求のHTTP応答から、判定に使う部分だけを取り出したもの。 */
export interface TunerProductProbeResult {
    readonly status: number;
    readonly body?: unknown;
}

/** 製品判定用のprobe要求を送る関数。`TunerHttpTransport.probeJson`を渡す想定。 */
export type TunerProductProbe = (options?: TunerRequestOptions) => Promise<TunerProductProbeResult>;

const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * チューナーサーバーがMirakurunかmirakcかを、既知の非互換な応答差で判定する。
 * Mirakurunに存在してmirakcに無いエンドポイントへprobeし、200でobject bodyが返れば`mirakurun`、
 * 404（そのエンドポイント自体が無い）なら`mirakc`と判定する。判定結果はconstructorのインスタンス
 * 単位でキャッシュし、以後の`detect`はprobeし直さない（サーバーの製品が実行中に変わらない前提）。
 */
export default class ProductDetector implements TunerProductDetector {
    /** 製品判定用のprobe要求を送る関数（constructor注入）。 */
    private readonly probe: TunerProductProbe;
    /** 判定済みの製品。未判定の間は`undefined`で、`detect`が初回成功した時点で確定し以後変わらない。 */
    private product: TunerServerProduct | undefined;

    constructor(probe: TunerProductProbe) {
        this.probe = probe;
    }

    /**
     * チューナーサーバーの製品を判定する。既に判定済みならprobeせずその値を返す。
     * @param options 中断用の`signal`等の共通オプション。
     * @returns 判定された製品。
     */
    public async detect(options?: TunerRequestOptions): Promise<TunerServerProduct> {
        if (this.product !== undefined) return this.product;
        const detected = await this.detectUncached(options);
        if (this.product === undefined) this.product = detected;
        return this.product;
    }

    /**
     * キャッシュを使わず、毎回probeして判定する。
     * @param options 中断用の`signal`等の共通オプション。
     * @returns 判定された製品。
     * @throws probe結果がどちらの判定条件にも合致しない場合。
     */
    private async detectUncached(options?: TunerRequestOptions): Promise<TunerServerProduct> {
        const result = await this.probe(options);
        if (result.status === 200 && isObject(result.body)) {
            return 'mirakurun';
        }
        if (result.status === 404) {
            return 'mirakc';
        }
        throw new Error('Unable to detect tuner server product');
    }
}
