import { inject, injectable } from 'inversify';
import * as path from 'path';
// tslint:disable-next-line:no-require-imports
import urljoin = require('url-join');
import IConfiguration from '../IConfiguration';
import IApiUtil, { CreateM3U8Option } from './IApiUtil';

@injectable()
export default class ApiUtil implements IApiUtil {
    private configuration: IConfiguration;

    constructor(@inject('IConfiguration') configuration: IConfiguration) {
        this.configuration = configuration;
    }

    /**
     * m3u8 文字列を生成する
     * @param option: CreateM3U8Option
     * @return string
     */
    public createM3U8PlayListStr(option: CreateM3U8Option): string {
        // TODO basic 認証対応
        /*
        const auth =
            typeof config.basicAuth === 'undefined' ? '' : `${option.basicAuth.user}:${option.basicAuth.password}@`;
        */

        const fullUrl = urljoin(`${option.isSecure ? 'https' : 'http'}://${this.getHost(option.host)}`, option.baseUrl);

        return '#EXTM3U\n' + `#EXTINF: ${option.duration}, ${option.name}\n` + fullUrl;
    }

    private getHost(baseHost: string): string {
        const config = this.configuration.getConfig();

        return typeof config.subDirectory === 'undefined' ? baseHost : path.join(baseHost, config.subDirectory);
    }
}
