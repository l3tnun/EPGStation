# Implementation Plan

---

> Cross-spec execution prerequisite: 共有server test foundationとNode.js 24/26 matrixは`server-application-runtime`が所
> 有する。該当foundation task group完了後に本specを実行する。本specは共有foundationを重複せず、メディア変換プロセス管理
> 固有のtestと、承認済み差分または未実装契約の最小実装だけを追加する。

-   [x] 1. 共有実行枠の既存契約を仕様テストで固定する
-   [x] 1.1 起動時の上限保持と変換不要時の枠非使用をcharacterizationする

    -   既存実装は変更せず、機能起動時に受け取った同時実行上限を保持し、上限未満では開始を試み、上限0では外部プロセスを
        生成しない挙動を`unittest/spec`で固定する。
    -   稼働中の設定変更を自動反映せず、新しい機能instanceだけが変更後の上限を使うことを`unittest/imp`で検証する。
    -   映像変換を必要としない直接配信が共有実行枠を消費しないことを、合成した配信要求との`integration`で確認する。
    -   完了時には、上限未満、上限0、稼働中変更、再起動相当、および直接配信の各fixtureが既存契約を再現し、production
        codeの差分がない。
    -   _Requirements: 1.3, 1.4, 1.6, 7.1, 7.2, 7.3_
    -   _Boundary: Process Admission・起動時設定_

-   [x] 1.2 優先度、入れ替え候補、および即時拒否をcharacterizationする

    -   既存実装は変更せず、エンコードを高優先度、ライブ・録画再生用変換を低優先度として一つの実行中一覧へ関連付けること
        を`unittest/spec`で固定する。
    -   上限到達時は新しい要求より低い優先度だけを候補とし、該当候補のうち直近登録を選び、同じか高い優先度しかない場合は
        既存処理を維持して拒否することを検証する。
    -   開始要求の待ち行列を作らず、拒否要求を後の空き枠へ自動割当しないことをfake clockで確認する。
    -   完了時には、高低優先度、同優先度、複数候補、候補なし、および後発空き枠の各fixtureで選択対象と開始結果が一意に観
        測できる。
    -   _Requirements: 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 4.6_
    -   _Boundary: Active Process Registry・Process Admission_

-   [x] 1.3 結果非所有、自動再起動なし、および終了境界をcharacterizationする

    -   既存実装は変更せず、拒否した開始要求と終了した処理を本機能が自動再実行・再起動しないことを`unittest/spec`で固定
        する。
    -   本機能がエンコード結果や再生状態を確定せず、開始・停止・枠解放だけを受け持つ境界をconsumerとの`integration`で確
        認する。
    -   新しい機能instanceは起動時に空の実行中一覧を作り、以前のメモリー内一覧を永続化または復元しないことを確認する。
    -   サーバー全体の終了時に全変換処理を停止・回収する専用処理を提供しないことをinterface contract testで確認する。
    -   完了時には、失敗後の空き枠、正常・異常終了、および全体終了の各fixtureで、暗黙の再実行、業務結果確定、専用drain処
        理がいずれも観測されない。
    -   _Requirements: 3.5, 4.4, 4.5, 7.3, 7.4_
    -   _Boundary: 責任境界・終了境界_

-   [x] 2. 同期受付と通常プロセスの一回だけのライフサイクルをTDDで実現する
-   [x] 2.1 同期受付、起動予約、および起動失敗をREDから最小実装・GREENまで一単位で実現する

    -   空き枠判定と一件の開始予約を同じ同期区間で確定し、同じevent loopから複数要求が来ても実行中数と予約数の合計が上限
        を超えない目標を`unittest/spec`で先に定義する。
    -   生成ごとに異なるobject tokenとopaque handleを返し、同じ時刻やPIDでも別の管理対象として扱うことを`unittest/imp`で
        定義する。
    -   同期的な生成失敗、開始通知前のerror、開始前の即時終了では予約を一回だけ解放し、実行中一覧へ残さず要求を失敗させ
        る順序を検証する。
    -   同期受付・handle・起動settlementの未実装だけを理由にtarget testが失敗するREDを確認してからproductionを変更する。
    -   外部I/Oへ進む前に空き枠または入れ替え予約を確保し、後続要求が更新済みの予約状態を観測するようにする。
    -   開始通知、開始前error、および即時終了を同じobject tokenへ関連付け、開始予約を一回だけ実行中枠へ昇格または解放す
        る。
    -   pipe用childと停止用opaque handleを一つの開始結果として返し、内部token、PID、状態を公開APIやIPCへ追加しない。
    -   同じ`unittest/spec`と`unittest/imp` targetを再実行する。
    -   完了時には、既存characterizationとtarget testがGREENになり、並行開始でも共有上限を超えず、起動失敗後に残留予約と
        赤いtestが0件になる。
    -   _Requirements: 1.1, 1.2, 1.3, 1.5, 4.2, 4.3_
    -   _Boundary: Process Admission・Active Process Registry_

