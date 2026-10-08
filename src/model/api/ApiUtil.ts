import axios, { AxiosRequestConfig } from 'axios';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as url from 'url';
import urljoin from 'url-join';
import { KodiInfo } from '../IConfigFile.js';
import IConfiguration from '../IConfiguration.js';
import IApiUtil, { CreateM3U8Option } from './IApiUtil.js';

/** `IApiUtil` の実装。詳細は `IApiUtil` を参照。 */
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
        const KODI_REQUEST_TIMEOUT_MS = 30_000;
        const controller = new AbortController();
        const option: AxiosRequestConfig = {
            url: url.resolve(kodiInfo.host, '/jsonrpc'),
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            responseType: 'json',
            signal: controller.signal,
            timeout: KODI_REQUEST_TIMEOUT_MS,
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

        let timer!: NodeJS.Timeout;
        const deadline = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
                controller.abort();
                reject(new Error('KodiRequestDeadlineExceeded'));
            }, KODI_REQUEST_TIMEOUT_MS);
        });
        const request = new Promise<void>((resolve, reject) => {
            axios.request(option).then(
                () => resolve(),
                error => reject(error),
            );
        });
        try {
            await Promise.race([deadline, request]);
        } finally {
            clearTimeout(timer);
        }
    }
}
