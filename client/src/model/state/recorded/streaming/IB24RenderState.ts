import Hls from 'hls.js';

export default interface IB24RenderState {
    init(video: HTMLVideoElement): void;
    destroy(): void;
    isInited(): boolean;
    showSubtitle(): void;
    disabledSubtitle(): void;
}
