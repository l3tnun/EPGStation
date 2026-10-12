# Web・API・リアルタイム通知提供機能 要件

## 概要

Web 画面、公開API、画像・映像、動画アップロード、API 文書、およびリアルタイム通知を提供し、利用者の要求を担当するサー
バー機能へ受け渡す。公開APIの実際の通信内容を変更せず維持する。

## 境界コンテキスト

-   **対象範囲**: Web・静的ファイル配信、公開設定、REST API、共通 HTTP 応答、アップロード、リアルタイム通知、
    HTTP・HTTPS、公開API契約を対象とする。
-   **対象外**: 各業務機能の判断と保存、画面の表示・操作設計、チューナーサーバー通信、サーバー全体の起動管理を対象外とす
    る。
-   **利用する機能**: サーバー設定管理機能（`server-configuration`）、運用ログ記録機能（`server-operational-logging`）、
    サーバー内部のプロセス間通信機能（`server-process-messaging`）、番組情報・番組表機能（`server-program-guide`）、録画
    予約管理機能（`server-reservation-management`）、自動予約ルール機能（`server-reservation-rules`）、予約録画実行機能
    （`server-recording-execution`）、録画済み番組管理機能（`server-recorded-content`）、録画済み番組のサムネイル管理機
    能（`server-thumbnail-management`）、録画ファイル変換（エンコード）機能（`server-encoding`）、録画保存先の容量管理機
    能（`server-storage-management`）、映像配信・再生連携機能（`server-media-delivery`）、IPTV向けチャンネル一覧・番組表
    出力機能（`server-iptv-export`）、状態変化通知・外部連携機能（`server-event-and-hook-delivery`）、機能間連携機能
    （`server-workflow-coordination`）
-   **この機能を利用する機能**: サーバー起動・稼働管理機能（`server-application-runtime`）

## Requirements

### Requirement 1: Web 画面・静的ファイル・公開情報

**目的:** 利用者として、Web 画面と画面が必要とする公開情報やファイルを取得したい。

#### Acceptance Criteria

1. The Web・API・リアルタイム通知提供機能 shall EPGStation の Web 画面を構成する静的ファイルを配信する
2. The Web・API・リアルタイム通知提供機能 shall 画面用画像、サムネイル、および配信用一時ファイルを定められた公開場所から
   配信する
3. Where 配信サブディレクトリが設定されているとき, the Web・API・リアルタイム通知提供機能 shall Web、API、API 文書、ファ
   イル、およびリアルタイム通知をその配下で提供する
4. When 公開設定を要求されたとき, the Web・API・リアルタイム通知提供機能 shall リアルタイム通知ポート、録画保存先名、エ
   ンコード方法、再生用 URL 設定、ストリーミング方法、外部再生先名、および `broadcast` を返す
5. When バージョンを要求されたとき, the Web・API・リアルタイム通知提供機能 shall EPGStation のパッケージバージョンを返す
6. The Web・API・リアルタイム通知提供機能 shall API の機械可読な文書を提供する
7. Where API 説明画面の配布物を利用できるとき, the Web・API・リアルタイム通知提供機能 shall API 文書を閲覧する画面を提供
   する
8. When HLSの親プレイリストを要求されたとき, the Web・API・リアルタイム通知提供機能 shall クライアントから見える相対path
   `./streamfiles/stream{streamId}.m3u8` と既存の静的ファイル提供経路を維持する
9. If 要求されたHLSファイルが配信用一時ファイルの公開場所に存在しないかpath traversalを含むとき, the Web・API・リアルタ
   イム通知提供機能 shall 任意のfilesystem fileを代わりに返さない

### Requirement 2: 番組・予約・録画の API

**目的:** 利用者として、EPGStation の主要機能を Web UI または外部アプリから利用したい。

#### Acceptance Criteria

1. The Web・API・リアルタイム通知提供機能 shall チャンネル、チャンネルロゴ、番組表、番組検索、および放送中番組の参照を受
   け付ける
2. The Web・API・リアルタイム通知提供機能 shall 予約の一覧、件数、詳細、追加、編集、取消、スキップ解除、重複解除、および
   再計算を受け付ける
3. The Web・API・リアルタイム通知提供機能 shall 自動予約ルールの一覧、詳細、追加、編集、有効化、無効化、および削除を受け
   付ける
4. The Web・API・リアルタイム通知提供機能 shall 録画中番組の一覧と録画タイマー再設定を受け付ける
5. The Web・API・リアルタイム通知提供機能 shall 録画済み番組、録画ファイル、ドロップログ、タグ、保護状態、およびサムネイ
   ルの参照と操作を受け付ける
