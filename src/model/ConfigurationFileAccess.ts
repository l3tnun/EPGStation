import * as fs from 'fs';
import { injectable } from 'inversify';
import * as path from 'path';
import IConfigurationFileAccess, { ConfigurationChangeListener } from './IConfigurationFileAccess.js';

/**
 * `IConfigurationFileAccess`の実装。設定ファイルの実I/Oを`fs`にそのまま委譲する薄いラッパー。
 * `configPath`/`templatePath`はNode.jsのcompile後の実行位置（`import.meta.dirname`、
 * dist配下のこのfile自身の場所）を基準に2階層上へ遡ったprojectルート直下の`config/`を指すため、
 * ビルド出力の配置（`dist/model/ConfigurationFileAccess.js`相当）を変えると壊れる。
 */
@injectable()
class ConfigurationFileAccess implements IConfigurationFileAccess {
    public readonly configPath = path.join(import.meta.dirname, '..', '..', 'config', 'config.yml');
    public readonly templatePath = path.join(import.meta.dirname, '..', '..', 'config', 'config.yml.template');

    public readSync(targetPath: string): string {
        return fs.readFileSync(targetPath, 'utf-8');
    }

    public read(targetPath: string): Promise<string> {
        return fs.promises.readFile(targetPath, 'utf-8');
    }

    public watch(targetPath: string, listener: ConfigurationChangeListener): void {
        fs.watchFile(targetPath, listener);
    }

    public unwatch(targetPath: string, listener: ConfigurationChangeListener): void {
        fs.unwatchFile(targetPath, listener);
    }
}

export default ConfigurationFileAccess;
