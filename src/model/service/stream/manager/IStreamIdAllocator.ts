import type * as apid from '../../../../../api.js';

/**
 * StreamManageModel が streamId を採番する際に相談する collaborator。
 *
 * StreamManageModel が管理する「active な stream の集合」だけでなく、
 * プロセス外の資源（例: 何らかの理由で削除されずに残ったディスク上の成果物）とも
 * 衝突しない streamId を選びたいストリーム種別のために存在する。
 *
 * StreamManageModel はこの collaborator が具体的に何を調べているか
 * （どんな成果物を、どこに書き出す種別なのか）を一切知らない。
 * ある stream がこの collaborator を必要とするかどうかは
 * IStreamBaseModel#ownsDiskArtifacts() や、呼び出し元が明示的に渡す情報から
 * 判断され、StreamManageModel は「使うか使わないか」という構造的な事実だけを扱う。
 */
export default interface IStreamIdAllocator {
    /**
     * この allocator が現在利用可能か（設定や実体が注入されていない等の理由で
     * 無効化されていないか）を返す。
     */
    isAvailable(): boolean;

    /**
     * 起動時の走査を（まだ着手していなければ）開始する。冪等。
     */
    beginInitialization(): void;

    /**
     * 現在の外部資源の占有状況のスナップショットを取得する。
     * isAvailable() が false の場合は null を返す。
     */
    captureSnapshot(): Promise<ReadonlySet<apid.StreamId> | null>;

    /**
     * activeStreamIds（既存の active な stream が使用中の streamId）とも
     * snapshot（外部資源が占有している streamId）とも衝突しない streamId を選ぶ。
     */
    reserve(activeStreamIds: Iterable<apid.StreamId>, snapshot: ReadonlySet<apid.StreamId>): apid.StreamId;

    /**
     * 既に払い出した streamId が、その後の外部資源の状態変化で
     * 衝突していないかを調べる。
     */
    hasArtifactCollision(streamId: apid.StreamId): Promise<boolean>;

    /**
     * streamId を「既知の衝突」として記録する。以後の reserve() はこの値を避ける。
     */
    markKnownCollision(streamId: apid.StreamId): void;

    /**
     * markKnownCollision() で記録済みの streamId 集合を返す。
     */
    knownCollisions(): ReadonlySet<apid.StreamId>;

    /**
     * streamId の使用が終わったことを通知する（内部カーソルの前進等、次回以降の
     * reserve() に対する副作用を持ちうる）。
     */
    release(streamId: apid.StreamId): void;
}
