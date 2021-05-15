import * as aribb24js from 'aribb24.js';
import Hls from 'hls.js';
import { injectable } from 'inversify';
import SubtitleUtil from '../../../../util/SubtitleUtil';
import IB24RenderState from './IB24RenderState';

@injectable()
export default class B24RenderState implements IB24RenderState {
    private b24Renderer: aribb24js.CanvasRenderer | null = null;

    /**
     * set b24 subtitle render
     * @param video: HTMLVideoElement
     * @param hls: Hls
     */
    public init(video: HTMLVideoElement, hls?: Hls): void {
        this.destroy();

        const b24Option = SubtitleUtil.getAribb24BaseOption();
        this.b24Renderer = new aribb24js.CanvasRenderer(b24Option);
        this.b24Renderer.attachMedia(video);

        if (typeof hls !== 'undefined') {
            hls.on(Hls.Events.FRAG_PARSING_METADATA, (_e, data) => {
                for (const sample of data.samples) {
                    this.b24Renderer?.pushID3v2Data(sample.pts, sample.data);
                }
            });
        }
    }

    /**
     * destory b24 subtitle render
     */
    public destroy(): void {
        if (this.b24Renderer === null) {
            return;
        }

        this.b24Renderer.detachMedia();
        this.b24Renderer.dispose();
        this.b24Renderer = null;
    }

    /**
     * 初期化済みか
     * @return boolean true で初期化済み
     */
    public isInited(): boolean {
        return this.b24Renderer !== null;
    }

    /**
     * 字幕を表示させる
     */
    public showSubtitle(): void {
        if (this.b24Renderer !== null) {
            this.b24Renderer.show();
        }
    }

    /**
     * 字幕を非表示にする
     */
    public disabledSubtitle(): void {
        if (this.b24Renderer !== null) {
            this.b24Renderer.hide();
        }
    }
}
