import Hls from 'hls-b24.js';

export default interface IB24RenderState {
    init(video: HTMLVideoElement, hls: Hls): void;
    destroy(): void;
    isInited(): boolean;
    showSubtitle(): void;
    disabledSubtitle(): void;
}
