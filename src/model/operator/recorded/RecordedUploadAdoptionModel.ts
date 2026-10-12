import { lstat, mkdir, readdir, rename, rmdir, unlink } from 'node:fs/promises';
import * as path from 'node:path';

const PAYLOAD_BASENAME = 'payload';

/** `adopt`が実際のfile移動に使うI/O契約。test時は`rename`だけ差し替えられるようにする。 */
export interface RecordedUploadAdoptionFileSystem {
    rename(source: string, destination: string): Promise<void>;
}

const rawFileSystem: RecordedUploadAdoptionFileSystem = { rename };

const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;

/**
 * アップロードされた動画fileを、`uploadRoot/incoming/<token>/payload`から
 * `uploadRoot/adopted/<token>/payload`へ移して「正式に採用された」状態にするモデル。
 * `incoming`側は本モデルの管理外（別途送り込まれる前提）で、`adopted`側の後始末
 * （中途半端に残ったtokenの掃除）は`initialize`が起動時に1回行う。
 */
export default class RecordedUploadAdoptionModel {
    /**
     * @param uploadRoot アップロード関連fileを置くルートディレクトリの絶対パス。
     * @param fileSystem file移動の実装。未指定時は`node:fs/promises`の`rename`をそのまま使う。
     */
    constructor(
        private readonly uploadRoot: string,
        private readonly fileSystem: RecordedUploadAdoptionFileSystem = rawFileSystem,
    ) {}

    /**
     * アップロード用ディレクトリ構成を用意する。`uploadRoot`と`uploadRoot/adopted`を作成
     * （既存なら検証のみ）し、前回異常終了等で`adopted`配下に中途半端に残ったtokenを掃除する。
     * `adopt`を呼ぶ前に1度呼んでおく前提。
     */
    public async initialize(): Promise<void> {
        await mkdir(this.uploadRoot, { recursive: true });
        await this.assertDirectory(this.uploadRoot);
        const adoptedRoot = path.join(this.uploadRoot, 'adopted');
        await this.ensureDirectory(adoptedRoot);
        await this.cleanStaleTokens(adoptedRoot);
    }

    /**
     * `incoming`配下にある、アップロード済みだが未採用のfileを`adopted`配下へ移し、正式採用する。
     * @param filePath 採用対象のincoming payloadのパス（`uploadRoot`からの相対または絶対のいずれか。
     *                 `incoming/<token>/payload`の形を満たさない場合は例外を投げる）。
     * @returns 移動後（採用後）のfileの絶対パス。
     */
    public async adopt(filePath: string): Promise<string> {
        const token = this.parseIncomingPath(filePath);
        const incomingPayload = path.join(this.uploadRoot, 'incoming', token, PAYLOAD_BASENAME);
        await this.validateIncomingPath(token, incomingPayload);

        const adoptedRoot = path.join(this.uploadRoot, 'adopted');
        await this.ensureDirectory(adoptedRoot);
        const adoptedToken = path.join(adoptedRoot, token);
        await mkdir(adoptedToken);
        const adoptedPayload = path.join(adoptedToken, PAYLOAD_BASENAME);
        try {
            await this.fileSystem.rename(incomingPayload, adoptedPayload);
            return adoptedPayload;
        } catch (error) {
            await rmdir(adoptedToken).catch(() => undefined);
            throw error;
        }
    }

    private parseIncomingPath(filePath: string): string {
        const match = /^incoming\/([^/\\]+)\/payload$/u.exec(filePath);
        if (match !== null && match[1] !== '.' && match[1] !== '..') {
            return match[1];
        }

        const incomingRoot = path.join(this.uploadRoot, 'incoming');
        const relativePath = path.relative(incomingRoot, filePath);
        const components = relativePath.split(path.sep);
        const [token, payload] = components;
        if (
            components.length !== 2 ||
            token.length === 0 ||
            token === '.' ||
            token === '..' ||
            payload !== PAYLOAD_BASENAME ||
            filePath !== path.join(incomingRoot, token, payload)
        ) {
            throw new Error('UploadPathError');
        }
        return token;
    }

    private async validateIncomingPath(token: string, payload: string): Promise<void> {
        const components = [
            this.uploadRoot,
            path.join(this.uploadRoot, 'incoming'),
            path.join(this.uploadRoot, 'incoming', token),
            payload,
        ];
        for (const [index, component] of components.entries()) {
            const stats = await lstat(component).catch(() => {
                throw new Error('UploadPathError');
            });
            if (index < components.length - 1 ? !stats.isDirectory() : !stats.isFile()) {
                throw new Error('UploadPathError');
            }
        }
    }

    private async ensureDirectory(directory: string): Promise<void> {
        try {
            await mkdir(directory);
        } catch (error) {
            if (errorCode(error) !== 'EEXIST') {
                throw error;
            }
        }
        await this.assertDirectory(directory);
    }

    private async assertDirectory(directory: string): Promise<void> {
        if (!(await lstat(directory)).isDirectory()) {
            throw new Error('UploadPathError');
        }
    }

    private async cleanStaleTokens(adoptedRoot: string): Promise<void> {
        for (const entry of await readdir(adoptedRoot, { withFileTypes: true })) {
            const tokenPath = path.join(adoptedRoot, entry.name);
            if (!entry.isDirectory() || entry.isSymbolicLink()) {
                await unlink(tokenPath).catch(() => undefined);
                continue;
            }
            await unlink(path.join(tokenPath, PAYLOAD_BASENAME)).catch(() => undefined);
            await rmdir(tokenPath).catch(() => undefined);
        }
    }
}
