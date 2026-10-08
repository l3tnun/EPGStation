import type * as apid from '../../../../api.js';

/**
 * エンコードが録画コンテンツを使用している間の排他リース。
 * これはサービス間の合成用ポートであり、公開 API には含めない。
 */
export default interface IRecordedResourceUsePort {
    acquire(recordedId: apid.RecordedId, kind: 'encoding'): Promise<{ token: object }>;
    release(token: object): Promise<void>;
}
