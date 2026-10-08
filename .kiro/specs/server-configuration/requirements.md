# サーバー設定管理機能 要件

## 概要

YAML 形式のサーバー設定を読み込み、省略値と表記を整え、各機能と Web UI 向けに必要な設定を提供する。設定ファイルの変更時
は再読み込みを試み、成功した場合だけ以後の取得結果を切り替える。

## 境界コンテキスト

-   **対象範囲**: YAML の読み込み、`!env` による環境変数の展開、標準値の補完、表記の正規化、起動に必要な最低条件の確認、
    設定の複製提供、再読み込み、公開用設定、外部コマンド設定の解釈
-   **対象外**: 全項目に共通する新しい検証体系、利用中設定の自動切替、個別機能の再起動、業務判断、ブラウザー内の設定
-   **利用する機能**: 運用ログ記録機能（`server-operational-logging`）
-   **この機能を利用する機能**: サーバー起動・稼働管理機能（`server-application-runtime`）、録画ファイル変換（エンコー
    ド）機能（`server-encoding`）、状態変化通知・外部連携機能（`server-event-and-hook-delivery`）、IPTV向けチャンネル一
    覧・番組表出力機能（`server-iptv-export`）、バックアップ・復元・旧版移行機能（`server-management-tools`）、映像配
    信・再生連携機能（`server-media-delivery`）、メディア変換プロセス管理機能（`server-media-process-management`）、デー
    タベース保存・検索機能（`server-persistence`）、番組情報・番組表機能（`server-program-guide`）、録画済み番組管理機能
    （`server-recorded-content`）、予約録画実行機能（`server-recording-execution`）、録画予約管理機能
    （`server-reservation-management`）、自動予約ルール機能（`server-reservation-rules`）、Web・API・リアルタイム通知提
    供機能（`server-service-interface`）、録画保存先の容量管理機能（`server-storage-management`）、録画済み番組のサムネ
    イル管理機能（`server-thumbnail-management`）、チューナーサーバー連携機能（`server-tuner-access`）

## Requirements

### Requirement 1: 設定の読み込みと補完

**目的:** 運用者として、省略可能な項目を補った一貫したサーバー設定を利用したい。

#### Acceptance Criteria

1. When サーバー処理を開始するとき, the サーバー設定管理機能 shall YAML 形式の設定ファイルを読み込む。値が `!env 環境変
   数名` と書かれた項目には、その環境変数の値を文字列として使う。`!env` を付けない値は環境変数名として解釈せず、書かれた
   とおりに扱う
2. When 対応する主要設定項目が省略されているとき, the サーバー設定管理機能 shall 定められた標準値を補う
3. Where ストリーミング設定の一部が省略され、基準となる設定を利用できるとき, the サーバー設定管理機能 shall 基準となる選
   択肢を補う
4. When サーバーの基準位置を表す記号を含む保存先を読み込んだとき, the サーバー設定管理機能 shall サーバーが利用する位置
   へ置き換える
5. When 配信サブディレクトリまたは保存先を読み込んだとき, the サーバー設定管理機能 shall サーバー内で利用する表記へ整え
   る
6. When 通常の録画保存先一覧を提供するとき, the サーバー設定管理機能 shall 一時録画用の名前を持つ保存先を一覧から除外す
   る

### Requirement 2: 起動に必要な最低条件

**目的:** 運用者として、Web UI・API を開始できない設定で後続機能が起動しないようにしたい。

#### Acceptance Criteria

1. If サーバー設定ファイルが存在しない、読み取れない、YAML として解釈できない、または `!env` が参照する環境変数が定義さ
   れていないとき, the サーバー設定管理機能 shall 後続機能へ設定を提供せず起動を失敗させる
2. The サーバー設定管理機能 shall HTTP の待受ポート、または待受ポート・秘密鍵・証明書を含む HTTPS 設定の少なくとも一方を
   必要とする
3. If HTTP と HTTPS のどちらの最低条件も満たさないとき, the サーバー設定管理機能 shall 後続機能へ設定を提供せず起動を失
   敗させる
4. If 標準値の基準となる設定を読み込めないとき, the サーバー設定管理機能 shall サーバー設定ファイル自体の読み込みを続
   け、利用できない基準値だけを補わない

### Requirement 3: 設定の取得

**目的:** 各サーバー機能として、取得後の変更が他の機能へ波及しない設定を利用したい。

#### Acceptance Criteria

1. When 設定を要求されたとき, the サーバー設定管理機能 shall その時点で有効な設定一式を返す
2. When 設定一式を返すとき, the サーバー設定管理機能 shall 管理中の設定とは独立した複製を返す
3. When 複数回設定を要求されたとき, the サーバー設定管理機能 shall 一つの取得結果に対する変更を別の取得結果へ反映しない

### Requirement 4: 設定変更の再読み込み

**目的:** 運用者として、設定ファイルを更新した後の取得要求へ新しい設定を提供したい。

#### Acceptance Criteria

1. The サーバー設定管理機能 shall 設定ファイルの変更を監視する
2. When 設定ファイルの変更を検知したとき, the サーバー設定管理機能 shall 変更後の YAML を読み込み、起動時と同じ補完と表
   記整理を行う
3. When 再読み込みと補完に成功したとき, the サーバー設定管理機能 shall それ以後の取得要求へ新しい設定を返す
4. If 再読み込みまたは補完に失敗したとき, the サーバー設定管理機能 shall 直前まで利用していた設定を維持して異常を記録す
   る
