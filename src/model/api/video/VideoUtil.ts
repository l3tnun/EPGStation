import { ChildProcess, execFile } from 'child_process';
import { inject, injectable, optional } from 'inversify';
import * as path from 'path';
import type * as apid from '../../../../api.js';
import VideoFile from '../../../db/entities/VideoFile.js';
import IVideoFileDB from '../../db/IVideoFileDB.js';
import IConfigFile from '../../IConfigFile.js';
import IConfiguration from '../../IConfiguration.js';
import ILogger from '../../ILogger.js';
import ILoggerModel from '../../ILoggerModel.js';
import IVideoUtil, { VideoInfo } from './IVideoUtil.js';

@injectable()
/** `IVideoUtil` の実装。詳細は `IVideoUtil` を参照。 */
export default class VideoUtil implements IVideoUtil {
    private config: IConfigFile;
    private videoFileDB: IVideoFileDB;
    private log: ILogger | undefined;

    constructor(
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('ILoggerModel') @optional() logger?: ILoggerModel,
    ) {
        this.config = configuration.getConfig();
        this.videoFileDB = videoFileDB;
        this.log = logger?.getLogger();
    }

    public async getFullFilePathFromId(videoFileId: apid.VideoFileId): Promise<string | null> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) {
            return null;
        }

        const parentDir = this.getParentDirPath(video.parentDirectoryName);

        return parentDir === null ? null : path.join(parentDir, video.filePath);
    }

    public getFullFilePathFromVideoFile(videoFile: VideoFile): string | null {
        const parentDir = this.getParentDirPath(videoFile.parentDirectoryName);

        return parentDir === null ? null : path.join(parentDir, videoFile.filePath);
    }

    public getParentDirPath(name: string): string | null {
        if (name === 'tmp' && typeof this.config.recordedTmp !== 'undefined') {
            return this.config.recordedTmp;
        }

        for (const r of this.config.recorded) {
            if (r.name === name) {
                return r.path;
            }
        }

        return null;
    }

    public getInfo(filePath: string): Promise<VideoInfo> {
        const timeoutMilliseconds = 30_000;
        const stopGraceMilliseconds = 3_000;
        return new Promise<VideoInfo>((resolve, reject) => {
            let deadline = 0;
            let child: ChildProcess | undefined;
            let deadlineTimer: NodeJS.Timeout | undefined;
            let pendingResult: { readonly error: Error | null; readonly stdout: string } | undefined;
            let stopGraceDeadline: number;
            let stopGraceTimer: NodeJS.Timeout | undefined;
            let settled = false;
            let terminalObserved = false;

            const clearDeadline = (): void => {
                clearTimeout(deadlineTimer);
                deadlineTimer = undefined;
            };
            const clearStopGrace = (): void => {
                clearTimeout(stopGraceTimer);
                stopGraceTimer = undefined;
            };
            const removeCloseListener = (): void => {
                child!.removeListener('close', onClose);
            };
            const release = (): void => {
                clearDeadline();
                clearStopGrace();
                removeCloseListener();
            };
            const onClose = (): void => {
                terminalObserved = true;
                clearStopGrace();
                removeCloseListener();
            };
            const checkStopGrace = (): void => {
                stopGraceTimer = undefined;
                if (terminalObserved) {
                    return;
                }
                const remaining = stopGraceDeadline - performance.now();
                if (remaining > 0) {
                    stopGraceTimer = setTimeout(checkStopGrace, remaining);
                    return;
                }
                removeCloseListener();
                this.log?.system.error(`video probe terminal not observed after SIGKILL: pid=${String(child!.pid)}`);
            };
            const onTimeout = (): void => {
                if (settled) {
                    return;
                }
                settled = true;
                clearDeadline();
                reject(new Error('VideoInfoTimeout'));
                stopGraceDeadline = performance.now() + stopGraceMilliseconds;
                try {
                    child!.kill('SIGKILL');
                } catch {
                    // The stop grace still records an unconfirmed terminal state.
                } finally {
                    if (!terminalObserved) {
                        checkStopGrace();
                    }
                }
            };
            const deadlineReached = (): boolean => performance.now() >= deadline;
            const onDeadlineExpired = (): void => {
                deadlineTimer = undefined;
                if (settled) {
                    return;
                }
                const remaining = deadline - performance.now();
                if (remaining > 0) {
                    deadlineTimer = setTimeout(onDeadlineExpired, remaining);
                    return;
                }
                onTimeout();
            };
            const settleFailure = (error: unknown): void => {
                settled = true;
                release();
                reject(error);
            };
            const settleSuccess = (info: VideoInfo): void => {
                settled = true;
                release();
                resolve(info);
            };
            const onResult = (err: Error | null, stdout: string): void => {
                if (settled) {
                    return;
                }
                if (deadlineReached()) {
                    onTimeout();
                    return;
                }
                if (err) {
                    settleFailure(err);
                    return;
                }

                try {
                    const result = <any>JSON.parse(stdout);
                    if (deadlineReached()) {
                        onTimeout();
                        return;
                    }
                    const info = {
                        duration: parseFloat(result.format.duration),
                        size: parseInt(result.format.size, 10),
                        bitRate: parseFloat(result.format.bit_rate),
                    };
                    if (deadlineReached()) {
                        onTimeout();
                        return;
                    }
                    settleSuccess(info);
                } catch (error: unknown) {
                    if (deadlineReached()) {
                        onTimeout();
                    } else {
                        settleFailure(error);
                    }
                }
            };
            const receiveResult = (error: Error | null, stdout: string): void => {
                if (child === undefined) {
                    pendingResult = { error, stdout };
                    return;
                }
                onResult(error, stdout);
            };

            try {
                deadline = performance.now() + timeoutMilliseconds;
                child = execFile(
                    this.config.ffprobe,
                    ['-v', '0', '-show_format', '-of', 'json', filePath],
                    receiveResult,
                );
                if (pendingResult !== undefined) {
                    const result = pendingResult;
                    pendingResult = undefined;
                    onResult(result.error, result.stdout);
                }
                if (!settled) {
                    child.on('close', onClose);
                    const remaining = deadline - performance.now();
                    if (remaining <= 0) {
                        onTimeout();
                    } else {
                        deadlineTimer = setTimeout(onDeadlineExpired, remaining);
                    }
                }
            } catch (error: unknown) {
                reject(error);
            }
        });
    }
}
declare const __EPGSTATION_COVERAGE_EXCLUSION_R2_VIDEO_UTIL_SETTLED_TRUE_ARM_20260808: unique symbol;
