import { rmdir, unlink } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';

/**
 * upload requestが最終的にどう終わったかの理由。`ServiceServer`の複数の並行イベント（request/response
 * のlifecycle event、timer、IPC登録結果）のうち最初に確定したものがこの値になる。
 * - `success`: 受信・登録とも成功した。
 * - `failure`: 受信中または登録処理でエラーが起きた。
 * - `abort`: クライアント切断やresponseの途中close等で処理が打ち切られた。
 * - `receive-timeout`: body受信が`config.uploadReceiveTimeoutMs`以内に完了しなかった。
 * - `registration-timeout`: 受信済みファイルの登録処理（IPC経由でoperator processへ）がtimeoutした。
 */
export type UploadTerminalReason = 'success' | 'failure' | 'abort' | 'receive-timeout' | 'registration-timeout';

/** `UploadAdmissionController.tryAcquire`が返す、同時アップロード枠1つ分の占有権。 */
export interface UploadLease {
    /** 占有権を解放する。複数回呼んでも2回目以降は何もしない。 */
    releaseOnce(): void;
}

/** cleanup処理が使う最小限のlogger契約。呼び出し元の具象loggerへ依存させないための境界。 */
export interface UploadCleanupLogger {
    error(message: string): void;
}

/**
 * 受信途中のmultipart bodyを、異常終了時に安全に巻き戻すための後始末役。
 * `request → parser(multer) → fileStream → outputStream(書き込み先file)`という pipe chain を
 * 保持し、異常終了時にunpipeしてから各streamをdestroyし、multerの`_handleFile`が待っている
 * callback（`settleStorage`）をエラーで解決してブロックを解く。
 */
export class UploadBodyReceiverTeardown {
    /** `bindParser`で登録された、multerが内部で使うparser stream（後始末対象）。未登録ならnull。 */
    private parser: Writable | null = null;
    /** `bindFile`で登録された、アップロードされたfile本体のreadable stream。未登録ならnull。 */
    private fileStream: Readable | null = null;
    /** `bindFile`で登録された、`fileStream`の書き込み先（一時payload fileへのwrite stream）。未登録ならnull。 */
    private outputStream: Writable | null = null;
    /** `bindFile`で登録された、multerの`_handleFile`callbackをエラーで解決するための関数。未登録ならnull。 */
    private settleStorage: ((error: Error) => void) | null = null;
    /** `teardownOnce`の結果を記憶し、複数回呼ばれても同じ後始末処理を使い回すためのcache。 */
    private teardownPromise: Promise<void> | null = null;
    /** `destroyTransportOnce`が既に実行済みかどうか（二重destroy防止）。 */
    private transportDestroyed = false;

    constructor(private readonly request: Readable) {}

    /** multerのparser streamを登録する。既に登録済みなら上書きしない。 */
    public bindParser(parser: Writable): void {
        if (this.parser === null) this.parser = parser;
    }

    /**
     * アップロードfileの受信streamと書き込み先、およびエラー時にmulterのcallbackを解決する関数を登録する。
     * 既にfileが登録済みなら何もしない（1 requestにつき1 fileのみを想定）。
     */
    public bindFile(fileStream: Readable, outputStream: Writable, settleStorage: (error: Error) => void): void {
        if (this.fileStream !== null) return;
        this.fileStream = fileStream;
        this.outputStream = outputStream;
        this.settleStorage = settleStorage;
    }

    /** 後始末を実行する。複数回呼ばれても最初の呼び出しの結果（Promise）を返す。 */
    public teardownOnce(error: Error): Promise<void> {
        if (this.teardownPromise === null) {
            this.teardownPromise = this.teardown(error);
        }
        return this.teardownPromise;
    }

    /** 元のHTTP requestのtransportをdestroyする（client切断時など）。複数回呼んでも1回しか実行しない。 */
    public destroyTransportOnce(): void {
        if (this.transportDestroyed) return;
        this.transportDestroyed = true;
        if (!this.request.destroyed) this.request.destroy();
    }