-   [x] 2.3 通常終了、通常停止、および一回だけの枠解放をREDから最小実装・GREENまで一単位で実現する

    -   正常終了、終了を確認できる異常終了、および開始後のerrorだけを区別し、error単独では枠を解放しない目標
        を`unittest/spec`で定義する。
    -   終了通知、終了状態確認、および順序の前後した重複通知が競合しても、同じobject tokenの枠だけを一回解放すること
        を`unittest/imp`で定義する。
    -   通常停止はstdioを整理し、500ミリ秒後の`SIGINT`を一回要求した時点で応答し、terminal到着を無期限に待たないことを
        fake timerで検証する。
    -   同じopaque handleへの後続停止要求が一つの停止処理へ参加し、別のsignal送信権を作らないことを確認する。
    -   terminal latch、通常停止、および一回だけの枠解放の未実装だけを理由にtarget testが失敗するREDを確認してから
        productionを変更する。
    -   管理対象を開始中、実行中、停止中、解放済みとして追跡し、通常停止の最初の要求だけが状態遷移とsignal送信処理を所有
        する。
    -   開始後のerrorは診断だけを記録し、終了通知または終了状態を確認したcallbackだけが同じobject tokenの一覧除去と枠解
        放を一回実行する。
    -   通常停止の応答とterminal待機を分離し、後続停止要求を同じ処理へ参加させる。
    -   同じ`unittest/spec`と`unittest/imp` targetを再実行する。
    -   完了時には、既存characterizationと全target経路がGREENになり、遅い通知や同じPIDの別処理が誤って停止・解放されず、
        赤いtestが残らない。
    -   _Requirements: 3.1, 3.6, 4.1, 4.2, 4.3_
    -   _Boundary: Active Process Registry・通常停止_

-   [x] 3. 優先度入れ替えを単一予約としてTDDで実現する
-   [x] 3.1 入れ替え予約と3秒判定をREDから最小実装・GREENまで一単位で実現する

    -   上限到達時に直近の低優先度対象を選ぶ同期区間で、実行中から停止中への遷移、一つの停止処理、および一件の入れ替え予
        約を不可分に作る目標を`unittest/spec`で定義する。
    -   二つの高優先度要求が同じ対象や同じ解放枠を予約せず、同じ優先度または既に停止中の処理を選ばないこと
        を`unittest/imp`で検証する。
    -   論理枠解放が3000ms以下なら予約を持つ一要求だけが開始し、3000ms到達時の同着解放ではownerだけが枠を使って
        competitorを拒否することをfake timerで定義する。3000ms時点でも未解放または3000msより後に解放された場合は新要求を
        失敗させ、後で解放されても自動開始しないことも分けて検証する。
    -   3秒の受付判定後も開始済みの停止処理を取り消さず、明示停止が同じ処理へ参加してsignalを重複送信しないことを確認す
        る。
    -   競合受付、停止処理共有、および予約済み枠の未実装だけを理由にtarget testが失敗するREDを確認してからproductionを変
        更する。
    -   低優先度対象の選択、停止中への遷移、停止処理の登録、および入れ替え予約を一つの同期処理で確定する。
    -   入れ替え要求だけが対象の論理枠解放を最大3000ms待ち、deadline timer到達時は同着解放を再確認してから、期限内の解放
        時だけ自身の予約を一回消費して置き換え先を開始する。成功・失敗の両経路でdeadline timerと確認用immediateを回収す
        る。
    -   期限超過時は新要求の予約だけを解放し、対象の停止処理と停止中状態を維持して、後続の明示停止を同じ処理へ参加させ
        る。
    -   同じ`unittest/spec`、`unittest/imp`、fake timer targetを再実行する。
    -   完了時には、既存characterizationと競合fixtureがすべてGREENになり、各時点の実行中数と予約数の合計が上限以下で、赤
        いtestが残らない。
    -   _Requirements: 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
    -   _Boundary: Replacement Coordinator・Process Admission_

