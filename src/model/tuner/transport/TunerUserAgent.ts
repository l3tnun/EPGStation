/**
 * チューナーサーバーへ送る User-Agent を組み立てる。
 *
 * mirakc は header の前方一致で EPGStation を識別し、一致したときだけ
 * `GET /api/programs/{id}` を EIT[p/f] の current / next で差し替え、
 * `GET /api/programs/{id}/stream` で一時 on-air tracker を起動する。判定は
 * `starts_with("EPGStation/")` で大文字小文字を区別するため、綴りをここで固定する。
 * package 名をそのまま使うと小文字で始まり、この経路を使えない。
 */
export const TUNER_USER_AGENT_PRODUCT = 'EPGStation';

/**
 * チューナーサーバーへ送るUser-Agent文字列を組み立てる。
 * @param version EPGStationのversion文字列。
 * @returns `"EPGStation/<version>"`形式の文字列。
 */
const composeTunerUserAgent = (version: string): string => `${TUNER_USER_AGENT_PRODUCT}/${version}`;

export default composeTunerUserAgent;
