import * as path from 'path';
import * as url from 'url';
import Mirakurun from 'mirakurun';
import Base from '../Base';

/**
* Mirakurun Client を生成する
*/
class CreateMirakurunClient extends Base {
    private static instance: CreateMirakurunClient;
    private static client: Mirakurun;

    public static get(): Mirakurun {
        if(!this.instance) {
            this.instance = new CreateMirakurunClient();
            this.instance.create();
        }

        return this.client;
    }

    private constructor() { super(); }

    private create(): void {
        const pkg = require(path.join('..', '..', '..', 'package.json'));
        let client = new Mirakurun();

        const mirakurunPath = this.config.getConfig().mirakurunPath;

        /**
        * Copyright (c) 2016 Yuki KAN and Chinachu Project Contributors
        * Released under the MIT license
        * http://opensource.org/licenses/mit-license.php
        */
        if(/\\\\.\\pipe/.test(mirakurunPath)) {
            client.socketPath = mirakurunPath;
        } else if(/(?:\/|\+)unix:/.test(mirakurunPath) === true) {
            const standardFormat = /^http\+unix:\/\/([^\/]+)(\/?.*)$/;
            const legacyFormat = /^http:\/\/unix:([^:]+):?(.*)$/;

            if (standardFormat.test(mirakurunPath) === true) {
                client.socketPath = mirakurunPath.replace(standardFormat, '$1').replace(/%2F/g, '/');
                client.basePath = path.posix.join(mirakurunPath.replace(standardFormat, '$2'), client.basePath);
            } else {
                client.socketPath = mirakurunPath.replace(legacyFormat, '$1');
                client.basePath = path.posix.join(mirakurunPath.replace(legacyFormat, '$2'), client.basePath);
            }
        } else {
            const urlObject = url.parse(mirakurunPath);
            client.host = <string>(urlObject.hostname);
            client.port = Number(<string>(urlObject.port));
            client.basePath = path.posix.join(<string>(urlObject.pathname), <string>(client.basePath));
        }

        client.userAgent = `${ pkg.name }/${ pkg.version }`;

        CreateMirakurunClient.client = client;
    }
}

export default CreateMirakurunClient;

