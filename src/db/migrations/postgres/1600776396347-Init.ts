import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1600776396347 implements MigrationInterface {
    public name = 'Init1600776396347';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'CREATE TABLE "channel" ("id" bigint NOT NULL, "serviceId" integer NOT NULL, "networkId" integer NOT NULL, "name" character varying NOT NULL, "halfWidthName" character varying NOT NULL, "remoteControlKeyId" integer, "hasLogoData" boolean NOT NULL DEFAULT false, "channelType" character varying NOT NULL, "channel" character varying NOT NULL, "type" integer, CONSTRAINT "PK_590f33ee6ee7d76437acf362e39" PRIMARY KEY ("id"))',
        );
        await queryRunner.query(
            'CREATE TABLE "drop_log_file" ("id" SERIAL NOT NULL, "errorCnt" bigint NOT NULL, "dropCnt" bigint NOT NULL, "scramblingCnt" bigint NOT NULL, "filePath" character varying NOT NULL, CONSTRAINT "PK_9ba415a7364681193fd50da43f7" PRIMARY KEY ("id"))',
        );
        await queryRunner.query(
            'CREATE TABLE "program" ("id" bigint NOT NULL, "updateTime" bigint NOT NULL, "channelId" bigint NOT NULL, "eventId" bigint NOT NULL, "serviceId" integer NOT NULL, "networkId" integer NOT NULL, "startAt" bigint NOT NULL, "endAt" bigint NOT NULL, "startHour" integer NOT NULL, "week" integer NOT NULL, "duration" integer NOT NULL, "isFree" boolean NOT NULL, "name" character varying NOT NULL, "halfWidthName" character varying NOT NULL, "shortName" character varying NOT NULL, "description" text, "halfWidthDescription" text, "extended" text, "halfWidthExtended" text, "genre1" integer, "subGenre1" integer, "genre2" integer, "subGenre2" integer, "genre3" integer, "subGenre3" integer, "channelType" character varying NOT NULL, "channel" character varying NOT NULL, "videoType" text, "videoResolution" text, "videoStreamContent" integer, "videoComponentType" integer, "audioSamplingRate" integer, "audioComponentType" integer, CONSTRAINT "PK_3bade5945afbafefdd26a3a29fb" PRIMARY KEY ("id"))',
        );
        await queryRunner.query(
            'CREATE TABLE "recorded_tag" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "halfWidthName" character varying NOT NULL, "color" character varying NOT NULL, CONSTRAINT "PK_fd6b3821ef43ed017fdf6fd34d3" PRIMARY KEY ("id"))',
        );
        await queryRunner.query(
            'CREATE TABLE "thumbnail" ("id" SERIAL NOT NULL, "filePath" character varying NOT NULL, "recordedId" integer NOT NULL, CONSTRAINT "PK_12afcbe5bdad28526b88dbdaf3f" PRIMARY KEY ("id"))',
        );
        await queryRunner.query(
            'CREATE TABLE "video_file" ("id" SERIAL NOT NULL, "parentDirectoryName" integer NOT NULL, "filePath" character varying NOT NULL, "type" character varying NOT NULL, "name" character varying NOT NULL, "size" bigint NOT NULL DEFAULT 0, "recordedId" integer NOT NULL, CONSTRAINT "PK_a22222fb21e7458b39e16de121e" PRIMARY KEY ("id"))',
        );
        await queryRunner.query(
            'CREATE TABLE "recorded" ("id" SERIAL NOT NULL, "reserveId" integer, "ruleId" integer, "programId" bigint, "channelId" bigint NOT NULL, "isProtected" boolean NOT NULL DEFAULT false, "startAt" bigint NOT NULL, "endAt" bigint NOT NULL, "duration" integer NOT NULL, "name" character varying NOT NULL, "halfWidthName" character varying NOT NULL, "description" text, "halfWidthDescription" text, "extended" text, "halfWidthExtended" text, "genre1" integer, "subGenre1" integer, "genre2" integer, "subGenre2" integer, "genre3" integer, "subGenre3" integer, "videoType" text, "videoResolution" text, "videoStreamContent" integer, "videoComponentType" integer, "audioSamplingRate" integer, "audioComponentType" integer, "isRecording" boolean NOT NULL, "dropLogFileId" integer, CONSTRAINT "REL_e0bc5373673ea0f120445830f4" UNIQUE ("dropLogFileId"), CONSTRAINT "PK_c93d8613a12e313ca94f57cdbf5" PRIMARY KEY ("id"))',
        );
        await queryRunner.query(
            'CREATE TABLE "recorded_history" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, "channelId" bigint NOT NULL, "endAt" bigint NOT NULL, CONSTRAINT "PK_d735453b3e132307b624a9da9ee" PRIMARY KEY ("id"))',
        );
        await queryRunner.query(
            'CREATE TABLE "reserve" ("id" SERIAL NOT NULL, "updateTime" bigint NOT NULL, "ruleId" integer, "ruleUpdateCnt" integer, "isSkip" boolean NOT NULL DEFAULT false, "isConflict" boolean NOT NULL DEFAULT false, "allowEndLack" boolean NOT NULL DEFAULT false, "tags" text, "isOverlap" boolean NOT NULL DEFAULT false, "isIgnoreOverlap" boolean NOT NULL DEFAULT false, "isTimeSpecified" boolean NOT NULL DEFAULT false, "parentDirectoryName" text, "directory" text, "recordedFormat" text, "encodeMode1" text, "encodeParentDirectoryName1" text, "encodeDirectory1" text, "encodeMode2" text, "encodeParentDirectoryName2" text, "encodeDirectory2" text, "encodeMode3" text, "encodeParentDirectoryName3" text, "encodeDirectory3" text, "isDeleteOriginalAfterEncode" boolean NOT NULL DEFAULT false, "programId" bigint, "programUpdateTime" bigint, "channelId" bigint NOT NULL, "channel" text NOT NULL, "channelType" text NOT NULL, "startAt" bigint NOT NULL, "endAt" bigint NOT NULL, "name" text, "halfWidthName" text, "shortName" text, "description" text, "halfWidthDescription" text, "extended" text, "halfWidthExtended" text, "genre1" integer, "subGenre1" integer, "genre2" integer, "subGenre2" integer, "genre3" integer, "subGenre3" integer, "videoType" text, "videoResolution" text, "videoStreamContent" integer, "videoComponentType" integer, "audioSamplingRate" integer, "audioComponentType" integer, CONSTRAINT "PK_619d1e12dbedbe126620cac8240" PRIMARY KEY ("id"))',
        );
        await queryRunner.query(
            'CREATE TABLE "rule" ("id" SERIAL NOT NULL, "updateCnt" integer NOT NULL DEFAULT 0, "isTimeSpecification" boolean NOT NULL DEFAULT false, "keyword" text, "halfWidthKeyword" text, "ignoreKeyword" text, "halfWidthIgnoreKeyword" text, "keyCS" boolean NOT NULL DEFAULT false, "keyRegExp" boolean NOT NULL DEFAULT false, "name" boolean NOT NULL DEFAULT false, "description" boolean NOT NULL DEFAULT false, "extended" boolean NOT NULL DEFAULT false, "ignoreKeyCS" boolean NOT NULL DEFAULT false, "ignoreKeyRegExp" boolean NOT NULL DEFAULT false, "ignoreName" boolean NOT NULL DEFAULT false, "ignoreDescription" boolean NOT NULL DEFAULT false, "ignoreExtended" boolean NOT NULL DEFAULT false, "GR" boolean NOT NULL DEFAULT false, "BS" boolean NOT NULL DEFAULT false, "CS" boolean NOT NULL DEFAULT false, "SKY" boolean NOT NULL DEFAULT false, "channelIds" text, "genres" text, "times" text, "isFree" boolean NOT NULL DEFAULT false, "durationMin" integer, "durationMax" integer, "searchPeriods" text, "enable" boolean NOT NULL DEFAULT false, "avoidDuplicate" boolean NOT NULL DEFAULT false, "periodToAvoidDuplicate" integer, "allowEndLack" boolean NOT NULL DEFAULT true, "tags" text, "parentDirectoryName" text, "directory" text, "recordedFormat" text, "mode1" text, "parentDirectoryName1" text, "directory1" text, "mode2" text, "parentDirectoryName2" text, "directory2" text, "mode3" text, "parentDirectoryName3" text, "directory3" text, "isDeleteOriginalAfterEncode" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_a5577f464213af7ffbe866e3cb5" PRIMARY KEY ("id"))',
        );
        await queryRunner.query(
            'CREATE TABLE "recorded_tags_recorded_tag" ("recordedId" integer NOT NULL, "recordedTagId" integer NOT NULL, CONSTRAINT "PK_9982d6929d9dcc1503554805eaf" PRIMARY KEY ("recordedId", "recordedTagId"))',
        );
        await queryRunner.query(
            'CREATE INDEX "IDX_4bf93992f2a6020b74bbf80cf4" ON "recorded_tags_recorded_tag" ("recordedId") ',
        );
        await queryRunner.query(
            'CREATE INDEX "IDX_c5315b388628971c92d241be9c" ON "recorded_tags_recorded_tag" ("recordedTagId") ',
        );
        await queryRunner.query(
            'ALTER TABLE "thumbnail" ADD CONSTRAINT "FK_f3e8be49269b5878c0f07ee0198" FOREIGN KEY ("recordedId") REFERENCES "recorded"("id") ON DELETE NO ACTION ON UPDATE NO ACTION',
        );
        await queryRunner.query(
            'ALTER TABLE "video_file" ADD CONSTRAINT "FK_8407bb2c2e9d927e8c1c694c6a8" FOREIGN KEY ("recordedId") REFERENCES "recorded"("id") ON DELETE NO ACTION ON UPDATE NO ACTION',
        );
        await queryRunner.query(
            'ALTER TABLE "recorded" ADD CONSTRAINT "FK_e0bc5373673ea0f120445830f4d" FOREIGN KEY ("dropLogFileId") REFERENCES "drop_log_file"("id") ON DELETE NO ACTION ON UPDATE NO ACTION',
        );
        await queryRunner.query(
            'ALTER TABLE "recorded_tags_recorded_tag" ADD CONSTRAINT "FK_4bf93992f2a6020b74bbf80cf4c" FOREIGN KEY ("recordedId") REFERENCES "recorded"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
        );
        await queryRunner.query(
            'ALTER TABLE "recorded_tags_recorded_tag" ADD CONSTRAINT "FK_c5315b388628971c92d241be9c8" FOREIGN KEY ("recordedTagId") REFERENCES "recorded_tag"("id") ON DELETE CASCADE ON UPDATE NO ACTION',
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            'ALTER TABLE "recorded_tags_recorded_tag" DROP CONSTRAINT "FK_c5315b388628971c92d241be9c8"',
        );
        await queryRunner.query(
            'ALTER TABLE "recorded_tags_recorded_tag" DROP CONSTRAINT "FK_4bf93992f2a6020b74bbf80cf4c"',
        );
        await queryRunner.query('ALTER TABLE "recorded" DROP CONSTRAINT "FK_e0bc5373673ea0f120445830f4d"');
        await queryRunner.query('ALTER TABLE "video_file" DROP CONSTRAINT "FK_8407bb2c2e9d927e8c1c694c6a8"');
        await queryRunner.query('ALTER TABLE "thumbnail" DROP CONSTRAINT "FK_f3e8be49269b5878c0f07ee0198"');
        await queryRunner.query('DROP INDEX "IDX_c5315b388628971c92d241be9c"');
        await queryRunner.query('DROP INDEX "IDX_4bf93992f2a6020b74bbf80cf4"');
        await queryRunner.query('DROP TABLE "recorded_tags_recorded_tag"');
        await queryRunner.query('DROP TABLE "rule"');
        await queryRunner.query('DROP TABLE "reserve"');
        await queryRunner.query('DROP TABLE "recorded_history"');
        await queryRunner.query('DROP TABLE "recorded"');
        await queryRunner.query('DROP TABLE "video_file"');
        await queryRunner.query('DROP TABLE "thumbnail"');
        await queryRunner.query('DROP TABLE "recorded_tag"');
        await queryRunner.query('DROP TABLE "program"');
        await queryRunner.query('DROP TABLE "drop_log_file"');
        await queryRunner.query('DROP TABLE "channel"');
    }
}
