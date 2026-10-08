# Implementation Plan

---

## Cross-spec execution prerequisite

共有 server test foundation と Node.js 24/26 matrix は `server-application-runtime` が所有する。該当 foundation task
group 完了後に本 spec を実行し、共有 foundation を重複させず、録画済み番組管理固有の test と承認済み差分の最小実装だけを
追加する。

-   [x] 1. 録画済み番組の保存、照会、および録画結果反映を仕様テストで固定する
-   [x] 1.1 録画済み番組と関連情報の保存契約を characterization する

    -   既存実装は変更せず、番組情報、放送局、時刻、録画中・保護状態と、0件・複数件の録画ファイルを保存する挙動を
        `unittest/spec` で固定する。
    -   ドロップログ、サムネイル登録情報、タグ、自動予約ルールの関連と、録画ファイルの保存先、相対名、種類、表示名、サイ
        ズを `unittest/imp` で検証する。
    -   代表的な作成・更新で永続化成功後にだけ状態変化が通知され、失敗した変更を成功として通知しないことを確認する。
    -   完了時には、syntheticな番組と関連情報の保存・再読込結果が承認済みの関係と項目を再現し、production codeの差分がな
        い。
    -   _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
    -   _Boundary: 録画済み番組と関連情報の永続管理_

-   [x] 1.2 (P) 一覧、検索、詳細、およびエンコード状態投影を characterization する

    -   キーワード、放送局、ジャンル、自動予約ルール、録画ファイル有無の検索条件と、一覧・総件数を `unittest/spec` で固
        定する。
    -   詳細へ録画ファイル、サムネイル登録情報、ドロップログ、タグを含め、待機中・実行中のエンコード索引だけを該当番組へ
        投影することを `unittest/imp` で検証する。
    -   放送局・ジャンル候補、0件一覧、および存在しないIDの対象なしを別の正常結果として確認する。
    -   完了時には、検索fixtureごとの一覧、総件数、詳細、候補、および対象なしが既存の公開投影を再現する。
    -   _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
    -   _Boundary: 録画済み番組照会_

-   [x] 1.3 録画開始から終了までの登録・更新要求を characterization する

    -   録画開始後に番組、録画ファイル、任意のドロップログを順に関連付ける既存契約を `unittest/spec` で固定する。
    -   一時録画先から通常保存先へ移った後の保存先名・相対名と、録画終了時の録画中状態・最終サイズ更新を `unittest/imp`
        で検証する。
    -   録画時刻制御や実ファイル移動は再実装せず、関係機能から受け取った登録・更新だけを本境界で検証する。
    -   完了時には、syntheticな一件の録画開始・終了系列から承認済みの番組・ファイル・ドロップログ状態が再読込できる。
    -   _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
    -   _Boundary: 録画結果登録_

-   [x] 2. 手動管理、タグ、保護、履歴、および再生用sourceの契約を固定する
-   [x] 2.1 手動作成と既存録画ファイル追加を characterization する

    -   妥当な番組情報から録画中でなく保護されていない番組を作り、期間から録画時間を得る挙動を `unittest/spec` で固定す
        る。
    -   終了時刻が開始時刻以前ならDB変更と通知を行わず失敗することを確認する。
    -   指定した保存先の既存ファイルからサイズを取得し、実ファイルを移動せず対象番組へ関連付ける挙動を `unittest/imp` で
        検証する。
    -   完了時には、正常・時刻不正・保存先不明・実ファイル不明の各fixtureが既存の作成または失敗結果を再現し、production
        codeの差分がない。
    -   _Requirements: 4.1, 4.2, 4.3_
    -   _Boundary: 手動登録・ファイル追加_

-   [x] 2.2 (P) タグ、保護状態、およびルール関連を characterization する

    -   タグの一覧、検索、追加、名前・色変更、削除と、番組との関連付け・解除を `unittest/spec` で固定する。
    -   保護状態の変更と通知、保護中の番組全体・個別ファイルの利用者削除拒否を `unittest/imp` で検証する。
    -   自動予約ルール削除後に保存済み番組の対象関連だけが解除されることを確認する。
    -   完了時には、タグ・番組関連と保護状態の各変更が再読込でき、保護中の削除fixtureでは実ファイルとDBが不変になる。
    -   _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
    -   _Boundary: タグ・保護・履歴_

-   [x] 2.3 (P) 録画履歴の追加・照会を characterization し、保持期限を TDD で仕様へ合わせる

    -   番組指定の自動予約が番組リレーではなく正常終了し、予約削除が必要な場合だけ、比較用番組名、放送局、録画終了時刻を
        履歴へ加える挙動を `unittest/spec` で固定する。
    -   指定期間の履歴と自動予約ルールの重複判定に必要な情報を `unittest/imp` で検証する。
    -   fake clockで保持日数のcutoffより前・同時刻・後を作り、同時刻を保持して期限を過ぎた履歴だけを削除するtarget test
        を先に失敗させる。DB query失敗を成功へ変えず呼出元へ返すことも故障注入で確認する。
    -   `src/model/db/RecordedHistoryDB.ts`は`endAt < cutoff`で削除し、cutoffと同時刻の履歴は保持する。
    -   SQLiteとMariaDBの実DB integrationでcutoffより前だけが削除され、同時刻と後の履歴が保持されることを確認する。
    -   完了時には、対象・非対象の録画終了系列と保持期限fixtureが承認済みの履歴集合を再現し、production差分が保持期限の
        strict境界修正だけになる。
    -   _Requirements: 6.1, 6.2, 6.3, 6.4_
    -   _Boundary: 録画履歴_

-   [x] 2.4 録画ファイル再生source providerを RED から GREEN まで閉じる

    -   `test/server/recorded-content/playback-source.spec.test.ts`と`playback-source.test.ts`へ、video file IDから
        recorded IDだけを返す予備照会、およびconsumerがlease取得後に渡すexpected recorded IDと一致するかを確認する全情報
        再読取を分けて固定するtarget testを先に追加する。既存再生要求の`playPosition`を`open()`へ渡して返却sourceが同じ
        値を保持すること、対応消失・別recorded IDへの変更、対象なし、path解決失敗、動画情報失敗、reader open失敗では
        sourceを返さないことを別々に確認する。
    -   `IRecordedPlaybackSourceProvider`と`RecordedPlaybackSourceProvider`を追加し、`encoded-direct`、録画中の末尾追尾
        reader、完了済みfile readerのtagged source variantと`RecordedPlaybackReader`を一箇所で定義する。すべてのsource
        variantは`playPosition`を保持し、encodedの直接入力はreaderを作らず、reader variantだけがclose可能なRecorded
        Content所有readerを持つ。
    -   providerは`open()`成功からconsumerの`adopt()`までreaderを所有し、`pending→adopted|disposed`の先着一回だけを許
        す。dispose先着後のadoptは`stale`でsourceなし、adopt先着後のdisposeはno-op、二重adopt・二重disposeではreader
        closeが高々一回であることをtarget testにする。
        `test/server/recorded-content/recorded-playback-source.integration.test.ts` でこの二段階解決、対応変更
        reject、variant選択、採用前整理、adopt/dispose競合を確認する。採用後のreader/process/timer/listener cleanup、配
        信開始・停止、stream ID、HLS、HTTP応答、視聴用processはproviderへ移さない。
    -   encodedの直接入力、録画中の末尾追尾reader、完了済みfileのreaderという既存選択を保持し、公開API、IPC、設定、DB
        schema、公開response、HLS公開pathを変更しない。
    -   同じproviderを`server-media-delivery` Task 2.5のlease consumerへ渡す。本Task 2.4のproviderを先に完了させ、その後
        にMedia Delivery Task 2.5のconsumerを実装・検証する。providerの実装・testとconsumerの実装・testは別leafで所有
        し、consumer側のdirect DB/path fallback 0件、`playPosition`利用、開始失敗への伝播、source採用後cleanupはMedia
        Delivery Task 2.5だけで検証する。
    -   完了時には、recorded ID予備照会、全情報の再読取、source variant、adopt/disposeの先着競合、採用前のownerがtarget
        testとprovider integrationで一意に追跡できる。
    -   _Requirements: 1.2, 2.3, 7.1, 7.2, 7.3, 7.4, 7.7, 7.8_
    -   _Boundary: 録画ファイル再生source provider_
    -   _Verification: unittest/spec, unittest/imp, integration_
    -   _Depends: 2.3, 4.2_