-   [x] 4. HLS writerのprocess group起動をTDDで実現する
-   [x] 4.1 HLS writer起動とopaque handleをREDから最小実装・GREENまで一単位で実現する

    -   Debian/LinuxではHLS writerを新しいprocess groupのleaderとして開始し、通常の子孫が同じgroupを継承できる目標
        を`unittest/spec`で定義する。
    -   direct child、PID、PGID、優先度、object token、および論理実行枠を一つの管理対象へ関連付け、HLS専用opaque handle
        でだけ参照することを`unittest/imp`で検証する。
    -   process groupを確立できない場合は開始要求を失敗させ、開始予約と共有枠を残さないことを確認する。
    -   自らdaemonizeまたは別process groupへ移動した外部コマンドを停止保証へ含めない境界をcontract testで固定する。
    -   HLS group起動と専用handleの未実装だけを理由にtarget testが失敗するREDを確認してからproductionを変更する。
    -   HLS writerだけを新しいprocess groupで開始し、direct childと保存済みPID/PGIDを同じobject tokenへ結び付ける。
    -   pipe用childとHLS停止用opaque handleを返し、consumerがPID、PGID、tokenを解釈または再構成できない境界を保つ。
    -   group開始失敗を通常の開始失敗へ収束させ、予約と共有枠を一回解放する。
    -   同じ`unittest/spec`、`unittest/imp`、合成process adapter targetを再実行する。
    -   完了時には、既存characterizationとtarget testがGREENになり、公開API、IPC、配信識別番号、およびHLS公開pathのshape
        に差分がなく、赤いtestが残らない。
    -   _Requirements: 5.1, 5.2, 5.3, 5.4_
    -   _Boundary: HLS Group Launcher・Active Process Registry_

-   [x] 5. HLS writerの有限停止と強制解放をTDDで実現する
-   [x] 5.1 二段停止と論理解放をREDから最小実装・GREENまで一単位で実現する

    -   保存済みprocess groupへ`SIGINT`を一回送り、1秒間隔で最大3回終了を確認する目標をfake timer付き`unittest/spec`で定
        義する。
    -   残存時だけ`SIGKILL`を一回送り、さらに1秒間隔で最大3回確認し、終了確認時は一覧除去と枠解放を一回だけ行うことを検
        証する。
    -   最後まで残存しても論理枠を強制解放し、PID、PGID、処理種別、送信済みsignal、終了未確認、および強制解放をerrorログ
        へ記録することを確認する。
    -   HLS成果物の削除成否を停止完了や共有枠解放の条件に含めないことをcontract testで固定する。
    -   `SIGINT`終了、`SIGKILL`終了、最後まで残存の三経路が未実装だけを理由に失敗するREDを確認してからproductionを変更す
        る。
    -   一つのHLS停止処理だけが保存済みgroupへのsignal送信権と停止finalizerの実行権を持つようにする。
    -   `SIGINT`と`SIGKILL`の各確認回数・間隔を承認済み値に固定し、終了確認または最後の確認後に一回だけfinalizerへ収束す
        る。
    -   終了未確認でも一覧から対象を除去して枠を強制解放し、必要な診断情報をerrorログへ一回記録する。
    -   同じ`unittest/spec`、`unittest/imp`、fake timer targetを再実行する。
    -   完了時には、既存characterizationと三経路がGREENになり、signal回数、確認回数、および枠解放回数がそれぞれ仕様値と
        一致して赤いtestが残らない。
    -   _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.8_
    -   _Boundary: HLS Stop Coordinator・Active Process Registry_

