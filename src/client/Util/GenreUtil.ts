import { genre1, genre2 } from '../lib/event';
import * as apid from '../../../api'

/**
* Genre Util
*/
namespace GenreUtil {
    /**
    * genre1 を取得
    * @return genre1
    */
    export const getGenre1 = (lv1?: apid.ProgramGenreLv1): string | null => {
        if(typeof lv1 === 'undefined' || typeof genre1[lv1] === 'undefined') {
            return null;
        }

        return genre1[lv1];
    }

    /**
    * genre2 を取得
    * @return genre1
    */
    export const getGenre2 = (lv1?: apid.ProgramGenreLv1, lv2?: apid.ProgramGenreLv2): string | null => {
        if(typeof lv1 === 'undefined'
            || typeof genre1[lv1] === 'undefined'
            || typeof lv2 === 'undefined'
            || typeof genre2[lv1][lv2] === 'undefined'
        ) {
            return null;
        }

        return genre2[lv1][lv2];
    }

    /**
    * genre1, genre2 をまとめて取得
    * @return genre1 / genre2
    */
    export const getGenres = (lv1?: apid.ProgramGenreLv1, lv2?: apid.ProgramGenreLv2): string => {
        if(typeof lv1 === 'undefined') { return ''; }

        let genre1 = GenreUtil.getGenre1(lv1);
        let genre2 = GenreUtil.getGenre2(lv1, lv2);

        if(genre1 === null) { return ''; }
        else if(genre2 === null) { return genre1; }

        return `${ genre1 } / ${ genre2 }`;
    }
}

export default GenreUtil;

