# 運用ログ記録機能 要件

## 概要

EPGStation Server の動作、アクセス、映像配信、エンコード、および異常を、用途と重要度に応じて画面またはログファイルへ記録
する。

## 境界コンテキスト

-   **対象範囲**: ログの初期化、用途別・重要度別の記録、役割別設定、設定されたファイル切替、重大な異常の記録
-   **対象外**: 業務処理の成否判断、異常後の再試行や再起動、メトリクス、分散トレース、ブラウザー側の記録
-   **利用する機能**: なし
-   **この機能を利用する機能**: サーバー起動・稼働管理機能（`server-application-runtime`）、サーバー設定管理機能
    （`server-configuration`）、録画ファイル変換（エンコード）機能（`server-encoding`）、状態変化通知・外部連携機能
    （`server-event-and-hook-delivery`）、IPTV向けチャンネル一覧・番組表出力機能（`server-iptv-export`）、バックアップ・
    復元・旧版移行機能（`server-management-tools`）、映像配信・再生連携機能（`server-media-delivery`）、メディア変換プロ
    セス管理機能（`server-media-process-management`）、データベース保存・検索機能（`server-persistence`）、サーバー内部
    のプロセス間通信機能（`server-process-messaging`）、番組情報・番組表機能（`server-program-guide`）、録画済み番組管理
    機能（`server-recorded-content`）、予約録画実行機能（`server-recording-execution`）、録画予約管理機能
    （`server-reservation-management`）、自動予約ルール機能（`server-reservation-rules`）、Web・API・リアルタイム通知提
    供機能（`server-service-interface`）、録画保存先の容量管理機能（`server-storage-management`）、録画済み番組のサムネ
    イル管理機能（`server-thumbnail-management`）、チューナーサーバー連携機能（`server-tuner-access`）、機能間連携機能
    （`server-workflow-coordination`）

## Requirements

### Requirement 1: ログ出力の初期化

**目的:** 運用者として、サーバー起動の早い段階から動作状況を確認したい。

#### Acceptance Criteria

1. When 詳細なログ設定を指定せずに初期化するとき, the 運用ログ記録機能 shall システム、アクセス、ストリーム、エンコード
   の記録を画面へ出力できるようにする
2. When 役割別のログ設定を指定して初期化するとき, the 運用ログ記録機能 shall その設定に定められた出力先と重要度を適用す
   る
3. If 指定されたログ設定が存在しない、読み取れない、または解釈できないとき, the 運用ログ記録機能 shall 該当するサーバー
   処理を開始しない
4. If 初期化前にログ出力を要求されたとき, the 運用ログ記録機能 shall 準備されていないことを画面へ出力し、該当する処理を
   継続しない

### Requirement 2: 用途別・重要度別の記録

**目的:** 運用者として、記録の用途と重要度から必要な情報を確認したい。

#### Acceptance Criteria

1. The 運用ログ記録機能 shall サーバー内部の動作と異常をシステムログとして記録する
2. The 運用ログ記録機能 shall Web UI、API、およびファイル取得の HTTP アクセスをアクセスログとして記録する
3. The 運用ログ記録機能 shall ライブ視聴と録画済み番組の配信状況をストリームログとして記録する
4. The 運用ログ記録機能 shall エンコードの開始、進行、終了、および異常をエンコードログとして記録する
5. When 各機能が重要度を指定して記録するとき, the 運用ログ記録機能 shall 指定された重要度をログ設定へ適用する

### Requirement 3: 役割別の出力設定

**目的:** 運用者として、予約・録画、Web・API、番組情報更新の記録を役割に応じて管理したい。

#### Acceptance Criteria

1. When 予約・録画を管理する処理を開始するとき, the 運用ログ記録機能 shall その処理に対応するログ設定を使用する
2. When Web UI・API を提供する処理を開始するとき, the 運用ログ記録機能 shall その処理に対応するログ設定を使用する
3. When 番組情報を更新する処理を開始するとき, the 運用ログ記録機能 shall その処理に対応するログ設定を使用する
4. Where ログファイル出力が設定されているとき, the 運用ログ記録機能 shall 設定された容量と保持数に従ってログファイルを切
   り替える
5. When 稼働中にログ設定ファイルが変更されたとき, the 運用ログ記録機能 shall 実行中の処理へ自動では反映せず、次回の初期
   化時に新しい設定を使用する

### Requirement 4: HTTP アクセスの記録

**目的:** 運用者として、Web・API への要求と応答状況をアクセスログで確認したい。

#### Acceptance Criteria

1. When Web・API 提供機能が HTTP 要求を受け付けたとき, the 運用ログ記録機能 shall アクセスログ設定に従って要求を記録する
2. When HTTP 要求の処理が完了したとき, the 運用ログ記録機能 shall アクセスログ設定に従って応答状態を記録する
3. The 運用ログ記録機能 shall アクセスの許可、拒否、および応答内容を独自に決定しない

### Requirement 5: 重大な異常の記録

**目的:** 運用者として、処理を継続できない可能性がある異常を確認したい。

#### Acceptance Criteria

1. When 捕捉されなかった例外を検知したとき, the 運用ログ記録機能 shall 重大な異常として記録する
2. When 処理結果を待たれないまま失敗した非同期処理を検知したとき, the 運用ログ記録機能 shall 重大な異常として記録する
3. When 他機能が処理停止または再起動を通知したとき, the 運用ログ記録機能 shall 指定された用途と重要度で記録する
4. The 運用ログ記録機能 shall 異常を記録したことだけを理由に処理の継続、停止、または再起動を決定しない

### Requirement 6: 機能固有サーバーテストの品質判定

**目的:** 保守者とリリース責任者として、ログ初期化、用途・重要度、HTTPアクセス、および重大異常の記録契約の退行をリリース
前に検出したい。

#### Acceptance Criteria

1. When 運用ログ記録機能を検証するとき, the 機能固有テスト shall Requirements 1から5の初期化、用途・重要度、役割別設定、
   HTTP要求・応答、および重大異常を記録するだけで停止・再起動を決定しない契約を`unittest/spec`で検証する
2. When 内部の値域と分岐を検証するとき, the 機能固有テスト shall 役割と用途の組合せ、出力先とlevelの選択、設定不在・読取
   不能・解析失敗・初期化前取得、およびHTTP処理の終了分岐を`unittest/imp`で検証する
3. When 機能固有test matrixを作るとき, the 機能固有テスト shall 未初期化・初期化済み・再初期化、HTTP処理の終了通知の重複
   と順序、捕捉されなかった例外と非同期失敗の近接発生、file切替・書込失敗、およびlogger・listener・file・processの取得か
   ら終了までを分類する
4. Where 結合境界を検証するとき, the 機能固有テスト shall HTTP要求・応答、設定とrotationのfilesystem、および役割別
   processを接続し、DBとIPCは本機能の直接境界でないため非適用理由を記録する
5. When 本機能の完了を判定するとき, the 運用ログ記録機能 shall 本機能の単体test（spec・imp）と結合testがすべて成功し、
   かつ`server-application-runtime`のRequirement 9 Acceptance Criterion 9のserver全体のcoverageの判定を満たさない限り本機能を未完了とする
