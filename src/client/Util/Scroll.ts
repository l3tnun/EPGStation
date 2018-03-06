/**
 * Scroll モジュール
 */
namespace Scroll {
    /**
     * 指定した Element を start から end までスクロールさせる
     * @param object Element
     * @param start 開始位置
     * @param end 終了位置
     * @param duration 移動時間(ms)
     */
    export const scrollTo = (object: Element, start: number, end: number, duration: number): void => {
        // 1fps あたりの移動距離
        const speed = ((end - start) / (duration / 1000)) / fps;
        const startTime = getTime();

        let position = start;
        let requestId: number | null = null;
        const loop = (): void => {
            const frame = Math.floor((getTime() - startTime) / (1000 / fps));

            position = start + speed * frame;
            if (speed > 0 && position >= end || speed <= 0 && position <= end) {
                object.scrollTop = Math.round(end);
                if (requestId !== null) { cancelAnimationFrame(requestId); }
            } else {
                object.scrollTop = Math.round(position);
                requestId = requestAnimationFrame(loop);
            }
        };

        loop();
    };

    const getTime = (): number => {
        return new Date().getTime();
    };

    const fps = 60;
}

export default Scroll;

