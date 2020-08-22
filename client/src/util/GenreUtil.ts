import * as apid from '../../../api';
import { Genre, SubGenre } from '../lib/event';

/**
 * Genre Util
 */
namespace GenreUtil {
    // ジャンル最大値
    export const GENRE_MAX_NUM = 15;

    /**
     * genre を取得
     * @return Genre str
     */
    export const getGenre = (lv1: apid.ProgramGenreLv1): string | null => {
        if (typeof (<any>Genre)[lv1] === 'undefined') {
            return null;
        }

        return (<any>Genre)[lv1];
    };

    /**
     * subGenre を取得
     * @return SubGenre str
     */
    export const getSubGenre = (lv1: apid.ProgramGenreLv1, lv2?: apid.ProgramGenreLv2): string | null => {
        if (
            typeof (<any>Genre)[lv1] === 'undefined' ||
            typeof lv2 === 'undefined' ||
            typeof (<any>SubGenre)[lv1][lv2] === 'undefined'
        ) {
            return null;
        }

        return (<any>SubGenre)[lv1][lv2];
    };

    /**
     * genre1, genre2 をまとめて取得
     * @param lv1: apid.ProgramGenreLv1
     * @param lv2?: apid.ProgramGenreLv2
     * @return Genre / subGenre or Genre or null
     */
    export const getGenres = (lv1: apid.ProgramGenreLv1, lv2?: apid.ProgramGenreLv2): string | null => {
        const genre = GenreUtil.getGenre(lv1);
        const subGenre = GenreUtil.getSubGenre(lv1, lv2);

        return genre === null ? null : subGenre === null ? genre : `${genre} / ${subGenre}`;
    };
}

export default GenreUtil;