6. The Web・API・リアルタイム通知提供機能 shall エンコードの追加、一覧、進捗確認、および取消を受け付ける
7. The Web・API・リアルタイム通知提供機能 shall 録画保存先の容量参照を受け付ける
8. The Web・API・リアルタイム通知提供機能 shall ライブ映像と録画済み映像の開始、継続、停止、および配信状態参照を受け付け
   る
9. The Web・API・リアルタイム通知提供機能 shall IPTV 向けチャンネル一覧と電子番組表を提供する
10. The Web・API・リアルタイム通知提供機能 shall 各操作の業務上の可否と状態を独自に決定せず、担当機能の結果を外部向け形
    式へ変換する

### Requirement 3: 公開API契約の維持

**目的:** Web UI と外部アプリの利用者として、サーバー更新後も公開APIを同じ通信内容で利用したい。

#### Acceptance Criteria

1. The Web・API・リアルタイム通知提供機能 shall 公開APIの要求方法、要求先、既存入力の名前・位置・必須性、成功状態、必須
   応答本文、内容種類、既存応答ヘッダー、および経路ごとのエラー状態と本文を維持する
2. The Web・API・リアルタイム通知提供機能 shall 録画済み映像のストリーム情報で既存フィールド名 `viodeFileId` を返す
3. The Web・API・リアルタイム通知提供機能 shall 予約一覧の `normal`、`conflicts`、`skips`、`overlaps` をそれぞれ配列とし
   て返す
4. The Web・API・リアルタイム通知提供機能 shall ルール追加を `POST <subDirectory>/api/rules` と
   `POST <subDirectory>/api/rules/keyword` の両方で受け付ける
5. When `POST <subDirectory>/api/recording/resettimer` へ本文なしの要求を受け付けたとき, the Web・API・リアルタイム通知
   提供機能 shall 成功時に HTTP 200 と必須本文 `{ code: 200 }` を返す
6. The Web・API・リアルタイム通知提供機能 shall 公開設定の応答へ `broadcast` を含める
7. The Web・API・リアルタイム通知提供機能 shall リアルタイム通知名 `updateStatus` と `updateEncode` を本文なしで維持する
8. When 機械可読な API 文書を提供するとき, the Web・API・リアルタイム通知提供機能 shall 予約一覧の四項目を配列として示
   し、ストリーム情報のフィールド名を実際の応答と一致させる

### Requirement 4: 共通の HTTP 要求と応答

**目的:** 利用者として、操作と内容に応じた HTTP 応答を受け取りたい。

#### Acceptance Criteria

1. When API 定義に合わない要求を受け付けたとき, the Web・API・リアルタイム通知提供機能 shall 入力エラーとして応答する。
   予約・ルールの追加と編集、および手動のエンコード追加で、保存先内ディレクトリまたはエンコード出力先ディレクトリが録画保
   存先の外を指す（`server-recording-execution`の保存先内ディレクトリの検査）要求も入力エラーとして扱い、HTTP 400、`code`、`message`、
   および`errors`を持つ既存形式の本文で応答する
2. When JSON を正常に返すとき, the Web・API・リアルタイム通知提供機能 shall 利用者ごとのキャッシュへ保存しないための既存
   ヘッダーを付ける
3. When プレイリスト、画像、ログ、または映像を返すとき, the Web・API・リアルタイム通知提供機能 shall 用途に応じた内容種
   類を付ける
4. When 映像ファイルの単一byte範囲を、解釈後の開始位置が0以上、開始位置が終了位置以下で、終了位置がファイルサイズ未
   満となるように要求されたとき, the Web・API・リアルタイム通知提供機能 shall HTTP 206、要求範囲、および要求byte列を返す
5. If 解釈後の要求開始位置または終了位置が映像ファイルのサイズ以上であるとき, the Web・API・リアルタイム通知提供機能
   shall HTTP 416と満たせないファイルサイズを返す
6. Where ダウンロードが指定されているとき, the Web・API・リアルタイム通知提供機能 shall 保存用の内容種類とファイル名を付
   ける
7. When サーバー内部の処理が失敗したとき, the Web・API・リアルタイム通知提供機能 shall HTTP 500、`code`、`message`、およ
   び既存では任意の `errors` を持つエラー本文を返す。予約の編集で、編集の対象ではない予約（自動予約とRule由来の番組リレ
   ー予約）を指定した要求は内部の失敗ではなく、HTTP 409、`code`、`message`、および`errors`を持つ既存形式の本文で応答する
8. When HTTP 要求を受け付けたとき, the Web・API・リアルタイム通知提供機能 shall アクセスログへ記録する

### Requirement 5: 公開 URL の組立て

**目的:** 利用者として、プレイリストと外部アプリ連携から要求に対応する接続先へ到達したい。

#### Acceptance Criteria

