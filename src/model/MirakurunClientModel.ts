import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import mirakurun from 'mirakurun';
import * as path from 'path';
import * as url from 'url';
import IConfigFile from './IConfigFile';
import IConfiguration from './IConfiguration';
import IMirakurunClientModel from './IMirakurunClientModel';

/**
 * mirakurun client のインスタンスを生成する
 */
@injectable()
export default class MirakurunClientModel implements IMirakurunClientModel {
    private client: mirakurun;
    private config: IConfigFile;

    constructor(@inject('IConfiguration') conf: IConfiguration) {
        this.client = new mirakurun();
        this.config = conf.getConfig();

        this.setClient();
    }

    /**
     * mirakurun client の設定
     */
    private setClient(): void {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json')).toString());
        const mirakurunPath = this.config.mirakurunPath;

        /**
         * Copyright (c) 2016 Yuki KAN and Chinachu Project Contributors
         * Released under the MIT license
         * http://opensource.org/licenses/mit-license.php
         */
        if (/\\\\.\\pipe/.test(mirakurunPath)) {
            this.client.socketPath = mirakurunPath;
        } else if (/(?:\/|\+)unix:/.test(mirakurunPath) === true) {
            const standardFormat = /^http\+unix:\/\/([^\/]+)(\/?.*)$/;
            const legacyFormat = /^http:\/\/unix:([^:]+):?(.*)$/;

            if (standardFormat.test(mirakurunPath) === true) {
                this.client.socketPath = mirakurunPath.replace(standardFormat, '$1').replace(/%2F/g, '/');
                this.client.basePath = path.posix.join(
                    mirakurunPath.replace(standardFormat, '$2'),
                    this.client.basePath,
                );
            } else {
                this.client.socketPath = mirakurunPath.replace(legacyFormat, '$1');
                this.client.basePath = path.posix.join(mirakurunPath.replace(legacyFormat, '$2'), this.client.basePath);
            }
        } else {
            const urlObject = url.parse(mirakurunPath);
            this.client.host = <string>urlObject.hostname;
            this.client.port = Number(<string>urlObject.port);
            this.client.basePath = path.posix.join(<string>urlObject.pathname, <string>this.client.basePath);
        }

        this.client.userAgent = `${pkg.name}/${pkg.version}`;
    }

    /**
     * mirakurun client を返す
     * @return mirakurun client
     */
    public getClient(): mirakurun {
        return this.client;
    }
}
