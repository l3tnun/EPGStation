import * as apid from '../../../api';
import { Genre, SubGenre } from '../lib/event';

/**
 * Genre Util
 */
namespace GenreUtil {
    // ジャンル最大値
    export const GENRE_MAX_NUM = 15;

    export interface GenreListItem {
        text: string;
        value: apid.ProgramGenreLv1;
    }

    export interface SubGenreListItem {
        text: string;
        value: apid.ProgramGenreLv2;
    }

    /**
     * ジャンル一覧を返す
     * @return GenreListItem[]
     */
    export const getGenreListItems = (): GenreListItem[] => {
        const items: GenreListItem[] = [];

        for (let i = 0; i <= GENRE_MAX_NUM; i++) {
            items.push({
                text: (Genre as any)[i],
                value: i,
            });
        }

        return items;
    };

    /**
     * サブジャンル一覧を返す
     * @param lv1: apid.ProgramGenreLv1
     * @return SubGenreListItem[];
     */
    export const getSubGenreListItems = (lv1: apid.ProgramGenreLv1): SubGenreListItem[] => {
        const items: SubGenreListItem[] = [];

        for (let i = 0; i <= GENRE_MAX_NUM; i++) {
            const text = (SubGenre as any)[lv1][i];
            if (text.length === 0) {
                continue;
            }

            items.push({
                text: text,
                value: i,
            });
        }

        return items;
    };

    /**
     * genre を取得
     * @return Genre str
     */
    export const getGenre = (lv1: apid.ProgramGenreLv1): string | null => {
        if (typeof (Genre as any)[lv1] === 'undefined') {
            return null;
        }

        return (Genre as any)[lv1];
    };

    /**
     * subGenre を取得
     * @return SubGenre str
     */
    export const getSubGenre = (lv1: apid.ProgramGenreLv1, lv2?: apid.ProgramGenreLv2): string | null => {
        if (typeof (Genre as any)[lv1] === 'undefined' || typeof lv2 === 'undefined' || typeof (SubGenre as any)[lv1][lv2] === 'undefined') {
            return null;
        }

        return (SubGenre as any)[lv1][lv2];
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