-   [x] 5.3 停止失敗、冪等性、および遅延通知隔離をREDから最小実装・GREENまで一単位で実現する

    -   解放済み、一覧に存在しない、または別object tokenのhandleへ停止を要求しても、保存済みPID/PGIDへ追加signalを送らず
        停止済み結果を返す目標を`unittest/spec`で定義する。
    -   group存在確認、各signal送信、および確認待機を個別にthrow・rejectさせ、error記録後も一つのfinalizerへ収束して枠を
        強制解放することを`unittest/imp`で検証する。
    -   強制解放後の遅い`exit`、`close`、`error`、確認結果が、別処理の停止・削除や二重解放を起こさないことを確認する。
    -   同じhandleへの並行停止が同じ結果へ参加し、停止終端後は同じPID/PGIDへsignalを追加しないことを検証する。
    -   補助処理失敗、stale handle、遅延通知、および重複停止の未実装だけを理由にtarget testが失敗するREDを確認してから
        productionを変更する。
    -   停止開始時にobject token、direct child、およびPGIDを固定し、開始後にPID/PGIDを再解決しない。
    -   存在確認、signal、待機の失敗を段階付きで記録し、安全に続行できる停止段階を試した後、成功・失敗にかかわらず一回だ
        けfinalizerを実行する。
    -   解放済みlatchとobject identityで停止後の要求・event・timerを無作用にし、別の管理対象へ作用させない。
    -   同じ`unittest/spec`、`unittest/imp`、fake timer targetを再実行する。
    -   完了時には、既存characterizationと全fixtureがGREENになり、各管理対象の停止処理、error記録、および論理枠解放が一
        回だけ観測され、赤いtestが残らない。
    -   _Requirements: 6.6, 6.7, 6.9, 6.10, 6.11_
    -   _Boundary: HLS Stop Coordinator・Active Process Registry_

-   [x] 6. 依頼元をmanaged handle契約へ接続する
-   [x] 6.1 (P) エンコード処理を高優先度のmanaged processへ移行する

    -   エンコード開始がpipe用childと停止用opaque handleを別々に保持し、既存の高優先度を維持する目標`integration` testを
        先に追加する。
    -   consumerがchildへ直接signalを送る現行経路だけを理由にtarget testが失敗するREDを確認してからproductionを変更す
        る。
    -   取消と実行期限による停止を共有process管理へ委譲し、依頼元からchildへ直接signalを送らない最小変更を行う。
    -   エンコードの待機列、job状態、進捗、取消結果、および出力結果の判断は`server-encoding`へ残し、本taskでは再実装しな
        い。
    -   同じtarget `integration` testを再実行する。
    -   完了時には、targetがGREENになり、エンコード開始・取消・終了のfixtureでmanaged handle経由のsignalだけが一回観測さ
        れ、既存の業務結果が維持されて赤いtestが残らない。
    -   _Requirements: 1.1, 1.2, 2.1, 3.1, 4.4, 4.5_
    -   _Boundary: 録画ファイル変換consumer adapter_
    -   _Depends: 2.3, 3.1_

-   [x] 6.2 (P) ライブ・録画配信処理を通常停止とHLS停止へ接続する

    -   変換ありの配信がpipe用childとopaque handleを保持し、変換なしの直接配信は共有枠を使わない目標`integration` testを
        先に追加する。
    -   consumerがchildまたはPID/PGIDへ直接signalを送る現行経路だけを理由にtarget testが失敗するREDを確認してから
        productionを変更する。
    -   通常配信停止は通常のmanaged停止、HLS配信停止はHLS専用停止へ委譲し、依頼元からchildやPID/PGIDへ直接signalを送らな
        い最小変更を行う。
    -   配信識別番号、視聴状態、HLS成果物の削除、および公開playlist pathは`server-media-delivery`へ残し、本taskでは変更
        しない。
    -   同じtarget `integration` testを再実行する。
    -   完了時には、targetがGREENになり、ライブ・録画の直接配信、通常変換、HLS変換の各fixtureで適切な停止契約だけが選ば
        れ、公開URLのshapeが変わらず赤いtestが残らない。
    -   _Requirements: 1.1, 1.2, 1.6, 2.2, 3.1, 4.5, 5.1, 6.8_
    -   _Boundary: 映像配信consumer adapter_
    -   _Depends: 2.3, 4.1, 5.3_

