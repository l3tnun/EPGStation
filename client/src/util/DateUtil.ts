namespace DateUtil {
    const fmt = {
        yyyy: (date: Date): string => {
            return date.getFullYear() + '';
        },
        YY: (date: Date): string => {
            return `${date.getFullYear()}`.slice(2, 4);
        },
        MM: (date: Date): string => {
            return ('0' + (date.getMonth() + 1)).slice(-2);
        },
        dd: (date: Date): string => {
            return ('0' + date.getDate()).slice(-2);
        },
        hh: (date: Date): string => {
            return ('0' + date.getHours()).slice(-2);
        },
        mm: (date: Date): string => {
            return ('0' + date.getMinutes()).slice(-2);
        },
        ss: (date: Date): string => {
            return ('0' + date.getSeconds()).slice(-2);
        },
        SSS: (date: Date): string => {
            return ('000' + date.getMilliseconds()).slice(-3);
        },
        w: (date: Date): string => {
            return ['日', '月', '火', '水', '木', '金', '土'][date.getDay()];
        },
    };

    /**
     * Date を string に変換
     * @param date: Date
     * @param formatStr: string yyyy MM dd hh mm ss w
     * @return string
     */
    export const format = (date: Date, formatStr: string): string => {
        for (const key in fmt) {
            formatStr = formatStr.replace(key, (fmt as any)[key](date));
        }

        return formatStr;
    };

    /**
     * 日本時間を返す
     * @param localDate Date
     * @return Date
     */
    export const getJaDate = (localDate: Date): Date => {
        const offSet = localDate.getTimezoneOffset() * 60 * 1000 + 1000 * 60 * 60 * 9;

        return new Date(localDate.getTime() + offSet);
    };
}

export default DateUtil;
