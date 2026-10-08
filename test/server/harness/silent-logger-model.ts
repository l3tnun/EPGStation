import { vi } from 'vitest';

/**
 * 出力を捨てる `ILoggerModel` の偽物。log の内容を確かめない test が、log を受け取る class（DB の repository など）を
 * 組み立てるのに使う。内容を確かめる test は、自分で `vi.fn()` を持つ偽物を作る。
 */
const discard = (): void => undefined;

const silentLogger = {
    access: { error: discard, info: discard, warn: discard },
    encode: { error: discard, info: discard, warn: discard },
    stream: { error: discard, info: discard, warn: discard },
    system: { error: discard, info: discard, warn: discard },
};

export const silentLoggerModel = { getLogger: () => silentLogger };

/**
 * `system` の記録を呼び出しとして残す `ILoggerModel` の偽物。log の内容を確かめる test が使う。
 * 呼び出し順や回数は `error`・`warn`・`info` の `mock.calls` で確かめる。
 */
export const createRecordingLoggerModel = () => {
    const error = vi.fn();
    const warn = vi.fn();
    const info = vi.fn();
    return { error, info, loggerModel: { getLogger: () => ({ system: { error, info, warn } }) }, warn };
};
