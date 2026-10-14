import { inject, injectable } from 'inversify';
import type * as apid from '../../../../api.js';
import IEncodeQueueDB, { EncodeQueueRow } from '../../db/IEncodeQueueDB.js';
import ILogger from '../../ILogger.js';
import ILoggerModel from '../../ILoggerModel.js';
import IEncodeQueueStore, { EncodeQueuePushSender, EncodeQueueRecord } from './IEncodeQueueStore.js';

/**
 * `IEncodeQueueStore` の実装。管理側（親 process）だけに置き、エンコードの依頼の記録（table `encode_queue`）への
 * 書き込みをここに集める。識別番号の割当てと記録の保存・更新・削除・一覧は、呼び出された順に一件ずつ直列に行う。
 * 最初の操作の前に全記録を一度だけ読み、記録が使っている識別番号と次に割り当てる値を作る（読込に失敗したら、
 * 次の操作で読み直す）。詳細: `.kiro/specs/server-encoding/design.md` 4.4 節。
 */
@injectable()
class EncodeQueueStore implements IEncodeQueueStore {
    private log: ILogger;
    private encodeQueueDB: IEncodeQueueDB;
    /** 読み込んだ記録。識別番号から記録を引く。 */
    private records = new Map<apid.EncodeId, EncodeQueueRecord>();
    /** 壊れていたが削除できなかった記録の識別番号。一覧には出さず、割り当てにも使わない。 */
    private blockedIds = new Set<number>();
    /** `add` に渡された要求ごとの値から、その要求で記録した識別番号を引く（`abandon` で使う）。 */
    private requestTokens = new Map<string, apid.EncodeId>();
    /** 次に割り当てる識別番号の候補 */
    private nextId = 1;
    private isLoaded = false;
    /** 直列の処理の末尾 */
    private tail: Promise<unknown> = Promise.resolve();

    constructor(@inject('ILoggerModel') logger: ILoggerModel, @inject('IEncodeQueueDB') encodeQueueDB: IEncodeQueueDB) {
        this.log = logger.getLogger();
        this.encodeQueueDB = encodeQueueDB;
    }

    public add(option: apid.AddEncodeProgramOption, requestToken?: string): Promise<apid.EncodeId> {
        return this.run(async () => {
            const encodeId = await this.addRecord(option);
            if (typeof requestToken === 'string') {
                this.requestTokens.set(requestToken, encodeId);
            }

            return encodeId;
        });
    }

    public abandon(requestToken: string): Promise<void> {
        return this.run(async () => {
            const encodeId = this.requestTokens.get(requestToken);
            if (typeof encodeId === 'undefined') {
                return;
            }

            await this.deleteRecord(encodeId);
            this.log.encode.info(`abandoned encode request record is deleted: ${encodeId}`);
        });
    }

    public updateOutputPath(encodeId: apid.EncodeId, outputPath: string): Promise<void> {
        return this.run(async () => {
            await this.encodeQueueDB.updateOutputPath(encodeId, outputPath);
            const record = this.records.get(encodeId);
            if (typeof record !== 'undefined') {
                record.outputPath = outputPath;
            }
        });
    }

    public remove(encodeId: apid.EncodeId): Promise<void> {
        return this.run(() => this.deleteRecord(encodeId));
    }

    public list(): Promise<EncodeQueueRecord[]> {
        return this.run(async () => {
            return EncodeQueueStore.orderByAcceptance([...this.records.keys()]).map(id => {
                const record = this.records.get(id) as EncodeQueueRecord;

                return { ...record, option: { ...record.option } };
            });
        });
    }

    public enqueueFromRecording(option: apid.AddEncodeProgramOption, send: EncodeQueuePushSender): void {
        this.run(async () => {
            let encodeId: apid.EncodeId;
            try {
                encodeId = await this.addRecord(option);
            } catch (err: unknown) {
                this.log.encode.error(
                    `failed to record an encode request from a finished recording: ${option.recordedId}`,
                );
                this.log.encode.error(err);

                return;
            }

            try {
                if (send(encodeId, option) === false) {
                    this.log.encode.info(`encode request is recorded and waits for the service process: ${encodeId}`);
                }
            } catch (err: unknown) {
                this.log.encode.error(`failed to hand over the recorded encode request: ${encodeId}`);
                this.log.encode.error(err);
            }
        }).catch((err: unknown) => {
            // 記録を読み込めず依頼を記録できなかった場合も、ログへ残す
            this.log.encode.error(`failed to record an encode request from a finished recording: ${option.recordedId}`);
            this.log.encode.error(err);
        });
    }

    /**
     * 処理を直列の末尾に並べ、記録を読み込んでから実行する
     */
    private run<T>(task: () => Promise<T>): Promise<T> {
        const result = this.tail.then(async () => {
            await this.load();

            return task();
        });
        this.tail = result.catch(() => undefined);

        return result;
    }

