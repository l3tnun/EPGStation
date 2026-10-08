import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TypeORM migration（mysql）。`rule` テーブルへ、BS4Kを対象種別に含めるかを示す
 * `BS4K` 列（既定 `false`）を追加する。GR/BS/CS/SKYの4列と対等な5つ目の種別列であり、
 * 既存行は全て `BS4K` = false（既存の絞り込み挙動を変えない）になる。
 */
export class AddRuleBS4K1790497623885 implements MigrationInterface {
    name = 'AddRuleBS4K1790497623885';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`rule\` ADD \`BS4K\` tinyint NOT NULL DEFAULT 0`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`rule\` DROP COLUMN \`BS4K\``);
    }
}