1. When 外部向け URL を組み立てるとき, the Web・API・リアルタイム通知提供機能 shall 要求の Host を使用する
2. When 外部向け URL の通信方式を決めるとき, the Web・API・リアルタイム通知提供機能 shall 実際の通信方式に加えて
   `X-Forwarded-Proto` が HTTPS を示す場合も HTTPS として扱う
3. Where 配信サブディレクトリが設定されているとき, the Web・API・リアルタイム通知提供機能 shall 外部向け URL にそのサブ
   ディレクトリを含める

### Requirement 6: 動画ファイルのアップロード

**目的:** 利用者として、動画ファイルを録画済み番組へ追加したい。

#### Acceptance Criteria

1. When 動画をアップロードするとき, the Web・API・リアルタイム通知提供機能 shall 一つの要求につき一件のファイル、録画済
   み番組、保存先、表示名、およびファイル種類を受け付ける
2. When Web・API提供子プロセスを開始するとき, the Web・API・リアルタイム通知提供機能 shall `concurrentUploadNum`と
   `uploadReceiveTimeoutMs`を読み込み、設定が省略された場合はそれぞれ3と300,000ミリ秒を使用し、稼働中の設定ファイル変更
   を現在の子プロセスへ反映しない
3. The Web・API・リアルタイム通知提供機能 shall `concurrentUploadNum`に1以上の安全な整数だけを、
   `uploadReceiveTimeoutMs`に1以上2,147,483,647以下の整数だけを許可し、条件を満たさない設定ではWeb・API提供子プロセスの
   起動を失敗させる
4. Before アップロードのbody受領または一時ファイル作成を始めるとき, the Web・API・リアルタイム通知提供機能 shall
   `concurrentUploadNum`の範囲内で一件分の実行枠を取得する
5. If すべてのアップロード実行枠が使用中であるとき, the Web・API・リアルタイム通知提供機能 shall その要求をbody受領と一
   時ファイル作成の前に既存のエラー応答経路で拒否し、受付済みアップロードと他のWeb・API要求を継続する
6. The Web・API・リアルタイム通知提供機能 shall 一件のアップロード実行枠を、body受領前から受信、入力確認、一時ファイル保
   存、録画保存先への移動、およびHTTP要求が成功、明示失敗、受信期限、要求中断、または登録IPCの10分期限で確定するまで保持
   する
7. While アップロードを受信しているとき, the Web・API・リアルタイム通知提供機能 shall ファイルを設定された一時保存先へ保
   存する
8. When アップロードの受信を開始したとき, the Web・API・リアルタイム通知提供機能 shall 起動時に保持した
   `uploadReceiveTimeoutMs`を一件のbody全体の受信期限として適用する
9. When ファイルの受信に成功したとき, the Web・API・リアルタイム通知提供機能 shall 録画済み番組管理機能へ登録を依頼する
10. When 録画済み番組管理機能への登録が成功したとき, the Web・API・リアルタイム通知提供機能 shall HTTP 200 と既存の成功
    本文 `{ code: 200, result: 'ok' }` を返す
11. If 登録依頼後にプロセス間通信の10分期限を超えたとき, the Web・API・リアルタイム通知提供機能 shall 既存のHTTP 500を返
    し、管理側ですでに始まった処理を取り消したとは扱わない
12. If アップロードの読み取り、入力確認、経路処理、または録画ファイル登録が失敗したとき, the Web・API・リアルタイム通知
    提供機能 shall その要求で把握している一時ファイルの削除を既存の方法で試み、既存のエラー応答へ渡す
13. If アップロードの受信待ち時間を超えたか利用者が要求を中断したとき, the Web・API・リアルタイム通知提供機能 shall 受信
    を中止し、その要求で把握している一時ファイルの削除を既存の方法で試みる
14. When 一件のHTTP要求が登録成功、登録失敗、受信失敗、要求中断、受信期限、または登録IPCの10分期限で確定したとき, the
    Web・API・リアルタイム通知提供機能 shall その実行枠を一回だけ解放し、遅れて届く登録結果のために実行枠を保持しない
15. The Web・API・リアルタイム通知提供機能 shall アップロードするファイルの最小サイズ、最大サイズ、または同時アップロー
    ド全体の合計byte上限を新設しない
16. The Web・API・リアルタイム通知提供機能 shall アップロードの公開request・response schema、成功status、および既存のエ
    ラー表現を変更しない
17. The Web・API・リアルタイム通知提供機能 shall `concurrentUploadNum`と`uploadReceiveTimeoutMs`を公開request・response
    schemaまたはWeb UI向け公開設定へ追加しない
18. When Web・API提供子プロセスを再起動したとき, the Web・API・リアルタイム通知提供機能 shall 再起動前のアップロード実行
    枠または途中処理を復元せず、起動時に二つの設定を読み直して空の実行枠から開始する
