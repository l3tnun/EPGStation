import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateTag1597376737777 implements MigrationInterface {
    public name = 'UpdateTag1597376737777';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'CREATE TABLE "temporary_recorded_tag" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "halfWidthName" varchar NOT NULL, "color" varchar NOT NULL)',
        );
        await queryRunner.query(
            'INSERT INTO "temporary_recorded_tag"("id", "name") SELECT "id", "name" FROM "recorded_tag"',
        );
        await queryRunner.query('DROP TABLE "recorded_tag"');
        await queryRunner.query('ALTER TABLE "temporary_recorded_tag" RENAME TO "recorded_tag"');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "recorded_tag" RENAME TO "temporary_recorded_tag"');
        await queryRunner.query(
            'CREATE TABLE "recorded_tag" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL)',
        );
        await queryRunner.query(
            'INSERT INTO "recorded_tag"("id", "name") SELECT "id", "name" FROM "temporary_recorded_tag"',
        );
        await queryRunner.query('DROP TABLE "temporary_recorded_tag"');
    }
}
