import { spawn, type ChildProcess } from 'node:child_process';
import type { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';

import type { ChildScenario } from './fixtures/child-scenarios.js';

const harnessDeadlineMilliseconds = 2_000;

type TerminalEventType = 'exit' | 'close';
type ObservableEventType = 'spawn' | 'stdout' | 'stderr' | 'message' | 'disconnect' | 'error' | TerminalEventType;

type ChildHarnessEventPayload =
    | { readonly type: 'spawn' | 'disconnect' }
    | { readonly type: 'stdout' | 'stderr'; readonly chunk: string }
    | { readonly type: 'message'; readonly message: unknown }
    | { readonly type: 'error'; readonly error: Error }
    | {
          readonly type: TerminalEventType;
          readonly code: number | null;
          readonly signal: NodeJS.Signals | null;
      };

export type ChildHarnessEvent = ChildHarnessEventPayload & { readonly sequence: number };

export interface ChildHarnessCleanupEvidence {
    readonly remainingChildProcesses: number;
    readonly remainingListeners: number;
    readonly remainingTimers: number;
    readonly remainingTempResources: number;
}

export interface SpawnCompiledChildOptions {
    readonly executablePath?: string;
    readonly gracefulReapDeadlineMilliseconds?: number;
    readonly hardReapDeadlineMilliseconds?: number;
    readonly observationDeadlineMilliseconds?: number;
    readonly temporaryParentDirectory?: string;
}

export interface CreateCompiledEntrypointSessionOptions {
    readonly compiledEntrypoint: string;
    readonly cwd: string;
    readonly detachedProcessGroup?: boolean;
    readonly env?: NodeJS.ProcessEnv;
    readonly executablePath?: string;
    readonly gracefulReapDeadlineMilliseconds?: number;
    readonly hardReapDeadlineMilliseconds?: number;
    readonly observationDeadlineMilliseconds?: number;
    readonly temporaryParentDirectory?: string;
    readonly prepareRuntimeRoot: (runtimeRoot: string) => Promise<void>;
}

export interface ChildHarnessSession {
    readonly child: ChildProcess;
    readonly compiledEntrypoint: string;
    readonly tempDirectory: string;
    readonly events: readonly ChildHarnessEvent[];
    readonly expiredHarnessDeadlines: number;
    readonly errors: readonly NodeJS.ErrnoException[];
    readonly messages: readonly unknown[];
    readonly stderr: string;
    readonly stdout: string;
    waitForClose(): Promise<void>;
    waitForEvent(type: ObservableEventType, deadlineMilliseconds?: number): Promise<ChildHarnessEvent>;
    cleanup(): Promise<ChildHarnessCleanupEvidence>;
}

interface EventWaiter {
    readonly type: ObservableEventType;
    readonly resolve: (event: ChildHarnessEvent) => void;
    readonly reject: (error: Error) => void;
    readonly timer: OwnedTimer;
}

type ListenerTarget = EventEmitter;

interface OwnedTimer {
    active: boolean;
    readonly handle: NodeJS.Timeout;
}

interface OwnedListener {
    readonly event: string;
    readonly listener: (...args: unknown[]) => void;
    readonly target: ListenerTarget;
}

class CompiledChildHarnessSession implements ChildHarnessSession {
    public readonly events: ChildHarnessEvent[] = [];
    public readonly errors: NodeJS.ErrnoException[] = [];
    public readonly messages: unknown[] = [];

    private readonly listeners: OwnedListener[] = [];
    private readonly timers = new Set<OwnedTimer>();
    private readonly waiters = new Set<EventWaiter>();
    private closed = false;
    private cleanupPromise: Promise<ChildHarnessCleanupEvidence> | undefined;
    private expiredDeadlineCount = 0;
    private sequence = 0;
    private stderrText = '';
    private stdoutText = '';

    public constructor(
        public readonly child: ChildProcess,
        public readonly tempDirectory: string,
        public readonly compiledEntrypoint: string,
        private readonly observationDeadlineMilliseconds: number,
        private readonly gracefulReapDeadlineMilliseconds: number,
        private readonly hardReapDeadlineMilliseconds: number,
        private readonly processGroupId?: number,
    ) {
        this.observeChild();
    }

    public get stdout(): string {
        return this.stdoutText;
    }

    public get stderr(): string {
        return this.stderrText;
    }

    public get expiredHarnessDeadlines(): number {
        return this.expiredDeadlineCount;
    }

    public waitForClose(): Promise<void> {
        if (this.closed) {
            return Promise.resolve();
        }

        return this.waitForEvent('close').then(() => undefined);
    }

    public waitForEvent(
        type: ObservableEventType,
        deadlineMilliseconds = this.observationDeadlineMilliseconds,
    ): Promise<ChildHarnessEvent> {
        const observed = this.events.find(event => event.type === type);
        if (observed !== undefined) {
            return Promise.resolve(observed);
        }

        const pending = new Promise<ChildHarnessEvent>((resolve, reject) => {
            const timer = this.createTimer(() => {
                this.waiters.delete(waiter);
                reject(new Error(`Child harness did not observe "${type}"`));
            }, deadlineMilliseconds);
            const waiter: EventWaiter = { type, resolve, reject, timer };
            this.waiters.add(waiter);
        });
        void pending.catch(() => undefined);
        return pending;
    }

    public cleanup(): Promise<ChildHarnessCleanupEvidence> {
        if (this.cleanupPromise === undefined) {
            this.cleanupPromise = this.performCleanup();
        }
        return this.cleanupPromise;
    }

    private async performCleanup(): Promise<ChildHarnessCleanupEvidence> {
        await this.reapChild();
        this.rejectOutstandingWaiters();
        this.detachOwnedListeners();
        this.clearTimers();
        await rm(this.tempDirectory, { recursive: true, force: true });

        return {
            remainingChildProcesses: this.hasRemainingProcesses() ? 1 : 0,
            remainingListeners: this.countAttachedOwnedListeners(),
            remainingTimers: this.countActiveOwnedTimers(),
            remainingTempResources: 0,
        };
    }

    private observeChild(): void {
        this.listen(this.child, 'spawn', () => this.record({ type: 'spawn' }));
        this.listen(this.child, 'message', (message: unknown) => {
            this.messages.push(message);
            this.record({ type: 'message', message });
        });
        this.listen(this.child, 'disconnect', () => this.record({ type: 'disconnect' }));
        this.listen(this.child, 'error', (error: NodeJS.ErrnoException) => {
            this.errors.push(error);
            this.record({ type: 'error', error });
        });
        this.listen(this.child, 'exit', (code: number | null, signal: NodeJS.Signals | null) =>
            this.record({ type: 'exit', code, signal }),
        );
        this.listen(this.child, 'close', (code: number | null, signal: NodeJS.Signals | null) => {
            this.closed = true;
            this.record({ type: 'close', code, signal });
        });

        if (this.child.stdout !== null) {
            this.child.stdout.setEncoding('utf8');
            this.listen(this.child.stdout, 'data', (chunk: string) => {
                this.stdoutText += chunk;
                this.record({ type: 'stdout', chunk });
            });
        }
        if (this.child.stderr !== null) {
            this.child.stderr.setEncoding('utf8');
            this.listen(this.child.stderr, 'data', (chunk: string) => {
                this.stderrText += chunk;
                this.record({ type: 'stderr', chunk });
            });
        }
    }

    private listen<TArgs extends unknown[]>(
        target: ListenerTarget,
        event: string,
        listener: (...args: TArgs) => void,
    ): void {
        const ownedListener = (...args: unknown[]): void => listener(...(args as TArgs));
        target.on(event, ownedListener);
        this.listeners.push({ target, event, listener: ownedListener });
    }

    private record(event: ChildHarnessEventPayload): void {
        const observed = { sequence: this.sequence, ...event } as ChildHarnessEvent;
        this.sequence += 1;
        this.events.push(observed);

        for (const waiter of this.waiters) {
            if (waiter.type !== observed.type) {
                continue;
            }
            this.completeWaiter(waiter);
            waiter.resolve(observed);
        }
    }

    private completeWaiter(waiter: EventWaiter): void {
        this.clearTimer(waiter.timer);
        this.waiters.delete(waiter);
    }

    private createTimer(callback: () => void, deadlineMilliseconds = this.observationDeadlineMilliseconds): OwnedTimer {
        const timer: OwnedTimer = {
            active: true,
            handle: setTimeout(() => {
                timer.active = false;
                this.expiredDeadlineCount += 1;
                callback();
            }, deadlineMilliseconds),
        };
        this.timers.add(timer);
        return timer;
    }

    private clearTimer(timer: OwnedTimer): void {
        if (!timer.active) {
            return;
        }
        clearTimeout(timer.handle);
        timer.active = false;
    }

    private countActiveOwnedTimers(): number {
        return [...this.timers].filter(timer => timer.active).length;
    }

    private countAttachedOwnedListeners(): number {
        return this.listeners.filter(({ target, event, listener }) =>
            target.rawListeners(event).some(attached => attached === listener),
        ).length;
    }

    private clearTimers(): void {
        for (const timer of this.timers) {
            this.clearTimer(timer);
        }
    }

    private async reapChild(): Promise<void> {
        if (this.processGroupId !== undefined) {
            this.signalProcessGroup('SIGTERM');
            await this.waitForHarnessClose(this.gracefulReapDeadlineMilliseconds);
            await this.waitForProcessGroupExit(50);
            if (this.isProcessGroupAlive()) {
                this.signalProcessGroup('SIGKILL');
                await this.waitForProcessGroupExit(this.hardReapDeadlineMilliseconds);
            }
            return;
        }

        if (this.closed) {
            return;
        }
        if (this.child.pid !== undefined) {
            this.child.kill('SIGTERM');
        }
        await this.waitForHarnessClose(this.gracefulReapDeadlineMilliseconds);

        if (this.closed) {
            return;
        }
        if (this.child.pid !== undefined) {
            this.child.kill('SIGKILL');
        }
        await this.waitForHarnessClose(this.hardReapDeadlineMilliseconds);
    }

    private async waitForProcessGroupExit(deadlineMilliseconds: number): Promise<void> {
        const deadline = Date.now() + deadlineMilliseconds;
        while (this.isProcessGroupAlive() && Date.now() < deadline) {
            // Poll interval for the real exit condition (isProcessGroupAlive()) checked above;
            // not a fixed wait-then-assume delay, so no vi.waitFor conversion is needed.
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }

    private hasRemainingProcesses(): boolean {
        return this.processGroupId === undefined ? !this.closed : this.isProcessGroupAlive();
    }

    private isProcessGroupAlive(): boolean {
        if (this.processGroupId === undefined) {
            return false;
        }
        try {
            process.kill(-this.processGroupId, 0);
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
                return false;
            }
            throw error;
        }
    }

    private signalProcessGroup(signal: NodeJS.Signals): void {
        if (this.processGroupId === undefined) {
            return;
        }
        try {
            process.kill(-this.processGroupId, signal);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
                throw error;
            }
        }
    }

    private waitForHarnessClose(deadlineMilliseconds = this.observationDeadlineMilliseconds): Promise<void> {
        if (this.closed) {
            return Promise.resolve();
        }

        return new Promise(resolve => {
            const timer = this.createTimer(resolve, deadlineMilliseconds);
            const checkClosed = (): void => {
                if (!this.closed) {
                    return;
                }
                this.clearTimer(timer);
                resolve();
            };
            this.listen(this.child, 'close', checkClosed);
        });
    }

    private rejectOutstandingWaiters(): void {
        for (const waiter of this.waiters) {
            this.completeWaiter(waiter);
            waiter.reject(new Error('Child harness cleaned up before the observation completed'));
        }
    }

    private detachOwnedListeners(): void {
        for (const { target, event, listener } of this.listeners) {
            target.off(event, listener);
        }
    }
}

