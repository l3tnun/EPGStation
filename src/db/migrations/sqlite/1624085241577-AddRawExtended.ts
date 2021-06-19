/* eslint-disable max-len */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRawExtended1624085241577 implements MigrationInterface {
    name = 'AddRawExtended1624085241577';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE program ADD COLUMN "rawExtended" text`);
        await queryRunner.query(`ALTER TABLE program ADD COLUMN "rawHalfWidthExtended" text`);

        await queryRunner.query(`ALTER TABLE recorded ADD COLUMN "rawExtended" text`);
        await queryRunner.query(`ALTER TABLE recorded ADD COLUMN "rawHalfWidthExtended" text`);

        await queryRunner.query(`ALTER TABLE reserve ADD COLUMN "rawExtended" text`);
        await queryRunner.query(`ALTER TABLE reserve ADD COLUMN "rawHalfWidthExtended" text`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "reserve" RENAME TO "temporary_reserve"`);
        await queryRunner.query(
            `CREATE TABLE "reserve" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "updateTime" bigint NOT NULL, "ruleId" integer, "ruleUpdateCnt" integer, "isSkip" boolean NOT NULL DEFAULT (0), "isConflict" boolean NOT NULL DEFAULT (0), "allowEndLack" boolean NOT NULL DEFAULT (0), "tags" text, "isOverlap" boolean NOT NULL DEFAULT (0), "isIgnoreOverlap" boolean NOT NULL DEFAULT (0), "isTimeSpecified" boolean NOT NULL DEFAULT (0), "parentDirectoryName" text, "directory" text, "recordedFormat" text, "encodeMode1" text, "encodeParentDirectoryName1" text, "encodeDirectory1" text, "encodeMode2" text, "encodeParentDirectoryName2" text, "encodeDirectory2" text, "encodeMode3" text, "encodeParentDirectoryName3" text, "encodeDirectory3" text, "isDeleteOriginalAfterEncode" boolean NOT NULL DEFAULT (0), "programId" bigint, "programUpdateTime" bigint, "channelId" bigint NOT NULL, "channel" text NOT NULL, "channelType" text NOT NULL, "startAt" bigint NOT NULL, "endAt" bigint NOT NULL, "name" text, "halfWidthName" text, "shortName" text, "description" text, "halfWidthDescription" text, "extended" text, "halfWidthExtended" text, "genre1" integer, "subGenre1" integer, "genre2" integer, "subGenre2" integer, "genre3" integer, "subGenre3" integer, "videoType" text, "videoResolution" text, "videoStreamContent" integer, "videoComponentType" integer, "audioSamplingRate" integer, "audioComponentType" integer)`,
        );
        await queryRunner.query(
            `INSERT INTO "reserve"("id", "updateTime", "ruleId", "ruleUpdateCnt", "isSkip", "isConflict", "allowEndLack", "tags", "isOverlap", "isIgnoreOverlap", "isTimeSpecified", "parentDirectoryName", "directory", "recordedFormat", "encodeMode1", "encodeParentDirectoryName1", "encodeDirectory1", "encodeMode2", "encodeParentDirectoryName2", "encodeDirectory2", "encodeMode3", "encodeParentDirectoryName3", "encodeDirectory3", "isDeleteOriginalAfterEncode", "programId", "programUpdateTime", "channelId", "channel", "channelType", "startAt", "endAt", "name", "halfWidthName", "shortName", "description", "halfWidthDescription", "extended", "halfWidthExtended", "genre1", "subGenre1", "genre2", "subGenre2", "genre3", "subGenre3", "videoType", "videoResolution", "videoStreamContent", "videoComponentType", "audioSamplingRate", "audioComponentType") SELECT "id", "updateTime", "ruleId", "ruleUpdateCnt", "isSkip", "isConflict", "allowEndLack", "tags", "isOverlap", "isIgnoreOverlap", "isTimeSpecified", "parentDirectoryName", "directory", "recordedFormat", "encodeMode1", "encodeParentDirectoryName1", "encodeDirectory1", "encodeMode2", "encodeParentDirectoryName2", "encodeDirectory2", "encodeMode3", "encodeParentDirectoryName3", "encodeDirectory3", "isDeleteOriginalAfterEncode", "programId", "programUpdateTime", "channelId", "channel", "channelType", "startAt", "endAt", "name", "halfWidthName", "shortName", "description", "halfWidthDescription", "extended", "halfWidthExtended", "genre1", "subGenre1", "genre2", "subGenre2", "genre3", "subGenre3", "videoType", "videoResolution", "videoStreamContent", "videoComponentType", "audioSamplingRate", "audioComponentType" FROM "temporary_reserve"`,
        );
        await queryRunner.query(`DROP TABLE "temporary_reserve"`);
        await queryRunner.query(`ALTER TABLE "recorded" RENAME TO "temporary_recorded"`);
        await queryRunner.query(
            `CREATE TABLE "recorded" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "reserveId" integer, "ruleId" integer, "programId" bigint, "channelId" bigint NOT NULL, "isProtected" boolean NOT NULL DEFAULT (0), "startAt" bigint NOT NULL, "endAt" bigint NOT NULL, "duration" integer NOT NULL, "name" text NOT NULL, "halfWidthName" text NOT NULL, "description" text, "halfWidthDescription" text, "extended" text, "halfWidthExtended" text, "genre1" integer, "subGenre1" integer, "genre2" integer, "subGenre2" integer, "genre3" integer, "subGenre3" integer, "videoType" text, "videoResolution" text, "videoStreamContent" integer, "videoComponentType" integer, "audioSamplingRate" integer, "audioComponentType" integer, "isRecording" boolean NOT NULL, "dropLogFileId" integer, CONSTRAINT "UQ_e0bc5373673ea0f120445830f4d" UNIQUE ("dropLogFileId"), CONSTRAINT "FK_e0bc5373673ea0f120445830f4d" FOREIGN KEY ("dropLogFileId") REFERENCES "drop_log_file" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`,
        );
        await queryRunner.query(
            `INSERT INTO "recorded"("id", "reserveId", "ruleId", "programId", "channelId", "isProtected", "startAt", "endAt", "duration", "name", "halfWidthName", "description", "halfWidthDescription", "extended", "halfWidthExtended", "genre1", "subGenre1", "genre2", "subGenre2", "genre3", "subGenre3", "videoType", "videoResolution", "videoStreamContent", "videoComponentType", "audioSamplingRate", "audioComponentType", "isRecording", "dropLogFileId") SELECT "id", "reserveId", "ruleId", "programId", "channelId", "isProtected", "startAt", "endAt", "duration", "name", "halfWidthName", "description", "halfWidthDescription", "extended", "halfWidthExtended", "genre1", "subGenre1", "genre2", "subGenre2", "genre3", "subGenre3", "videoType", "videoResolution", "videoStreamContent", "videoComponentType", "audioSamplingRate", "audioComponentType", "isRecording", "dropLogFileId" FROM "temporary_recorded"`,
        );
        await queryRunner.query(`DROP TABLE "temporary_recorded"`);
        await queryRunner.query(`ALTER TABLE "program" RENAME TO "temporary_program"`);
        await queryRunner.query(
            `CREATE TABLE "program" ("id" bigint PRIMARY KEY NOT NULL, "updateTime" bigint NOT NULL, "channelId" bigint NOT NULL, "eventId" bigint NOT NULL, "serviceId" integer NOT NULL, "networkId" integer NOT NULL, "startAt" bigint NOT NULL, "endAt" bigint NOT NULL, "startHour" integer NOT NULL, "week" integer NOT NULL, "duration" integer NOT NULL, "isFree" boolean NOT NULL, "name" text NOT NULL, "halfWidthName" text NOT NULL, "shortName" text NOT NULL, "description" text, "halfWidthDescription" text, "extended" text, "halfWidthExtended" text, "genre1" integer, "subGenre1" integer, "genre2" integer, "subGenre2" integer, "genre3" integer, "subGenre3" integer, "channelType" varchar NOT NULL, "channel" varchar NOT NULL, "videoType" text, "videoResolution" text, "videoStreamContent" integer, "videoComponentType" integer, "audioSamplingRate" integer, "audioComponentType" integer)`,
        );
        await queryRunner.query(
            `INSERT INTO "program"("id", "updateTime", "channelId", "eventId", "serviceId", "networkId", "startAt", "endAt", "startHour", "week", "duration", "isFree", "name", "halfWidthName", "shortName", "description", "halfWidthDescription", "extended", "halfWidthExtended", "genre1", "subGenre1", "genre2", "subGenre2", "genre3", "subGenre3", "channelType", "channel", "videoType", "videoResolution", "videoStreamContent", "videoComponentType", "audioSamplingRate", "audioComponentType") SELECT "id", "updateTime", "channelId", "eventId", "serviceId", "networkId", "startAt", "endAt", "startHour", "week", "duration", "isFree", "name", "halfWidthName", "shortName", "description", "halfWidthDescription", "extended", "halfWidthExtended", "genre1", "subGenre1", "genre2", "subGenre2", "genre3", "subGenre3", "channelType", "channel", "videoType", "videoResolution", "videoStreamContent", "videoComponentType", "audioSamplingRate", "audioComponentType" FROM "temporary_program"`,
        );
        await queryRunner.query(`DROP TABLE "temporary_program"`);
    }
}
