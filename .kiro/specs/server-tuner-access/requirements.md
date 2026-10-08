# チューナーサーバー連携機能 要件

## 概要

本機能は、Mirakurunまたはmirakcから稼働状態、チューナー、放送局、番組、ロゴ、および放送ストリームを取得する。

Mirakurun専用クライアントパッケージに依存せず、両製品が公開する共通のREST APIとストリームAPIを直接利用する。最低対
応版はMirakurun 3.8.0、mirakc 3.1.10とし、それ以降の版を対応範囲とする。接続先が異なっても、利用機能へ同じ業務上の結果を
返す。

## 境界コンテキスト

-   **対象範囲**: 接続先の準備、稼働状態、チューナー・放送局・番組・ロゴの取得、変更取得、録画・ライブ視聴ストリーム、取
    得優先度、一回の要求の応答時間、起動時接続確認
-   **対象外**: 番組の保存と検索、予約競合とチューナー割当、録画状態、ストリーム変換と配信、Mirakurun・mirakc自体の管
    理、HTTPS、接続先専用の認証・通信代理・証明書、Windows host OS上のserver運用
-   **利用する機能**: サーバー設定管理機能（`server-configuration`）、運用ログ記録機能（`server-operational-logging`）
-   **この機能を利用する機能**: サーバー起動・稼働管理機能（`server-application-runtime`）、映像配信・再生連携機能
    （`server-media-delivery`）、番組情報・番組表機能（`server-program-guide`）、予約録画実行機能
    （`server-recording-execution`）、録画予約管理機能（`server-reservation-management`）

## Requirements

### Requirement 1: 対応製品と接続方法

**目的:** 運用者として、対応範囲のMirakurunまたはmirakcを設定した接続方法で利用したい。

#### Acceptance Criteria

1. The チューナーサーバー連携機能 shall Mirakurun 3.8.0以降を対応範囲として扱う
2. The チューナーサーバー連携機能 shall mirakc 3.1.10以降を対応範囲として扱う
3. The チューナーサーバー連携機能 shall 対応範囲内の個別版について事前の許可一覧にないことだけを理由に拒否しない
4. The チューナーサーバー連携機能 shall Mirakurun専用クライアントパッケージを情報照会、変更取得、またはストリーム取得の
   必須条件にしない
5. The チューナーサーバー連携機能 shall 両製品が公開する共通のREST APIとストリームAPIを直接利用する
6. When ネットワーク上の接続先が設定されているとき, the チューナーサーバー連携機能 shall HTTP接続を準備する
7. When Unixドメインソケットが設定されているとき, the チューナーサーバー連携機能 shall そのソケットを通じたHTTP接続を準
   備する
8. When Windowsの名前付きパイプが設定されているとき, the チューナーサーバー連携機能 shall 既存のparserおよびHTTP request
   の`socketPath` optionによる解釈をbest-effortなcharacterizationとして保持する。Windows host OSはserver正式対応外とし、
   名前付きパイプ実接続を結合testの必須条件にしない
9. The チューナーサーバー連携機能 shall HTTPS、接続先専用の認証情報、通信代理、またはTLS証明書の設定を提供しない
10. The チューナーサーバー連携機能 shall 全てのHTTP要求の`User-Agent`を`EPGStation/`で始め、続けて自身の版を置く
11. The チューナーサーバー連携機能 shall `User-Agent`の`EPGStation`を大文字小文字を含めてこの綴りで送る

### Requirement 2: 稼働状態と放送情報の取得

**目的:** 番組情報、予約、録画として、接続先製品に依存しない放送情報を利用したい。

#### Acceptance Criteria

1. When 稼働状態を要求されたとき, the チューナーサーバー連携機能 shall 接続先が返した稼働状態と版情報を利用側へ返す
2. When チューナー一覧を要求されたとき, the チューナーサーバー連携機能 shall 利用可能なチューナーと対応する放送波を返す
3. When 放送局一覧を要求されたとき, the チューナーサーバー連携機能 shall 利用可能な放送局を返す
4. When 番組一覧を要求されたとき, the チューナーサーバー連携機能 shall 利用可能な番組を返す
5. When 番組識別子を指定して要求されたとき, the チューナーサーバー連携機能 shall 接続先が返した個別番組を返す
6. When Mirakurunとmirakcが同じ業務情報を異なる表現で返すとき, the チューナーサーバー連携機能 shall 利用側へ同じ業務上の
   結果を返す
7. The チューナーサーバー連携機能 shall Mirakurunまたはmirakc固有の型や表現を利用側の公開条件として要求しない
8. The チューナーサーバー連携機能 shall 取得した放送局または番組を永続保存しない

