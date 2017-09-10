import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as express from 'express';
import * as openapi from 'express-openapi';
import * as bodyParser from 'body-parser';
import * as log4js from 'log4js';
import Base from '../Base';
import SocketIoServer from './SocketIoServer';
import Util from '../Util/Util';

/**
* Server
*/
class Server extends Base {
    private app = express();

    constructor() {
        super();

        // log
        this.app.use(log4js.connectLogger(this.log.access, { level: log4js.levels.INFO }));

        // read api.yml
        const api = yaml.safeLoad(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'api.yml'), 'utf-8'));

        // swagger ui
        const swaggerUi = require('swagger-ui-express');
        this.app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(api));
        this.app.get('/api/debug', (_req, res) => res.redirect('/api-docs/?url=/api/docs'));

        // init express-openapi
        openapi.initialize({
            app: this.app,
            apiDoc: api,
            paths: path.join(__dirname, 'api'),
            consumesMiddleware: {
                'application/json': bodyParser.json(),
                'text/text': bodyParser.text()
            },
            errorMiddleware: (err, _req, res, _next) => {
                res.status(400);
                res.json(err);
            },
            errorTransformer: (openapi, _jsonschema) => {
                return openapi.message;
            },
            docsPath: '/docs',
            exposeApiDocs: true
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
        express.static.mime.define({'video/MP2T': ['m3u8']});

        // static files
        this.app.use('/', express.static(path.join(__dirname, '..', '..', '..', 'html')));
        this.app.use('/material-design-icons', express.static(path.join(__dirname, '..', '..', '..', 'node_modules', 'material-design-icons')));
        this.app.use('/material-design-lite', express.static(path.join(__dirname, '..', '..', '..', 'node_modules', 'material-design-lite')));
        this.app.use('/js', express.static(path.join(__dirname, '..', '..', '..', 'dist', 'client')));
        this.app.use('/css', express.static(path.join(__dirname, '..', '..', '..', 'dist', 'css')));
        this.app.use('/img', express.static(path.join(__dirname, '..', '..', '..', 'img')));
        this.app.use('/icon', express.static(path.join(__dirname, '..', '..', '..', 'icon')));

        // thumbnail
        this.app.use('/thumbnail', express.static(Util.getThumbnailPath()));

        // streamfile
        this.app.use('/streamfiles', express.static(Util.getStreamFilePath()));
    }

    /**
    * 開始
    */
    public start(): void {
        const port = this.config.getConfig().serverPort || 8888;
        const server = this.app.listen(port, () => {
            this.log.system.info(`listening on ${ port }`);
        });

        // socket.io
        SocketIoServer.getInstance().initialize(server);
    }
}

export default Server;
