import { injectable } from 'inversify';
import * as path from 'path';
import FileUtil from '../../../util/FileUtil.js';
import IEncodeFileManageModel from './IEncodeFileManageModel.js';

/**
 * `IEncodeFileManageModel` の実装。エンコード出力先ファイルパスの重複を避けるための
 * 採番（同名なら`(n)`を付けて回避）と、進行中エンコードが使用中のパスの管理を行う。
 */
@injectable()
export default class EncodeFileManageModel implements IEncodeFileManageModel {
    private usedFileNameIndex: { [name: string]: boolean } = {}; // 使用済みファイル名

    /**
     * エンコードファイルの出力先を返す
     * 出力先パスを usedFileNameIndex に登録して重複したファイルパスが使用されないようにする
     * @param outputDirPath: string 出力先ディレクトリ
     * @param inputFilePath: string 入力ファイルパス
     * @param suffix: 拡張子
     * @returns 出力先パス
     */
    public async getFilePath(outputDirPath: string, inputFilePath: string, suffix: string): Promise<string> {
        const basefileName = path.basename(inputFilePath, path.extname(inputFilePath));

        // while(1) の中でのみ代入するため、初期値を外すと確定代入と見なされない。
        // eslint-disable-next-line no-useless-assignment
        let result: string | null = null;
        let conflict = 0;
        while (1) {
            // ファイル名生成
            let fileName = basefileName;
            if (conflict > 0) {
                fileName += `(${conflict.toString(10)})`;
            }
            fileName += suffix;

            result = path.join(outputDirPath, fileName);

            // 使用済みファイル名に一致するか
            if (typeof this.usedFileNameIndex[result] !== 'undefined') {
                conflict++;
                continue;
            }

            // 同名ファイルがすでに存在するか
            try {
                await FileUtil.stat(result);
                conflict++;
            } catch (e: any) {
                // 同名ファイルがすでに存在しなかった
                break;
            }
        }

        if (result === null) {
            throw new Error('GetFilePathError');
        }

        // 使用済みファイル名として登録する
        this.usedFileNameIndex[result] = true;

        return result;
    }

    /**
     * 指定されたファイルパスを使用済みリストから開放する
     * @param filePath: ファイルパス
     */
    public release(filePath: string): void {
        delete this.usedFileNameIndex[filePath];
    }
}
declare const __EPGSTATION_COVERAGE_EXCLUSION_ENCODE_FILE_MANAGE_WHILE_RESULT_NULL_20260924: unique symbol;
