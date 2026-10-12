/**
 * 編集の対象ではない予約（自動予約と Rule 由来の番組リレー予約）の編集を拒否したことを示すエラーメッセージ。
 * 入力・encode option の誤り（`ReservationEditError`）と区別し、API 層はこの文字列で HTTP 409 と判別する
 * （IPC を越えてもエラーメッセージは保たれる）。
 */
export const RESERVATION_NOT_EDITABLE_ERROR = 'ReservationIsNotEditable';
