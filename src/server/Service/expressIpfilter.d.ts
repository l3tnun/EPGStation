/**
 * 適当 express-ipfilter 定義
 */
declare namespace expressIpfilter {
    export const IpFilter: (table: string[], args: any) => any;
    export const IpDeniedError: any;
}

declare module 'express-ipfilter' {
    export = expressIpfilter;
}

