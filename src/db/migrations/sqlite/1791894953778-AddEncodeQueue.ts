import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TypeORM migration（sqlite）。エンコードの依頼の記録を保存する `encode_queue` テーブルを追加する。
 * 識別番号 `id` は呼出し元が割り当てる主キー（自動採番なし）、`option` は依頼内容の JSON 文字列、
 * `outputPath` は変換を開始したときの出力先（未定なら NULL）、`createdAt` は記録した時刻（UNIX ミリ秒）。
 * 既存のテーブルは変更しない。
 */
export class AddEncodeQueue1791894953778 implements MigrationInterface {
    name = 'AddEncodeQueue1791894953778';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "encode_queue" ("id" bigint PRIMARY KEY NOT NULL, "option" text NOT NULL, "outputPath" text, "createdAt" bigint NOT NULL)`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "encode_queue"`);
    }
}
