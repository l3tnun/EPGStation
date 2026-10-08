class ConfirmedServiceAddressInUseError extends Error {
    public readonly cause: unknown;

    public constructor(cause: unknown) {
        super('Service startup failed because its configured port was already in use');
        this.name = 'ConfirmedServiceAddressInUseError';
        this.cause = cause;
    }
}

export const classifyServiceStartupFailure = (failure: unknown, serviceLog: string): unknown =>
    /(?:^|\W)EADDRINUSE(?:\W|$)/u.test(serviceLog) ? new ConfirmedServiceAddressInUseError(failure) : failure;

export const retryConfirmedServiceAddressInUse = async <T>(attempt: () => Promise<T>): Promise<T> => {
    try {
        return await attempt();
    } catch (error) {
        if (!(error instanceof ConfirmedServiceAddressInUseError)) {
            throw error;
        }
        return attempt();
    }
};
