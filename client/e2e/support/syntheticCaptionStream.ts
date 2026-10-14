import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ARIBB24CharacterToken,
  ARIBB24ClearScreenToken,
  ARIBB24JapaneseJIS8Encoder,
  muxDatagroup,
  muxIndependentPES,
} from 'aribb24.js'

/*
 * ライブの M2TS-LL の再生で字幕を描くことを確かめるための、合成の MPEG-2 TS を作る。
 * 映像と音声は ffmpeg の lavfi（testsrc・sine）だけから作った合成の file（support/media）:
 *   ffmpeg -f lavfi -i testsrc=duration=12:size=160x90:rate=15 \
 *     -f lavfi -i sine=frequency=440:duration=12:sample_rate=48000 \
 *     -c:v libx264 -profile:v baseline -pix_fmt yuv420p -g 15 -b:v 60k -c:a aac -b:a 32k -ac 1 \
 *     -f mpegts -mpegts_m2ts_mode 0 synthetic-live.m2ts
 * これに、aribb24.js の encoder・muxer で組み立てた合成の字幕（ARIB STD-B24 の字幕管理と字幕文）の PES を、
 * 映像と同じ時計の PTS で一定間隔に差し込み、PMT に字幕の PID（stream_type 0x06）を足す。放送波のデータは使わない。
 */

const TS_PACKET_SIZE = 188
const CAPTION_PID = 0x0130
const CAPTION_INTERVAL_SECONDS = 0.5
const PTS_CLOCK = 90_000

export const SYNTHETIC_CAPTION_TEXT = 'ごうせいじまく'

const mediaPath = join(dirname(fileURLToPath(import.meta.url)), 'media', 'synthetic-live.m2ts')

const crc32Mpeg2 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte << 24
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1
    }
  }
  return crc >>> 0
}

const packetPid = (packet: Uint8Array): number => ((packet[1] & 0x1f) << 8) | packet[2]
const startsUnit = (packet: Uint8Array): boolean => (packet[1] & 0x40) !== 0

const payloadOffset = (packet: Uint8Array): number => {
  const adaptation = (packet[3] & 0x30) >> 4
  return adaptation === 0b10 || adaptation === 0b11 ? 5 + packet[4] : 4
}

const readPts = (bytes: Uint8Array, offset: number): number =>
  ((bytes[offset] >> 1) & 0x07) * 2 ** 30 +
  (bytes[offset + 1] << 22) +
  ((bytes[offset + 2] >> 1) << 15) +
  (bytes[offset + 3] << 7) +
  (bytes[offset + 4] >> 1)

const writePts = (pts: number): number[] => {
  const high = Math.floor(pts / 2 ** 30) & 0x07
  const low = pts % 2 ** 30
  return [
    0x21 | (high << 1),
    (low >> 22) & 0xff,
    0x01 | (((low >> 15) & 0x7f) << 1),
    (low >> 7) & 0xff,
    0x01 | ((low & 0x7f) << 1),
  ]
}

const programMapPid = (packets: Uint8Array[]): number => {
  const pat = packets.find((packet) => packetPid(packet) === 0 && startsUnit(packet))
  if (pat === undefined) throw new Error('synthetic stream has no PAT')
  const section = payloadOffset(pat) + 1 + pat[payloadOffset(pat)]
  return ((pat[section + 10] & 0x1f) << 8) | pat[section + 11]
}

// PMT の elementary stream の loop の末尾に字幕の PID を足し、CRC を計算し直す。
const withCaptionStream = (packet: Uint8Array): Uint8Array => {
  const rewritten = Uint8Array.from(packet)
  const section = payloadOffset(packet) + 1 + packet[payloadOffset(packet)]
  const sectionLength = ((packet[section + 1] & 0x0f) << 8) | packet[section + 2]
  const crcOffset = section + 3 + sectionLength - 4
  const entry = [0x06, 0xe0 | (CAPTION_PID >> 8), CAPTION_PID & 0xff, 0xf0, 0x00]
  if (crcOffset + entry.length + 4 > TS_PACKET_SIZE) throw new Error('PMT does not fit')
  rewritten.set(entry, crcOffset)
  const newLength = sectionLength + entry.length
  rewritten[section + 1] = (packet[section + 1] & 0xf0) | (newLength >> 8)
  rewritten[section + 2] = newLength & 0xff
  const crc = crc32Mpeg2(rewritten.subarray(section, crcOffset + entry.length))
  rewritten.set(
    [crc >>> 24, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff],
    crcOffset + entry.length,
  )
  return rewritten
}

const captionPacket = (pts: number, dataGroup: ArrayBufferLike, counter: number): Uint8Array => {
  const payload = new Uint8Array(
    muxIndependentPES({ tag: 'Caption', data: new Uint8Array(dataGroup) }),
  )
  const pes = Uint8Array.from([
    0x00,
    0x00,
    0x01,
    0xbd,
    (3 + 5 + payload.length) >> 8,
    (3 + 5 + payload.length) & 0xff,
    0x80,
    0x80,
    0x05,
    ...writePts(pts),
    ...payload,
  ])
  const room = TS_PACKET_SIZE - 4
  if (pes.length > room - 1) throw new Error('caption PES does not fit in one packet')
  const packet = new Uint8Array(TS_PACKET_SIZE).fill(0xff)
  packet.set([0x47, 0x40 | (CAPTION_PID >> 8), CAPTION_PID & 0xff, 0x30 | (counter & 0x0f)])
  const adaptationLength = room - 1 - pes.length
  packet[4] = adaptationLength
  if (adaptationLength > 0) packet[5] = 0x00
  packet.set(pes, 5 + adaptationLength)
  return packet
}

