/**
 * @types/fs-extra でエラーが出るので一時的に対応
 */

declare module 'fs-extra' {
    export const copy: (src: string, dest: string) => Promise<void>;
}