### Requirement 3: 番組・放送局の変更取得

**目的:** 番組情報・番組表として、接続先で発生する放送局と番組の変更を継続して受け取りたい。

#### Acceptance Criteria

1. When Mirakurunを利用するとき, the チューナーサーバー連携機能 shall 公開された番組・放送局変更ストリームを利用可能にす
   る
2. When mirakcを利用するとき, the チューナーサーバー連携機能 shall 公開された更新通知と必要な放送局別番組取得を利用可能
   にする
3. When 変更取得で一部の通信エラーまたは通知内容の解析失敗を確認したとき, the チューナーサーバー連携機能 shall そのエ
   ラーを番組情報・番組表へ伝える
4. When Mirakurunの変更ストリームが通常の終了または切断を返したとき, the チューナーサーバー連携機能 shall その取得処理を
   終了し、通信エラーまたは解析失敗と同じ切断通知を番組情報・番組表へ伝えない
5. The チューナーサーバー連携機能 shall 変更通知の集約、保存、全件同期、または再接続時期を所有しない
6. The チューナーサーバー連携機能 shall 変更通知へ順序、重複、または欠落を検出する共通の連番を追加しない
7. The チューナーサーバー連携機能 shall 継続中の変更取得へ一律の総接続時間を設けない
8. When Mirakurunの変更ストリームが、番組・放送局以外の対象（チューナーの状態、およびMirakurun 4系が流すジョブの状態を含む）の通知を返したとき, the チューナーサーバー連携機能 shall その通知を番組情報・番組表へ伝えず、変更取得を継続する。番組または放送局の通知の内容が不正なときは、解析失敗として扱う

> **通知の非対称:** Mirakurunの通常の終了または切断では、取得処理は終了するが、通信エラーまたは解析失敗と同じ切断通知を
> 利用側へ送らない（3.4）。

### Requirement 4: 録画用ストリーム

**目的:** 予約録画実行として、番組指定または放送局指定で放送ストリームを取得したい。

#### Acceptance Criteria

1. When 番組指定予約の録画ストリームを要求されたとき, the チューナーサーバー連携機能 shall 番組識別子と取得優先度を接続
   先へ渡してストリームを要求する
2. When 時刻指定予約の録画ストリームを要求されたとき, the チューナーサーバー連携機能 shall 放送局識別子と取得優先度を接
   続先へ渡してストリームを要求する
3. When 録画ストリームを取得したとき, the チューナーサーバー連携機能 shall 受信したストリームを予約録画実行へ渡す
4. If 録画ストリームの取得が失敗したか確立の応答時間を超えたとき, the チューナーサーバー連携機能 shall エラーを予約録画
   実行へ返す
5. When 録画の取消または終了を要求されたとき, the チューナーサーバー連携機能 shall EPGStation側のストリーム接続を破棄で
   きるようにする
6. The チューナーサーバー連携機能 shall 録画ストリームの継続時間そのものへ一律の終了時間を設けない
7. The チューナーサーバー連携機能 shall 途切れた録画ストリームを途中位置から自動再開しない

### Requirement 5: ライブ視聴用ストリームと取得優先度

**目的:** 映像配信として、放送局のライブ視聴ストリームを選択された優先度で取得したい。

#### Acceptance Criteria

1. When ライブ視聴ストリームを要求されたとき, the チューナーサーバー連携機能 shall 放送局識別子と取得優先度を接続先へ渡
   してストリームを要求する
2. When ライブ視聴ストリームを取得したとき, the チューナーサーバー連携機能 shall 受信したストリームを映像配信へ渡す
3. If ライブ視聴ストリームの取得が失敗したか確立の応答時間を超えたとき, the チューナーサーバー連携機能 shall エラーを映
   像配信へ返す
4. When 視聴の終了または配信異常を受け付けたとき, the チューナーサーバー連携機能 shall EPGStation側のストリーム接続を破
   棄できるようにする
5. The チューナーサーバー連携機能 shall ライブ視聴ストリームの継続時間そのものへ一律の終了時間を設けない
6. The チューナーサーバー連携機能 shall 複数の録画と視聴が競合した場合の受理、拒否、または入替を独自に決定しない
7. The チューナーサーバー連携機能 shall EPGStation側の接続破棄後に接続先のチューナー資源解放完了を確認する共通の結果を提
   供しない

### Requirement 6: 放送局ロゴ

**目的:** 番組情報・番組表として、保存済み放送局に対応するロゴを照会したい。

#### Acceptance Criteria