const captionDataGroups = (): {
  management: ArrayBufferLike
  statement: ArrayBufferLike
} => {
  const encoder = new ARIBB24JapaneseJIS8Encoder()
  const units = encoder.encode([
    ARIBB24ClearScreenToken.from(),
    ...Array.from(SYNTHETIC_CAPTION_TEXT, (character) => ARIBB24CharacterToken.from(character)),
  ])
  return {
    management: muxDatagroup({
      tag: 'CaptionManagement',
      group: 0,
      timeControlMode: 0,
      languages: [
        {
          lang: 0,
          displayMode: 0,
          iso_639_language_code: 'jpn',
          format: 0b1000,
          TCS: 0,
          rollup: 0,
        },
      ],
      units: [],
    }),
    statement: muxDatagroup({
      tag: 'CaptionStatement',
      group: 0,
      lang: 0,
      timeControlMode: 0,
      units,
    }),
  }
}

/**
 * TS を、映像の PES の PTS（最初の映像からの秒）ごとの塊に分ける。HTTP server がこの秒に合わせて書き出すと、
 * live の配信と同じく実時間の速さで届く。
 */
export const pacedTransportStreamChunks = (
  stream: Uint8Array,
): Array<{ mediaSeconds: number; bytes: Uint8Array }> => {
  const chunks: Array<{ mediaSeconds: number; bytes: Uint8Array }> = []
  let firstPts: number | undefined
  let mediaSeconds = 0
  let chunkStart = 0
  let videoPid: number | undefined
  for (let offset = 0; offset < stream.length; offset += TS_PACKET_SIZE) {
    const packet = stream.subarray(offset, offset + TS_PACKET_SIZE)
    const pid = packetPid(packet)
    if (videoPid === undefined && pid !== 0 && startsUnit(packet)) {
      const pes = payloadOffset(packet)
      // stream_id 0xE0〜0xEF が映像の PES
      if (packet[pes] === 0 && packet[pes + 1] === 0 && (packet[pes + 3] & 0xf0) === 0xe0) {
        videoPid = pid
      }
    }
    if (pid !== videoPid || !startsUnit(packet)) continue
    const pes = payloadOffset(packet)
    if ((packet[pes + 7] & 0x80) === 0) continue
    const pts = readPts(packet, pes + 9)
    firstPts ??= pts
    const seconds = (pts - firstPts) / PTS_CLOCK
    if (seconds > mediaSeconds) {
      chunks.push({ mediaSeconds, bytes: stream.subarray(chunkStart, offset) })
      chunkStart = offset
      mediaSeconds = seconds
    }
  }
  chunks.push({ mediaSeconds, bytes: stream.subarray(chunkStart) })
  return chunks
}

/** 合成の映像・音声の TS に、合成の字幕を一定間隔で差し込んだ TS を返す。 */
export const readSyntheticCaptionStream = async (): Promise<Buffer> => {
  const source = await readFile(mediaPath)
  if (source.length % TS_PACKET_SIZE !== 0) throw new Error('synthetic stream is not 188-byte TS')
  const packets: Uint8Array[] = []
  for (let offset = 0; offset < source.length; offset += TS_PACKET_SIZE) {
    packets.push(source.subarray(offset, offset + TS_PACKET_SIZE))
  }
  const pmtPid = programMapPid(packets)
  const { management, statement } = captionDataGroups()

  const output: Uint8Array[] = []
  let videoPid: number | undefined
  let nextCaptionPts: number | undefined
  let counter = 0
  for (const packet of packets) {
    const pid = packetPid(packet)
    if (pid === pmtPid && startsUnit(packet)) {
      const section = payloadOffset(packet) + 1 + packet[payloadOffset(packet)]
      // 最初の elementary stream（ffmpeg は映像を先に置く）の PID を映像の PID にする。
      const programInfoLength = ((packet[section + 10] & 0x0f) << 8) | packet[section + 11]
      const loop = section + 12 + programInfoLength
      videoPid ??= ((packet[loop + 1] & 0x1f) << 8) | packet[loop + 2]
      output.push(withCaptionStream(packet))
      continue
    }
    if (pid === videoPid && startsUnit(packet)) {
      const pes = payloadOffset(packet)
      if ((packet[pes + 7] & 0x80) !== 0) {
        const pts = readPts(packet, pes + 9)
        nextCaptionPts ??= pts
        while (nextCaptionPts <= pts) {
          output.push(captionPacket(nextCaptionPts, management, counter))
          counter += 1
          output.push(captionPacket(nextCaptionPts, statement, counter))
          counter += 1
          nextCaptionPts += CAPTION_INTERVAL_SECONDS * PTS_CLOCK
        }
      }
    }
    output.push(packet)
  }
  if (nextCaptionPts === undefined) throw new Error('synthetic stream has no video PTS')
  return Buffer.concat(output)
}