-   [x] 7. 共有実行枠とprocess groupを結合検証する
-   [x] 7.1 競合する開始・停止・終了を決定論的に結合検証する

    -   合成child、fake timer、およびdeferred eventを用い、複数開始、同一対象への入れ替えと明示停止、期限先着、重複
        terminal、および遅延eventを`integration`で交差させる。
    -   すべての順序で実行中数と予約数の合計が上限以下になり、予約を持つ一要求だけが解放枠を使い、各object tokenの枠が一
        回だけ解放されることを確認する。
    -   拒否要求の自動再実行、開始済み停止の取消、別対象へのsignal、エンコード結果または再生状態の確定が起きないことを否
        定検証する。
    -   完了時には、通常processとHLS writerの競合matrixが共通server test commandから再現可能に成功し、未処理rejectionと
        残留timerが0件になる。
    -   _Requirements: 1.1, 1.2, 1.3, 1.5, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.6, 6.6,
        6.7, 6.9, 6.10, 6.11_
    -   _Boundary: Process Admission・Active Process Registry・Replacement Coordinator・HLS Stop Coordinator_
    -   _Depends: 3.1, 5.3, 6.1, 6.2_

-   [x] 7.2 Debian/Linuxの隔離process groupでHLS停止を結合検証する

    -   synthetic executableだけを使い、HLS writerが新しいprocess groupのleaderになり、通常の子孫が同じgroupへ属すること
        を`integration`で確認する。
    -   `SIGINT`で終了、`SIGKILL`で終了、最後まで終了未確認、およびgroup開始失敗を隔離processで再現し、signal列、確認回
        数、error記録、枠解放を検証する。
    -   direct childだけが先に終了して子孫が残る場合は枠とopaque handleを保持し、group不在確認または停止finalizerでだけ
        解放することを確認する。
    -   daemonizeまたは別groupへ移動するsynthetic processは保証外として扱い、追跡外processを誤って停止したという成功判定
        を行わない。
    -   完了時には、Debian/Linux上の隔離process group suiteが成功し、残留する管理対象、子process、timer、および実環境由
        来fixtureが0件になる。
    -   _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11_
    -   _Boundary: HLS Group Launcher・HLS Stop Coordinator・Linux process adapter_
    -   _Depends: 4.1, 5.3, 6.2_

-   [x] 8. 機能固有testと共有server品質判定を接続する
-   [x] 8.1 全43機能ACのinventoryを作り`unittest/spec`を完成させる

    -   `test/server/media-process-management/media-process-management.spec.test.ts`にRequirements 1から7の全43 ACと一意
        の主test ID、補助test、fixture、期待する開始・停止結果、管理枠、process lifecycle、非所有effectを対応付ける。
    -   上限0・上限未満・上限到達、低・同・高優先度、3000ms到達時の入れ替え成功・3000msより後の入れ替え失敗、通常process
        の開始・停止・terminal、HLS groupの開始・二段停止・強制解放・stale handle、および起動時設定保持を外部契約として
        検証する。
    -   Tasks 2.1、2.3、3.1、4.1、5.1、5.3でRED確認から最小実装・同一targetのGREENまで閉じた失敗契約を同suiteへ統合し、
        意図した未実装失敗を残したまま本taskを完了しない。
    -   完了時には、全43 ACを成功した一意の主test IDへ逆引きでき、未割当、同じ主test IDの重複、根拠のないskip、および未
        解消のred caseがいずれも0件である。
    -   _Depends: 1.1, 1.2, 1.3, 2.1, 2.3, 3.1, 4.1, 5.1, 5.3, 6.1, 6.2, 7.1, 7.2_
    -   _Requirements: 8.1_