const formatDiagnostics = (diagnostics: readonly ts.Diagnostic[]): string =>
    ts.formatDiagnostics(diagnostics, {
        getCanonicalFileName: fileName => fileName,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => '\n',
    });

const compileScenario = async (sourceEntrypoint: string, compiledEntrypoint: string, source: string): Promise<void> => {
    await writeFile(sourceEntrypoint, source, { encoding: 'utf8', mode: 0o600 });

    const compilerOptions: ts.CompilerOptions = {
        esModuleInterop: true,
        // 製品と同じ解決方法で組み立てる。TypeScript 6 はこの指定を非推奨として拒否するため、
        // 6 系の間は明示的に許可する。製品側が別の解決方法へ移った時点でここも合わせる。
        ignoreDeprecations: '6.0',
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        noEmitOnError: true,
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ES2021,
        types: ['node'],
    };
    const program = ts.createProgram([sourceEntrypoint], compilerOptions);
    const preEmitDiagnostics = ts.getPreEmitDiagnostics(program);
    if (preEmitDiagnostics.length > 0) {
        throw new Error(formatDiagnostics(preEmitDiagnostics));
    }

    let emittedJavaScript: string | undefined;
    const emitResult = program.emit(undefined, (fileName, text) => {
        if (fileName.endsWith('.js')) {
            emittedJavaScript = text;
        }
    });
    if (emitResult.diagnostics.length > 0) {
        throw new Error(formatDiagnostics(emitResult.diagnostics));
    }
    if (emittedJavaScript === undefined) {
        throw new Error('TypeScript did not emit the synthetic child entrypoint');
    }
    await writeFile(compiledEntrypoint, emittedJavaScript, { encoding: 'utf8', mode: 0o600 });
};