5. When 再読み込みに成功したとき, the サーバー設定管理機能 shall 設定を保持済みの機能を自動的に停止、再起動、または更新
   しない

### Requirement 5: Web UI 向け公開設定

**目的:** Web UI として、画面と再生に必要な設定だけを取得したい。

#### Acceptance Criteria

1. When 公開用設定を要求されたとき, the サーバー設定管理機能 shall リアルタイム通知の接続先ポートを提供する
2. When 公開用設定を要求されたとき, the サーバー設定管理機能 shall 録画保存先名、エンコード方法名、および利用可能なスト
   リーミング方法を提供する
3. When 公開用設定を要求されたとき, the サーバー設定管理機能 shall 端末別の再生用 URL 設定と外部再生先の名前を提供する
4. The サーバー設定管理機能 shall 公開用設定へデータベース認証情報、内部保存場所、および外部コマンドを含めない

### Requirement 6: 外部コマンド設定の解釈

**目的:** 外部処理を利用する機能として、既存のコマンド設定形式を同じ意味で利用したい。

#### Acceptance Criteria

1. When 外部コマンド設定を解釈するとき, the サーバー設定管理機能 shall 空白で区切られた先頭要素を実行ファイル、残りを引
   数として扱う
2. When 実行ファイルに Node.js 実行ファイルを表す記号があるとき, the サーバー設定管理機能 shall 実行中の Node.js 実行
   ファイルへ置き換える
3. When 引数にサーバーの基準位置または空白を表す記号があるとき, the サーバー設定管理機能 shall 既存の設定形式に従って置
   き換える
4. If 指定された実行ファイルが存在しないとき, the サーバー設定管理機能 shall 外部コマンドを開始せずエラーを返す

### Requirement 7: 処理量と処理期限の設定

**目的:** 運用者として、サーバー再起動時に反映される処理量上限とアップロード・外部コマンドの期限を設定したい。

#### Acceptance Criteria

1. When `encodeQueueLimit` が省略されているとき, the サーバー設定管理機能 shall エンコード待機依頼上限として1,024を補う
2. When `concurrentUploadNum` が省略されているとき, the サーバー設定管理機能 shall 同時アップロード数として3を補う
3. When `uploadReceiveTimeoutMs` が省略されているとき, the サーバー設定管理機能 shall 一件の動画アップロード本文全体の受
   信期限として300,000ミリ秒を補う
4. When `thumbnailMaxPending` が省略されているとき, the サーバー設定管理機能 shall サムネイル生成待機依頼上限として32 を
   補う
5. When `hookCommandMaxPending` が省略されているとき, the サーバー設定管理機能 shall 外部コマンド待機依頼上限として64 を
   補う
6. When `hookCommandTimeoutMs` が省略されているとき, the サーバー設定管理機能 shall 外部コマンドの準備開始から実行終了ま
   での期限として300,000ミリ秒を補う
7. The サーバー設定管理機能 shall `encodeQueueLimit` と `concurrentUploadNum` に1以上の安全な整数だけを許可する
8. The サーバー設定管理機能 shall `thumbnailMaxPending` と `hookCommandMaxPending` に1以上10,000以下の整数だけを許可する
9. The サーバー設定管理機能 shall `hookCommandTimeoutMs` と `uploadReceiveTimeoutMs` に1以上2,147,483,647以下の整数だけ
   を許可する
10. If Requirement 7.7から7.9の条件を満たさない設定を読み込んだとき, the サーバー設定管理機能 shall その設定を利用する機
    能を開始せず設定エラーを返す
11. The サーバー設定管理機能 shall Requirement 7の設定をWeb UI向け公開設定へ含めない
12. The サーバー設定管理機能 shall Requirement 7の設定を取得時の複製へ含めるが、各利用機能が起動時に保持した値を設定再読
    み込みによって自動的に置き換えない

### Requirement 8: 機能固有サーバーテストの品質判定

**目的:** 保守者とリリース責任者として、設定の読み込み、補完、複製、再読み込み、公開範囲、および値検証の退行をリリース前
に検出したい。

#### Acceptance Criteria

1. When サーバー設定管理機能を検証するとき, the 機能固有テスト shall Requirements 1から7の読み込み・補完・正規化、最低起
   動条件、独立した複製、再読み込み成功時だけの切替、公開項目、外部コマンド解釈、および処理量・期限設定を
   `unittest/spec`で検証する
2. When 内部の値域と分岐を検証するとき, the 機能固有テスト shall 省略値、最小値、最大許容値、範囲外、小数、文字列、非有
   限値、深い複製、表記の正規化、公開許可項目、および実行ファイル不存在の分岐を`unittest/imp`で検証する
3. When 機能固有test matrixを作るとき, the 機能固有テスト shall 有効設定なし・有効設定あり・再読み込み中・成功・失敗、変
   更前後の取得で旧または新の完全な設定だけを返す状態、稼働中の保持値と再起動後の反映、およびfile・watcher・listenerの取
   得から解放までを分類する
4. Where 結合境界を検証するとき, the 機能固有テスト shall 設定・template・鍵・証明書・実行ファイルのfilesystem境界と公開
   設定のHTTP projectionを接続し、DBとIPCは非適用、外部コマンド実行とprocess再起動は利用機能の所有であるためprocess境界
   を非適用として記録する
5. When 本機能の完了を判定するとき, the サーバー設定管理機能 shall 本機能の単体test（spec・imp）と結合testがすべて成功し、
   かつ`server-application-runtime`のRequirement 9 Acceptance Criterion 9のserver全体のcoverageの判定を満たさない限り本機能を未完了とする
