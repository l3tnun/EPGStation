import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1589694107084 implements MigrationInterface {
    public name = 'Init1589694107084';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'CREATE TABLE "channel" ("id" bigint PRIMARY KEY NOT NULL, "serviceId" integer NOT NULL, "networkId" integer NOT NULL, "name" varchar NOT NULL, "halfWidthName" varchar NOT NULL, "remoteControlKeyId" integer, "hasLogoData" boolean NOT NULL DEFAULT (0), "channelType" varchar NOT NULL, "channel" varchar NOT NULL)',
            undefined,
        );
        await queryRunner.query(
            'CREATE TABLE "program" ("id" bigint PRIMARY KEY NOT NULL, "updateTime" bigint NOT NULL, "channelId" bigint NOT NULL, "eventId" bigint NOT NULL, "serviceId" integer NOT NULL, "networkId" integer NOT NULL, "startAt" bigint NOT NULL, "endAt" bigint NOT NULL, "startHour" integer NOT NULL, "week" integer NOT NULL, "duration" integer NOT NULL, "isFree" boolean NOT NULL, "name" varchar NOT NULL, "halfWidthName" varchar NOT NULL, "shortName" varchar NOT NULL, "description" text, "halfWidthDescription" text, "extended" text, "halfWidthExtended" text, "genre1" integer, "subGenre1" integer, "genre2" integer, "subGenre2" integer, "genre3" integer, "subGenre3" integer, "channelType" varchar NOT NULL, "channel" varchar NOT NULL, "videoType" text, "videoResolution" text, "videoStreamContent" integer, "videoComponentType" integer, "audioSamplingRate" integer, "audioComponentType" integer)',
            undefined,
        );
        await queryRunner.query(
            'CREATE TABLE "recorded_tag" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL)',
            undefined,
        );
        await queryRunner.query(
            'CREATE TABLE "thumbnail" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "filePath" varchar NOT NULL, "recordedId" integer NOT NULL)',
            undefined,
        );
        await queryRunner.query(
            'CREATE TABLE "video_file" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "parentDirectoryName" integer NOT NULL, "filePath" varchar NOT NULL, "isTs" boolean NOT NULL, "name" varchar NOT NULL, "size" bigint NOT NULL DEFAULT (0), "recordedId" integer NOT NULL)',
            undefined,
        );
        await queryRunner.query(
            'CREATE TABLE "recorded" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "reserveId" integer, "ruleId" integer, "programId" bigint, "channelId" bigint NOT NULL, "startAt" bigint NOT NULL, "endAt" bigint NOT NULL, "duration" integer NOT NULL, "name" varchar NOT NULL, "halfWidthName" varchar NOT NULL, "description" text, "halfWidthDescription" text, "extended" text, "halfWidthExtended" text, "genre1" integer, "subGenre1" integer, "genre2" integer, "subGenre2" integer, "genre3" integer, "subGenre3" integer, "videoType" text, "videoResolution" text, "videoStreamContent" integer, "videoComponentType" integer, "audioSamplingRate" integer, "audioComponentType" integer, "isRecording" boolean NOT NULL)',
            undefined,
        );
        await queryRunner.query(
            'CREATE TABLE "recorded_history" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" varchar NOT NULL, "channelId" bigint NOT NULL, "endAt" bigint NOT NULL)',
            undefined,
        );
        await queryRunner.query(
            'CREATE TABLE "reserve" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "updateTime" bigint NOT NULL, "ruleId" integer, "ruleUpdateCnt" integer, "isSkip" boolean NOT NULL DEFAULT (0), "isConflict" boolean NOT NULL DEFAULT (0), "allowEndLack" boolean NOT NULL DEFAULT (0), "isOverlap" boolean NOT NULL DEFAULT (0), "isIgnoreOverlap" boolean NOT NULL DEFAULT (0), "isTimeSpecifited" boolean NOT NULL DEFAULT (0), "parentDirectoryName" text, "directory" text, "recordedFormat" text, "encodeMode1" text, "encodeParentDirectoryName1" text, "encodeDirectory1" text, "encodeMode2" text, "encodeParentDirectoryName2" text, "encodeDirectory2" text, "encodeMode3" text, "encodeParentDirectoryName3" text, "encodeDirectory3" text, "encodeDelTs" boolean NOT NULL DEFAULT (0), "programId" bigint, "programUpdateTime" bigint, "channelId" bigint NOT NULL, "channel" text NOT NULL, "channelType" text NOT NULL, "startAt" bigint NOT NULL, "endAt" bigint NOT NULL, "name" text, "halfWidthName" text, "shortName" text, "description" text, "halfWidthDescription" text, "extended" text, "halfWidthExtended" text, "genre1" integer, "subGenre1" integer, "genre2" integer, "subGenre2" integer, "genre3" integer, "subGenre3" integer, "videoType" text, "videoResolution" text, "videoStreamContent" integer, "videoComponentType" integer, "audioSamplingRate" integer, "audioComponentType" integer)',
            undefined,
        );
        await queryRunner.query(
            'CREATE TABLE "rule" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "updateCnt" integer NOT NULL DEFAULT (0), "isTimeSpecification" boolean NOT NULL DEFAULT (0), "keyword" text, "ignoreKeyword" text, "keyCS" boolean NOT NULL DEFAULT (0), "keyRegExp" boolean NOT NULL DEFAULT (0), "name" boolean NOT NULL DEFAULT (0), "description" boolean NOT NULL DEFAULT (0), "extended" boolean NOT NULL DEFAULT (0), "ignoreKeyCS" boolean NOT NULL DEFAULT (0), "ignoreKeyRegExp" boolean NOT NULL DEFAULT (0), "ignoreName" boolean NOT NULL DEFAULT (0), "ignoreDescription" boolean NOT NULL DEFAULT (0), "ignoreExtended" boolean NOT NULL DEFAULT (0), "GR" boolean NOT NULL DEFAULT (0), "BS" boolean NOT NULL DEFAULT (0), "CS" boolean NOT NULL DEFAULT (0), "SKY" boolean NOT NULL DEFAULT (0), "channelIds" text, "genres" text, "times" text, "week" integer, "isFree" boolean NOT NULL DEFAULT (0), "durationMin" integer, "durationMax" integer, "searchPeriods" text, "enable" boolean NOT NULL DEFAULT (0), "avoidDuplicate" boolean NOT NULL DEFAULT (0), "periodToAvoidDuplicate" integer, "allowEndLack" boolean NOT NULL DEFAULT (1), "parentDirectoryName" text, "directory" text, "recordedFormat" text, "mode1" text, "parentDirectoryName1" text, "directory1" text, "mode2" text, "parentDirectoryName2" text, "directory2" text, "mode3" text, "parentDirectoryName3" text, "directory3" text, "delTs" boolean NOT NULL DEFAULT (0))',
            undefined,
        );
        await queryRunner.query(
            'CREATE TABLE "recorded_tags_recorded_tag" ("recordedId" integer NOT NULL, "recordedTagId" integer NOT NULL, PRIMARY KEY ("recordedId", "recordedTagId"))',
            undefined,
        );
        await queryRunner.query(
            'CREATE INDEX "IDX_4bf93992f2a6020b74bbf80cf4" ON "recorded_tags_recorded_tag" ("recordedId") ',
            undefined,
        );
        await queryRunner.query(
            'CREATE INDEX "IDX_c5315b388628971c92d241be9c" ON "recorded_tags_recorded_tag" ("recordedTagId") ',
            undefined,
        );
        await queryRunner.query(
            'CREATE TABLE "temporary_thumbnail" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "filePath" varchar NOT NULL, "recordedId" integer NOT NULL, CONSTRAINT "FK_f3e8be49269b5878c0f07ee0198" FOREIGN KEY ("recordedId") REFERENCES "recorded" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)',
            undefined,
        );
        await queryRunner.query(
            'INSERT INTO "temporary_thumbnail"("id", "filePath", "recordedId") SELECT "id", "filePath", "recordedId" FROM "thumbnail"',
            undefined,
        );
        await queryRunner.query('DROP TABLE "thumbnail"', undefined);
        await queryRunner.query('ALTER TABLE "temporary_thumbnail" RENAME TO "thumbnail"', undefined);
        await queryRunner.query(
            'CREATE TABLE "temporary_video_file" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "parentDirectoryName" integer NOT NULL, "filePath" varchar NOT NULL, "isTs" boolean NOT NULL, "name" varchar NOT NULL, "size" bigint NOT NULL DEFAULT (0), "recordedId" integer NOT NULL, CONSTRAINT "FK_8407bb2c2e9d927e8c1c694c6a8" FOREIGN KEY ("recordedId") REFERENCES "recorded" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION)',
            undefined,
        );
        await queryRunner.query(
            'INSERT INTO "temporary_video_file"("id", "parentDirectoryName", "filePath", "isTs", "name", "size", "recordedId") SELECT "id", "parentDirectoryName", "filePath", "isTs", "name", "size", "recordedId" FROM "video_file"',
            undefined,
        );
        await queryRunner.query('DROP TABLE "video_file"', undefined);
        await queryRunner.query('ALTER TABLE "temporary_video_file" RENAME TO "video_file"', undefined);
        await queryRunner.query('DROP INDEX "IDX_4bf93992f2a6020b74bbf80cf4"', undefined);
        await queryRunner.query('DROP INDEX "IDX_c5315b388628971c92d241be9c"', undefined);
        await queryRunner.query(
            'CREATE TABLE "temporary_recorded_tags_recorded_tag" ("recordedId" integer NOT NULL, "recordedTagId" integer NOT NULL, CONSTRAINT "FK_4bf93992f2a6020b74bbf80cf4c" FOREIGN KEY ("recordedId") REFERENCES "recorded" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, CONSTRAINT "FK_c5315b388628971c92d241be9c8" FOREIGN KEY ("recordedTagId") REFERENCES "recorded_tag" ("id") ON DELETE CASCADE ON UPDATE NO ACTION, PRIMARY KEY ("recordedId", "recordedTagId"))',
            undefined,
        );
        await queryRunner.query(
            'INSERT INTO "temporary_recorded_tags_recorded_tag"("recordedId", "recordedTagId") SELECT "recordedId", "recordedTagId" FROM "recorded_tags_recorded_tag"',
            undefined,
        );
        await queryRunner.query('DROP TABLE "recorded_tags_recorded_tag"', undefined);
        await queryRunner.query(
            'ALTER TABLE "temporary_recorded_tags_recorded_tag" RENAME TO "recorded_tags_recorded_tag"',
            undefined,
        );
        await queryRunner.query(
            'CREATE INDEX "IDX_4bf93992f2a6020b74bbf80cf4" ON "recorded_tags_recorded_tag" ("recordedId") ',
            undefined,
        );
        await queryRunner.query(
            'CREATE INDEX "IDX_c5315b388628971c92d241be9c" ON "recorded_tags_recorded_tag" ("recordedTagId") ',
            undefined,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('DROP INDEX "IDX_c5315b388628971c92d241be9c"', undefined);
        await queryRunner.query('DROP INDEX "IDX_4bf93992f2a6020b74bbf80cf4"', undefined);
        await queryRunner.query(
            'ALTER TABLE "recorded_tags_recorded_tag" RENAME TO "temporary_recorded_tags_recorded_tag"',
            undefined,
        );
        await queryRunner.query(
            'CREATE TABLE "recorded_tags_recorded_tag" ("recordedId" integer NOT NULL, "recordedTagId" integer NOT NULL, PRIMARY KEY ("recordedId", "recordedTagId"))',
            undefined,
        );
        await queryRunner.query(
            'INSERT INTO "recorded_tags_recorded_tag"("recordedId", "recordedTagId") SELECT "recordedId", "recordedTagId" FROM "temporary_recorded_tags_recorded_tag"',
            undefined,
        );
        await queryRunner.query('DROP TABLE "temporary_recorded_tags_recorded_tag"', undefined);
        await queryRunner.query(
            'CREATE INDEX "IDX_c5315b388628971c92d241be9c" ON "recorded_tags_recorded_tag" ("recordedTagId") ',
            undefined,
        );
        await queryRunner.query(
            'CREATE INDEX "IDX_4bf93992f2a6020b74bbf80cf4" ON "recorded_tags_recorded_tag" ("recordedId") ',
            undefined,
        );
        await queryRunner.query('ALTER TABLE "video_file" RENAME TO "temporary_video_file"', undefined);
        await queryRunner.query(
            'CREATE TABLE "video_file" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "parentDirectoryName" integer NOT NULL, "filePath" varchar NOT NULL, "isTs" boolean NOT NULL, "name" varchar NOT NULL, "size" bigint NOT NULL DEFAULT (0), "recordedId" integer NOT NULL)',
            undefined,
        );
        await queryRunner.query(
            'INSERT INTO "video_file"("id", "parentDirectoryName", "filePath", "isTs", "name", "size", "recordedId") SELECT "id", "parentDirectoryName", "filePath", "isTs", "name", "size", "recordedId" FROM "temporary_video_file"',
            undefined,
        );
        await queryRunner.query('DROP TABLE "temporary_video_file"', undefined);
        await queryRunner.query('ALTER TABLE "thumbnail" RENAME TO "temporary_thumbnail"', undefined);
        await queryRunner.query(
            'CREATE TABLE "thumbnail" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "filePath" varchar NOT NULL, "recordedId" integer NOT NULL)',
            undefined,
        );
        await queryRunner.query(
            'INSERT INTO "thumbnail"("id", "filePath", "recordedId") SELECT "id", "filePath", "recordedId" FROM "temporary_thumbnail"',
            undefined,
        );
        await queryRunner.query('DROP TABLE "temporary_thumbnail"', undefined);
        await queryRunner.query('DROP INDEX "IDX_c5315b388628971c92d241be9c"', undefined);
        await queryRunner.query('DROP INDEX "IDX_4bf93992f2a6020b74bbf80cf4"', undefined);
        await queryRunner.query('DROP TABLE "recorded_tags_recorded_tag"', undefined);
        await queryRunner.query('DROP TABLE "rule"', undefined);
        await queryRunner.query('DROP TABLE "reserve"', undefined);
        await queryRunner.query('DROP TABLE "recorded_history"', undefined);
        await queryRunner.query('DROP TABLE "recorded"', undefined);
        await queryRunner.query('DROP TABLE "video_file"', undefined);
        await queryRunner.query('DROP TABLE "thumbnail"', undefined);
        await queryRunner.query('DROP TABLE "recorded_tag"', undefined);
        await queryRunner.query('DROP TABLE "program"', undefined);
        await queryRunner.query('DROP TABLE "channel"', undefined);
    }
}
