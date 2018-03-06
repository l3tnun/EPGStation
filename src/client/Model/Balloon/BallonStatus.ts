/**
 * BalloonStatus
 * Balloon の表示、非表示の状態を保持する
 */
class BalloonStatus {
    private status: boolean = false;

    public open(): void {
        this.status = true;
    }

    public close(): void {
        this.status = false;
    }

    public get(): boolean {
        return this.status;
    }
}

export default BalloonStatus;