-   [x] 3. アップロード済み一時ファイルの安全な引受けをTDDで実現する
-   [x] 3.1 upload adoption、配置・DB登録・通知境界を RED から GREEN まで閉じる

    -   保存先外へ出るサブディレクトリ（`..`）を拒否する`unittest/spec`（`upload.spec.test.ts`）と、`\`を含むもの、および空・
        `.`・`..`の要素を含むサブディレクトリ（`a\b`、`a//b`、`./a`、`a/..`）を拒否する`unittest/imp`
        （`upload-default-filesystem.imp.test.ts`）、および保存先配下の途中symbolic linkを、ディレクトリ作成・移動・登録前に拒否
        するtestを追加する。
    -   同名なし、単一・複数衝突、同時衝突、別ファイルシステム移動で、既存ファイルを一度も上書きしないtarget testを追加
        する。
    -   番組・保存先不明、ディレクトリ準備・移動失敗、DB登録失敗ごとに、当該要求が渡した一時ファイルまたは作成・移動した
        宛先だけをbest-effortに整理することを故障注入で検証する。
    -   testは現行との差を示して先に失敗し、既存ファイルまたは別要求のファイルを削除できる挙動を合格条件にしない。
    -   完了時には、各反例の期待効果と禁止効果が独立したassertionになり、production codeはまだ変更されていない。
    -   `src/model/operator/recorded/RecordedUploadAdoptionModel.ts`を作成し、
        `uploadTempDir/incoming/{uploadToken}/payload`のexact grammar、途中link非経由、およびtokenごとの
        `adopted/{uploadToken}`排他的作成を実装する。
    -   `src/model/ipc/IPCServer.ts`から専用adapterを呼び、既存`FileUtil.rename`やcopy fallbackを使わないraw rename成功
        だけをparentへの所有権移転とする。失敗時はincomingと既存adoptedを変更せず、自ら作った空token directoryだけを整理
        する。
    -   parent起動時はupload受付前に専用adopted領域のstale tokenだけを整理し、incoming、録画保存先、別tokenへ作用しな
        い。ACK消失、caller期限、service child再起動後もadoption済み処理を継続し、公開・IPC・domain・DB schemaへtokenや
        owner fieldを追加しない。
    -   `unittest/imp`でraw rename成功・失敗・衝突、incoming unlink race、ACK消失、stale整理を通し、各ownerが現在所有す
        るpathだけを高々一回整理する。
    -   完了時には、adoption成功後だけ既存domain処理が一回呼ばれ、失敗・競合・再起動fixtureでincoming、既存adopted、別要
        求file、および録画保存先がbyte単位で不変になる。
    -   `src/model/operator/recorded/RecordedManageModel.ts`でサブディレクトリを要素ごとに検査し（`\`を含むものと空・`.`・
        `..`の要素を拒否）、ファイル名の区切り文字と`.`・`..`も拒否したうえで、選択した保存先root内包と途中componentの非linkを
        効果前に確認する。
    -   Linuxでは親directoryのfile descriptorを経由して配置し、Linux以外（macOS・Windows）ではrootと親の`realpath`と各段
        の`lstat`を配置の直前に確認してからpathを指定して配置する。platformを差し替えられる形の
        `unittest/imp`で、darwin・win32の配置の成功と、保存先外・symbolic linkの拒否、確認が差し替えを見つけた後に後始末で保存先外のfileを消さないことを検証する（design 7.4）。
    -   元ファイル名、`(1)`、`(2)`の候補を排他的に確保し、競合した候補を変更・削除せず次候補へ進む。
    -   候補探索は元ファイル名から`(9999)`までの最大10,000候補に制限する。これは全候補が競合する入力で同期的な無限探索を
        避ける内部安全上限であり、上限到達時は配置前の一時fileだけを整理して`UploadCandidateLimitError`を返す。
    -   adoptedから同一ファイルシステム移動または上書きなしcopy fallbackを行い、commit前のadopted・partial destinationと
        commit後のdestinationを混同せず、現在ownerのpathだけを高々一回整理する。
    -   `unittest/imp`で3.1の保存先外、link、競合、移動・copy・unlink失敗fixtureを通し、実pathや実番組情報を出力へ残さな
        い。
    -   完了時には、3.1の配置testが通り、選択root外と既存・別要求fileの内容・存在が不変になる。
    -   配置成功後に表示名、種類、サイズ、保存先、相対名、対象番組を登録し、配置とDB登録の両方が成功した時点だけを引受け
        成功とする`integration` testを先に追加する。
    -   DB登録失敗では移動済みfileを削除して失敗を返し、DB登録後のfile追加通知またはサムネイル受付失敗では配置と登録を保
        持して成功を巻き戻さないことを故障注入する。
    -   失敗するtarget testを確認してから、通知失敗をcommit前失敗として扱う箇所だけを最小修正する。
    -   HTTP受信中の最大3並列、本文受信期限、一時file lifecycle、file size上下限は本taskへ追加しない。
    -   完了時には、成功時だけ引受成功とサムネイル生成要否が観測され、各失敗で当該要求以外のfileと登録が不変になる。
    -   _Requirements: 1.5, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13_
    -   _Boundary: upload引受け・状態変化通知_

-   [x] 4. 動画情報確認の既存解析と有限実行を検証する
-   [x] 4.1 (P) 動画情報の解析と対象なし・外部処理失敗を characterization する

    -   登録済み録画ファイルから再生時間、ファイルサイズ、ビットレートを数値として得る既存挙動を `unittest/spec` で固定
        する。
    -   登録なしと保存先不明を外部処理を起動しない失敗として、解決済みpathの実ファイルなし、起動失敗、非正常終了、不正
        JSONを外部処理開始後に動画情報を返さない失敗として `unittest/imp` で区別する。
    -   synthetic executableと一時ファイルだけを使い、実録画ファイル、実保存先、および未加工child出力を証跡へ含めない。
    -   完了時には、正常JSONだけが3項目を返し、各失敗fixtureは成功値を生成せず、production codeの差分がない。
    -   _Requirements: 7.1, 7.3, 7.4_
    -   _Boundary: 動画情報確認_

-   [x] 4.2 動画情報確認の有限 lifecycle を RED から GREEN まで閉じる

    -   fake timerと制御可能なchildで、spawn直前から30,000msの直前・到達・超過と、応答確定直前の期限再確認を
        `unittest/spec` にする。
    -   期限到達で一度だけ失敗を確定し、強制停止を要求して追加3秒だけ終了を確認し、終了未確認を運用ログへ渡すことを検証
        する。
    -   期限後の終了通知、stdout、解析完了が同じ要求を成功へ変えず、並行する別要求の結果へ作用しない反例を追加する。
    -   testが有限期限と結果fenceの未実装を示して失敗することを確認し、production codeはまだ変更しない。
    -   完了時には、期限、停止要求、追加確認、遅延callbackの各観測点を独立して再現できる。
    -   要求ごとに独立したmonotonic期限、単一settlement、process handle、および期限後結果fenceを実装する。
    -   30秒超過時の強制停止と追加3秒確認を実装し、終了未確認だけを許可済み診断情報で記録する。
    -   `unittest/imp` とsynthetic childの `integration` testで、正常、起動失敗、期限超過、終了未確認、late resultを検証
        する。
    -   完了時には4.1と4.2の全testが通り、固着した一要求が別の動画情報要求、録画、予約、API操作を停止しない。
    -   _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_
    -   _Boundary: 動画情報確認_

-   [x] 5. 録画済み番組と個別録画ファイルの削除を安全な確定効果へ収束させる
-   [x] 5.1 存在、保護、録画中、および最後の個別ファイル判定を characterization する

    -   番組または個別ファイルの対象なしと、保護中の利用者削除拒否を `unittest/spec` で固定する。
    -   録画中の個別ファイル削除が番組全体削除になり、録画終了済みでは実ファイルと登録情報だけを削除する既存分岐を
        `unittest/imp` で検証する。
    -   個別削除後に0件なら番組全体を削除し、1件以上なら番組を保持することを確認する。
    -   完了時には、存在・保護・録画中・残件数の組合せごとに、削除または拒否される対象IDが一意に観測でき、production
        codeの差分がない。
    -   _Requirements: 5.4, 5.5, 8.1, 8.2, 8.6, 8.7, 8.8_
    -   _Boundary: 録画済み番組・個別録画ファイル削除_

-   [x] 5.2 削除前提、exact効果、および確定通知を RED から GREEN まで閉じる

    -   録画中の削除では、本機能がエンコード取消・録画停止の全体順序を開始せず、前提処理済みの要求だけを削除本体へ渡す
        `unittest/spec` を追加する。
    -   番組全体、個別file、容量不足削除のprepareが副作用なしのtyped resultとopaque tokenを返し、同じtokenの同時・後続使
        用、別provider・別種類・再起動前tokenをfile・DB・event効果前に拒否するtarget testを追加する。
    -   同じrecorded IDへのfinal operationを直列化し、lock内最終再読取で対象なし、保護化、録画状態・reserve ID・relation
        数・保存先所属の変化を検出した場合は、準備時snapshotを削除集合へ再利用しないことを検証する。
    -   録画ファイル、サムネイル、ドロップログごとに管理保存先内包と途中componentの非linkを確認し、root外またはlink先を
        削除しない反例を追加する。
    -   同じ対象IDの存在・保護状態と関連resource集合から削除対象を確定し、個別実ファイル失敗後も続行可能なDB効果を試みる
        ことを故障注入する。
    -   DB削除が確定しない場合に成功通知を出さず、実際に確定した削除だけを通知するtarget testを追加する。
    -   testが現行の録画停止順序、token・lock不在、path結合、および部分DB失敗後の成功扱いとの差を示して先に失敗すること
        を確認する。
    -   完了時には、委譲、token、lock内再読取、path境界、DB失敗の各反例testが意図した現行差を再現し、production codeはま
        だ変更されていない。
    -   資源種別ごとの管理rootと相対pathを正規化し、rootから親までのlink非経由を効果直前に確認する。
    -   最終entryがsymbolic linkならlink先でなくlink自体だけを削除し、root外または途中link経由では実ファイルへ作用しな
        い。
    -   録画ファイル、サムネイル登録情報、ドロップログ、番組情報の確定効果を対象IDへ結び付け（タグ関連は番組情報の削除に伴いDB側で解除される）、DB失敗を成功へ潰
        さない。
    -   `unittest/imp` で実ファイル削除失敗後の続行、DB失敗、root外、途中link、最終linkを検証する。
    -   録画ファイルのrootは親directory名から`VideoUtil.getParentDirPath`で解決し、一時録画先（名前`tmp`）に残ったfileも削除
        対象にする。整理（`videoFileCleanup()`）が使う旧`delete()`/`deleteVideoFile()`の実ファイル削除も同じ管理削除を通し、
        root外・途中link経由のpathと一時録画先のfileを`unittest/imp`で検証する。
    -   先頭が`/`（Windowsでは`\`も）の登録pathは、区切りを取り除いてからroot相対として解釈し、全体削除・個別削除・容量不足
        削除・整理のどの経路でもroot内の実ファイルを削除する。区切りを取り除いた後に`..`でroot外へ出るpathと途中linkは削除
        しないことを、`integration`の実file system（`recorded-content-filesystem.integration.test.ts`）とplatform別の区切りの
        `unittest/imp`で検証する。
    -   Linuxでは親directoryのfile descriptorを経由して削除し、Linux以外（macOS・Windows）ではrootと親の`realpath`と各段
        の`lstat`を削除の直前に確認してからpathを指定して削除する。platformを差し替えられる形の
        `unittest/imp`で、darwin・win32の削除の成功と、保存先外・`..`・symbolic linkの拒否、およびLinuxの経路が変わらない
        ことを検証する（design 7.4）。
    -   完了時には5.2のpath・確定効果testが通り、対象外実ファイルと別番組の登録情報が不変になる。
    -   _Requirements: 1.5, 5.4, 5.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10_
    -   _Boundary: 録画済み番組・個別録画ファイル削除_

-   [x] 5.3 prepared deletion token registryを RED から GREEN まで閉じる

    -   一回消費、同時再利用、replay、stale、種類違い、失敗後再利用、および未使用token回収のtarget testを先に追加し、
        token registry未実装だけが意図した理由でREDになることを確認する。
    -   `src/model/operator/recorded/PreparedDeletionTokenRegistry.ts`を作成し、provider種類ごとのactive tokenを
        `WeakMap`相当、消費済みtokenを`WeakSet`相当でinstance内だけに保持する。
    -   final operation入口でactive entryを同期的に除いて消費済みへ移してから最初の`await`へ進み、同時または後続再利用は
        `token-replayed`、別instance・別種類・再起動前・不明tokenは`token-stale`として効果前に拒否する。
    -   success、typed result、同期throw、rejectionでもtokenをactiveへ戻さず、未使用tokenは参照破棄後に回収可能とする。
        永続一覧、期限timer、定期GC、checkpoint、retryを追加しない。
    -   `unittest/imp`で一回消費、同時再利用、replay、stale、種類違い、失敗後再利用、未使用token回収可能性を検証する。
    -   実装後に同じtarget testを再実行してGREENを確認する。
    -   完了時には一つのtokenから効果実行へ進む呼出しが最大一件になる。
    -   _Requirements: 5.4, 5.5, 8.1, 8.2, 8.6, 8.7, 8.8_
    -   _Boundary: prepared deletion token lifecycle_
    -   _Depends: 5.2_

-   [x] 5.4 recorded ID resource mutation lockを RED から GREEN まで閉じる

    -   同一ID直列化、異なるID並行、先行失敗、同期throw、rejection、および最終解放のtarget testを先に追加し、mutation
        lock未実装だけが意図した理由でREDになることを確認する。
    -   `src/model/operator/recorded/RecordedResourceMutationLock.ts`を作成し、同じrecorded IDの最終再読取とmutationだけ
        をFIFOで直列化し、異なるIDは互いに待たせない。
    -   success、typed result、同期throw、rejectionの全経路でlockを一回解放し、token registryをlock代わりにせず、待機列
        が空になったIDのentryを回収する。
    -   `unittest/imp`で同一ID直列化、異なるID並行、取得待ち中の先行失敗、同期throw、rejection、最終解放を検証する。
    -   実装後に同じtarget testを再実行してGREENを確認する。
    -   完了時には同一ID raceが決定的な順序で再現され、全終了経路で次要求が進み、使用後entryが残らない。
    -   _Requirements: 8.1, 8.2, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9_
    -   _Boundary: recorded ID resource mutation lock_
    -   _Depends: 5.2_

-   [x] 5.5 番組全体のprepared deletion providerを RED から GREEN まで閉じる

    -   prepareの副作用0、lock内再読取、state変化拒否、およびexact-ID planのtarget testを先に追加し、番組全体provider未
        実装だけが意図した理由でREDになることを確認する。
    -   `src/model/operator/recorded/IPreparedRecordedDeletionProvider.ts`を作成し、
        `src/model/operator/recorded/RecordedManageModel.ts`へ副作用なしの`prepareUserDeletion()`とone-shot
        `deletePrepared()`を実装する。
    -   prepareは対象なし・保護中・preparedをtyped resultで返し、preparedには録画状態とreserve IDだけを渡してrelation
        ID、path、entity、lock handleを公開しない。
    -   final operationはTask 5.3のtokenを消費してTask 5.4のlock内で存在、保護、録画状態、reserve ID、全relationを再読取
        し、state変化時は効果0で拒否し、適格時だけ最終exact-ID planをTask 5.2へ渡す。
    -   実装後に同じtarget testを再実行してGREENを確認する。
    -   完了時にはprepare単独のfile・DB・event・停止・取消効果が0件になる。
    -   _Requirements: 5.4, 8.1, 8.2, 8.3, 8.4, 8.5, 8.9, 8.10_
    -   _Boundary: 利用者の番組全体prepared deletion provider_
    -   _Depends: 5.2, 5.3, 5.4_

-   [x] 5.6 個別録画fileのprepared deletion providerを RED から GREEN まで閉じる

    -   個別file race、whole decision、final再読取、および対象拡張禁止のtarget testを先に追加し、個別file provider未実装
        だけが意図した理由でREDになることを確認する。
    -   `src/model/operator/recorded/IPreparedVideoFileDeletionProvider.ts`を作成し、対象なし・保護中・prepared・
        `WholeRecordedDeletionRequired`を副作用なしで判定する。
    -   録画中または最後の一件なら個別効果0でwhole decisionを返す。直接削除はTask 5.3のtoken消費とTask 5.4のlock内で対象
        file、親、保護、録画状態、全video relationを再読取し、適格時のexact videoFile IDだけをTask 5.2へ渡す。
    -   final再読取で録画中または最後の一件へ変わった場合は部分削除せずwhole decisionを返し、呼出元に新しい番組全体
        prepareを要求する。古い個別tokenや親snapshotを再利用しない。
    -   実装後に同じtarget testを再実行してGREENを確認する。
    -   完了時には別fileまたは番組全体へ削除対象を暗黙に拡張しない。
    -   _Requirements: 5.5, 8.1, 8.2, 8.6, 8.7, 8.8, 8.9, 8.10_
    -   _Boundary: 利用者の個別file prepared deletion provider_
    -   _Depends: 5.2, 5.3, 5.4_

-   [x] 5.7 容量不足削除providerを RED から GREEN まで閉じる

    -   保存先所属、録画状態race、typed拒否、およびbusy・unknown時の効果0をtarget testへ先に追加し、容量不足削除provider
        未実装だけが意図した理由でREDになることを確認する。
    -   `src/model/operator/recorded/IRecordedStorageDeletionProvider.ts`を作成し、対象なし、保護中、録画中、relationな
        し、保存先不一致を理由付き`not-deleted`、適格時をopaque tokenとして副作用なしで返す。
    -   final operationはTask 5.3のtokenを消費し、Task 5.4のlock内で存在、保護、録画状態、全video relation、保存先所属を
        再読取する。変化時は実file・DB・event効果0の`not-deleted`、適格時だけTask 5.2のexact-ID削除を実行する。
    -   録画・encode・配信use gate、候補選択、容量再計測、最大60秒terminal barrierは実装せず、
        `server-application-runtime`と`server-storage-management`がcompositionできるdomain providerだけを完成させる。
    -   実装後に同じtarget testを再実行してGREENを確認する。
    -   完了時にはbusy・unknown時に削除を開始しないprovider契約を境界testから利用できる。
    -   _Requirements: 8.1, 8.2, 8.4, 8.5, 8.9, 8.10_
    -   _Boundary: 容量不足用prepared deletion provider_
    -   _Depends: 5.2, 5.3, 5.4_

-   [x] 5.8 機能間連携から委譲された削除と状態変化通知を結合する

    -   前提処理済みの録画中番組削除を受け、本機能内で新たな取消・停止順序を開始せず、確定済み対象へ削除本体だけを適用す
        る。
    -   番組全体削除、個別ファイル削除、および最後の個別ファイル削除で、確定効果に対応する通知を一度だけ出す
        `integration` testを追加する。
    -   前提処理失敗、保護再確認、DB失敗、および通知先失敗を故障注入し、未確定削除を成功通知しないことを確認する。
    -   跨域のエンコード取消・録画停止・削除順は本taskで再実装せず、`server-workflow-coordination`の結合taskへ受渡し可能
        なdomain契約だけを完成させる。
    -   番組全体・個別file・容量不足の各providerについて、prepared token、recorded ID lock内最終再読取、exact-ID効果、
        typed拒否、one-shot消費、およびlock解放をtemporary DB・filesystemへ結合する。
    -   完了時には、前提処理済み要求だけが削除へ進み、各確定効果と通知が一対一に観測され、token・lock・file・DB resource
        が全終了経路で回収される。
    -   _Requirements: 1.5, 5.4, 5.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10_
    -   _Boundary: 削除統合・状態変化通知_
    -   _Depends: 5.1, 5.5, 5.6, 5.7_

-   [x] 6. 録画ファイルとドロップログの明示的整理を独立・有限・安全にする
-   [x] 6.1 DB登録と実ファイルの既存照合効果を characterization する

    -   録画ファイルのDBのみ、実ファイルのみ、両方あり、および管理対象を含まない空ディレクトリを `unittest/spec` で固定
        する。
    -   ドロップログのDBのみ、実ファイルのみ、両方ありで、関係解除、登録削除、未登録実ファイル削除を `unittest/imp` で検
        証する。
    -   対象集合構築後の個別削除・更新失敗が、処理可能な他対象を妨げない既存範囲を故障注入する。
    -   dot entryを列挙対象外にすることと、管理保存先rootの列挙失敗を対象種類の失敗にすることを確認する。
    -   完了時には、二種類それぞれのsyntheticなDB・filesystem組合せから、承認済みの削除・保持結果が観測できる。
    -   _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.15, 9.16_
    -   _Boundary: 録画ファイル整理・ドロップログ整理_

-   [x] 6.2 link非追従、root内包、および列挙失敗分離を RED から GREEN まで閉じる

    -   root内からroot外を指すfile link、directory link、broken linkを辿らず、未登録ならlink自体だけを削除する
        `unittest/spec` を追加する。
    -   正規化後にroot外となるentryを再帰・削除せず、dotfileとdot-directoryを対象外とする反例を追加する。
    -   root列挙失敗は対象種類を失敗にし、個別subdirectoryの列挙失敗・同期的種類確認失敗は記録して他対象を続け、owning要
        求を未settledにしないことを検証する。
    -   testが現行のlink追従、subdirectory失敗の黙殺、およびcallback内同期例外の未settledとの差を示して先に失敗すること
        を確認する。
    -   完了時には、link先とroot外markerへ作用しないこと、各列挙失敗の要求結果を再現できる。
    -   entry種類をlink非追従で確認し、symbolic linkを一件のentryとして扱い、link先へ再帰しない列挙を実装する。
    -   各entryの正規化pathとroot内包を確認し、dot entryを除外して、空ディレクトリを深い順に処理する。
    -   root失敗と個別subdirectory失敗を分離し、個別失敗は許可済み情報で記録して他対象を続け、callback・同期例外を要求の
        成功または失敗へ必ず接続する。
    -   `unittest/imp` でfile・directory・broken link、root外link、dot entry、root/subdirectory失敗を検証する。
    -   完了時には6.2の全testが通り、link先、root外、およびdot entryがbyte単位で不変になる。
    -   _Requirements: 9.3, 9.4, 9.7, 9.8, 9.12, 9.13, 9.14, 9.15, 9.16, 9.17_
    -   _Boundary: 管理保存先の安全な列挙_

-   [x] 6.3 種類別single-flight、10分caller期限、および変更通知を RED から GREEN まで閉じる

    -   録画ファイル整理とドロップログ整理を同時に開始し、一方の成功・失敗・期限超過を他方の結果として共有しない
        `unittest/spec` を追加する。
    -   同種整理中の新規要求を先行要求へ合流させず進行中エラーとし、異種整理と通常の録画済み番組操作を受け付けることを検
        証する。
    -   callerが10分で期限超過しても処理中状態を維持し、先行本体の後着成功・失敗でだけ同種を再受付するfake timer testを
        追加する。
    -   ドロップログ整理で関係または登録を変更した場合も、確定した変更を関係機能へ一度通知する旧欠落のtarget testを追加
        する。
    -   testが現行の逐次開始、無期限caller待ち、同種重複実行、およびdrop-log変更通知欠落との差を示して先に失敗することを
        確認する。
    -   完了時には、二種類の独立状態、caller期限、drop-log変更通知のtarget testが意図した理由で失敗し、production codeは
        まだ変更されていない。
    -   録画ファイル整理用とドロップログ整理用の独立したprocess-local状態を持ち、開始時に同種重複だけを原子的に拒否す
        る。
    -   処理本体の成功・失敗を確定する `finally` だけで状態を解除し、callerの10分期限超過では本体も状態も解除しない。
    -   一つの公開要求から二種類の整理を同時に開始し、各結果を独立して既存エラー応答経路へ返す最小adapter変更を行う。
    -   DBの関係・登録削除が確定した整理では対応する変更通知を行い、失敗または変更なしでは成功変更を捏造しない。
    -   `unittest/imp` で同種拒否、異種同時実行、caller期限、後着settlement、通常操作継続を検証する。
    -   完了時には同じ6.3の全target testが通り、一件の固着した整理が同種新規整理以外の機能を停止しない。
    -   _Requirements: 1.5, 9.9, 9.10, 9.11_
    -   _Boundary: 種類別整理実行状態・録画済み操作adapter_

-   [x] 6.4 二種類の整理効果とfailure isolationを結合検証する

    -   DBのみ、実ファイルのみ、空directory、link、dot entry、root/subdirectory失敗を含むsynthetic保存先で二種類の整理を
        同時実行する `integration` testを追加する。
    -   対象集合構築後の一件失敗後も、列挙済みの他対象が処理され、実際に確定した関係・登録変更だけが通知されることを検証
        する。
    -   caller期限後に本体を制御可能に完了・失敗させ、処理中状態の解除と同種再受付が本体settlementに従うことを確認する。
    -   サムネイル生成queue、容量不足候補選択、HTTP upload受信、および跨域削除順を本taskへ持ち込まない。
    -   完了時には、二種類の結果、状態、削除効果、通知が互いに混ざらず、対象外fixtureが不変になる。
    -   _Requirements: 1.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 9.13, 9.14, 9.15, 9.16, 9.17_
    -   _Boundary: 録画ファイル整理・ドロップログ整理統合_
    -   _Depends: 6.1, 6.2, 6.3_

-   [x] 7. 録画済み番組管理固有testを共有server品質gateへ接続する
-   [x] 7.1 正式な機能固有の仕様case一覧を作り`unittest/spec`を完成させる

    -   Design 9.3のRC-1.1からRC-9.17と、`record-domain.spec.test.ts`、`query.spec.test.ts`、
        `upload.spec.test.ts`、`metadata.spec.test.ts`、`probe.spec.test.ts`、`delete.spec.test.ts`、
        `cleanup.spec.test.ts`、`playback-source.spec.test.ts`の一意なnamed caseを一対一に対応付ける。
    -   Requirements 1から9の全74 ACについて、保存・検索、録画結果、手動作成・upload、タグ・保護・履歴、動画情報、削除、
        録画file・drop log整理の入力、結果、DB・file副作用、通知、失敗を`unittest/spec`で検証し、欠落・重複を0件にする。
    -   synthetic payload、temporary root、制御可能childだけを使い、実番組名、実保存先、実URL、未加工child出力をtest名、
        fixture、snapshot、失敗出力へ含めない。Requirement 10の5 ACはsuiteを自己検証するcaseへ混入させず、Task 7.2から
        7.5の確認項目で追跡する。
    -   完了時には、全79 ACのうちRequirements 1から9の74件を成功したnamed caseへ逆引きでき、未割当、根拠のないskip、およ
        び補足caseの正式一覧への混入が0件である。
    -   _Depends: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 3.1, 4.2, 5.8, 6.4_
    -   _Requirements: 10.1_

-   [x] 7.2 値域・所有権・path・process・削除・整理分岐を`unittest/imp`で完成させる

    -   `record-domain.test.ts`、`upload.test.ts`、`metadata.test.ts`、`playback-source.test.ts`、`probe.test.ts`、
        `delete.test.ts`、`cleanup.test.ts`へ0件・1件・複数件・対象なし、`null`・空・0・1・最小・最大・範囲外・不正型・重複、および手動作
        成の不正時刻範囲をDesign 9.2・9.3どおり割り当てる。仕様に上限のない値へ新しい最大・範囲外規則を追加しない。
    -   uploadの同名・複数・同時衝突、raw adoption renameとunlink race、保存root外・途中link、owner段階別の一回cleanup、
        DB/file commit pointを検証する。incomingからadoptedへのrenameを所有権移転とし、IPC応答を移転条件にせず、既存・別
        要求・現在ownerでないfileを整理対象にしない承認済み契約を維持する。
    -   動画情報processの起動失敗・非正常終了・不正JSON、30秒直前・到達・超過、強制停止、追加3秒、late outputと単一
        settlementを検証する。削除では対象なし・保護・録画中・最後の一件、prepared token、lock内最終再読取、exact-ID
        effectを、整理ではlink非追従、root/subdirectory失敗、同種single-flight、異種同時実行、caller期限後のlate
        settlement、dot entryの整理対象外を検証する。
    -   workflow所有の取消・停止順、upload HTTP受信制限、容量削除のRuntime use gate、公開・IPC schemaへ新しい安全fieldや
        retry・rollback・永続jobを追加せず、M1からM8の各branchをassertionまたは最小equivalent除外へ対応付ける。
    -   完了時には、`IMP-CASES-10.2`の具体caseが全件成功し、値域、衝突、path、process、削除、整理の未分類branchが0件であ
        る。
    -   _Depends: 3.1, 4.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.2, 6.3, 7.1_
    -   _Requirements: 10.2_

-   [x] 7.3 状態・失敗・race・資源・非適用matrixを全79 ACで完成させる

    -   Design 9.3の79行を、DB未登録・登録済み・更新済み、0件・1件・複数件・対象なし、録画中・終了済み・保護中、upload
        incoming・adopted・destination・DB登録済み、整理idle・running・success・failure・caller timeout・late
        settlement、process未開始・running・success・failure・timeoutへ割り当てる。
    -   副作用順、同名・同時衝突、期限直前・到達・超過、応答消失、late settlement、重複通知を分類し、cancelは全79行で契
        約を持たない`CAN-NA`、再入とrestartはDesignの`RE-AP`・`RST-AP`該当case以外を理由付き非適用とする。期限後cleanup
        のprocess強制停止をcaller cancelへ読み替えない。
    -   DB transaction・relation、incoming・adopted・destination、録画file・directory・symbolic link、timer、
        listener、child process、prepared token、recorded ID mutation lockを取得からterminal結果まで追跡する。upload、利
        用者削除、容量不足削除のowner移転・one-shot token・exact resource・lock解放契約をDesignから変更しない。
    -   HTTP request streamは公開carrier側、IPC message listenerはprocess messaging側の資源として境界integrationで解放を
        観測し、本機能がcarrier、共有runner、global gateを所有する記載へ変えない。
    -   完了時には、Designの`MATRIX-10.3`の79行で契約、種別、入力、状態、時間・race、資源、外部境界、failure、期待結果に
        欠落・重複・未分類・N/A理由欠落が0件である。
    -   _Depends: 7.1, 7.2_
    -   _Requirements: 10.3_

-   [x] 7.4 DB・HTTP・IPC・filesystem・process境界を結合検証する

    -   `recorded-content-db.integration.test.ts`で番組、file、drop、thumbnail、tag relation、履歴のround tripとupload・
        削除・整理のcommit pointをtemporary DBへ接続し、transaction失敗、row残存、DB closeを観測する。
    -   `recorded-content-http.integration.test.ts`はWeb・API提供機能のharnessから一覧・詳細・作成・upload・tag・保護・
        削除・整理をdomain portへ接続し、validation・domain失敗status、request stream中断、listener解放を検証する。
        route、HTTP carrier、upload受信中の制限を本機能へ複製しない。
    -   `recorded-content-ipc.integration.test.ts`はprocess messagingのharnessから録画結果、file、upload、保護、削除、整
        理のserialization・応答・期限を接続する。adoption後のACK消失・child再起動でもparent処理を継続し、caller timeout
        をfile所有権の巻戻し、本体取消、running解除へ読み替えない。
    -   `recorded-content-filesystem.integration.test.ts`でraw adoption、unlink race、move・copy fallback、排他的別名、
        削除・列挙・symbolic link・stale adopted整理をtemporary treeへ接続し、現在ownerだけの一回cleanup、root外・link
        先・既存・別要求file不変、tree回収を検証する。
    -   `recorded-content-process.integration.test.ts`で正常JSON、起動失敗、非正常終了、不正JSON、期限、強制停止、追加3
        秒、late outputをisolated childへ接続し、stream、timer、listener、child参照を一回だけ解放する。
    -   DB、HTTP、IPC、temporary filesystem、isolated child processはすべて本機能へ適用する。外部製品processの起動・監
        督、Mirakurun等のnetwork transport、永続test filesystemは非適用とし、各carrierまたは共有runnerの未実行を本機能
        integrationのPASSへ代替しない。
    -   完了時には、`INT-CASES-10.4`の5境界caseが成功し、失敗後のDB・request stream・file・timer・listener・child
        process未解放が0件である。
    -   _Depends: 3.1, 4.2, 5.8, 6.4, 7.3_
    -   _Requirements: 10.4_

-   [x] 7.5 本機能の品質判定を満たす

    -   Task 7.1から7.4の機能固有の単体test（`unittest/spec`・`unittest/imp`）と`integration`を、`server-application-runtime`が
        所有する共有commandで全件成功させる。本specではcommand・config・thresholdを追加しない。
    -   本機能が主に所有するsourceに、単体testだけでのC0・C1の未到達が残る場合は、`server-application-runtime`のMajor 12の単体testで
        解消されていることを確かめる。判定は、同specの`Requirement 9 Acceptance Criterion 9`に従う。
    -   完了時には、本機能の単体testと結合testが全件成功し、server全体の判定（`server-application-runtime` Requirement 9
        Acceptance Criterion 9）に本機能のsourceの未到達が残らない。
    -   _Depends: 7.1, 7.2, 7.3, 7.4_
    -   _Requirements: 10.5_

## Leaf実行契約

| Leaf | Concrete target                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Test type                                          | Local Depends                                                                         | Verification command                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `test/server/recorded-content/record-domain.spec.test.ts`<br>`test/server/recorded-content/record-domain.test.ts`<br>`test/server/recorded-content/recorded-content-baseline.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `unittest/spec`<br>`unittest/imp`<br>`integration` | なし（共有foundationのみ）                                                            | `npm run test:server:spec -- test/server/recorded-content/record-domain.spec.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/record-domain.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/recorded-content-baseline.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                     |
| 1.2  | `test/server/recorded-content/query.spec.test.ts`<br>`test/server/recorded-content/record-domain.test.ts`<br>`test/server/recorded-content/recorded-content-baseline.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `unittest/spec`<br>`unittest/imp`<br>`integration` | なし（共有foundationのみ）                                                            | `npm run test:server:spec -- test/server/recorded-content/query.spec.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/record-domain.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/recorded-content-baseline.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                             |
| 1.3  | `test/server/recorded-content/record-domain.spec.test.ts`<br>`test/server/recorded-content/record-domain.test.ts`<br>`test/server/recorded-content/recorded-content-baseline.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `unittest/spec`<br>`unittest/imp`<br>`integration` | なし（共有foundationのみ）                                                            | `npm run test:server:spec -- test/server/recorded-content/record-domain.spec.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/record-domain.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/recorded-content-baseline.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2.1  | `test/server/recorded-content/upload.spec.test.ts`<br>`test/server/recorded-content/upload.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                                            | `npm run test:server:spec -- test/server/recorded-content/upload.spec.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/upload.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2.2  | `test/server/recorded-content/metadata.spec.test.ts`<br>`test/server/recorded-content/metadata.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                                            | `npm run test:server:spec -- test/server/recorded-content/metadata.spec.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/metadata.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2.3  | `src/model/db/RecordedHistoryDB.ts`<br>`test/server/recorded-content/metadata.spec.test.ts`<br>`test/server/recorded-content/metadata.test.ts`<br>`test/server/recorded-content/recorded-content-baseline.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `unittest/spec`<br>`unittest/imp`<br>`integration` | なし（共有foundationのみ）                                                            | `npm run test:server:spec -- test/server/recorded-content/metadata.spec.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/metadata.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/recorded-content-baseline.integration.test.ts`                                                                                                                                                                                                                                                                                                                 |
| 2.4  | `src/model/operator/recorded/{IRecordedPlaybackSourceProvider,RecordedPlaybackSourceProvider}.ts`<br>`test/server/recorded-content/{playback-source.spec.test.ts,playback-source.test.ts,recorded-playback-source.integration.test.ts}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `unittest/spec`<br>`unittest/imp`<br>`integration` | `2.3, 4.2`                                                                            | `npm run test:server:spec -- test/server/recorded-content/playback-source.spec.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/playback-source.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/recorded-playback-source.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                  |
| 3.1  | `src/model/operator/recorded/RecordedUploadAdoptionModel.ts`<br>`src/model/operator/recorded/RecordedManageModel.ts`<br>`src/model/ipc/IPCServer.ts`<br>`test/server/recorded-content/upload.spec.test.ts`<br>`test/server/recorded-content/upload.test.ts`<br>`test/server/recorded-content/recorded-content-ipc.integration.test.ts`<br>`test/server/recorded-content/recorded-content-filesystem.integration.test.ts`<br>`test/server/recorded-content/path-based-file-operations.imp.test.ts`<br>`test/server/recorded-content/upload-default-filesystem.imp.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                      | `unittest/spec`<br>`unittest/imp`<br>`integration` | なし（共有foundationのみ）                                                            | `npm run test:server:spec -- test/server/recorded-content/upload.spec.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/upload.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/recorded-content-ipc.integration.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/recorded-content-filesystem.integration.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/path-based-file-operations.imp.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/upload-default-filesystem.imp.test.ts` |
| 4.1  | `test/server/recorded-content/probe.spec.test.ts`<br>`test/server/recorded-content/probe.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                                            | `npm run test:server:spec -- test/server/recorded-content/probe.spec.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/probe.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 4.2  | `src/model/api/video/VideoUtil.ts`<br>`test/server/recorded-content/probe.spec.test.ts`<br>`test/server/recorded-content/probe.test.ts`<br>`test/server/recorded-content/recorded-content-process.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `unittest/spec`<br>`unittest/imp`<br>`integration` | なし（共有foundationのみ）                                                            | `npm run test:server:spec -- test/server/recorded-content/probe.spec.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/probe.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/recorded-content-process.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 5.1  | `test/server/recorded-content/delete.spec.test.ts`<br>`test/server/recorded-content/delete.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                                            | `npm run test:server:spec -- test/server/recorded-content/delete.spec.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/delete.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 5.2  | `src/model/operator/recorded/RecordedManageModel.ts`<br>`test/server/recorded-content/delete.spec.test.ts`<br>`test/server/recorded-content/delete.test.ts`<br>`test/server/recorded-content/path-based-file-operations.imp.test.ts`<br>`test/server/recorded-content/legacy-delete-cascade.imp.test.ts`<br>`test/server/recorded-content/cleanup.spec.test.ts`<br>`test/server/recorded-content/recorded-content-filesystem.integration.test.ts` | `unittest/spec`<br>`unittest/imp`<br>`integration` | なし（共有foundationのみ）                                                            | `npm run test:server:spec -- test/server/recorded-content/delete.spec.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/delete.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/path-based-file-operations.imp.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/legacy-delete-cascade.imp.test.ts`<br>`npm run test:server:spec -- test/server/recorded-content/cleanup.spec.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/recorded-content-filesystem.integration.test.ts` |
| 5.3  | `src/model/operator/recorded/PreparedDeletionTokenRegistry.ts`<br>`test/server/recorded-content/delete.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `unittest/imp`                                     | `5.2`                                                                                 | `npm run test:server:imp -- test/server/recorded-content/delete.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 5.4  | `src/model/operator/recorded/RecordedResourceMutationLock.ts`<br>`test/server/recorded-content/delete.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `unittest/imp`                                     | `5.2`                                                                                 | `npm run test:server:imp -- test/server/recorded-content/delete.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 5.5  | `src/model/operator/recorded/IPreparedRecordedDeletionProvider.ts`<br>`src/model/operator/recorded/RecordedManageModel.ts`<br>`test/server/recorded-content/delete.spec.test.ts`<br>`test/server/recorded-content/delete.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `unittest/spec`<br>`unittest/imp`                  | `5.2, 5.3, 5.4`                                                                       | `npm run test:server:spec -- test/server/recorded-content/delete.spec.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/delete.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 5.6  | `src/model/operator/recorded/IPreparedVideoFileDeletionProvider.ts`<br>`src/model/operator/recorded/RecordedManageModel.ts`<br>`test/server/recorded-content/delete.spec.test.ts`<br>`test/server/recorded-content/delete.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `unittest/spec`<br>`unittest/imp`                  | `5.2, 5.3, 5.4`                                                                       | `npm run test:server:spec -- test/server/recorded-content/delete.spec.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/delete.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 5.7  | `src/model/operator/recorded/IRecordedStorageDeletionProvider.ts`<br>`src/model/operator/recorded/RecordedManageModel.ts`<br>`test/server/recorded-content/delete.spec.test.ts`<br>`test/server/recorded-content/delete.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `unittest/spec`<br>`unittest/imp`                  | `5.2, 5.3, 5.4`                                                                       | `npm run test:server:spec -- test/server/recorded-content/delete.spec.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/delete.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 5.8  | `test/server/recorded-content/delete.spec.test.ts`<br>`test/server/recorded-content/delete.integration.test.ts`<br>`test/server/recorded-content/recorded-content-ipc.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `unittest/spec`<br>`integration`                   | `5.1, 5.5, 5.6, 5.7`                                                                  | `npm run test:server:spec -- test/server/recorded-content/delete.spec.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/delete.integration.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/recorded-content-ipc.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                    |
| 6.1  | `test/server/recorded-content/cleanup.spec.test.ts`<br>`test/server/recorded-content/cleanup.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                                            | `npm run test:server:spec -- test/server/recorded-content/cleanup.spec.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/cleanup.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 6.2  | `src/util/FileUtil.ts`<br>`test/server/recorded-content/cleanup.spec.test.ts`<br>`test/server/recorded-content/cleanup.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                                            | `npm run test:server:spec -- test/server/recorded-content/cleanup.spec.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/cleanup.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 6.3  | `src/model/api/recorded/RecordedApiModel.ts`<br>`src/model/db/DropLogFileDB.ts`<br>`src/model/db/IDropLogFileDB.ts`<br>`src/model/db/IRecordedDB.ts`<br>`src/model/db/RecordedDB.ts`<br>`src/model/event/EventSetter.ts`<br>`src/model/event/IRecordedEvent.ts`<br>`src/model/event/RecordedEvent.ts`<br>`src/model/operator/recorded/RecordedManageModel.ts`<br>`test/server/event-and-hook-delivery/_harness.ts`<br>`test/server/event-and-hook-delivery/event-delivery.spec.test.ts`<br>`test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`<br>`test/server/recorded-content/cleanup.spec.test.ts`<br>`test/server/recorded-content/cleanup.test.ts`<br>`test/server/recorded-content/recorded-content-filesystem.integration.test.ts`<br>`test/server/recorded-content/recorded-content-ipc.integration.test.ts` | `unittest/spec`<br>`unittest/imp`<br>`integration` | なし（共有foundationのみ）                                                            | `npm run test:server:spec -- test/server/event-and-hook-delivery/event-delivery.spec.test.ts`<br>`npm run test:server:spec -- test/server/recorded-content/cleanup.spec.test.ts`<br>`npm run test:server:imp -- test/server/event-and-hook-delivery/imp/event-hook-characteristics.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/cleanup.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/recorded-content-filesystem.integration.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/recorded-content-ipc.integration.test.ts`                                                                                     |
| 6.4  | `test/server/recorded-content/cleanup.spec.test.ts`<br>`test/server/recorded-content/recorded-content-ipc.integration.test.ts`<br>`test/server/recorded-content/recorded-content-filesystem.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `unittest/spec`<br>`integration`                   | `6.1, 6.2, 6.3`                                                                       | `npm run test:server:spec -- test/server/recorded-content/cleanup.spec.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/recorded-content-ipc.integration.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/recorded-content-filesystem.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                              |
| 7.1  | `test/server/recorded-content/record-domain.spec.test.ts`<br>`test/server/recorded-content/query.spec.test.ts`<br>`test/server/recorded-content/upload.spec.test.ts`<br>`test/server/recorded-content/metadata.spec.test.ts`<br>`test/server/recorded-content/playback-source.spec.test.ts`<br>`test/server/recorded-content/probe.spec.test.ts`<br>`test/server/recorded-content/delete.spec.test.ts`<br>`test/server/recorded-content/cleanup.spec.test.ts`                                                                                                                                                                                                                                                                                                                                                                                 | `unittest/spec`                                    | `1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 3.1, 4.2, 5.8, 6.4`                               | `npm run test:server:spec -- test/server/recorded-content/record-domain.spec.test.ts`<br>`npm run test:server:spec -- test/server/recorded-content/query.spec.test.ts`<br>`npm run test:server:spec -- test/server/recorded-content/upload.spec.test.ts`<br>`npm run test:server:spec -- test/server/recorded-content/metadata.spec.test.ts`<br>`npm run test:server:spec -- test/server/recorded-content/playback-source.spec.test.ts`<br>`npm run test:server:spec -- test/server/recorded-content/probe.spec.test.ts`<br>`npm run test:server:spec -- test/server/recorded-content/delete.spec.test.ts`<br>`npm run test:server:spec -- test/server/recorded-content/cleanup.spec.test.ts`   |
| 7.2  | `test/server/recorded-content/record-domain.test.ts`<br>`test/server/recorded-content/upload.test.ts`<br>`test/server/recorded-content/metadata.test.ts`<br>`test/server/recorded-content/playback-source.test.ts`<br>`test/server/recorded-content/probe.test.ts`<br>`test/server/recorded-content/delete.test.ts`<br>`test/server/recorded-content/cleanup.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `unittest/imp`                                     | `2.4, 3.1, 4.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.2, 6.3, 7.1`                               | `npm run test:server:imp -- test/server/recorded-content/record-domain.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/upload.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/metadata.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/playback-source.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/probe.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/delete.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/cleanup.test.ts`                                                                                                                              |
| 7.3  | `test/server/recorded-content/record-domain.spec.test.ts`<br>`test/server/recorded-content/delete.test.ts`<br>`test/server/recorded-content/cleanup.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `unittest/spec`<br>`unittest/imp`                  | `7.1, 7.2`                                                                            | `npm run test:server:spec -- test/server/recorded-content/record-domain.spec.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/delete.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/cleanup.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 7.4  | `test/server/recorded-content/recorded-content-db.integration.test.ts`<br>`test/server/recorded-content/recorded-content-http.integration.test.ts`<br>`test/server/recorded-content/recorded-content-ipc.integration.test.ts`<br>`test/server/recorded-content/recorded-content-filesystem.integration.test.ts`<br>`test/server/recorded-content/recorded-content-process.integration.test.ts`<br>`test/server/recorded-content/recorded-playback-source.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                 | `integration`                                      | `2.4, 3.1, 4.2, 5.8, 6.4, 7.3`                                                        | `npm run test:server:integration -- test/server/recorded-content/recorded-content-db.integration.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/recorded-content-http.integration.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/recorded-content-ipc.integration.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/recorded-content-filesystem.integration.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/recorded-content-process.integration.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/recorded-playback-source.integration.test.ts` |
| 7.5  | `test/server/recorded-content/record-domain.spec.test.ts`<br>`test/server/recorded-content/record-domain.test.ts`<br>`test/server/recorded-content/recorded-content-db.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `unittest/spec`・`unittest/imp`・`integration` | `2.4, 3.1, 4.2, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4` | `npm run test:server:spec -- test/server/recorded-content/record-domain.spec.test.ts`<br>`npm run test:server:imp -- test/server/recorded-content/record-domain.test.ts`<br>`npm run test:server:integration -- test/server/recorded-content/recorded-content-db.integration.test.ts`                                                                                                                                                                                                                                                                                                                                                                                                           |
