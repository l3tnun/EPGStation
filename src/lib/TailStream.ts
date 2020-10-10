/**
 * Copyright (c) 2014 Jimb Esser
 * Released under the MIT license
 * http://opensource.org/licenses/mit-license.php
 */

/**
 * このソースは https://github.com/Jimbly/node-tail-stream
 * を改変し作成しています。
 */

import * as assert from 'assert';
import * as fs from 'fs';
import { Readable, ReadableOptions } from 'stream';
import ILogger from '../model/ILogger';
import ILoggerModel from '../model/ILoggerModel';
import container from '../model/ModelContainer';

export interface TailStreamOption extends ReadableOptions {
    start?: number;
}

class TailStream extends Readable {
    private offset: number;
    private closed: boolean = false;
    private filePath: string;
    private readInProgress: boolean = false;
    private getFdInProgress: boolean = false;
    private checkIdleTimer: NodeJS.Timeout | null = null;
    private checkFileTimer: NodeJS.Timeout | null = null;
    private readPending: number = 0;
    private fd: number = 0;

    private log: ILogger;

    constructor(filename: string, option: TailStreamOption) {
        super(option);

        this.filePath = filename;
        this.offset = option.start || 0;

        this.log = container.get<ILoggerModel>('ILoggerModel').getLogger();

        this.getFd();
    }

    private getFd(): void {
        assert.ok(!this.fd);
        assert.ok(!this.getFdInProgress);
        this.getFdInProgress = true;

        fs.open(this.filePath, 'r', (err, fd) => {
            if (this.closed) {
                return;
            }
            assert.ok(this.getFdInProgress);
            this.getFdInProgress = false;
            if (err) {
                // file doesn't exist (yet), try later
                if (this.readPending) {
                    // and we're inside of a _read call already, start a watcher to be notified
                    // when it exists
                    setTimeout(() => {
                        if (this.closed) {
                            return;
                        }
                        this.getFd();
                    }, 1000);
                }
            } else {
                this.fd = fd;
                if (this.readPending) {
                    this.doRead();
                }
            }
        });
    }

    private doRead(): void {
        assert.ok(this.fd);
        assert.ok(this.readPending);
        assert.ok(!this.readInProgress);

        this.readInProgress = true;
        fs.fstat(this.fd, (err, stat) => {
            if (this.closed) {
                return;
            }
            assert.ok(this.readInProgress);

            if (err) {
                this.readInProgress = false;
                // TODO: retry later, need to verify .fd is valid, check if .ino changed
                this.debug('error statting', err);
                this.emit('error', err);

                return;
            }

            let start = this.offset;
            const end = stat.size;

            if (end < start) {
                // file was truncated
                start = 0;
            }

            assert.ok(this.readPending);
            const size = Math.min(this.readPending, end - start);
            if (size === 0) {
                // no data, try again later
                this.debug('no data to read');
                this.readInProgress = false;
                this.checkFile(); // ensure we're watching the file

                return;
            }

            const buffer = new Buffer(size);

            fs.read(this.fd, buffer, 0, size, start, (e, bytesRead, buff) => {
                if (this.closed) {
                    return;
                }
                assert.ok(this.readInProgress);
                this.readInProgress = false;
                if (e) {
                    // Error, stop reading
                    this.debug('error reading', e);

                    return this.emit('error', e);
                }

                if (bytesRead === 0) {
                    // no data, try again later
                    this.debug('no data read');
                    this.checkFile(); // ensure we're watching the file

                    return;
                }

                this.debug('read ' + bytesRead + ' bytes');
                this.readPending = 0;
                this.offset = start + bytesRead;
                // stream will call ._read again later (or immediately) to pump us for more data

                // Make sure if we do not get a ._read call again later, we clean ourselves up
                assert.ok(!this.checkIdleTimer);
                this.checkIdleTimer = setTimeout(() => {
                    this.checkIdle();
                }, 1000);

                // Must be very last, might recursively call into us!
                this.push(buff);

                return;
            });
        });
    }

    private checkFile(): void {
        if (this.checkFileTimer !== null) {
            return;
        }

        const stat = fs.statSync(this.filePath);
        this.checkFileTimer = setTimeout(() => {
            this.checkFileTimer = null;

            const newStat = fs.statSync(this.filePath);
            if (newStat.size !== stat.size) {
                this.doRead();
            } else {
                this.close();
            }
        }, 1000);
    }

    private checkIdle(): void {
        assert.ok(this.checkIdleTimer);
        this.checkIdleTimer = null;
        assert.ok(!this.readInProgress && !this.getFdInProgress);
        // If we get here, we're not reading anything, and haven't been asked to,
        // stop watching
        this.debug('timeout expired, closing watcher');
    }

    public _read(size: number): void {
        assert.ok(!this.closed);
        assert.ok(!this.readPending);
        assert.ok(size);

        if (this.checkIdleTimer) {
            clearTimeout(this.checkIdleTimer);
            this.checkIdleTimer = null;
        }

        this.debug('read_pending = ' + size);
        this.readPending = size;
        if (!this.fd) {
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

    private close(): void {
        this.closed = true;
        this.push(null);
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

export const createReadStream = (path: string, option: TailStreamOption): TailStream => {
    return new TailStream(path, option);
};
