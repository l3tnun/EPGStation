if (typeof process.send !== 'function') process.exit(90);

let replyCount = 0;
const keepAlive = setInterval(() => undefined, 1_000);

const observe = observation => {
    process.stdout.write(`${JSON.stringify(observation)}\n`);
};

process.on('disconnect', () => {
    observe({ kind: 'disconnected', replyCount });
});

process.on('SIGTERM', () => {
    clearInterval(keepAlive);
    process.exit(0);
});

if (process.env.EPGSTATION_UPLOAD_ACK_CHILD_STARTUP_MODE === 'reject') {
    observe({ kind: 'startup-rejected' });
} else if (process.env.EPGSTATION_UPLOAD_ACK_CHILD_STARTUP_MODE !== 'silent') {
    process.on('message', message => {
        if (message?.kind === 'dispatch') {
            process.send(message.request);
            observe({ kind: 'dispatched' });

            return;
        }
        if (message?.kind === 'report') {
            observe({ kind: 'report', replyCount });

            return;
        }
        if (message?.type === 'uploadedVideoAdopted') {
            observe({ id: message.id, kind: 'adoption-ack-discarded', type: message.type });

            return;
        }
        replyCount += 1;
        observe({ kind: 'reply', replyCount });
    });

    observe({ kind: 'ready' });
}
