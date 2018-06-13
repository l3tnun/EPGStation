import * as request from 'request';
import * as url from 'url';
import * as urljoin from 'url-join';
import Util from '../../Util/Util';
import * as DBSchema from '../DB/DBSchema';

namespace ApiUtil {
    /**
     * DBSchema.ProgramSchema の修正
     * @param program: DBSchema.ProgramSchema
     * @return any[]
     */
    export const fixReserveProgram = (program: DBSchema.ProgramSchema): {} => {
        delete program.startHour;
        delete program.week;
        delete program.duration;

        return ApiUtil.deleteNullinHash(program);
    };

    /**
     * hash か null 値のものを削除
     * @param hash: hash
     * @return null 値が削除された hash
     */
    export const deleteNullinHash = (hash: {}): {} => {
        for (const key in hash) {
            if (hash[key] === null) {
                delete hash[key];
            }
        }

        return hash;
    };

    /**
     * id 付き要素を並び替え
     * @param items: 並び替える要素
     * @param order: 並び替える順番
     * @return items
     */
    export const sortItems = <T>(items: { id: number }[], order: number[]): T => {
        let cnt = 0;
        order.forEach((id) => {
            const i = items.findIndex((t) => {
                return t.id === id;
            });

            if (i === -1) { return; }

            // tslint:disable-next-line
            const [item] = items.splice(i, 1);
            items.splice(cnt, 0, item);
            cnt += 1;
        });

        return items as any;
    };

    /**
     * kodi に指定した url を送信する
     * @param source: source url
     * @param host: kodi host url
     * @param user?: user
     * @param pass?: password
     * @param Promise<void>
     */
    export const sendToKodi = (source: string, host: string, user?: string, pass?: string): Promise<void> => {
        const option: request.OptionsWithUri = {
            uri: url.resolve(host, '/jsonrpc'),
            headers: {
                name: 'Content-type',
                value: 'application/json',
            },
            json: {
                jsonrpc: '2.0',
                method: 'Player.Open',
                params: {
                    item: { file: source },
                },
                id: 1,
            },
        };

        if (typeof user !== 'undefined' && typeof pass !== 'undefined') {
            option.auth = {
                user: user,
                pass: pass,
            };
        }

        return new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
            request.post(option, (err, _response, body) => {
                if (err !== null || typeof body === 'undefined') {
                    reject(new Error(`ErrorSendToKodi ${ err }, ${ body }`));
                } else {
                    resolve();
                }
            });
        });
    };

    /**
     * Create m3u8 Play List Str
     * @param host: host
     * @param isSecure: boolean
     * @param baseUrl: http://host 以下の url
     */
    export const createM3U8PlayListStr = (conf: {
        host: string;
        isSecure: boolean;
        name: string;
        duration: number;
        baseUrl: string;
        basicAuth?: { user: string; password: string };
    }): string => {
        const auth = typeof conf.basicAuth === 'undefined' ? '' : `${ conf.basicAuth.user }:${ conf.basicAuth.password }@`;
        const fullUrl = urljoin(`${ conf.isSecure ? 'https' : 'http' }://${ auth }${ ApiUtil.getHost(conf.host) }`, conf.baseUrl);

        return '#EXTM3U\n'
        + `#EXTINF: ${ conf.duration }, ${ conf.name }\n`
        + fullUrl;
    };

    /**
     * host に サブディレクトリを追加して返す
     * @param baseHost: host
     * @return string
     */
    export const getHost = (baseHost: string): string => {
        const subDirectory = Util.getSubDirectory();

        return subDirectory === null ? baseHost : urljoin(baseHost, subDirectory);
    };
}

export default ApiUtil;

