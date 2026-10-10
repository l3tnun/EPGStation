import bodyParser from 'body-parser';
import cors from 'cors';
import express, { NextFunction } from 'express';
import getSwaggerUiAbsolutePath from 'swagger-ui-dist/absolute-path.js';
import openapi from 'express-openapi';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { inject, injectable } from 'inversify';
import { load as loadYaml } from 'js-yaml';
import log4js from 'log4js';
import { mkdirp } from 'mkdirp';
import multer from 'multer';
import { OpenAPIV3 } from 'openapi-types';
import * as path from 'path';
import urljoin from 'url-join';
import IConfigFile from '../IConfigFile.js';
import IConfiguration from '../IConfiguration.js';
import ILogger from '../ILogger.js';
import ILoggerModel from '../ILoggerModel.js';
import IServiceServer from './IServiceServer.js';
import ISocketIOManageModel from './socketio/ISocketIOManageModel.js';
import UploadAdmissionController, {
    bindUploadRequestFinalizer,
    IncomingUploadFile,
    unbindUploadRequestFinalizer,
    UploadBodyReceiverTeardown,
    UploadRequestFinalizer,
    type UploadTerminalReason,
} from './upload/UploadAdmissionController.js';

/**
 * 1 度解釈した query を握っておく middleware を app へ登録する
 *
 * Express 5 の req.query は参照するたびに生の query 文字列を解釈し直し、毎回別の object を
 * 返す。OpenAPI の層は受け取った object の値を型に合わせて書き換えてから検証へ渡すため、
 * 書き換えが次の参照に残らず、整数や真偽値の query parameter がすべて弾かれる。
 * 最初の解釈だけを保持して、以降は同じ object を返す。
 *
 * OpenAPI の経路を組み立てる前に呼ぶ。同じ経路を自前で組み立てる test が実装と同じものを
 * 通せるよう named export にしてある。
 */
export const holdParsedQuery = (app: express.Application): void => {
    app.use((req, _res, next) => {
        const parsed = req.query;
        Object.defineProperty(req, 'query', {
            configurable: true,
            enumerable: true,
            get: () => parsed,
        });
        next();
    });
};

/**
 * `IServiceServer` の実装。OpenAPI定義（`api.yml`）から組み立てたHTTP APIとSwagger UI、
 * 静的file配信（clientの成果物）、アップロード受付（`UploadAdmissionController`経由で
 * 同時アップロード数を制限）をまとめて1つのExpress applicationとして起動する。
 */
@injectable()
class ServiceServer implements IServiceServer {
    private log: ILogger;
    /** config.ymlの内容。静的file配信・アップロード上限数・CORS許可等の判定に使う。constructor時のみ設定。 */
    private config: IConfigFile;
    /** socket.io関連の初期化・namespace管理を委譲するcollaborator。 */
    private socketIoManageModel: ISocketIOManageModel;
    /** アップロード同時実行数の上限管理と、リクエストごとの受付/解放を担うcollaborator。 */
    private uploadAdmission: UploadAdmissionController;
    /** この class が構築するExpress application本体。 */
    private app = express();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('ISocketIOManageModel')
        socketIoManageModel: ISocketIOManageModel,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.socketIoManageModel = socketIoManageModel;
        this.uploadAdmission = new UploadAdmissionController(this.config.concurrentUploadNum);

