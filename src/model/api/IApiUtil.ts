import { KodiInfo } from '../IConfigFile';

export interface CreateM3U8Option {
    host: string;
    isSecure: boolean;
    name: string;
    duration: number;
    baseUrl: string; // http://host 以下の url
}

export default interface IApiUtil {
    createM3U8PlayListStr(option: CreateM3U8Option): string;
    getHost(baseHost: string): string;
    sendToKodi(source: string, kodiInfo: KodiInfo): Promise<void>;
}