export const spawnCompiledChildScenario = async (
    scenario: ChildScenario,
    options: SpawnCompiledChildOptions = {},
): Promise<ChildHarnessSession> => {
    if (options.temporaryParentDirectory === '') {
        throw new TypeError('Temporary parent directory must not be empty');
    }
    const temporaryParentDirectory = resolve(options.temporaryParentDirectory ?? tmpdir());
    const tempDirectory = await mkdtemp(join(temporaryParentDirectory, 'epgstation-child-harness-'));
    const sourceEntrypoint = join(tempDirectory, 'entrypoint.ts');
    const compiledEntrypoint = join(tempDirectory, 'entrypoint.cjs');

    try {
        await compileScenario(sourceEntrypoint, compiledEntrypoint, scenario.source);
        const child = spawn(options.executablePath ?? process.execPath, [compiledEntrypoint], {
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });
        return new CompiledChildHarnessSession(
            child,
            tempDirectory,
            compiledEntrypoint,
            options.observationDeadlineMilliseconds ?? harnessDeadlineMilliseconds,
            options.gracefulReapDeadlineMilliseconds ??
                options.observationDeadlineMilliseconds ??
                harnessDeadlineMilliseconds,
            options.hardReapDeadlineMilliseconds ?? harnessDeadlineMilliseconds,
        );
    } catch (error) {
        await rm(tempDirectory, { recursive: true, force: true });
        throw error;
    }
};