        this.init();
    }

    /**
     * 初期化処理
     */
    private init(): void {
        this.setLog();
        const api = this.getApiDocument(ServiceServer.API_YML);
        if (this.config.isAllowAllCORS === true) {
            this.app.use(cors());
        }
        this.setSwaggerUI();
        this.createUploadDir();
        this.holdParsedQuery();
        this.initOpenApi(api);
        this.setStaticFiles();
    }

    /**
     * log の設定
     */
    private setLog(): void {
        this.app.use(log4js.connectLogger(this.log.access, { level: 'info' }));
    }

    /**
     * api.yml の読み込み
     * @param ymlPath: api.yml のファイルパス
     * @return OpenAPIV3.Document
     */
    private getApiDocument(ymlPath: string): OpenAPIV3.Document {
        const api = <OpenAPIV3.Document>loadYaml(fs.readFileSync(ymlPath, 'utf-8'));

        // host 設定
        api.servers = this.config.apiServers.map(url => {
            return {
                url: urljoin(url, this.createUrl('/api')),
            };
        });

        // set title and version
        const pkg = <any>JSON.parse(fs.readFileSync(ServiceServer.PACKAGE_JSON, 'utf-8'));
        api.info.title = pkg.name;
        api.info.version = pkg.version;

        return api;
    }

    /**
     * 1 度解釈した query を握っておく
     */
    private holdParsedQuery(): void {
        holdParsedQuery(this.app);
    }

    /**
     * Open Api 設定
     * @param api: OpenAPIV3.Document
     */
    private initOpenApi(api: OpenAPIV3.Document): void {
        openapi.initialize({
            apiDoc: api,
            app: this.app,
            docsPath: '/docs',
            consumesMiddleware: {
                'application/json': bodyParser.json() as any,
                'text/text': bodyParser.text() as any,
                'multipart/form-data': (req, res, next) => {
                    this.uploadFile(req as any, res as any, next);
                },
            },
            errorMiddleware: (err, _req, res, _next) => {
                this.log.system.error(err);
                res.status(400);
                res.json(err);
            },
            errorTransformer: openApi => {
                this.log.system.error(<any>openApi);

                return {
                    message: (<any>openApi).message,
                };
            },
            exposeApiDocs: true,
            paths: ServiceServer.API_DIR,
        });
    }

    /**
     * 既定の判定と異なる Content-Type を返す拡張子
     *
     * Express 5 は `express.static.mime` を廃止した。静的配信の Content-Type は送出直前に
     * 上書きする。ここに無い拡張子は従来どおり mime-types の判定に従う。
     */
    private static readonly STATIC_CONTENT_TYPES: { readonly [extension: string]: string } = {
        '.eot': 'application/vnd.ms-fontobject',
        '.ttf': 'application/font-ttf',
        '.woff': 'application/font-woff',
        '.woff2': 'application/font-woff2',
        '.map': 'magnus-internal/imagemap',
        '.jpg': 'image/jpg',
        '.ts': 'video/mpeg',
        '.m4s': 'application/octet-stream',
        '.m3u8': 'video/MP2T',
        '.log': 'text/plain',
    };

    /**
     * 静的配信の Content-Type を上書きする
     */
    private static setStaticContentType(res: express.Response, filePath: string): void {
        const contentType = ServiceServer.STATIC_CONTENT_TYPES[path.extname(filePath).toLowerCase()];
        if (typeof contentType === 'string') {
            res.setHeader('Content-Type', contentType);
        }
    }

    /**
     * 静的配信の設定
     */
    private static staticOptions(): Parameters<typeof express.static>[1] {
        return { setHeaders: ServiceServer.setStaticContentType };
    }

    /**
     * ファイル読み込み url 設定
     */
    private setStaticFiles(): void {
        // static files
        this.app.use(
            this.createUrl('/img'),
            express.static(path.join(import.meta.dirname, '..', '..', '..', 'img'), ServiceServer.staticOptions()),
        );

        // thumbnail
        this.app.use(
            this.createUrl('/thumbnail'),
            express.static(this.config.thumbnail, ServiceServer.staticOptions()),
        );

        // streamFile
        this.app.use(
            this.createUrl('/streamfiles'),
            express.static(this.config.streamFilePath, ServiceServer.staticOptions()),
        );

        // frontend
        this.app.use(
            this.createUrl('/'),
            express.static(ServiceServer.FRONTEND_DIST_DIR, ServiceServer.staticOptions()),
        );
    }

    /**
     * SwaggerUI の設定
     */
    private setSwaggerUI(): void {
        if (fs.existsSync(ServiceServer.SWAGGER_UI_DIST) === false) {
            return;
        }

        // replace url
        // issue: https://github.com/swagger-api/swagger-ui/issues/5710
        const pathToSwaggerUi: string = getSwaggerUiAbsolutePath();
        const indexContent = fs
            .readFileSync(path.join(pathToSwaggerUi, 'swagger-initializer.js'))
            .toString()
            .replace('https://petstore.swagger.io/v2/swagger.json', this.createUrl('/api/docs'));

        this.app.get(this.createUrl('/api-docs/swagger-initializer.js'), (_req, res) => {
            res.send(indexContent);
        });

        // api doc
        this.app.use(
            this.createUrl('/api-docs'),
            express.static(ServiceServer.SWAGGER_UI_DIST, ServiceServer.staticOptions()),
        );

        // リダイレクト設定
        this.app.get(this.createUrl('/api/debug'), (_req, res) => {
            return res.redirect(this.createUrl('/api-docs/?url=' + this.createUrl('/api/docs')));
        });
    }

    /**
     * upload 用のディレクトリを生成する
     */
    private createUploadDir(): void {
        const directories = [
            this.config.uploadTempDir,
            path.join(this.config.uploadTempDir, 'incoming'),
            path.join(this.config.uploadTempDir, 'adopted'),
        ];
        const stats = directories.map(directory => {
            try {
                const stat = fs.statSync(directory);
                if (!stat.isDirectory()) {
                    throw new Error(`upload path is not a directory: ${directory}`);
                }
                return stat;
            } catch (err: unknown) {
                if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                    throw err;
                }
                this.log.system.info(`mkdirp: ${directory}`);
                mkdirp.sync(directory);
                return fs.statSync(directory);
            }
        });

        if (stats[1].dev !== stats[2].dev) {
            throw new Error('upload namespaces must use the same filesystem');
        }

        this.cleanupStaleIncomingUploads(path.join(this.config.uploadTempDir, 'incoming'));
    }

    /**
     * Restarted service children reclaim only stale paths that remain in
     * their own incoming namespace. Parent-owned adopted paths are never
     * enumerated or modified here.
     */
    private cleanupStaleIncomingUploads(incomingRoot: string): void {
        for (const entry of fs.readdirSync(incomingRoot, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.isSymbolicLink()) continue;

            const tokenDirectory = path.join(incomingRoot, entry.name);
            this.removeStaleIncomingPath('payload', path.join(tokenDirectory, 'payload'), () =>
                fs.unlinkSync(path.join(tokenDirectory, 'payload')),
            );
            this.removeStaleIncomingPath('token directory', tokenDirectory, () => fs.rmdirSync(tokenDirectory));
        }
    }

    private removeStaleIncomingPath(label: string, target: string, remove: () => void): void {
        try {
            remove();
        } catch (error: unknown) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
            const message = error instanceof Error ? error.message : String(error);
            this.log.system.error(`stale incoming upload ${label} cleanup error: ${target}: ${message}`);
        }
    }

    /**
     * ファイルを upload する
     * @param req
     * @param res
     * @param next
     */
    private uploadFile(req: any, res: any, next: NextFunction): void {
        const lease = this.uploadAdmission.tryAcquire();
        if (lease === null) {
            const error = new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'file');
            return next(error.message);
        }

        const receiverTeardown = new UploadBodyReceiverTeardown(req);
        let bodyTimer: NodeJS.Timeout | undefined;
        let incomingFile: IncomingUploadFile | null = null;
        let nextForwarded = false;
        let terminalErrorMessage: string | null = null;
        const clearBodyTimer = (): void => {
            clearTimeout(bodyTimer);
            bodyTimer = undefined;
        };
        const forwardNextOnce = (error?: string): void => {
            if (nextForwarded) return;
            nextForwarded = true;
            next(error);
        };
        const isResponseWritable = (): boolean =>
            res.destroyed !== true && res.headersSent !== true && res.writableEnded !== true;
        const finish = (reason: UploadTerminalReason, errorMessage?: string): void => {
            if (finalizer.isFinished()) return;
            terminalErrorMessage = errorMessage ?? null;
            finalizer.finishOnce(reason);
        };
        const onRequestAborted = (): void => {
            finish('abort');
        };
        const onResponseFinish = (): void => {
            finish(res.statusCode >= 400 ? 'failure' : 'success');
        };
        const onResponseClose = (): void => {
            finish('abort');
        };
        const onFinalized = (reason: UploadTerminalReason): void | Promise<void> => {
            req.removeListener('aborted', onRequestAborted);
            res.removeListener('finish', onResponseFinish);
            res.removeListener('close', onResponseClose);
            removeUploadParserListeners();
            clearBodyTimer();
            unbindUploadRequestFinalizer(req, finalizer);
            if (reason === 'success' && !finalizer.shouldCleanupIncomingAfterSuccess()) return;

            return (async (): Promise<void> => {
                if (reason !== 'success') {
                    const receiverStopped = receiverTeardown.teardownOnce(
                        new Error(terminalErrorMessage ?? `UploadTerminated:${reason}`),
                    );
                    if (reason === 'abort') receiverTeardown.destroyTransportOnce();
                    await receiverStopped;
                }
                if (incomingFile !== null) await incomingFile.cleanupOnce();
                if (terminalErrorMessage !== null && isResponseWritable()) forwardNextOnce(terminalErrorMessage);
            })();
        };
        const reportFinalizerError = (error: unknown): void => {
            const message = error instanceof Error ? error.message : String(error);
            try {
                this.log.access.error(`upload finalizer error: ${message}`);
            } catch {
                // Logging failures must not alter an established upload outcome.
            }
        };
        // multer は request の 'aborted' と 'close' を once ではなく on で購読し、処理が終わっても
        // 外さない。中断された upload では listener が残り続けるため、こちらの後始末で一緒に外す。
        // 自分が付けたものは名前で分かるので、それ以外を落とす。
        const parserListenersBefore = {
            aborted: new Set(req.listeners('aborted')),
            close: new Set(req.listeners('close')),
        };
        const removeUploadParserListeners = (): void => {
            for (const event of ['aborted', 'close'] as const) {
                for (const listener of req.listeners(event)) {
                    if (!parserListenersBefore[event].has(listener) && listener !== onRequestAborted) {
                        req.removeListener(event, listener as (...args: unknown[]) => void);
                    }
                }
            }
        };

        const finalizer = new UploadRequestFinalizer(lease, onFinalized, reportFinalizerError);
        bindUploadRequestFinalizer(req, finalizer);
        req.once('aborted', onRequestAborted);
        res.once('finish', onResponseFinish);
        res.once('close', onResponseClose);

        if (req.aborted === true) {
            finish('abort');
            return;
        }

        let tokenDirectory: string;
        try {
            tokenDirectory = fs.mkdtempSync(path.join(this.config.uploadTempDir, 'incoming', 'upload-'));
            incomingFile = new IncomingUploadFile(
                tokenDirectory,
                path.join(tokenDirectory, 'payload'),
                this.log.access,
            );
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            finish('failure', message);
            return;
        }

        const payloadPath = incomingFile.payloadPath;
        const storage: multer.StorageEngine = {
            _handleFile: (_req, file, callback) => {
                const outputStream = fs.createWriteStream(payloadPath);
                let settled = false;
                const settle = (error?: Error, info?: Partial<Express.Multer.File>): void => {
                    if (settled) return;
                    settled = true;
                    callback(error, info);
                };
                receiverTeardown.bindFile(file.stream, outputStream, error => settle(error));
                outputStream.once('error', error => settle(error));
                outputStream.once('finish', () =>
                    settle(undefined, {
                        destination: tokenDirectory,
                        filename: 'payload',
                        path: payloadPath,
                        size: outputStream.bytesWritten,
                    }),
                );
                file.stream.pipe(outputStream);
            },
            _removeFile: (_req, file, callback) => {
                const uploadedPath = file.path;
                delete (file as Partial<Express.Multer.File>).destination;
                delete (file as Partial<Express.Multer.File>).filename;
                delete (file as Partial<Express.Multer.File>).path;
                if (typeof uploadedPath !== 'string') return callback(null);
                fs.unlink(uploadedPath, error => callback(error?.code === 'ENOENT' ? null : error));
            },
        };

        const receiveBody = multer({ storage: storage, defParamCharset: 'utf8' }).single('file');
        bodyTimer = setTimeout(() => {
            bodyTimer = undefined;
            finish('receive-timeout', 'UploadReceiveTimeout');
        }, this.config.uploadReceiveTimeoutMs);
        const hadOwnPipe = Object.prototype.hasOwnProperty.call(req, 'pipe');
        const originalPipe = req.pipe;
        req.pipe = function (this: any, destination: any, ...args: any[]): any {
            receiverTeardown.bindParser(destination);
            return originalPipe.call(this, destination, ...args);
        };
        try {
            receiveBody(req as any, res as any, (err: any) => {
                clearBodyTimer();
                if (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    finish('failure', message);
                    return;
                }

                if (finalizer.isFinished()) return;

                if (typeof req.body.recordedId === 'string') {
                    req.body.recordedId = parseInt(req.body.recordedId, 10);
                }

                if (typeof req.file !== 'undefined' && typeof req.file.fieldname !== 'undefined') {
                    req.body.file = req.file.filename;
                }

                forwardNextOnce();
            });
        } finally {
            if (hadOwnPipe) req.pipe = originalPipe;
            else delete req.pipe;
        }
    }

    /**
     * サブディレクトリを付加した path を返す
     * @param url: string
     */
    private createUrl(urlStr: string): string {
        return typeof this.config.subDirectory === 'undefined' ? urlStr : urljoin(this.config.subDirectory, urlStr);
    }

    /**
     * http server 起動
     */
    public start(): void {
        const sokcetioServers: http.Server[] = [];

        // http
        if (typeof this.config.port !== 'undefined') {
            const socketioPort =
                typeof this.config.socketioPort !== 'undefined' ? this.config.socketioPort : this.config.port;

            const server = this.app.listen(this.config.port, (error?: Error) => {
                // Express は listen の失敗（EADDRINUSE など）も callback の第 1 引数で渡す
                if (typeof error !== 'undefined') {
                    this.log.system.fatal(`http server listen error on ${this.config.port}: ${error.message}`);
                    throw error;
                }
                this.log.system.info(`http server listening on ${this.config.port}`);
            });

            // socket.io
            if (socketioPort === this.config.port) {
                sokcetioServers.push(server);
            } else {
                const socketIOServer = http.createServer();
                socketIOServer.listen(this.config.socketioPort, () => {
                    this.log.system.info(`http SocketIO listening on ${this.config.socketioPort}`);
                });

                sokcetioServers.push(socketIOServer);
            }
        }

        // https
        if (typeof this.config.https !== 'undefined') {
            const option: https.ServerOptions = {
                key: fs.readFileSync(this.config.https.key),
                cert: fs.readFileSync(this.config.https.cert),
            };
            if (typeof this.config.https.ca !== 'undefined') {
                if (typeof this.config.https.ca === 'string') {
                    option.ca = fs.readFileSync(this.config.https.ca);
                } else {
                    option.ca = this.config.https.ca.map(f => {
                        return fs.readFileSync(f);
                    });
                }
                option.requestCert = true;
                option.rejectUnauthorized = true;
            }

            const httpsServer = https.createServer(option, this.app);
            httpsServer.listen(this.config.https.port, () => {
                if (typeof this.config.https !== 'undefined') {
                    this.log.system.info(`https server listening on ${this.config.https.port}`);
                }
            });

            // socket.io
            const httpsSocketioPort = this.config.https.socketioPort;
            if (typeof httpsSocketioPort === 'undefined') {
                sokcetioServers.push(httpsServer);
            } else {
                const socketIOServer = https.createServer(option);
                sokcetioServers.push(socketIOServer);
                socketIOServer.listen(httpsSocketioPort, () => {
                    this.log.system.info(`https SocketIO listening on ${httpsSocketioPort}`);
                });
            }
        }

        this.socketIoManageModel.initialize(sokcetioServers);
    }
}

namespace ServiceServer {
    export const ROOT_DIR = path.join(import.meta.dirname, '..', '..', '..');
    export const API_YML = path.join(ServiceServer.ROOT_DIR, 'api.yml');
    export const PACKAGE_JSON = path.join(ServiceServer.ROOT_DIR, 'package.json');
    export const SWAGGER_UI_DIST = path.join(ServiceServer.ROOT_DIR, 'node_modules', 'swagger-ui-dist');
    export const API_DIR = path.join(import.meta.dirname, 'api');
    export const FRONTEND_DIST_DIR = path.join(ROOT_DIR, 'client', 'dist');
}

export default ServiceServer;
