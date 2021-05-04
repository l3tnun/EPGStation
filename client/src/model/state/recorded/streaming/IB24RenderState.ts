import Hls from 'hls.js';

export default interface IB24RenderState {
    init(video: HTMLVideoElement, hls: Hls): void;
    destroy(): void;
    isInited(): boolean;
    showSubtitle(): void;
    disabledSubtitle(): void;
}