19. When multipart のファイル名を受信するとき, the Web・API・リアルタイム通知提供機能 shall 通常の `filename` parameter
    をUTF-8として解釈し、明示charsetを持つ `filename*` parameterをそのcharsetで一回だけ解釈して優先し、解釈済みの名前を
    再decodeして変更しない

### Requirement 7: リアルタイム更新通知

**目的:** Web UI として、サーバー内の状態変化を契機に必要な情報を再取得したい。

#### Acceptance Criteria

1. When HTTP または HTTPS の接続先を開始するとき, the Web・API・リアルタイム通知提供機能 shall 同じ接続先または設定され
   た別ポートでリアルタイム通知を提供する
2. Where 配信サブディレクトリが設定されているとき, the Web・API・リアルタイム通知提供機能 shall その配下のリアルタイム通
   知パスを使用する
3. When 通常の状態更新通知を受け取ったとき, the Web・API・リアルタイム通知提供機能 shall 200ミリ秒の間に届いた同種通知を
   まとめて `updateStatus` を送る
4. When エンコード進捗更新通知を受け取ったとき, the Web・API・リアルタイム通知提供機能 shall 200ミリ秒の間に届いた同種通
   知をまとめて `updateEncode` を送る
5. The Web・API・リアルタイム通知提供機能 shall `updateStatus` と `updateEncode` へ個別の変更内容を含めない
6. If 利用者が切断している間に通知が発生したとき, the Web・API・リアルタイム通知提供機能 shall 通知を保存または再送しな
   い

### Requirement 8: HTTP・HTTPS と接続元条件

**目的:** 運用者として、設定した通信方式と接続元条件で Web・API とリアルタイム通知を提供したい。

#### Acceptance Criteria

1. Where HTTP ポートが設定されているとき, the Web・API・リアルタイム通知提供機能 shall そのポートで HTTP を開始する。ポート
   使用中などで待ち受けを開始できないときは、待ち受け開始を記録せず、`EADDRINUSE` などの失敗の原因を運用ログへ記録し、
   起動の失敗として例外を送出する
2. Where HTTPS のポート、秘密鍵、および証明書が設定されているとき, the Web・API・リアルタイム通知提供機能 shall その設定
   で HTTPS を開始する
3. Where HTTPS の認証局証明書が設定されているとき, the Web・API・リアルタイム通知提供機能 shall 接続元証明書を要求して検
   証する
4. Where API の全接続元許可が設定されているとき, the Web・API・リアルタイム通知提供機能 shall Web と API の HTTP 応答で
   Cross-Origin Resource Sharing をすべての接続元へ許可する
5. The Web・API・リアルタイム通知提供機能 shall リアルタイム通知接続ですべての接続元を許可する
6. The Web・API・リアルタイム通知提供機能 shall Web、API、画像、映像、API 文書、およびリアルタイム通知へ共通のアプリケー
   ション認証を追加しない

### Requirement 9: 機能固有サーバーテストの品質判定

**目的:** 保守者とリリース責任者として、公開HTTP契約、file公開、upload、リアルタイム通知、およびlistener境界の互換性の退
行をリリース前に検出したい。

#### Acceptance Criteria

1. When Web・API・リアルタイム通知提供機能を検証するとき, the 機能固有テスト shall Requirements 1から8のroute、入力、
   status、本文、header、静的file・HLS、公開URL、upload、リアルタイム通知、およびHTTP・HTTPS契約を`unittest/spec`で検証
   する
2. When 内部の値域と分岐を検証するとき, the 機能固有テスト shall subDirectory、Host・通信方式、byte range、upload同時実
   行数の省略値と境界、受信期限、通知の集約時間、およびlistener設定の分岐を`unittest/imp`で検証する
3. When 機能固有test matrixを作るとき, the 機能固有テスト shall upload枠取得前・受信中・登録待ち・成功・失敗・abort・期
   限到達・再起動、`finish`・`close`・`abort`・timeoutの競合、およびtemporary file・upload枠・timer・socket・listenerの
   一回だけの終端と解放を分類する
4. Where 結合境界を検証するとき, the 機能固有テスト shall HTTP・HTTPS要求応答、管理側操作のIPC、静的file・HLS・uploadの
   filesystem、およびWeb・API child processの起動後・再起動後のlistenerを接続し、DBの直接利用は各domain ownerの責務とし
   て非適用理由を記録する
5. When 本機能の完了を判定するとき, the Web・API・リアルタイム通知提供機能 shall 本機能の単体test（spec・imp）と結合testがすべて成功し、
   かつ`server-application-runtime`のRequirement 9 Acceptance Criterion 9のserver全体のcoverageの判定を満たさない限り本機能を未完了とする
