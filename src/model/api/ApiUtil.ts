import axios, { AxiosRequestConfig } from 'axios';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as url from 'url';
import urljoin from 'url-join';
import { KodiInfo } from '../IConfigFile';
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
        const fullUrl = urljoin(`${option.isSecure ? 'https' : 'http'}://${this.getHost(option.host)}`, option.baseUrl);

        return '#EXTM3U\n' + `#EXTINF: ${option.duration}, ${option.name}\n` + fullUrl;
    }

    /**
     * host に サブディレクトリを追加して返す
     * @param baseHost: host
     * @return string
     */
    public getHost(baseHost: string): string {
        const config = this.configuration.getConfig();

        return typeof config.subDirectory === 'undefined' ? baseHost : path.join(baseHost, config.subDirectory);
    }

    /**
     * kodi へビデオリンクを送信する
     * @param source: ビデオリンク
     * @param kodiInfo: KodiInfo
     */
    public async sendToKodi(source: string, kodiInfo: KodiInfo): Promise<void> {
        const option: AxiosRequestConfig = {
            url: url.resolve(kodiInfo.host, '/jsonrpc'),
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            responseType: 'json',
            data: {
                jsonrpc: '2.0',
                method: 'Player.Open',
                params: {
                    item: { file: source },
                },
                id: 1,
            },
        };

        if (typeof kodiInfo.user !== 'undefined' && typeof kodiInfo.password !== 'undefined') {
            option.auth = {
                username: kodiInfo.user,
                password: kodiInfo.password,
            };
        }

        await axios.request(option);
    }
}
