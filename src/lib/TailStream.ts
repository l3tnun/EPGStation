/**
 * Copyright (c) 2014 Jimb Esser
 * Released under the MIT license
 * http://opensource.org/licenses/mit-license.php
 */

/**
 * このソースは https://github.com/Jimbly/node-tail-stream
 * を改変し作成しています。
 */

import * as fs from 'fs';
import { Readable, ReadableOptions } from 'stream';
import ILogger from '../model/ILogger.js';
import ILoggerModel from '../model/ILoggerModel.js';
import container from '../model/ModelContainer.js';

/** `createReadStream` の追加オプション。 */
export interface TailStreamOption extends ReadableOptions {
    /** 読み取りを開始するファイル先頭からのバイト位置。省略時は 0（ファイル先頭）。 */
    start?: number;
}

class TailStream extends Readable {
    private offset: number;
    private isClosed: boolean = false;
    private readonly filePath: string;
    private readInProgress: boolean = false;
    private getFdInProgress: boolean = false;
    private checkIdleTimer: NodeJS.Timeout | null = null;
    private checkFileTimer: NodeJS.Timeout | null = null;
    private openRetryTimer: NodeJS.Timeout | null = null;
    private readPending: number = 0;
    private fd: number | null = null;
    private readonly closedFileDescriptors = new Set<number>();

    private readonly log: ILogger;

    constructor(filename: string, option: TailStreamOption) {
        super(option);

        this.filePath = filename;
        this.offset = option.start ?? 0;

        this.log = container.get<ILoggerModel>('ILoggerModel').getLogger();

        this.getFd();
    }

    private getFd(): void {
        if (this.isClosed || this.fd !== null || this.getFdInProgress) return;

        this.getFdInProgress = true;

        fs.open(this.filePath, 'r', (err, fd) => {
            this.getFdInProgress = false;
            if (this.isClosed) {
                if (!err) this.closeFileDescriptor(fd);
                return;
            }

            if (err) {
                // file doesn't exist (yet), try later
                if (this.readPending !== 0) this.scheduleOpenRetry();
            } else {
                this.fd = fd;
                if (this.readPending !== 0) this.doRead();
            }
        });
    }

    private scheduleOpenRetry(): void {
        if (this.openRetryTimer !== null) return;

        this.openRetryTimer = setTimeout(() => {
            this.openRetryTimer = null;
            this.getFd();
        }, 1000);
    }

    private doRead(): void {
        const fd = this.fd;
        if (this.isClosed || fd === null || this.readPending === 0 || this.readInProgress) return;

        this.readInProgress = true;
        fs.fstat(fd, (err, stat) => {
            if (this.isClosed || this.fd !== fd) {
                this.readInProgress = false;
                return;
            }

            if (err) {
                this.readInProgress = false;
                this.debug(FSTAT_ERROR_DEBUG_MESSAGE, err);
                this.destroy(err);
                return;
            }

            let start = this.offset;
            const end = stat.size;

            if (end < start) {
                // file was truncated
                start = 0;
            }

            const size = Math.min(this.readPending, end - start);
            if (size === 0) {
                // no data, try again later
                this.debug(EOF_NO_DATA_TO_READ_DEBUG_MESSAGE);
                this.readInProgress = false;
                this.checkFile(end); // ensure we're watching the file

                return;
            }

            const buffer = Buffer.allocUnsafe(size);

            fs.read(fd, buffer, 0, size, start, (readError, bytesRead, buff) => {
                if (this.isClosed || this.fd !== fd) {
                    this.readInProgress = false;
                    return;
                }

                this.readInProgress = false;
                if (readError) {
                    // Error, stop reading
                    this.debug(READ_ERROR_DEBUG_MESSAGE, readError);
                    this.destroy(readError);
                    return;
                }

                if (bytesRead === 0) {
                    // no data, try again later
                    this.debug(ZERO_BYTE_READ_DEBUG_MESSAGE);
                    this.checkFile(end); // ensure we're watching the file

                    return;
                }

                this.debug(formatReadBytesDebugMessage(bytesRead));
                this.readPending = 0;
                this.offset = start + bytesRead;
                // stream will call ._read again later (or immediately) to pump us for more data

                // Make sure if we do not get a ._read call again later, we clean ourselves up.
                this.scheduleIdleCheck();

                // Must be very last, might recursively call into us!
                this.push(buff);
            });
        });
    }

