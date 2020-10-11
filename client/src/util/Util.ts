import { cloneDeep } from 'lodash';
import VueRouter, { Location, Route } from 'vue-router';

namespace Util {
    /**
     * 指定した時間だけ待機する
     * @param time: 待機する時間 (ms)
     * @return Promise<void>
     */
    export const sleep = (time: number): Promise<void> => {
        return new Promise<void>((resolve: () => void) => {
            setTimeout(() => {
                resolve();
            }, time);
        });
    };

    /**
     * url から query を取り出す
     * @param url: string
     * @return { [key: string]: string }
     */
    export const getQuery = (url: string): { [key: string]: string } => {
        const urls = url.split('?');
        if (urls.length < 2) {
            return {};
        }

        const strs = urls[1].split('&');
        const result: any = {};
        for (const s of strs) {
            const query = s.split('=');
            if (query.length === 2) {
                result[query[0]] = query[1];
            }
        }

        return result;
    };

    /**
     * 引数で渡された url の 指定された パラメータの値を返す
     * @param url: url
     * @param key: query
     * @return string | null
     */
    export const getQueryParam = (url: string, key: string): string | null => {
        const value = Util.getQuery(url)[key];

        return typeof value === 'undefined' ? null : decodeURIComponent(value);
    };

    /**
     * query に timestamp を追加してページ移動する
     * @param router: VueRouter
     * @param location Location
     * @return Promise<Route>
     */
    export const move = async (router: VueRouter, location: Location): Promise<Route | null> => {
        location = cloneDeep(location);
        if (typeof location.query === 'undefined') {
            location.query = {};
        }

        if (typeof location.path === 'undefined') {
            location.path = '/';
        } else if (location.path.slice(0, 1) !== '/') {
            location.path = '/' + location.path;
        }

        // path が同じ場合 timestamp 以外の query が同じでないかチェックする
        if (router.currentRoute.path === location.path) {
            const oldQuery = cloneDeep(router.currentRoute.query);
            delete oldQuery.timestamp;
            delete location.query.timestamp;

            if (Object.keys(oldQuery).length === Object.keys(location.query).length) {
                let isEqual = true;
                for (const key in oldQuery) {
                    if (location.query[key] !== oldQuery[key]) {
                        isEqual = false;
                        break;
                    }
                }

                if (isEqual === true) {
                    return null;
                }
            }
        }

        (location.query as any)['timestamp'] = new Date().getTime();

        return router.push(location);
    };

    /**
     * get subdirectory
     * @return string
     */
    export const getSubDirectory = (): string => {
        return window.location.pathname.replace(/\/[^\/]*$/, '');
    };

    /**
     * Route からページ数を取り出す
     * @param route: Route
     * @return number
     */
    export const getPageNum = (route: Route): number => {
        const page = typeof route.query.page === 'string' ? parseInt(route.query.page, 10) : 1;

        if (isNaN(page) === true) {
            throw new Error('PageIsNaN');
        }

        return page;
    };

    // ファイルサイズ単位
    const fileSizeUnits = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

    /**
     * ファイルサイズ取得
     * @param size: number
     * @return string
     */
    export const getFileSizeStr = (size: number): string => {
        let cnt = 0;
        for (; cnt <= fileSizeUnits.length; cnt++) {
            if (size < 1000) {
                break;
            }
            size /= 1024;
        }

        return `${size.toFixed(1)}${fileSizeUnits[cnt]}`;
    };
}

export default Util;
