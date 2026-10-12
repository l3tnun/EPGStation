import * as path from 'path';
import type * as apid from '../../api.js';

/**
 * 保存先内ディレクトリが録画保存先の外を指すことを示すエラーメッセージ。
 * 予約・ルール・手動エンコードの追加と編集が拒否するときに使い、API 層はこの文字列で入力エラー（HTTP 400）と判別する
 * （IPC を越えてもエラーメッセージは保たれる）。
 */
export const INVALID_SUB_DIRECTORY_ERROR = 'InvalidSubDirectory';

/**
 * 登録された相対パスの先頭の区切り文字（`/`、Windowsでは`\`も）を取り除く。
 * 録画ファイルは`path.join(保存先root, 登録path)`で作られ、`/anime/x.ts`も保存先root内の`anime/x.ts`になるため、
 * 保存先内ディレクトリの検査と削除は同じ解釈でroot相対のパスにする。
 * @param relativePath 登録された相対パス
 * @param platformPath 区切り文字を決めるplatform（既定は実行中のplatform）
 * @returns 先頭の区切り文字を取り除いたパス
 */
export const stripLeadingSeparators = (
    relativePath: string,
    platformPath: Pick<path.PlatformPath, 'sep'> = path,
): string => relativePath.replace(platformPath.sep === '\\' ? /^[\\/]+/ : /^\/+/, '');

/**
 * 保存先内ディレクトリが、録画保存先のrootの中に収まるかを判定する。
 * NUL文字を含むものと、先頭の区切りを取り除いた残りが絶対パスまたは drive 指定（`C:x` のような drive 相対を含む）になるもの、`.`と`..`を解決するとrootの上へ出るものは外とする。
 * @param subDirectory 保存先内ディレクトリ（書式を展開した後、または展開前の指定）
 * @param platformPath パスの解釈に使うplatform（既定は実行中のplatform）
 * @returns rootの中に収まるなら true
 */
export const isSubDirectoryInsideRoot = (subDirectory: string, platformPath: path.PlatformPath = path): boolean => {
    if (subDirectory.includes('\0')) {
        return false;
    }

    const stripped = stripLeadingSeparators(subDirectory, platformPath);
    // drive 指定（`C:\x`）と drive 相対（`C:x`・`C:`・`C:..`）は、root を持つので外とする
    if (platformPath.parse(stripped).root !== '') {
        return false;
    }

    const normalized = platformPath.normalize(stripped);

    return normalized !== '..' && !normalized.startsWith(`..${platformPath.sep}`);
};

/**
 * 保存オプションとエンコードオプションに、録画保存先の外を指す保存先内ディレクトリがあるかを調べる。
 * @param saveOption 保存オプション（`directory`）
 * @param encodeOption エンコードオプション（`directory1`〜`directory3`）
 * @returns 外を指すものが一つでもあれば true
 */
export const hasSubDirectoryOutsideRoot = (
    saveOption?: apid.ReserveSaveOption,
    encodeOption?: apid.ReserveEncodedOption,
): boolean =>
    [saveOption?.directory, encodeOption?.directory1, encodeOption?.directory2, encodeOption?.directory3].some(
        directory => typeof directory === 'string' && isSubDirectoryInsideRoot(directory) === false,
    );