    private checkFile(sizeAtEndOfFile: number): void {
        if (this.isClosed || this.checkFileTimer !== null) return;

        this.checkFileTimer = setTimeout(() => {
            this.checkFileTimer = null;
            if (this.isClosed) return;

            fs.stat(this.filePath, (err, stat) => {
                if (this.isClosed) return;
                if (err) {
                    this.debug(EOF_STAT_ERROR_DEBUG_MESSAGE, err);
                    this.destroy(err);
                    return;
                }

                if (stat.size !== sizeAtEndOfFile) {
                    this.doRead();
                } else {
                    this.finish();
                }
            });
        }, 1000);
    }

    private scheduleIdleCheck(): void {
        if (this.isClosed || this.checkIdleTimer !== null) return;

        this.checkIdleTimer = setTimeout(() => {
            this.checkIdleTimer = null;
            if (!this.isClosed && !this.readInProgress && !this.getFdInProgress && this.readPending === 0)
                this.debug(IDLE_TIMEOUT_DEBUG_MESSAGE);
        }, 1000);
    }

    public _read(size: number): void {
        if (this.isClosed || this.readPending !== 0 || size <= 0) return;

        if (this.checkIdleTimer !== null) {
            clearTimeout(this.checkIdleTimer);
            this.checkIdleTimer = null;
        }

        this.debug('read_pending = ' + size);
        this.readPending = size;
        if (this.fd === null) {
            if (this.getFdInProgress) {
                this.debug('waiting on fd');
                // Read will trigger read when getFd finishes
            } else {
                // last getFd must have failed, try again!
                this.getFd();
            }

            return;
        }
        this.doRead();
    }

    public _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        this.dispose();
        callback(error);
    }

    private finish(): void {
        if (this.isClosed) return;

        this.dispose();
        this.push(null);
    }

    private dispose(): void {
        if (this.isClosed) return;

        this.isClosed = true;
        this.readPending = 0;
        this.clearTimers();

        const fd = this.fd;
        this.fd = null;
        if (fd !== null) this.closeFileDescriptor(fd);
    }

    private clearTimers(): void {
        if (this.checkIdleTimer !== null) {
            clearTimeout(this.checkIdleTimer);
            this.checkIdleTimer = null;
        }
        if (this.checkFileTimer !== null) {
            clearTimeout(this.checkFileTimer);
            this.checkFileTimer = null;
        }
        if (this.openRetryTimer !== null) {
            clearTimeout(this.openRetryTimer);
            this.openRetryTimer = null;
        }
    }

    private closeFileDescriptor(fd: number): void {
        if (this.closedFileDescriptors.has(fd)) return;

        this.closedFileDescriptors.add(fd);
        fs.close(fd, () => undefined);
    }

    private debug(str: string, err?: Error): void {
        if (err) {
            this.log.stream.error(str);
            this.log.stream.error(err);
        } else {
            // this.log.stream.debug(str);
        }
    }
}

/**
 * `tail -f` のように、末尾へ追記され続けているファイルを読み取る `Readable` を生成する。
 * `fs.createReadStream` と異なり、現在のファイルサイズまで読み切ってもストリームを終了させず、
 * ファイルサイズがそれ以上変化しなくなるまで（＝書き込みが止まるまで）ポーリングを続けて
 * 追記分を流し続ける。録画中（まだ書き込みが続いている）ビデオファイルの再生に使う
 * （`isRecording === true` の場合のみ、呼び出し元 `RecordedStreamBaseModel` 参照）。
 * @param path 読み取り対象のファイルパス。
 * @param option 読み取り開始位置等のオプション。
 * @returns 生成した読み取りストリーム。
 */
export const createReadStream = (path: string, option: TailStreamOption): TailStream => {
    return new TailStream(path, option);
};

// TailStream diagnostic messages.
const EOF_NO_DATA_TO_READ_DEBUG_MESSAGE = 'no data to read';
const ZERO_BYTE_READ_DEBUG_MESSAGE = 'no data read';
const FSTAT_ERROR_DEBUG_MESSAGE = 'error statting';
const READ_ERROR_DEBUG_MESSAGE = 'error reading';
const READ_BYTES_DEBUG_MESSAGE_PREFIX = 'read ';
const READ_BYTES_DEBUG_MESSAGE_SUFFIX = ' bytes';
const EOF_STAT_ERROR_DEBUG_MESSAGE = 'error statting file';
const IDLE_TIMEOUT_DEBUG_MESSAGE = 'timeout expired, closing watcher';
const formatReadBytesDebugMessage = (bytesRead: number): string =>
    READ_BYTES_DEBUG_MESSAGE_PREFIX + bytesRead + READ_BYTES_DEBUG_MESSAGE_SUFFIX;
declare const __EPGSTATION_COVERAGE_EXCLUSION_TAIL_STREAM_CHECKFILE_TIMER_ISCLOSED_20260924: unique symbol;
