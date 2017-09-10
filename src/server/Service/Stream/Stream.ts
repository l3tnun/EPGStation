import * as http from 'http';
import { ChildProcess } from 'child_process';
import Base from '../../Base';
import * as enums from './StreamTypeInterface';
import { EncodeProcessManagerInterface, EncodeProcessManager } from '../EncodeProcessManager';
import { StreamManagerInterface, StreamManager } from './StreamManager';

interface StreamInfo {
    type: enums.StreamType;
    mode: number;
}

abstract class Stream extends Base {
    protected process: EncodeProcessManagerInterface;
    private manager: StreamManagerInterface;
    private viewCnt: number = 0;
    private streamNumber: number;

    constructor() {
        super();
        this.process = EncodeProcessManager.getInstance();
        this.manager = StreamManager.getInstance();
    }

    public async start(streamNumber: number): Promise<void> {
        this.streamNumber = streamNumber;
    }

    public abstract stop(): Promise<void>;
    public abstract getInfo(): StreamInfo;
    public abstract getEncChild(): ChildProcess | null;
    public abstract getMirakurunStream(): http.IncomingMessage | null;

    /**
    * child Process が終了したときの処理
    * @param streamNumber
    * @param resetCount default: true
    */
    protected ChildExit(streamNumber: number, resetCount: boolean = true): void {
        if(resetCount) { this.resetCount(); }
        this.manager.stop(streamNumber);
    }

    /**
    * mirakurun の優先度を返す
    */
    protected getPriority(): number {
        return this.config.getConfig().streamingPriority || 0;
    }

    public countUp(): void { this.viewCnt += 1; }

    public countDown(): void {
        this.viewCnt -= 1;
        this.manager.stop(this.streamNumber);
    }

    public resetCount(isStop: boolean = true): void {
        this.viewCnt = 0;
        if(isStop) { this.manager.stop(this.streamNumber); }
    }

    public getCount(): number { return this.viewCnt; }
}

namespace Stream {
    export const priority = 0;
}

export { StreamInfo, Stream };