-   [x] 8.2 値域・分岐・順序・一回だけの副作用を`unittest/imp`で完成させる

    -   `test/server/media-process-management/implementation.test.ts`で上限0・1・未満・到達、空き枠0・1、低・同・高優先
        度、複数候補、複数高優先度要求、同期spawn throw、spawn前後の`error`、spawnと即時terminalを検証する。
    -   `CreateProcessOption.input`と`output`の`null`・空文字・通常値、同じhandleへの重複停止、入れ替え・明示停止・取
        消・期限の競合、各signal、終了確認0回から最大3回、古いPID・PGID・別token、および枠解放一回をcall ledgerでassert
        する。
    -   本機能が受け取る検証済み上限に固有最大値と範囲外契約はないためserver-configuration境界として理由付き非適用にし、
        TypeScript不正型はcompile時検証へ割り当てる。castで存在しないruntime validationを創作しない。
    -   完了時には、Design 7.2の全caseが対応assertionから逆引きでき、値域・branch・回数・対象identityの未分類が0件である。
    -   _Depends: 2.1, 2.3, 3.1, 4.1, 5.1, 5.3, 8.1_
    -   _Requirements: 8.2_

-   [x] 8.3 唯一の機能固有test matrixを48行で維持する

    -   DesignのMatrixでR1.1からR8.5まで48 ACを一行ずつ配置する。各行は`AC/契約`、test種別、入力、状態、時間・順序/race、
        資源、外部境界、failure注入、期待結果の固定9列を持つ。
    -   各ACに一つだけの主test IDを割り当て、同じ主test IDを別ACの主testへ再利用しない。補助testは別欄で追跡し、別matrixへ
        合否判定を分散させない。
    -   開始中・実行中・停止中・解放済み、3000ms未満・3000ms到達時の解放成功・3000ms時点でも未解放・3000msより後の解放、
        同着・race、入れ替え・明示停止・取消・期限の競合、late settlement、起動・停止失敗、遅い`exit`・`close`・
        `error`を分類し、timer、immediate、listener、child process、process group、予約、停止promise、論理実行枠の取得か
        ら解放までを記録する。
    -   `null`、空、0、1、最小、最大、範囲外、不正型、重複をtestまたはDesignの理由付き非適用へ割り当てる。非適用、未実
        行、Linux以外のskipをPASSへ数えない。
    -   完了時には、48行、48個の一意な主test ID、空欄0件、未分類0件となり、各行からTask 8.1、8.2、8.4のtestまたは非適用
        理由へ逆引きできる。
    -   _Depends: 8.1, 8.2_
    -   _Requirements: 8.3_

-   [x] 8.4 Debian/Linuxの実process group境界と非適用境界を結合検証する

    -   `test/server/media-process-management/process-group.integration.test.ts`の`makeLinuxGroupScript`が、caseごとに一時
        directoryへsynthetic executableを生成し、test parentと異なるprocess groupのdirect childと通常の子childを
        isolated processとして起動する。生成した一時directoryはcase終了時に回収する。
    -   `SIGINT`でgroup全体が終了する経路、`SIGKILL`を必要とする経路、最後まで終了未確認の経路、direct child先行終了、
        group開始失敗を検証し、signal列、各段階の確認回数、error記録、registry除去、枠解放一回を観測する。
    -   各caseの後始末でfixture child、process group、timer、listener、停止promise、registry、論理枠の残留を0件にし、
        test parentのgroupへsignalを送っていないことを前後でassertする。
    -   非Linuxではplatform、skip件数、Linux process group contractである理由を記録し、fake suiteで代替しない。Debian/Linuxで
        同suiteが全件成功することを前提とする。
    -   DB、HTTP、IPC、永続filesystem、HLS成果物削除は直接境界でない理由をDesignのMatrixへ記録する。synthetic executableと一時directoryの回収を製品
        filesystemまたは成果物削除contractへ読み替えない。
    -   完了時には、Linux child・group・signal・終了確認の成功・失敗・回収を実境界で観測でき、5つの非適用境界を含む
        matrixの未分類が0件である。
    -   _Depends: 4.1, 5.3, 6.1, 6.2, 7.1, 7.2, 8.3_
    -   _Requirements: 8.4_

