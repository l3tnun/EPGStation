import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsProtected1599392754629 implements MigrationInterface {
    public name = 'AddIsProtected1599392754629';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE recorded ADD column "isProtected" boolean NOT NULL DEFAULT (0)');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "recorded" RENAME TO "temporary_recorded"');
        await queryRunner.query(
            'CREATE TABLE "recorded" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "reserveId" integer, "ruleId" integer, "programId" bigint, "channelId" bigint NOT NULL, "startAt" bigint NOT NULL, "endAt" bigint NOT NULL, "duration" integer NOT NULL, "name" varchar NOT NULL, "halfWidthName" varchar NOT NULL, "description" text, "halfWidthDescription" text, "extended" text, "halfWidthExtended" text, "genre1" integer, "subGenre1" integer, "genre2" integer, "subGenre2" integer, "genre3" integer, "subGenre3" integer, "videoType" text, "videoResolution" text, "videoStreamContent" integer, "videoComponentType" integer, "audioSamplingRate" integer, "audioComponentType" integer, "isRecording" boolean NOT NULL, "dropLogFileId" integer, CONSTRAINT "UQ_e0bc5373673ea0f120445830f4d" UNIQUE ("dropLogFileId"), CONSTRAINT "FK_e0bc5373673ea0f120445830f4d" FOREIGN KEY ("dropLogFileId") REFERENCES "drop_log_file" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)',
        );
        await queryRunner.query(
            'INSERT INTO "recorded"("id", "reserveId", "ruleId", "programId", "channelId", "startAt", "endAt", "duration", "name", "halfWidthName", "description", "halfWidthDescription", "extended", "halfWidthExtended", "genre1", "subGenre1", "genre2", "subGenre2", "genre3", "subGenre3", "videoType", "videoResolution", "videoStreamContent", "videoComponentType", "audioSamplingRate", "audioComponentType", "isRecording", "dropLogFileId") SELECT "id", "reserveId", "ruleId", "programId", "channelId", "startAt", "endAt", "duration", "name", "halfWidthName", "description", "halfWidthDescription", "extended", "halfWidthExtended", "genre1", "subGenre1", "genre2", "subGenre2", "genre3", "subGenre3", "videoType", "videoResolution", "videoStreamContent", "videoComponentType", "audioSamplingRate", "audioComponentType", "isRecording", "dropLogFileId" FROM "temporary_recorded"',
        );
        await queryRunner.query('DROP TABLE "temporary_recorded"');
    }
}
