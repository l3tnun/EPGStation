namespace Util {
    /**
     * sleep
     * @param msec: ミリ秒
     */
    export const sleep = (msec: number): Promise<void> => {
        return new Promise((resolve: () => void) => {
            setTimeout(() => {
                resolve();
            }, msec);
        });
    };
}

export default Util;
