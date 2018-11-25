import * as path from 'path';
import * as request from 'request';
import * as url from 'url';
import * as urljoin from 'url-join';
import * as apid from '../../../../api';
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
     * DBSchema.RecordedSchema を apid.RecordedProgram へ変換する
     * @param data: DBSchema.RecordedSchema
     * @param encodedFiles?: DBSchema.EncodedSchema[]
     * @return RecordedProgram
     */
    export const convertToRecordedProgram = (data: DBSchema.RecordedSchema, encodedFiles: DBSchema.EncodedSchema[] = []): apid.RecordedProgram => {
        delete data.duration;
        delete data.logPath;

        // thumbnaul があるか
        (data as any as apid.RecordedProgram).hasThumbnail = data.thumbnailPath !== null;
        delete data.thumbnailPath;

        (data as any as apid.RecordedProgram).original = data.recPath !== null;

        if (data.recPath !== null) {
            (data as any as apid.RecordedProgram).filename = encodeURIComponent(path.basename(String(data.recPath)));
        }
        delete data.recPath;

        // エンコードファイルを追加
        if (encodedFiles.length > 0) {
            (data as any as apid.RecordedProgram).encoded = encodedFiles.map((file) => {
                const encoded: apid.EncodedProgram = {
                    encodedId: file.id,
                    name: file.name,
                    filename: encodeURIComponent(path.basename(file.path)),
                };

                if (file.filesize !== null) { encoded.filesize = file.filesize; }

                return encoded;
            });
        }

        return <apid.RecordedProgram> ApiUtil.deleteNullinHash(data);
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