    private async teardown(error: Error): Promise<void> {
        const parser = this.parser;
        const fileStream = this.fileStream;
        const outputStream = this.outputStream;

        if (parser !== null) this.request.unpipe(parser);
        if (fileStream !== null) fileStream.unpipe(outputStream as Writable);

        if (parser !== null && !parser.destroyed) parser.destroy();
        if (fileStream !== null && !fileStream.destroyed) fileStream.destroy();

        let outputClosed: Promise<void> = Promise.resolve();
        if (outputStream !== null && !outputStream.closed) {
            outputClosed = new Promise(resolve => outputStream.once('close', resolve));
        }
        if (outputStream !== null && !outputStream.destroyed) outputStream.destroy();

        await outputClosed;
        this.settleStorage?.(error);
    }
}

/**
 * アップロードされたfileの受け皿として事前に作られた一時directory（`tokenDirectory`）と、その中の
 * payload file path（`payloadPath`）の所有者。登録処理が完了しなかった場合、これらを削除する責務を持つ。
 */
export class IncomingUploadFile {
    /** `cleanupOnce`の結果を記憶し、複数回呼ばれても同じ削除処理を使い回すためのcache。 */
    private cleanupPromise: Promise<void> | null = null;

    constructor(
        public readonly tokenDirectory: string,
        public readonly payloadPath: string,
        private readonly logger: UploadCleanupLogger,
    ) {}

    /** payload fileと一時directoryを削除する。複数回呼ばれても最初の呼び出しの結果を返す。 */
    public cleanupOnce(): Promise<void> {
        if (this.cleanupPromise === null) {
            this.cleanupPromise = this.cleanupOwnedPaths();
        }
        return this.cleanupPromise;
    }

    private async cleanupOwnedPaths(): Promise<void> {
        await this.removeExact('payload', this.payloadPath, () => unlink(this.payloadPath));
        await this.removeExact('token directory', this.tokenDirectory, () => rmdir(this.tokenDirectory));
    }

    /** 1件のpath削除を試みる。既に存在しない（`ENOENT`）場合は成功扱い。他のエラーはloggerへ記録するのみで投げ直さない。 */
    private async removeExact(label: string, target: string, remove: () => Promise<void>): Promise<void> {
        try {
            await remove();
        } catch (error: unknown) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            const message = error instanceof Error ? error.message : String(error);
            try {
                this.logger.error(`upload ${label} cleanup error: ${target}: ${message}`);
            } catch {
                // Cleanup and logging failures must not change the established HTTP outcome.
            }
        }
    }
}

/** `UploadAdmissionController`が発行する、processローカルな（永続化しない）占有権の実装。 */
class ProcessLocalUploadLease implements UploadLease {
    /** 既に解放済みかどうか（`releaseOnce`の二重実行防止）。 */
    private released = false;

    constructor(private readonly release: () => void) {}

    public releaseOnce(): void {
        if (this.released) return;
        this.released = true;
        this.release();
    }
}

/**
 * 1つのupload requestの終端（成功／失敗／中断／timeout）を、複数の競合するきっかけ
 * （requestのabort、responseのfinish/close、受信timeout、handlerからの明示的な完了報告）のうち
 * 最初の1回だけ確定させる状態機械。確定後は占有権（`lease`）を必ず解放する。
 */
export class UploadRequestFinalizer {
    /** 既に終端が確定したか（`finishOnce`の二重実行防止）。 */
    private finished = false;
    /** `onFinish`が返したPromiseを追跡するための完了状態。`onFinish`が同期的なら即座に解決済み。 */
    private completion: Promise<void> = Promise.resolve();
    /**
     * `success`で終端した場合でも、受信済みfileの後始末（`IncomingUploadFile.cleanupOnce`）を
     * 呼ぶべきかどうか。IPC登録の結果、所有権がoperator process側へ渡ったかどうかを
     * filesystem側の実際の状態でしか判断できない競合状態があるため、`requestIncomingCleanupAfterSuccess`
     * で「試すべき」ことだけを記録し、実際に消せるかどうかの判断はfilesystem操作自体に委ねる。
     */
    private cleanupIncomingAfterSuccess = false;

    constructor(
        private readonly lease: UploadLease,
        private readonly onFinish: (reason: UploadTerminalReason) => void | Promise<void> = () => undefined,
        private readonly onFinishError: (error: unknown) => void = () => undefined,
    ) {}

    /** 既に終端が確定しているかどうかを返す。 */
    public isFinished(): boolean {
        return this.finished;
    }

