import * as m from 'mithril';

/**
 * Util モジュール
 * よく使う処理をまとめたもの
 */
namespace Util {
    /**
     * iPad スクリーン解像度定義
     */
    const IPAD_SCREENS = {
        1024: 768,
        1112: 834,
        1194: 834,
        1366: 1024,
        2048: 1536,
        2224: 1668,
        2388: 1668,
        2732: 2048,
    };

    /**
     * Material Desgin Lite の DOM をアップグレードする
     */
    export const upgradeMdl = (): void => {
        componentHandler.upgradeDom();
        const el = document.getElementsByClassName('mdl-layout__container');
        for (let i = 0; i < el.length - 1; i++) { el[i].parentNode!.removeChild(el[i]); }
    };

    /**
     * query のコピーを返す
     * @return query
     */
    export const getCopyQuery = (): { [key: string]: any } => {
        return JSON.parse(JSON.stringify(m.route.param()));
    };

    /**
     * クリックされた要素の座標を返す
     * @param event: Event
     * @return x: 画面上の x 座標
     *         y: 画面上の y 座標
     *         width: クリックされた要素の幅
     *         height: クリックされた要素の高さ
     */
    export const getClickPosition = (event: Event): { x: number; y: number; width: number; height: number } => {
        let elmX: number;
        let elmY: number;

        if ((<TouchEvent> event).targetTouches) {
            // mobile
            elmX = (<TouchEvent> event).targetTouches[0].pageX - (<HTMLElement> event.target).offsetLeft;
            elmY = (<TouchEvent> event).targetTouches[0].pageY - (<HTMLElement> event.target).offsetTop;
        } else if ((document.all || 'all' in document) && !Util.uaIsFirefox()) {
            elmX = (<MouseEvent> event).offsetX;
            elmY = (<MouseEvent> event).offsetY;
        } else {
            elmX = (<MouseEvent> event).layerX;
            elmY = (<MouseEvent> event).layerY;
        }

        const rect = (<HTMLElement> event.target).getBoundingClientRect();
        let x = (<MouseEvent> event).x - elmX;
        if (x === 0) {
            // firefox で起こる
            x = rect.left;
        }

        let y = (<MouseEvent> event).y - elmY;
        if (y === 0) {
            // firefox で起こる
            y = rect.top;
        }

        return {
            x: x,
            y: y,
            width: (<HTMLElement> event.target).offsetWidth,
            height: (<HTMLElement> event.target).offsetHeight,
        };
    };

    /**
     * UA が iOS か判定
     * @return boolean
     */
    export const uaIsiOS = (): boolean => {
        return /iPad|iPhone|iPod/.test(navigator.userAgent);
    };

    /**
     * UA が iPhone か判定
     */
    export const uaIsiPhone = (): boolean => {
        return /iPhone|iphone/.test(navigator.userAgent);
    };

    /**
     * UA が iPadOS か判定
     */
    export const uaIsiPadOS = (): boolean => {
        if (uaIsMac() === false) {
            return false;
        }

        let width = 0;
        let height = 0;
        if (window.screen.width < window.screen.height) {
            width = window.screen.width;
            height = window.screen.height;
        } else {
            width = window.screen.height;
            height = window.screen.width;
        }

        return IPAD_SCREENS[height] === width;
    };

    /**
     * UA が Android か判定
     * @return boolean
     */
    export const uaIsAndroid = (): boolean => {
        return /Android|android/.test(navigator.userAgent);
    };

    /**
     * UA が Edge か判定
     * @return boolean
     */
    export const uaIsEdge = (): boolean => {
        return /Edge|edge/.test(navigator.userAgent);
    };

    /**
     * UA が IE か判定
     * @return boolean
     */
    export const uaIsIE = (): boolean => {
        return /msie|MSIE/.test(navigator.userAgent) || /Trident/.test(navigator.userAgent);
    };

    /**
     * UA が Chrome か判定
     * @return boolean
     */
    export const uaIsChrome = (): boolean => {
        return /chrome|Chrome/.test(navigator.userAgent);
    };

    /**
     * UA が Firefox か判定
     * @return boolean
     */
    export const uaIsFirefox = (): boolean => {
        return /firefox|Firefox/.test(navigator.userAgent);
    };

    /**
     * UA が Safari か判定
     * @return boolean
     */
    export const uaIsSafari = (): boolean => {
        return /safari|Safari/.test(navigator.userAgent) && !Util.uaIsChrome();
    };

    /**
     * UA が Safari 10+ か判定
     * @return boolean
     */
    export const uaIsSafari10OrLater = (): boolean => {
        return uaIsSafari() && (/Version\/1\d/i).test(navigator.userAgent);
    };

    /**
     * UA が Mobile か判定
     * @return boolean
     */
    export const uaIsMobile = (): boolean => {
        return /Mobile|mobile/.test(navigator.userAgent);
    };

    /**
     * UA が macOS か判定
     * @return boolean
     */
    export const uaIsMac = (): boolean => {
        return /Macintosh|macintosh/.test(navigator.userAgent);
    };

    /**
     * UA が Windows か判定
     * @return boolean
     */
    export const uaIsWindows = (): boolean => {
        return /Windows|windows/.test(navigator.userAgent);
    };

    /**
     * close Navigation
     */
    export const closeNavigation = (): void => {
        const navi = document.getElementsByClassName('mdl-layout__obfuscator');
        if (navi.length > 0) {
            (<HTMLElement> navi[0]).click();
        }
    };

    /**
     * sleep
     * @param msec: ミリ秒
     */
    export const sleep = (msec: number): Promise<void> => {
        return new Promise((resolve: () => void) => {
            window.setTimeout(() => { resolve(); }, msec);
        });
    };

    /**
     * m.route.set する際に query に dummy を追加する
     * @param href: string
     * @param query: any
     */
    export const move = (href: string, query: { [key: string]: any } = {}) => {
        query['dummy'] = new Date().getTime();
        m.route.set(href, query);
    };

    /**
     * url が同じかチェック
     * @param href: string
     * @param query: { [key: string]: any }
     * @return boolean
     */
    export const isEqualURL = (href: string, query: { [key: string]: any } = {}): boolean => {
        const tmpQuery = Util.getCopyQuery();
        let isEqual = true;
        for (const key in tmpQuery) {
            if (key !== 'dummy' && query[key] !== tmpQuery[key]) {
                isEqual = false;
            }
        }

        if (isEqual) {
            for (const key in query) {
                if (key !== 'dummy' && query[key] !== tmpQuery[key]) {
                    isEqual = false;
                }
            }
        }

        return (isEqual && m.route.get().split('?')[0] === href);
    };

    /**
     * get subdirectory
     * @return string
     */
    export const getSubDirectory = (): string => {
        return window.location.pathname.replace(/\/[^\/]*$/, '');
    };

    /**
     * get mdl-layout element
     * @return HTMLElement | null
     */
    export const getMDLLayout = (): HTMLElement | null => {
        const elements = document.getElementsByClassName('mdl-layout');

        return elements.length === 0 ? null : <HTMLElement> elements[0];
    };

    // ファイルサイズ単位
    const fileSizeUnits = ['B', 'KB', 'MB', 'GB'];

    /**
     * ファイルサイズ取得
     * @param size: number
     * @return string
     */
    export const getFileSizeStr = (size: number): string => {
        let cnt = 0;
        for (; cnt <= fileSizeUnits.length; cnt++) {
            if (size < 1000) { break; }
            size /= 1024;
        }

        return `${ size.toFixed(1) }${ fileSizeUnits[cnt] }`;
    };
}

export default Util;

