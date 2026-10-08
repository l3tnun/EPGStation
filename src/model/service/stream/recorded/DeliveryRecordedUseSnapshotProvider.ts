/**
 * 「現在配信中の録画済みファイルの recordedId 集合」の取得結果。取得元
 * （`ActiveRecordedDeliveryIdSource`）が例外を投げた場合、呼び出し元へは空集合ではなく
 * `unknown` として伝え、「配信が無い」と「取得自体に失敗した」を区別できるようにする。
 */
export type DeliveryRecordedUseSnapshot =
    { readonly recordedIds: ReadonlySet<number>; readonly status: 'known' } | { readonly status: 'unknown' };

/**
 * 現在配信中の録画済みファイルの recordedId 集合を返せる取得元。
 * `ActiveRecordedDeliveryRegistry` がこの実装を提供する。
 */
export interface ActiveRecordedDeliveryIdSource {
    getActiveRecordedFileDeliveryIds(): ReadonlySet<number>;
}

/**
 * `ActiveRecordedDeliveryRegistry.register` が返す、登録解除用のハンドル。
 */
export interface ActiveRecordedDeliveryRegistration {
    release(): void;
}

/**
 * どの録画済みファイル（recordedId）が現在いくつ配信中かを、参照カウントで追跡する registry。
 * 同一ファイルへの複数配信（例: 複数クライアントからの同時視聴）を1つの recordedId として
 * まとめて数え、カウントが 0 になった時点で「配信中でない」に戻す。
 */
export class ActiveRecordedDeliveryRegistry implements ActiveRecordedDeliveryIdSource {
    /** recordedId ごとの現在の参照カウント（配信中の lease 数）。0 になった recordedId は保持しない。 */
    private readonly activeLeaseCounts = new Map<number, number>();

    public getActiveRecordedFileDeliveryIds(): ReadonlySet<number> {
        return new Set(this.activeLeaseCounts.keys());
    }

    /**
     * recordedId の配信中カウントを1つ増やし、対応する解除ハンドルを返す。
     * 返されたハンドルの `release()` は多重呼び出しに対して安全（2回目以降は無視する）。
     */
    public register(recordedId: number): ActiveRecordedDeliveryRegistration {
        this.activeLeaseCounts.set(recordedId, (this.activeLeaseCounts.get(recordedId) ?? 0) + 1);
        let released = false;

        return {
            release: () => {
                if (released) {
                    return;
                }
                released = true;
                this.remove(recordedId);
            },
        };
    }

    private remove(recordedId: number): void {
        const count = this.activeLeaseCounts.get(recordedId);
        if (count === undefined || count <= 1) {
            this.activeLeaseCounts.delete(recordedId);
            return;
        }

        this.activeLeaseCounts.set(recordedId, count - 1);
    }
}

/**
 * `ActiveRecordedDeliveryIdSource` からの取得結果を、失敗時の扱いも含めて
 * `DeliveryRecordedUseSnapshot` の形へ正規化する。
 */
export default class DeliveryRecordedUseSnapshotProvider {
    constructor(private readonly source: ActiveRecordedDeliveryIdSource) {}

    public getActiveRecordedFileDeliveryIds(): DeliveryRecordedUseSnapshot {
        try {
            return { recordedIds: new Set(this.source.getActiveRecordedFileDeliveryIds()), status: 'known' };
        } catch {
            return { status: 'unknown' };
        }
    }
}