    /**
     * 全記録を読み、記録が使っている識別番号と次に割り当てる値を作る。読込済みなら何もしない
     */
    private async load(): Promise<void> {
        if (this.isLoaded === true) {
            return;
        }

        const rows = await this.encodeQueueDB.findAll();
        const records = new Map<apid.EncodeId, EncodeQueueRecord>();
        const blockedIds = new Set<number>();
        for (const row of rows) {
            const record = EncodeQueueStore.parseRow(row);
            if (record !== null) {
                records.set(record.id, record);
                continue;
            }

            this.log.encode.error(`invalid encode request record is deleted: ${row.id}`);
            try {
                await this.encodeQueueDB.deleteOnce(row.id);
            } catch (err: unknown) {
                this.log.encode.error(`failed to delete the invalid encode request record: ${row.id}`);
                this.log.encode.error(err);
                if (Number.isSafeInteger(row.id) === true && row.id >= 1) {
                    blockedIds.add(row.id);
                }
            }
        }

        const ordered = EncodeQueueStore.orderByAcceptance([...records.keys()]);
        this.records = records;
        this.blockedIds = blockedIds;
        this.nextId = ordered.length === 0 ? 1 : EncodeQueueStore.advance(ordered[ordered.length - 1]);
        this.isLoaded = true;
    }

    /**
     * 記録を削除し、その記録を指す要求ごとの値も消す
     */
    private async deleteRecord(encodeId: apid.EncodeId): Promise<void> {
        await this.encodeQueueDB.deleteOnce(encodeId);
        this.records.delete(encodeId);
        for (const [requestToken, tokenEncodeId] of this.requestTokens) {
            if (tokenEncodeId === encodeId) {
                this.requestTokens.delete(requestToken);
            }
        }
    }

    /**
     * 識別番号を割り当てて記録を保存する。保存に失敗したら識別番号と次の値を変えない
     */
    private async addRecord(option: apid.AddEncodeProgramOption): Promise<apid.EncodeId> {
        let encodeId = this.nextId;
        while (this.records.has(encodeId) === true || this.blockedIds.has(encodeId) === true) {
            encodeId = EncodeQueueStore.advance(encodeId);
        }

        const record: EncodeQueueRecord = {
            id: encodeId,
            option: { ...option },
            outputPath: null,
            createdAt: Date.now(),
        };
        await this.encodeQueueDB.insertOnce({
            id: record.id,
            option: JSON.stringify(record.option),
            outputPath: record.outputPath,
            createdAt: record.createdAt,
        });
        this.records.set(encodeId, record);
        this.nextId = EncodeQueueStore.advance(encodeId);

        return encodeId;
    }
}

namespace EncodeQueueStore {
    /**
     * 識別番号の次の値。`Number.MAX_SAFE_INTEGER` の次は 1
     * @param encodeId: 識別番号
     * @return 次の値
     */
    export const advance = (encodeId: number): number => {
        return encodeId === Number.MAX_SAFE_INTEGER ? 1 : encodeId + 1;
    };

    /**
     * 識別番号を受け付け順に並べる。昇順に並べ、隣り合う値の差（最後の値から先頭の値へは、最大値を越えて 1 へ
     * 戻る差）が最も大きい箇所の直後から並べる
     * @param ids: 識別番号
     * @return 受け付け順の識別番号
     */
    export const orderByAcceptance = (ids: number[]): number[] => {
        const sorted = [...ids].sort((a, b) => a - b);
        if (sorted.length <= 1) {
            return sorted;
        }

        let largestGapIndex = sorted.length - 1;
        let largestGap = Number.MAX_SAFE_INTEGER - sorted[sorted.length - 1] + sorted[0];
        for (let i = 0; i < sorted.length - 1; i++) {
            const gap = sorted[i + 1] - sorted[i];
            if (gap > largestGap) {
                largestGap = gap;
                largestGapIndex = i;
            }
        }

        const start = (largestGapIndex + 1) % sorted.length;

        return [...sorted.slice(start), ...sorted.slice(0, start)];
    };

    /**
     * DB の行を記録へ戻す。識別番号が範囲外、または依頼内容が解釈できない場合は null
     * @param row: DB の行
     * @return 記録または null
     */
    export const parseRow = (row: EncodeQueueRow): EncodeQueueRecord | null => {
        if (Number.isSafeInteger(row.id) === false || row.id < 1) {
            return null;
        }

        let value: unknown;
        try {
            value = JSON.parse(row.option);
        } catch {
            return null;
        }
        if (isAddEncodeProgramOption(value) === false) {
            return null;
        }

        return {
            id: row.id,
            option: value,
            outputPath: row.outputPath,
            createdAt: row.createdAt,
        };
    };

    const isAddEncodeProgramOption = (value: unknown): value is apid.AddEncodeProgramOption => {
        if (typeof value !== 'object' || value === null || Array.isArray(value) === true) {
            return false;
        }

        const option = value as Record<string, unknown>;

        return (
            typeof option.recordedId === 'number' &&
            typeof option.sourceVideoFileId === 'number' &&
            typeof option.parentDir === 'string' &&
            (typeof option.directory === 'undefined' || typeof option.directory === 'string') &&
            typeof option.mode === 'string' &&
            typeof option.removeOriginal === 'boolean'
        );
    };
}

export default EncodeQueueStore;
