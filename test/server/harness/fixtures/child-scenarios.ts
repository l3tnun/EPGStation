export interface ChildScenario {
    readonly name: string;
    readonly source: string;
}

export interface StreamDrainScenario extends ChildScenario {
    readonly expectedStdout: string;
    readonly expectedStderr: string;
}

const streamLength = 128 * 1024;
const expectedStdout = `${'O'.repeat(streamLength)}\nstdout-drained\n`;
const expectedStderr = `${'E'.repeat(streamLength)}\nstderr-drained\n`;

export const childScenarios = {
    normalExit: {
        name: 'normal-exit',
        source: `
const output: string = 'normal-output';
console.log(output);
`,
    },
    ipcMessage: {
        name: 'ipc-message',
        source: `
const message: { kind: string; sequence: number } = {
    kind: 'synthetic-ready',
    sequence: 1,
};
process.send?.(message, () => process.disconnect());
`,
    },
    streamDrain: {
        name: 'stream-drain',
        source: `
process.stdout.write('O'.repeat(${streamLength}));
process.stdout.write('\\nstdout-drained\\n');
process.stderr.write('E'.repeat(${streamLength}));
process.stderr.write('\\nstderr-drained\\n');
`,
        expectedStdout,
        expectedStderr,
    },
    signalWait: {
        name: 'signal-wait',
        source: `
process.send?.({ kind: 'waiting-for-signal' });
setInterval(() => undefined, 60_000);
`,
    },
    unhandledRejection: {
        name: 'unhandled-rejection',
        source: `
const failure: Error = new Error('synthetic-unhandled-rejection');
void Promise.reject(failure);
`,
    },
    continuing: {
        name: 'continuing',
        source: `
process.send?.({ kind: 'continuing' });
setInterval(() => undefined, 60_000);
`,
    },
    stubborn: {
        name: 'stubborn',
        source: `
process.on('SIGTERM', () => {
    process.send?.({ kind: 'ignored-sigterm' });
});
process.send?.({ kind: 'stubborn-ready' });
setInterval(() => undefined, 60_000);
`,
    },
} satisfies Record<string, ChildScenario | StreamDrainScenario>;