    /**
     * Records only that a later successful terminal decision must try the
     * child-owned incoming cleanup. The filesystem remains the ownership
     * authority when the parent adoption races this cleanup.
     */
    public requestIncomingCleanupAfterSuccess(): void {
        if (!this.finished) this.cleanupIncomingAfterSuccess = true;
    }

    /** `requestIncomingCleanupAfterSuccess`が呼ばれていたかどうかを返す。 */
    public shouldCleanupIncomingAfterSuccess(): boolean {
        return this.cleanupIncomingAfterSuccess;
    }

    /**
     * 終端を確定し、`onFinish`を1回だけ実行してから占有権を解放する。
     * @param reason 確定させる終端理由。
     * @returns 今回の呼び出しで実際に終端を確定できたか（既に確定済みなら`false`）。
     */
    public finishOnce(reason: UploadTerminalReason): boolean {
        if (this.finished) return false;
        this.finished = true;
        try {
            const result = this.onFinish(reason);
            if (this.isPromiseLike(result)) {
                this.completion = Promise.resolve(result)
                    .catch(error => this.reportFinishError(error))
                    .then(() => this.lease.releaseOnce());
            } else {
                this.lease.releaseOnce();
            }
        } catch (error: unknown) {
            this.reportFinishError(error);
            this.lease.releaseOnce();
        }
        return true;
    }

    /** `finishOnce`が起動した`onFinish`の完了（およびそれに続く占有権解放）を待つ。 */
    public waitForCompletion(): Promise<void> {
        return this.completion;
    }

    private reportFinishError(error: unknown): void {
        try {
            this.onFinishError(error);
        } catch {
            // Finalizer reporting failures must not revive or replace the terminal decision.
        }
    }

    private isPromiseLike(value: void | Promise<void>): value is Promise<void> {
        return value !== undefined && typeof value.then === 'function';
    }
}

/**
 * HTTP requestの生objectから、それに紐づく`UploadRequestFinalizer`を引けるようにする側路。
 * `ServiceServer`（multer middleware層）と`videos/upload.ts`（route handler層）は別の場所で
 * 同じrequestを扱うが、DIで共有state を渡す経路が無いため、requestのidentityをkeyにした
 * `WeakMap`で受け渡す。requestがGCされればcacheも自然に消える。
 */
const requestFinalizers = new WeakMap<object, UploadRequestFinalizer>();

/** 指定requestに対応する`UploadRequestFinalizer`を登録する。 */
export const bindUploadRequestFinalizer = (request: object, finalizer: UploadRequestFinalizer): void => {
    requestFinalizers.set(request, finalizer);
};

/** 指定requestの登録を解除する。登録されているものが渡した`finalizer`と一致する場合のみ解除する（すり替え防止）。 */
export const unbindUploadRequestFinalizer = (request: object, finalizer: UploadRequestFinalizer): void => {
    if (requestFinalizers.get(request) === finalizer) requestFinalizers.delete(request);
};

/** 指定requestに対応する`UploadRequestFinalizer`を取得する。登録が無ければ`undefined`。 */
export const getUploadRequestFinalizer = (request: object): UploadRequestFinalizer | undefined =>
    requestFinalizers.get(request);

/**
 * route handler側から、対応するfinalizerが未確定であれば終端を確定させる。
 * @param request 対象のHTTP request。
 * @param reason 確定させる終端理由。
 * @returns finalizerが見つからない、または既に確定済みの場合は`false`。
 */
export const finishUploadRequest = (request: object, reason: UploadTerminalReason): boolean =>
    requestFinalizers.get(request)?.finishOnce(reason) ?? false;

/**
 * 同時アップロード数を`config.concurrentUploadNum`（`maximum`）以内へ制限するprocessローカルな門番。
 * 永続化やprocess間共有はせず、単純なcounterで管理する。
 */
export default class UploadAdmissionController {
    /** 現在占有中のアップロード枠数。 */
    private active = 0;

    constructor(private readonly maximum: number) {}

    /**
     * 空き枠があれば1枠確保する。
     * @returns 確保できた場合は解放操作付きの占有権。上限に達していれば`null`
     *          （呼び出し側は multer の `LIMIT_UNEXPECTED_FILE` エラーとして扱う）。
     */
    public tryAcquire(): UploadLease | null {
        if (this.active >= this.maximum) return null;
        this.active++;
        return new ProcessLocalUploadLease(() => {
            this.active--;
        });
    }
}