-   [x] 8.5 本機能の品質判定を満たす

    -   Task 8.1から8.4の機能固有の単体test（`unittest/spec`・`unittest/imp`）と`integration`を、`server-application-runtime`が
        所有する共有commandで全件成功させる。本specではcommand・config・thresholdを追加しない。
    -   本機能が主に所有するsourceに、単体testだけでのC0・C1の未到達が残る場合は、`server-application-runtime`のMajor 12の単体testで
        解消されていることを確かめる。判定は、同specの`Requirement 9 Acceptance Criterion 9`に従う。
    -   完了時には、本機能の単体testと結合testが全件成功し、server全体の判定（`server-application-runtime` Requirement 9
        Acceptance Criterion 9）に本機能のsourceの未到達が残らない。
    -   _Depends: 8.1, 8.2, 8.3, 8.4_
    -   _Requirements: 8.5_

## Leaf実行契約

| Leaf | Concrete target                                                                                                                                                                                                                                                                                 | Test type                                          | Local Depends                                                     | Verification command                                                                                                                                                                                                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | `test/server/media-process-management/media-process-management.spec.test.ts`<br>`test/server/media-process-management/implementation.test.ts`<br>`test/server/media-process-management/process-group.integration.test.ts`                                                                       | `unittest/spec`<br>`unittest/imp`<br>`integration` | なし（共有foundationのみ）                                        | `npm run test:server:spec -- test/server/media-process-management/media-process-management.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-process-management/implementation.test.ts`<br>`npm run test:server:integration -- test/server/media-process-management/process-group.integration.test.ts` |
| 1.2  | `test/server/media-process-management/media-process-management.spec.test.ts`                                                                                                                                                                                                                    | `unittest/spec`                                    | なし（共有foundationのみ）                                        | `npm run test:server:spec -- test/server/media-process-management/media-process-management.spec.test.ts`                                                                                                                                                                                                            |
| 1.3  | `test/server/media-process-management/media-process-management.spec.test.ts`<br>`test/server/media-process-management/process-group.integration.test.ts`                                                                                                                                        | `unittest/spec`<br>`integration`                   | なし（共有foundationのみ）                                        | `npm run test:server:spec -- test/server/media-process-management/media-process-management.spec.test.ts`<br>`npm run test:server:integration -- test/server/media-process-management/process-group.integration.test.ts`                                                                                             |
| 2.1  | `src/model/service/encode/EncodeProcessManageModel.ts`<br>`src/model/service/encode/IEncodeProcessManageModel.ts`<br>`test/server/media-process-management/media-process-management.spec.test.ts`<br>`test/server/media-process-management/implementation.test.ts`                              | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                        | `npm run test:server:spec -- test/server/media-process-management/media-process-management.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-process-management/implementation.test.ts`                                                                                                                |
| 2.3  | `src/model/service/encode/EncodeProcessManageModel.ts`<br>`src/model/service/encode/IEncodeProcessManageModel.ts`<br>`src/util/ProcessUtil.ts`<br>`test/server/media-process-management/media-process-management.spec.test.ts`<br>`test/server/media-process-management/implementation.test.ts` | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                        | `npm run test:server:spec -- test/server/media-process-management/media-process-management.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-process-management/implementation.test.ts`                                                                                                                |
| 3.1  | `src/model/service/encode/EncodeProcessManageModel.ts`<br>`test/server/media-process-management/media-process-management.spec.test.ts`<br>`test/server/media-process-management/implementation.test.ts`                                                                                         | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                        | `npm run test:server:spec -- test/server/media-process-management/media-process-management.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-process-management/implementation.test.ts`                                                                                                                |
| 4.1  | `src/model/service/encode/EncodeProcessManageModel.ts`<br>`src/model/service/encode/IEncodeProcessManageModel.ts`<br>`src/util/ProcessUtil.ts`<br>`test/server/media-process-management/media-process-management.spec.test.ts`<br>`test/server/media-process-management/implementation.test.ts` | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                        | `npm run test:server:spec -- test/server/media-process-management/media-process-management.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-process-management/implementation.test.ts`                                                                                                                |
| 5.1  | `src/model/service/encode/EncodeProcessManageModel.ts`<br>`src/util/ProcessUtil.ts`<br>`test/server/media-process-management/media-process-management.spec.test.ts`<br>`test/server/media-process-management/implementation.test.ts`                                                            | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                        | `npm run test:server:spec -- test/server/media-process-management/media-process-management.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-process-management/implementation.test.ts`                                                                                                                |
| 5.3  | `src/model/service/encode/EncodeProcessManageModel.ts`<br>`src/util/ProcessUtil.ts`<br>`test/server/media-process-management/media-process-management.spec.test.ts`<br>`test/server/media-process-management/implementation.test.ts`                                                            | `unittest/spec`<br>`unittest/imp`                  | なし（共有foundationのみ）                                        | `npm run test:server:spec -- test/server/media-process-management/media-process-management.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-process-management/implementation.test.ts`                                                                                                                |
| 6.1  | `src/model/service/encode/EncoderModel.ts`<br>`test/server/media-process-management/process-group.integration.test.ts`                                                                                                                                                                          | `integration`                                      | `2.3, 3.1`                                                        | `npm run test:server:integration -- test/server/media-process-management/process-group.integration.test.ts`                                                                                                                                                                                                         |
| 6.2  | `src/model/service/stream/base/LiveStreamBaseModel.ts`<br>`src/model/service/stream/base/RecordedStreamBaseModel.ts`<br>`test/server/media-process-management/process-group.integration.test.ts`                                                                                                | `integration`                                      | `2.3, 4.1, 5.3`                                                   | `npm run test:server:integration -- test/server/media-process-management/process-group.integration.test.ts`                                                                                                                                                                                                         |
| 7.1  | `test/server/media-process-management/process-group.integration.test.ts`                                                                                                                                                                                                                        | `integration`                                      | `3.1, 5.3, 6.1, 6.2`                                              | `npm run test:server:integration -- test/server/media-process-management/process-group.integration.test.ts`                                                                                                                                                                                                         |
| 7.2  | `test/server/media-process-management/process-group.integration.test.ts`                                                                                                                                                                                                                        | `integration`                                      | `4.1, 5.3, 6.2`                                                   | `npm run test:server:integration -- test/server/media-process-management/process-group.integration.test.ts`                                                                                                                                                                                                         |
| 8.1  | `test/server/media-process-management/media-process-management.spec.test.ts`                                                                                                                                                                                                                    | `unittest/spec`                                    | `1.1, 1.2, 1.3, 2.1, 2.3, 3.1, 4.1, 5.1, 5.3, 6.1, 6.2, 7.1, 7.2` | `npm run test:server:spec -- test/server/media-process-management/media-process-management.spec.test.ts`                                                                                                                                                                                                            |
| 8.2  | `test/server/media-process-management/implementation.test.ts`                                                                                                                                                                                                                                   | `unittest/imp`                                     | `2.1, 2.3, 3.1, 4.1, 5.1, 5.3, 8.1`                               | `npm run test:server:imp -- test/server/media-process-management/implementation.test.ts`                                                                                                                                                                                                                            |
| 8.3  | `.kiro/specs/server-media-process-management/design.md` | レビュー | `8.1, 8.2`                                                        | なし（Designの48行のレビュー） |
| 8.4  | `test/server/media-process-management/process-group.integration.test.ts` | `integration`                                      | `4.1, 5.3, 6.1, 6.2, 7.1, 7.2, 8.3`                               | `npm run test:server:integration -- test/server/media-process-management/process-group.integration.test.ts`                                                                                                                                                                                                         |
| 8.5  | `test/server/media-process-management/media-process-management.spec.test.ts`<br>`test/server/media-process-management/implementation.test.ts`<br>`test/server/media-process-management/process-group.integration.test.ts`                                                                       | `unittest/spec`<br>`unittest/imp`<br>`integration` | `8.1, 8.2, 8.3, 8.4`                                              | `npm run test:server:spec -- test/server/media-process-management/media-process-management.spec.test.ts`<br>`npm run test:server:imp -- test/server/media-process-management/implementation.test.ts`<br>`npm run test:server:integration -- test/server/media-process-management/process-group.integration.test.ts` |
