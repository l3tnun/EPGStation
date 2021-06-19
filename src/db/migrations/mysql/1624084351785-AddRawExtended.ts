import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRawExtended1624084351785 implements MigrationInterface {
    name = 'AddRawExtended1624084351785';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE `program` ADD `rawExtended` text NULL');
        await queryRunner.query('ALTER TABLE `program` ADD `rawHalfWidthExtended` text NULL');
        await queryRunner.query('ALTER TABLE `recorded` ADD `rawExtended` text NULL');
        await queryRunner.query('ALTER TABLE `recorded` ADD `rawHalfWidthExtended` text NULL');
        await queryRunner.query('ALTER TABLE `reserve` ADD `rawExtended` text NULL');
        await queryRunner.query('ALTER TABLE `reserve` ADD `rawHalfWidthExtended` text NULL');
        await queryRunner.query('ALTER TABLE `channel` CHANGE `remoteControlKeyId` `remoteControlKeyId` int NULL');
        await queryRunner.query('ALTER TABLE `channel` CHANGE `type` `type` int NULL');
        await queryRunner.query('ALTER TABLE `program` CHANGE `description` `description` text NULL');
        await queryRunner.query('ALTER TABLE `program` CHANGE `halfWidthDescription` `halfWidthDescription` text NULL');
        await queryRunner.query('ALTER TABLE `program` CHANGE `extended` `extended` text NULL');
        await queryRunner.query('ALTER TABLE `program` CHANGE `halfWidthExtended` `halfWidthExtended` text NULL');
        await queryRunner.query('ALTER TABLE `program` CHANGE `genre1` `genre1` int NULL');
        await queryRunner.query('ALTER TABLE `program` CHANGE `subGenre1` `subGenre1` int NULL');
        await queryRunner.query('ALTER TABLE `program` CHANGE `genre2` `genre2` int NULL');
        await queryRunner.query('ALTER TABLE `program` CHANGE `subGenre2` `subGenre2` int NULL');
        await queryRunner.query('ALTER TABLE `program` CHANGE `genre3` `genre3` int NULL');
        await queryRunner.query('ALTER TABLE `program` CHANGE `subGenre3` `subGenre3` int NULL');
        await queryRunner.query('ALTER TABLE `program` CHANGE `videoType` `videoType` text NULL');
        await queryRunner.query('ALTER TABLE `program` CHANGE `videoResolution` `videoResolution` text NULL');
        await queryRunner.query('ALTER TABLE `program` CHANGE `videoStreamContent` `videoStreamContent` int NULL');
        await queryRunner.query('ALTER TABLE `program` CHANGE `videoComponentType` `videoComponentType` int NULL');
        await queryRunner.query('ALTER TABLE `program` CHANGE `audioSamplingRate` `audioSamplingRate` int NULL');
        await queryRunner.query('ALTER TABLE `program` CHANGE `audioComponentType` `audioComponentType` int NULL');
        await queryRunner.query('ALTER TABLE `recorded` DROP FOREIGN KEY `FK_e0bc5373673ea0f120445830f4d`');
        await queryRunner.query('ALTER TABLE `recorded` CHANGE `reserveId` `reserveId` int NULL');
        await queryRunner.query('ALTER TABLE `recorded` CHANGE `ruleId` `ruleId` int NULL');
        await queryRunner.query('ALTER TABLE `recorded` CHANGE `programId` `programId` bigint NULL');
        await queryRunner.query('ALTER TABLE `recorded` CHANGE `description` `description` text NULL');
        await queryRunner.query(
            'ALTER TABLE `recorded` CHANGE `halfWidthDescription` `halfWidthDescription` text NULL',
        );
        await queryRunner.query('ALTER TABLE `recorded` CHANGE `extended` `extended` text NULL');
        await queryRunner.query('ALTER TABLE `recorded` CHANGE `halfWidthExtended` `halfWidthExtended` text NULL');
        await queryRunner.query('ALTER TABLE `recorded` CHANGE `genre1` `genre1` int NULL');
        await queryRunner.query('ALTER TABLE `recorded` CHANGE `subGenre1` `subGenre1` int NULL');
        await queryRunner.query('ALTER TABLE `recorded` CHANGE `genre2` `genre2` int NULL');
        await queryRunner.query('ALTER TABLE `recorded` CHANGE `subGenre2` `subGenre2` int NULL');
        await queryRunner.query('ALTER TABLE `recorded` CHANGE `genre3` `genre3` int NULL');
        await queryRunner.query('ALTER TABLE `recorded` CHANGE `subGenre3` `subGenre3` int NULL');
        await queryRunner.query('ALTER TABLE `recorded` CHANGE `videoType` `videoType` text NULL');
        await queryRunner.query('ALTER TABLE `recorded` CHANGE `videoResolution` `videoResolution` text NULL');
        await queryRunner.query('ALTER TABLE `recorded` CHANGE `videoStreamContent` `videoStreamContent` int NULL');
        await queryRunner.query('ALTER TABLE `recorded` CHANGE `videoComponentType` `videoComponentType` int NULL');
        await queryRunner.query('ALTER TABLE `recorded` CHANGE `audioSamplingRate` `audioSamplingRate` int NULL');
        await queryRunner.query('ALTER TABLE `recorded` CHANGE `audioComponentType` `audioComponentType` int NULL');
        await queryRunner.query('ALTER TABLE `recorded` CHANGE `dropLogFileId` `dropLogFileId` int NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `ruleId` `ruleId` int NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `ruleUpdateCnt` `ruleUpdateCnt` int NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `tags` `tags` text NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `parentDirectoryName` `parentDirectoryName` text NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `directory` `directory` text NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `recordedFormat` `recordedFormat` text NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `encodeMode1` `encodeMode1` text NULL');
        await queryRunner.query(
            'ALTER TABLE `reserve` CHANGE `encodeParentDirectoryName1` `encodeParentDirectoryName1` text NULL',
        );
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `encodeDirectory1` `encodeDirectory1` text NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `encodeMode2` `encodeMode2` text NULL');
        await queryRunner.query(
            'ALTER TABLE `reserve` CHANGE `encodeParentDirectoryName2` `encodeParentDirectoryName2` text NULL',
        );
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `encodeDirectory2` `encodeDirectory2` text NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `encodeMode3` `encodeMode3` text NULL');
        await queryRunner.query(
            'ALTER TABLE `reserve` CHANGE `encodeParentDirectoryName3` `encodeParentDirectoryName3` text NULL',
        );
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `encodeDirectory3` `encodeDirectory3` text NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `programId` `programId` bigint NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `programUpdateTime` `programUpdateTime` bigint NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `name` `name` text NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `halfWidthName` `halfWidthName` text NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `shortName` `shortName` text NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `description` `description` text NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `halfWidthDescription` `halfWidthDescription` text NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `extended` `extended` text NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `halfWidthExtended` `halfWidthExtended` text NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `genre1` `genre1` int NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `subGenre1` `subGenre1` int NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `genre2` `genre2` int NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `subGenre2` `subGenre2` int NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `genre3` `genre3` int NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `subGenre3` `subGenre3` int NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `videoType` `videoType` text NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `videoResolution` `videoResolution` text NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `videoStreamContent` `videoStreamContent` int NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `videoComponentType` `videoComponentType` int NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `audioSamplingRate` `audioSamplingRate` int NULL');
        await queryRunner.query('ALTER TABLE `reserve` CHANGE `audioComponentType` `audioComponentType` int NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `keyword` `keyword` text NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `halfWidthKeyword` `halfWidthKeyword` text NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `ignoreKeyword` `ignoreKeyword` text NULL');
        await queryRunner.query(
            'ALTER TABLE `rule` CHANGE `halfWidthIgnoreKeyword` `halfWidthIgnoreKeyword` text NULL',
        );
        await queryRunner.query('ALTER TABLE `rule` CHANGE `channelIds` `channelIds` text NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `genres` `genres` text NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `times` `times` text NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `durationMin` `durationMin` int NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `durationMax` `durationMax` int NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `searchPeriods` `searchPeriods` text NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `periodToAvoidDuplicate` `periodToAvoidDuplicate` int NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `tags` `tags` text NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `parentDirectoryName` `parentDirectoryName` text NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `directory` `directory` text NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `recordedFormat` `recordedFormat` text NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `mode1` `mode1` text NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `parentDirectoryName1` `parentDirectoryName1` text NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `directory1` `directory1` text NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `mode2` `mode2` text NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `parentDirectoryName2` `parentDirectoryName2` text NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `directory2` `directory2` text NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `mode3` `mode3` text NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `parentDirectoryName3` `parentDirectoryName3` text NULL');
        await queryRunner.query('ALTER TABLE `rule` CHANGE `directory3` `directory3` text NULL');
        await queryRunner.query(
            'ALTER TABLE `recorded` ADD CONSTRAINT `FK_e0bc5373673ea0f120445830f4d` FOREIGN KEY (`dropLogFileId`) REFERENCES `drop_log_file`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION',
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE `recorded` DROP FOREIGN KEY `FK_e0bc5373673ea0f120445830f4d`');
        await queryRunner.query("ALTER TABLE `rule` CHANGE `directory3` `directory3` text NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `rule` CHANGE `parentDirectoryName3` `parentDirectoryName3` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `rule` CHANGE `mode3` `mode3` text NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `rule` CHANGE `directory2` `directory2` text NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `rule` CHANGE `parentDirectoryName2` `parentDirectoryName2` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `rule` CHANGE `mode2` `mode2` text NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `rule` CHANGE `directory1` `directory1` text NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `rule` CHANGE `parentDirectoryName1` `parentDirectoryName1` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `rule` CHANGE `mode1` `mode1` text NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `rule` CHANGE `recordedFormat` `recordedFormat` text NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `rule` CHANGE `directory` `directory` text NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `rule` CHANGE `parentDirectoryName` `parentDirectoryName` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `rule` CHANGE `tags` `tags` text NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `rule` CHANGE `periodToAvoidDuplicate` `periodToAvoidDuplicate` int NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `rule` CHANGE `searchPeriods` `searchPeriods` text NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `rule` CHANGE `durationMax` `durationMax` int NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `rule` CHANGE `durationMin` `durationMin` int NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `rule` CHANGE `times` `times` text NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `rule` CHANGE `genres` `genres` text NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `rule` CHANGE `channelIds` `channelIds` text NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `rule` CHANGE `halfWidthIgnoreKeyword` `halfWidthIgnoreKeyword` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `rule` CHANGE `ignoreKeyword` `ignoreKeyword` text NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `rule` CHANGE `halfWidthKeyword` `halfWidthKeyword` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `rule` CHANGE `keyword` `keyword` text NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `reserve` CHANGE `audioComponentType` `audioComponentType` int NULL DEFAULT 'NULL'",
        );
        await queryRunner.query(
            "ALTER TABLE `reserve` CHANGE `audioSamplingRate` `audioSamplingRate` int NULL DEFAULT 'NULL'",
        );
        await queryRunner.query(
            "ALTER TABLE `reserve` CHANGE `videoComponentType` `videoComponentType` int NULL DEFAULT 'NULL'",
        );
        await queryRunner.query(
            "ALTER TABLE `reserve` CHANGE `videoStreamContent` `videoStreamContent` int NULL DEFAULT 'NULL'",
        );
        await queryRunner.query(
            "ALTER TABLE `reserve` CHANGE `videoResolution` `videoResolution` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `reserve` CHANGE `videoType` `videoType` text NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `reserve` CHANGE `subGenre3` `subGenre3` int NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `reserve` CHANGE `genre3` `genre3` int NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `reserve` CHANGE `subGenre2` `subGenre2` int NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `reserve` CHANGE `genre2` `genre2` int NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `reserve` CHANGE `subGenre1` `subGenre1` int NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `reserve` CHANGE `genre1` `genre1` int NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `reserve` CHANGE `halfWidthExtended` `halfWidthExtended` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `reserve` CHANGE `extended` `extended` text NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `reserve` CHANGE `halfWidthDescription` `halfWidthDescription` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `reserve` CHANGE `description` `description` text NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `reserve` CHANGE `shortName` `shortName` text NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `reserve` CHANGE `halfWidthName` `halfWidthName` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `reserve` CHANGE `name` `name` text NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `reserve` CHANGE `programUpdateTime` `programUpdateTime` bigint NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `reserve` CHANGE `programId` `programId` bigint NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `reserve` CHANGE `encodeDirectory3` `encodeDirectory3` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query(
            "ALTER TABLE `reserve` CHANGE `encodeParentDirectoryName3` `encodeParentDirectoryName3` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `reserve` CHANGE `encodeMode3` `encodeMode3` text NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `reserve` CHANGE `encodeDirectory2` `encodeDirectory2` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query(
            "ALTER TABLE `reserve` CHANGE `encodeParentDirectoryName2` `encodeParentDirectoryName2` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `reserve` CHANGE `encodeMode2` `encodeMode2` text NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `reserve` CHANGE `encodeDirectory1` `encodeDirectory1` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query(
            "ALTER TABLE `reserve` CHANGE `encodeParentDirectoryName1` `encodeParentDirectoryName1` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `reserve` CHANGE `encodeMode1` `encodeMode1` text NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `reserve` CHANGE `recordedFormat` `recordedFormat` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `reserve` CHANGE `directory` `directory` text NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `reserve` CHANGE `parentDirectoryName` `parentDirectoryName` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `reserve` CHANGE `tags` `tags` text NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `reserve` CHANGE `ruleUpdateCnt` `ruleUpdateCnt` int NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `reserve` CHANGE `ruleId` `ruleId` int NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `recorded` CHANGE `dropLogFileId` `dropLogFileId` int NULL DEFAULT 'NULL'",
        );
        await queryRunner.query(
            "ALTER TABLE `recorded` CHANGE `audioComponentType` `audioComponentType` int NULL DEFAULT 'NULL'",
        );
        await queryRunner.query(
            "ALTER TABLE `recorded` CHANGE `audioSamplingRate` `audioSamplingRate` int NULL DEFAULT 'NULL'",
        );
        await queryRunner.query(
            "ALTER TABLE `recorded` CHANGE `videoComponentType` `videoComponentType` int NULL DEFAULT 'NULL'",
        );
        await queryRunner.query(
            "ALTER TABLE `recorded` CHANGE `videoStreamContent` `videoStreamContent` int NULL DEFAULT 'NULL'",
        );
        await queryRunner.query(
            "ALTER TABLE `recorded` CHANGE `videoResolution` `videoResolution` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `recorded` CHANGE `videoType` `videoType` text NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `recorded` CHANGE `subGenre3` `subGenre3` int NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `recorded` CHANGE `genre3` `genre3` int NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `recorded` CHANGE `subGenre2` `subGenre2` int NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `recorded` CHANGE `genre2` `genre2` int NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `recorded` CHANGE `subGenre1` `subGenre1` int NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `recorded` CHANGE `genre1` `genre1` int NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `recorded` CHANGE `halfWidthExtended` `halfWidthExtended` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `recorded` CHANGE `extended` `extended` text NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `recorded` CHANGE `halfWidthDescription` `halfWidthDescription` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `recorded` CHANGE `description` `description` text NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `recorded` CHANGE `programId` `programId` bigint NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `recorded` CHANGE `ruleId` `ruleId` int NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `recorded` CHANGE `reserveId` `reserveId` int NULL DEFAULT 'NULL'");
        await queryRunner.query(
            'ALTER TABLE `recorded` ADD CONSTRAINT `FK_e0bc5373673ea0f120445830f4d` FOREIGN KEY (`dropLogFileId`) REFERENCES `drop_log_file`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION',
        );
        await queryRunner.query(
            "ALTER TABLE `program` CHANGE `audioComponentType` `audioComponentType` int NULL DEFAULT 'NULL'",
        );
        await queryRunner.query(
            "ALTER TABLE `program` CHANGE `audioSamplingRate` `audioSamplingRate` int NULL DEFAULT 'NULL'",
        );
        await queryRunner.query(
            "ALTER TABLE `program` CHANGE `videoComponentType` `videoComponentType` int NULL DEFAULT 'NULL'",
        );
        await queryRunner.query(
            "ALTER TABLE `program` CHANGE `videoStreamContent` `videoStreamContent` int NULL DEFAULT 'NULL'",
        );
        await queryRunner.query(
            "ALTER TABLE `program` CHANGE `videoResolution` `videoResolution` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `program` CHANGE `videoType` `videoType` text NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `program` CHANGE `subGenre3` `subGenre3` int NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `program` CHANGE `genre3` `genre3` int NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `program` CHANGE `subGenre2` `subGenre2` int NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `program` CHANGE `genre2` `genre2` int NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `program` CHANGE `subGenre1` `subGenre1` int NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `program` CHANGE `genre1` `genre1` int NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `program` CHANGE `halfWidthExtended` `halfWidthExtended` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `program` CHANGE `extended` `extended` text NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `program` CHANGE `halfWidthDescription` `halfWidthDescription` text NULL DEFAULT 'NULL'",
        );
        await queryRunner.query("ALTER TABLE `program` CHANGE `description` `description` text NULL DEFAULT 'NULL'");
        await queryRunner.query("ALTER TABLE `channel` CHANGE `type` `type` int NULL DEFAULT 'NULL'");
        await queryRunner.query(
            "ALTER TABLE `channel` CHANGE `remoteControlKeyId` `remoteControlKeyId` int NULL DEFAULT 'NULL'",
        );
        await queryRunner.query('ALTER TABLE `reserve` DROP COLUMN `rawHalfWidthExtended`');
        await queryRunner.query('ALTER TABLE `reserve` DROP COLUMN `rawExtended`');
        await queryRunner.query('ALTER TABLE `recorded` DROP COLUMN `rawHalfWidthExtended`');
        await queryRunner.query('ALTER TABLE `recorded` DROP COLUMN `rawExtended`');
        await queryRunner.query('ALTER TABLE `program` DROP COLUMN `rawHalfWidthExtended`');
        await queryRunner.query('ALTER TABLE `program` DROP COLUMN `rawExtended`');
    }
}
