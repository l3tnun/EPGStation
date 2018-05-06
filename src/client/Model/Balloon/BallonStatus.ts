/**
 * BalloonStatus
 * Balloon の表示、非表示の状態を保持する
 */
class BalloonStatus {
    private status: boolean = false;
    private closeCallback: (() => void) | null = null;

    public open(): void {
        this.status = true;
    }

    public close(): void {
        if (this.closeCallback !== null) {
            this.closeCallback();
        }
        this.status = false;
    }

    public get(): boolean {
        return this.status;
    }

    public setCallback(closeCallback: (() => void)): void {
        this.closeCallback = closeCallback;
    }
}

export default BalloonStatus;