export const createCompiledEntrypointSession = async (
    options: CreateCompiledEntrypointSessionOptions,
): Promise<ChildHarnessSession> => {
    if (options.temporaryParentDirectory === '') {
        throw new TypeError('Temporary parent directory must not be empty');
    }
    const temporaryParentDirectory = resolve(options.temporaryParentDirectory ?? tmpdir());
    const runtimeRoot = await mkdtemp(join(temporaryParentDirectory, 'epgstation-runtime-harness-'));
    const entrypointRelativePath = relative(resolve(options.cwd), resolve(options.compiledEntrypoint));
    if (
        entrypointRelativePath.length === 0 ||
        entrypointRelativePath.startsWith('..') ||
        isAbsolute(entrypointRelativePath)
    ) {
        await rm(runtimeRoot, { recursive: true, force: true });
        throw new Error('Compiled entrypoint must be inside its source runtime root');
    }

    try {
        await options.prepareRuntimeRoot(runtimeRoot);
        const runtimeEntrypoint = resolve(runtimeRoot, entrypointRelativePath);
        const child = spawn(options.executablePath ?? process.execPath, [runtimeEntrypoint], {
            cwd: runtimeRoot,
            detached: options.detachedProcessGroup === true,
            env: { ...process.env, ...options.env, NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE },
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });
        return new CompiledChildHarnessSession(
            child,
            runtimeRoot,
            runtimeEntrypoint,
            options.observationDeadlineMilliseconds ?? harnessDeadlineMilliseconds,
            options.gracefulReapDeadlineMilliseconds ??
                options.observationDeadlineMilliseconds ??
                harnessDeadlineMilliseconds,
            options.hardReapDeadlineMilliseconds ?? harnessDeadlineMilliseconds,
            options.detachedProcessGroup === true ? child.pid : undefined,
        );
    } catch (error) {
        await rm(runtimeRoot, { recursive: true, force: true });
        throw error;
    }
};
