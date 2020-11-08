import * as bodyParser from 'body-parser';
import express from 'express';
import * as openapi from 'express-openapi';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import { inject, injectable } from 'inversify';
import * as yaml from 'js-yaml';
import * as log4js from 'log4js';
import mkdirp from 'mkdirp';
import multer from 'multer';
import { OpenAPIV3 } from 'openapi-types';
import * as path from 'path';
import urljoin from 'url-join';
import FileUtil from '../../util/FileUtil';
import IConfigFile from '../IConfigFile';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IServiceServer from './IServiceServer';
import ISocketIOManageModel from './socketio/ISocketIOManageModel';

@injectable()
class ServiceServer implements IServiceServer {
    private log: ILogger;
    private config: IConfigFile;
    private socketIoManageModel: ISocketIOManageModel;
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

        this.init();
    }

    /**
     * 初期化処理
     */
    private init(): void {
        this.setLog();
        const api = this.getApiDocument(ServiceServer.API_YML);
        this.setSwaggerUI();
        this.createUploadDir();
        this.initOpenApi(api);
        this.setMime();
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
        const api = <OpenAPIV3.Document>yaml.safeLoad(fs.readFileSync(ymlPath, 'utf-8'));

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
     * Open Api 設定
     * @param api: OpenAPIV3.Document
     */
    private initOpenApi(api: OpenAPIV3.Document): void {
        openapi.initialize({
            apiDoc: api,
            app: this.app,
            docsPath: '/docs',
            consumesMiddleware: {
                'application/json': bodyParser.json(),
                'text/text': bodyParser.text(),
                'multipart/form-data': (req, res, next) => {
                    this.getUploader().single('file')(req, res, (err: any) => {
                        if (err) {
                            return next(err.message);
                        }

                        if (typeof req.body.recordedId === 'string') {
                            req.body.recordedId = parseInt(req.body.recordedId, 10);
                        }

                        if (typeof req.file !== 'undefined' && typeof req.file.fieldname !== 'undefined') {
                            req.body.file = req.file.filename;
                        }

                        return next();
                    });
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
     * mime 設定
     */
    private setMime(): void {
        // static mime
        express.static.mime.define({ 'text/css': ['css', 'min.css'] });
        express.static.mime.define({ 'text/javascript': ['js', 'min.js'] });
        express.static.mime.define({
            'application/vnd.ms-fontobject': ['eot'],
        });
        express.static.mime.define({ 'application/font-ttf': ['ttf'] });
        express.static.mime.define({ 'application/font-woff': ['woff'] });
        express.static.mime.define({ 'application/font-woff2': ['woff2'] });
        express.static.mime.define({ 'magnus-internal/imagemap': ['map'] });
        express.static.mime.define({ 'image/png': ['png'] });
        express.static.mime.define({ 'image/jpg': ['jpg'] });
        express.static.mime.define({ 'video/mpeg': ['ts'] });
        express.static.mime.define({ 'application/octet-stream': ['m4s'] });
        express.static.mime.define({ 'video/MP2T': ['m3u8'] });
        express.static.mime.define({ 'text/plain': ['log'] });
    }

    /**
     * ファイル読み込み url 設定
     */
    private setStaticFiles(): void {
        // static files
        this.app.use(this.createUrl('/img'), express.static(path.join(__dirname, '..', '..', '..', 'img')));

        // thumbnail
        this.app.use(this.createUrl('/thumbnail'), express.static(this.config.thumbnail));

        // streamFile
        this.app.use(this.createUrl('/streamfiles'), express.static(this.config.streamFilePath));

        // client
        this.app.use(this.createUrl('/'), express.static(ServiceServer.CLIENT_DIR));
    }

    /**
     * SwaggerUI の設定
     */
    private setSwaggerUI(): void {
        if (fs.existsSync(ServiceServer.SWAGGER_UI_DIST) === false) {
            return;
        }

        // api doc
        this.app.use(this.createUrl('/api-docs'), express.static(ServiceServer.SWAGGER_UI_DIST));

        // リダイレクト設定
        this.app.get(this.createUrl('/api/debug'), (_req, res) => {
            return res.redirect(this.createUrl('/api-docs/?url=' + this.createUrl('/api/docs')));
        });
    }

    /**
     * upload 用のディレクトリを生成する
     */
    private createUploadDir(): void {
        // upload dir
        try {
            fs.statSync(this.config.uploadTempDir);
        } catch (e) {
            this.log.system.info(`mkdirp: ${this.config.uploadTempDir}`);
            mkdirp.sync(this.config.uploadTempDir);
        }
    }

    /**
     * multer.Multer を生成する
     */
    private getUploader(): multer.Multer {
        // uploader
        const storage = multer.diskStorage({
            destination: this.config.uploadTempDir,
            filename: (req, file, cb) => {
                const fileName =
                    file.fieldname +
                    '-' +
                    new Date().getTime().toString(16) +
                    Math.floor(100000 * Math.random()).toString(16);
                cb(null, fileName);

                // 切断時はファイルを削除
                (<any>req).on('close', async () => {
                    const filePath = path.join(this.config.uploadTempDir, fileName);
                    try {
                        await FileUtil.unlink(filePath);
                        this.log.access.info(`delete upload file: ${filePath}`);
                    } catch (err) {
                        this.log.access.error(`upload file delete error: ${filePath}`);
                        this.log.access.error(err.message);
                    }
                });
            },
        });

        return multer({ storage: storage });
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

            const server = this.app.listen(this.config.port, () => {
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
            if (typeof this.config.https.socketioPort === 'undefined') {
                sokcetioServers.push(httpsServer);
            } else {
                const socketIOServer = https.createServer(option);
                sokcetioServers.push(socketIOServer);
                socketIOServer.listen(this.config.https.socketioPort, () => {
                    this.log.system.info(`https SocketIO listening on ${this.config.socketioPort}`);
                });
            }
        }

        this.socketIoManageModel.initialize(sokcetioServers);
    }
}

namespace ServiceServer {
    export const ROOT_DIR = path.join(__dirname, '..', '..', '..');
    export const API_YML = path.join(ServiceServer.ROOT_DIR, 'api.yml');
    export const PACKAGE_JSON = path.join(ServiceServer.ROOT_DIR, 'package.json');
    export const SWAGGER_UI_DIST = path.join(ServiceServer.ROOT_DIR, 'node_modules', 'swagger-ui-dist');
    export const API_DIR = path.join(__dirname, 'api');
    export const CLIENT_DIR = path.join(ROOT_DIR, 'client', 'dist');
}

export default ServiceServer;
