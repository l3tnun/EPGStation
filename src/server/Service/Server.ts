/// <reference path="./swaggerUiExpress.d.ts" />

import * as bodyParser from 'body-parser';
import * as express from 'express';
import * as openapi from 'express-openapi';
import * as fs from 'fs';
import * as http from 'http';
import * as yaml from 'js-yaml';
import * as log4js from 'log4js';
import * as mkdirp from 'mkdirp';
import * as multer from 'multer';
import { OpenAPIV2 } from 'openapi-types';
import * as path from 'path';
// tslint:disable-next-line:no-require-imports
import urljoin = require('url-join');
import Base from '../Base';
import factory from '../Model/ModelFactory';
import { EncodeFinModelInterface } from '../Model/Service/Encode/EncodeFinModel';
import { SocketIoManageModelInterface } from '../Model/Service/SocketIoManageModel';
import FileUtil from '../Util/FileUtil';
import Util from '../Util/Util';
import BasicAuth from './BasicAuth';

/**
 * Server
 */
class Server extends Base {
    private app = express();
    private subDirectory: string | null = null;

    constructor() {
        super();

        // log
        this.app.use(log4js.connectLogger(this.log.access, { level: 'info' }));

        // config
        const config = this.config.getConfig();
        this.subDirectory = Util.getSubDirectory();

        // basic auth
        const basicAuthConfig = config.basicAuth;
        if (typeof basicAuthConfig !== 'undefined') {
            this.app.use(BasicAuth(basicAuthConfig.user, basicAuthConfig.password));
        }

        // read pkg
        const pkg = require(path.join(__dirname, '..', '..', '..', 'package.json'));

        // read api.yml
        const api = <OpenAPIV2.Document> yaml.safeLoad(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'api.yml'), 'utf-8'));
        api.basePath = this.createUrl('/api');
        api.info = {
            title: pkg.name,
            version: pkg.version,
        };

        // swagger ui
        if (fs.existsSync(path.join(__dirname, '..', '..', '..', 'node_modules', 'swagger-ui-dist')) === true) {
            this.app.use(this.createUrl('/api-docs'), express.static(path.join(__dirname, '..', '..', '..', 'node_modules', 'swagger-ui-dist')));
            this.app.get(this.createUrl('/api/debug'), (_req, res) => { return res.redirect(this.createUrl('/api-docs/?url=' + this.createUrl('/api/docs'))); });
        }

        // uploader dir
        const uploadTempDir = config.uploadTempDir || './data/upload';
        try {
            fs.statSync(uploadTempDir);
        } catch (e) {
            // ディレクトリが存在しなければ作成する
            this.log.system.info(`mkdirp: ${ uploadTempDir }`);
            mkdirp.sync(uploadTempDir);
        }

        // uploader
        const storage = multer.diskStorage({
            destination: uploadTempDir,
            filename: (req, file, cb) => {
                const fileName = file.fieldname + '-' + new Date().getTime().toString(16) + Math.floor(100000 * Math.random()).toString(16);
                cb(null, fileName);

                // 切断時はファイルを削除
                (<any> req).on('close', async() => {
                    const filePath = path.join(uploadTempDir, fileName);
                    try {
                        await FileUtil.promiseUnlink(filePath);
                        this.log.access.info(`delete upload file: ${ filePath }`);
                    } catch (err) {
                        this.log.access.error(`upload file delete error: ${ filePath }`);
                        this.log.access.error(err.message);
                    }
                });
            },
        });
        const upload = multer({ storage: storage });

        // init express-openapi
        openapi.initialize({
            apiDoc: api,
            app: this.app,
            consumesMiddleware: {
                'application/json': bodyParser.json(),
                'text/text': bodyParser.text(),
                'multipart/form-data': (req, res, next) => {
                    upload.single('file')(req, res, (err) => {
                        if (err) { return next(err.message); }

                        if (typeof req.file !== 'undefined' && typeof req.file.fieldname !== 'undefined') {
                            req.body[req.file.fieldname] = req.file;
                        }

                        return next();
                    });
                },
            },
            docsPath: '/docs',
            errorMiddleware: (err, _req, res, _next) => {
                res.status(400);
                res.json(err);
            },
            errorTransformer: (openApi) => {
                this.log.system.error(<any> openApi);

                return {
                    message: (<any> openApi).message,
                };
            },
            exposeApiDocs: true,
            paths: path.join(__dirname, 'api'),
        });

        // static mime
        express.static.mime.define({'text/css': ['css', 'min.css']});
        express.static.mime.define({'text/javascript': ['js', 'min.js']});
        express.static.mime.define({'application/vnd.ms-fontobject': ['eot']});
        express.static.mime.define({'application/font-ttf': ['ttf']});
        express.static.mime.define({'application/font-woff': ['woff']});
        express.static.mime.define({'application/font-woff2': ['woff2']});
        express.static.mime.define({'magnus-internal/imagemap': ['map']});
        express.static.mime.define({'image/png': ['png']});
        express.static.mime.define({'image/jpg': ['jpg']});
        express.static.mime.define({'video/mpeg': ['ts']});
        express.static.mime.define({'application/octet-stream': ['m4s']});
        express.static.mime.define({'video/MP2T': ['m3u8']});
        express.static.mime.define({'text/plain': ['log']});

        // static files
        this.app.use(this.createUrl('/'), express.static(path.join(__dirname, '..', '..', '..', 'html')));
        this.app.use(this.createUrl('/material-design-icons'), express.static(path.join(__dirname, '..', '..', '..', 'node_modules', 'material-design-icons')));
        this.app.use(this.createUrl('/material-design-lite'), express.static(path.join(__dirname, '..', '..', '..', 'node_modules', 'material-design-lite')));
        this.app.use(this.createUrl('/js'), express.static(path.join(__dirname, '..', '..', '..', 'dist', 'client')));
        this.app.use(this.createUrl('/css'), express.static(path.join(__dirname, '..', '..', '..', 'dist', 'css')));
        this.app.use(this.createUrl('/img'), express.static(path.join(__dirname, '..', '..', '..', 'img')));
        this.app.use(this.createUrl('/icon'), express.static(path.join(__dirname, '..', '..', '..', 'icon')));

        // thumbnail
        this.app.use(this.createUrl('/thumbnail'), express.static(Util.getThumbnailPath()));

        // streamfile
        this.app.use(this.createUrl('/streamfiles'), express.static(Util.getStreamFilePath()));
    }

    private createUrl(str: string): string {
        return this.subDirectory === null ? str : urljoin(this.subDirectory, str);
    }

    /**
     * 開始
     */
    public start(): void {
        const port = parseInt(<any> this.config.getConfig().serverPort, 10) || 8888;
        this.app.listen(port, () => {
            this.log.system.info(`server listening on ${ port }`);
        });

        // socket.io 用
        const socketIoServer = http.createServer();
        socketIoServer.listen(port + 1, () => {
            this.log.system.info(`SocketIo listening on ${ port + 1}`);
        });

        // socket.io
        (<SocketIoManageModelInterface> factory.get('SocketIoManageModel')).initialize(socketIoServer);

        // encode 終了後
        (<EncodeFinModelInterface> factory.get('EncodeFinModel')).set();
    }
}

export default Server;
