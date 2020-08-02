import { MigrationInterface, QueryRunner } from 'typeorm';

export class IsTsToType1596346076567 implements MigrationInterface {
    public name = 'IsTsToType1596346076567';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'CREATE TABLE "temporary_video_file" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "parentDirectoryName" integer NOT NULL, "filePath" varchar NOT NULL, "type" boolean NOT NULL, "name" varchar NOT NULL, "size" bigint NOT NULL DEFAULT (0), "recordedId" integer NOT NULL, CONSTRAINT "FK_8407bb2c2e9d927e8c1c694c6a8" FOREIGN KEY ("recordedId") REFERENCES "recorded" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)',
        );
        await queryRunner.query(
            'INSERT INTO "temporary_video_file"("id", "parentDirectoryName", "filePath", "type", "name", "size", "recordedId") SELECT "id", "parentDirectoryName", "filePath", "isTs", "name", "size", "recordedId" FROM "video_file"',
        );
        await queryRunner.query('DROP TABLE "video_file"');
        await queryRunner.query('ALTER TABLE "temporary_video_file" RENAME TO "video_file"');
        await queryRunner.query(
            'CREATE TABLE "temporary_video_file" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "parentDirectoryName" integer NOT NULL, "filePath" varchar NOT NULL, "type" varchar NOT NULL, "name" varchar NOT NULL, "size" bigint NOT NULL DEFAULT (0), "recordedId" integer NOT NULL, CONSTRAINT "FK_8407bb2c2e9d927e8c1c694c6a8" FOREIGN KEY ("recordedId") REFERENCES "recorded" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)',
        );
        await queryRunner.query(
            'INSERT INTO "temporary_video_file"("id", "parentDirectoryName", "filePath", "type", "name", "size", "recordedId") SELECT "id", "parentDirectoryName", "filePath", "type", "name", "size", "recordedId" FROM "video_file"',
        );
        await queryRunner.query('DROP TABLE "video_file"');
        await queryRunner.query('ALTER TABLE "temporary_video_file" RENAME TO "video_file"');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "video_file" RENAME TO "temporary_video_file"');
        await queryRunner.query(
            'CREATE TABLE "video_file" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "parentDirectoryName" integer NOT NULL, "filePath" varchar NOT NULL, "type" boolean NOT NULL, "name" varchar NOT NULL, "size" bigint NOT NULL DEFAULT (0), "recordedId" integer NOT NULL, CONSTRAINT "FK_8407bb2c2e9d927e8c1c694c6a8" FOREIGN KEY ("recordedId") REFERENCES "recorded" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)',
        );
        await queryRunner.query(
            'INSERT INTO "video_file"("id", "parentDirectoryName", "filePath", "type", "name", "size", "recordedId") SELECT "id", "parentDirectoryName", "filePath", "type", "name", "size", "recordedId" FROM "temporary_video_file"',
        );
        await queryRunner.query('DROP TABLE "temporary_video_file"');
        await queryRunner.query('ALTER TABLE "video_file" RENAME TO "temporary_video_file"');
        await queryRunner.query(
            'CREATE TABLE "video_file" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "parentDirectoryName" integer NOT NULL, "filePath" varchar NOT NULL, "isTs" boolean NOT NULL, "name" varchar NOT NULL, "size" bigint NOT NULL DEFAULT (0), "recordedId" integer NOT NULL, CONSTRAINT "FK_8407bb2c2e9d927e8c1c694c6a8" FOREIGN KEY ("recordedId") REFERENCES "recorded" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)',
        );
        await queryRunner.query(
            'INSERT INTO "video_file"("id", "parentDirectoryName", "filePath", "isTs", "name", "size", "recordedId") SELECT "id", "parentDirectoryName", "filePath", "type", "name", "size", "recordedId" FROM "temporary_video_file"',
        );
        await queryRunner.query('DROP TABLE "temporary_video_file"');
    }
}