1. When ロゴありの放送局について画像を要求されたとき, the チューナーサーバー連携機能 shall 公開されたロゴ取得APIへ要求す
   る
2. When ロゴ画像を取得したとき, the チューナーサーバー連携機能 shall 画像を要求元へ返す
3. If ロゴ取得が失敗したか有限な応答時間を超えたとき, the チューナーサーバー連携機能 shall ロゴなしへ変換せず取得エラー
   を返す
4. The チューナーサーバー連携機能 shall 取得したロゴ画像を保存しない
5. When 同じ放送局のロゴを再び要求されたとき, the チューナーサーバー連携機能 shall 接続先へ改めて要求する

### Requirement 7: 一回の要求の応答時間と再試行

**目的:** 利用機能として、起動時の稼働状態確認を除く一回の外部要求で処理が無期限に停止せず、失敗後の再試行主体を判断した
い。

#### Acceptance Criteria

1. When 起動時の稼働状態確認を除いて稼働状態、チューナー、放送局、番組、またはロゴをREST APIへ要求するとき, the チュー
   ナーサーバー連携機能 shall 操作ごとに設定された有限な応答時間を適用する
2. When 録画またはライブ視聴のストリーム確立を要求するとき, the チューナーサーバー連携機能 shall HTTP応答を受け取ってス
   トリームを利用側へ引き渡すまでに限り設定された有限な応答時間を適用し、引渡し後の継続受信には適用しない
3. If 一回の要求が応答時間を超えたとき, the チューナーサーバー連携機能 shall その要求を失敗として依頼元へ返す
4. If 起動後の個別要求が失敗したとき, the チューナーサーバー連携機能 shall その要求を一律に自動再試行しない
5. When 起動時の稼働状態確認が失敗したとき, the チューナーサーバー連携機能 shall 1秒待って新しい確認を開始する
6. While 起動時の稼働状態確認が成功していないとき, the チューナーサーバー連携機能 shall 後続の予約、録画、Web UI・APIの
   開始を許可しない
7. The チューナーサーバー連携機能 shall 起動時の稼働状態確認の一回ごとの要求、総試行回数、または総待機時間へEPGStation独
   自の上限を設けない

### Requirement 8: 機能固有サーバーテストの品質判定

**目的:** 保守者とリリース責任者として、接続先、製品間の共通結果、REST・変更取得・放送stream・応答期限・後始末の退行をリ
リース前に検出したい。

#### Acceptance Criteria

1. When チューナーサーバー連携機能を検証するとき, the 機能固有テスト shall Requirements 1から7の対応版、HTTP・Unix
   domain socketの正式接続方式、named pipeのbest-effortなparser・request option characterization、共通の業務結果、変更取
   得、録画・ライブ視聴stream、ロゴ、有限な一回の要求、および起動時確認を`unittest/spec`で検証する
2. When 内部の値域と分岐を検証するとき, the 機能固有テスト shall HTTP・Unix domain socketの接続先解釈、named pipeの既存
   parser・request optionによるbest-effortな解釈、route・priority、HTTP status、必須・追加field、製品能力判定、期限の直
   前・到達・超過、応答・abort・timeoutの競合、および共通結果への変換分岐を`unittest/imp`で検証する
3. When 機能固有test matrixを作るとき, the 機能固有テスト shall 要求前・確立中・引渡し済み・終了、成功・通信error・解析
   失敗・通常終了・close・abort・timeout、起動確認失敗後の1秒待機と上限なし、引渡し前のHTTP request・response・timer・
   AbortSignal listenerの一回だけの解放、および引渡し後のReadable所有権の利用機能への移転・冪等なclose要求・terminal
   event伝播を分類する。接続先のチューナー資源解放完了確認は本機能の非適用境界として記録する
4. Where 結合境界を検証するとき, the 機能固有テスト shall 合成HTTP serverおよびtemporary Unix domain socketでREST、変更
   stream、録画・ライブ視聴stream、ロゴ、およびabortを接続する。named pipeは既存parser・request optionのbest-effortな
   characterizationに限定し、DB、IPC、永続filesystem、およびchild processは非適用理由を記録する
5. When 本機能の完了を判定するとき, the チューナーサーバー連携機能 shall 本機能のHTTP・Unix domain socketの単体test（spec・imp）と結合testが
   すべて成功し、かつ`server-application-runtime`のRequirement 9 Acceptance Criterion 9のserver全体のcoverageの判定を満たさない限り本機能を未完了とする。Windows named pipe実接続の
   未実行・skip・failureは本機能の完了判定を妨げない
