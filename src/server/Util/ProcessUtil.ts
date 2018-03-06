import { ChildProcess } from 'child_process';

namespace ProcessUtil {
    /**
     * セットしたプロセスを前処理をしてから殺す
     * @param child: ChildProcess
     * @param wait: number default 500
     */
    export const kill = (child: ChildProcess, wait = 500): Promise<void> => {
        return new Promise<void>((resolve: () => void, reject: (err: Error) => void) => {
            try {
                child.stdin.end();
                child.stdout.unpipe();
                child.stderr.unpipe();
                child.stdout.destroy();
                child.stderr.destroy();
                child.stdout.removeAllListeners('data');
                child.stderr.removeAllListeners('data');

                setTimeout(() => {
                    child.kill('SIGINT');
                    resolve();
                }, wait);
            } catch (err) {
                reject(err);
            }
        });
    };
}

export default ProcessUtil;

