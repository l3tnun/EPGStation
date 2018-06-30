import PromiseQueue from '../../lib/PromiseQueue';
import Model from '../Model';

/**
 * QueueProcessBaseModel
 * コマンドの実行を queue で管理して一つづつ実行するようにする
 */
abstract class QueueProcessBaseModel extends Model {
    private static queue: PromiseQueue = new PromiseQueue();

    /**
     * push queue
     * @param job: Promise<any>
     */
    protected push<T>(job: () => Promise<T>): Promise<T> {
        return QueueProcessBaseModel.queue.add<T>(() => {
            return job();
        });
    }
}

export default QueueProcessBaseModel;

