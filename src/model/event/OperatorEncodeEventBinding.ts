import { inject, injectable } from 'inversify';
import { EncodeCompletionSink, EncodeCompletionSinkRegistrationPort } from '../ipc/IEncodeCompletionSink.js';
import IOperatorEncodeEvent from './IOperatorEncodeEvent.js';

type OperatorEncodeEventProvider = IOperatorEncodeEvent & EncodeCompletionSink;

/**
 * operator process側の`IOperatorEncodeEvent`実装（同時に`EncodeCompletionSink`も実装している）を、
 * IPCServer側の`EncodeCompletionSinkRegistrationPort`へ後から登録するための結線役。
 * `IOperatorEncodeEvent`と`EncodeCompletionSink`はどちらもencode処理からの通知を受け取る側の
 * 契約だが、DI時点でIPCServer→OperatorEncodeEvent→IPCServerという循環依存になるため、
 * constructor注入ではなくこのbindingを介して`setup()`実行時に1回だけ結び付ける。
 */
@injectable()
export default class OperatorEncodeEventBinding {
    constructor(
        @inject('EncodeCompletionSinkRegistrationPort')
        private readonly registrationPort: EncodeCompletionSinkRegistrationPort,
        @inject('IOperatorEncodeEvent') private readonly provider: OperatorEncodeEventProvider,
    ) {}

    /**
     * `provider`（`IOperatorEncodeEvent`兼`EncodeCompletionSink`の実装）を登録口へ登録する。
     * 登録自体に重複排除は無いため、複数回呼ぶとその都度登録される（呼び出し側が1回だけ呼ぶ前提）。
     */
    public setup(): void {
        this.registrationPort.register(this.provider);
    }
}
