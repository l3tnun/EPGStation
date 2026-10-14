# 録画ファイル変換（エンコード）機能 設計

## 1. 目的

録画済み番組の動画ファイルを、設定された変換方法で別の形式へ変換する。依頼を受け付け順に実行し、待機・実行状態、進捗、取
消、結果反映を一つの機能として扱う。

## 2. 境界と依存関係

### 2.1 本機能が担当すること

-   変換依頼の受付と識別番号の割当て
-   Web・API側処理（service child）のprocess内の待機列と実行中一覧
-   依頼の記録（保存・出力先の追加・削除）と、起動時の記録からの復元
-   識別番号の割当て（記録を保存する管理側で行う）と、記録の受け付け順の並べ直し
-   録画完了による依頼の記録と、Web・API側処理への受け渡し
-   受付順の開始とエンコード同時実行数の制御
-   変換対象・変換方法・保存先の開始前確認
-   外部変換処理の開始、進捗取得、取消、実行時間上限
-   変換結果の録画済み番組への反映依頼
-   失敗時の途中出力削除と、終了後の次依頼開始
-   容量削除候補の選別に使う待機中・実行中recorded IDのread-only snapshot

### 2.2 本機能が担当しないこと

-   録画済み番組と録画ファイルの永続保存
-   依頼の記録を保存するtableの定義、migration、DB操作の実装（`server-persistence`）
-   記録の操作をWeb・API側処理から管理側へ渡す通信の識別・期限（`server-process-messaging`）
-   ライブ視聴や録画再生のための一時変換
-   メディア変換処理全体の共有上限と優先順位
-   録画、予約、外部フック配送

### 2.3 依存関係

```mermaid
flowchart LR
    Caller[Web・API／録画後処理] --> Encoding[録画ファイル変換]
    Encoding --> Config[サーバー設定管理]
    Encoding --> Recorded[録画済み番組管理]
    Encoding --> PM[内部resource利用lease]
    Encoding --> Media[メディア変換プロセス管理]
    Encoding --> Log[運用ログ記録]
    Encoding --> Events[状態変化通知]
    Encoding --> Store[依頼記録窓口（管理側）]
    Store --> DB[データベース保存・検索]
```

| 依存先                   | 利用内容                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------ |
| サーバー設定管理         | 変換方法、保存先、同時実行数、共有処理数、待機上限を起動時に取得する                 |
| 録画済み番組管理         | 番組・変換元ファイル・放送局を確認し、結果登録、サイズ更新、元ファイル削除を依頼する |
| プロセス間通信           | 録画済みresource利用leaseを取得・解放し、容量不足削除との競合を防ぐ                  |
| メディア変換プロセス管理 | ライブ・再生用変換と共有する外部処理枠を取得する                                     |
| 運用ログ記録             | 受付、開始、完了、取消、失敗、結果反映失敗を記録する                                 |
| 状態変化通知             | 追加、進捗、取消、失敗、完了を関係機能へ伝える                                       |
| データベース保存・検索   | 依頼の記録（`encode_queue`）を保存・更新・削除・一覧する（管理側だけが使う）         |
| プロセス間通信（記録）   | Web・API側処理から管理側の依頼記録窓口へ、記録の追加・出力先の追加・削除・一覧を頼む |

## 3. 機能構成

| 構成要素          | 責務                                                                            |
| ----------------- | ------------------------------------------------------------------------------- |
| 変換操作窓口      | 手動依頼を内部形式へ変換し、一覧と取消を提供する                                |
| 受付・待機管理    | 受付上限、識別番号、FIFO待機列、実行中一覧を管理する                            |
| 変換ジョブ        | 開始前確認、外部処理、進捗、取消、実行時間上限を一件単位で管理する              |
| resource利用lease | 待機列へ公開する前にrecorded IDのencode利用を取得し、結果settlement後に解放する |
| 利用中snapshot    | 待機列と実行中一覧のrecorded IDを副作用なしで一時点の集合へ投影する             |
| 出力名管理        | 同時処理および既存ファイルと重複しない出力候補を選ぶ                            |
| 結果反映          | 新規ファイル登録またはサイズ更新を依頼し、条件付きで元ファイル削除を依頼する    |
| 変換イベント      | 追加、進捗、取消、失敗、完了を通知する                                          |
| 依頼記録窓口      | 管理側（親process）に置き、識別番号の割当て、記録の保存・更新・削除・一覧、受け付け順の並べ直し、録画完了依頼の記録と受け渡しを直列に行う |
| 記録の復元        | Web・API側処理の起動時に記録を一覧で受け取り、判定の後で待機列へ戻す。戻し終えるまで新しい受付を待たせる |

## 4. 主要データとインターフェース

### 4.1 変換依頼

```ts
interface EncodeRequest {
    recordedId: number;
    sourceVideoFileId: number;
    parentDir: string;
    directory?: string; // 親保存先の中に収まる相対path。手動依頼は受付時に検査する
    mode: string;
    removeOriginal: boolean;
}

interface IRecordedResourceUsePort {
    acquire(recordedId: number, kind: 'encoding'): Promise<{ readonly token: object }>;
    release(token: object): Promise<void>;
}

type EncodingRecordedUseSnapshot =
    | { readonly status: 'known'; readonly recordedIds: ReadonlySet<number> }
    | { readonly status: 'unknown' };

interface IEncodingRecordedUseSnapshotProvider {
    getQueuedAndRunningRecordedIds(): EncodingRecordedUseSnapshot;
}

interface InternalEncodeJob {
    readonly info: EncodeInfoItem;
    readonly recordedUseToken: object;
}
```

受付後は正の整数 `encodeId` と取得済みのrecorded-use tokenを加えた内部ジョブとして保持する。tokenは公開一覧、通
知、HTTP、または業務IPCへ露出しない。依頼の内容、識別番号、出力先は4.4の記録としてDBへ保存する。待機列と実行中一覧の
区別、進捗、recorded-use tokenは保存しない（再起動後はすべて待機として戻す）。

### 4.2 一覧情報

```ts
interface EncodeQueueInfo {
    runningQueue: EncodeInfoItem[];
    waitQueue: EncodeInfoItem[];
}

interface EncodeInfoItem {
    id: number;
    mode: string;
    recordedId: number;
    percent?: number;
    log?: string;
}
```

進捗率とメッセージは外部変換処理が出力した場合だけ設定する。取得できない値を本機能で推定しない。

`IEncodingRecordedUseSnapshotProvider`は待機列と実行中一覧を同じprocess-local同期境界でread-onlyに読み、両方の
`recordedId`を重複除去した集合として返す。待機中jobも将来のsource利用が確定した受付済み要求なので含める。snapshot取得は
jobを開始・取消・並べ替えず、leaseを取得・解放せず、queueの進行を待たない。一時点として両一覧を安全に列挙できない場合は
部分集合や空集合を返さず`unknown`とする。snapshotへ現れる全jobは待機列への公開前からrecorded-use leaseを保持している。結
果は永続化せず、後続のqueue変化を拘束しない。

### 4.3 起動時設定

| 設定                  | 意味                         | 省略時         | 検証                                        | 反映時期   |
| --------------------- | ---------------------------- | -------------- | ------------------------------------------- | ---------- |
| `concurrentEncodeNum` | 本機能で同時に実行する変換数 | 設定管理に従う | 0以下なら新規受付を拒否                     | 起動時     |
| `encodeProcessNum`    | メディア変換全体の共有処理数 | 設定管理に従う | 共有管理側で検証                            | 起動時     |
| `encodeQueueLimit`    | 受付処理中と待機中の合計上限 | 1,024          | `Number.isSafeInteger(value) && value >= 1` | 起動時     |
| `encodeSuspendTimes`  | 待機依頼を開始しない時間帯   | 停止時間帯なし | `start`・`end`の`HH:mm`配列（下記）         | 起動時     |
| `encodeRemoveInterruptedOutput` | 中断された変換の出力途中のファイルを復元時に削除するか | `true` | 設定管理が真偽値を検証 | 起動時 |
| `encode[].rate`       | 録画時間に掛ける実行時間倍率 | 4              | 変換方法の設定に従う                        | 変換開始時 |

`encodeQueueLimit` はproperty自体がない場合、またはencode設定を含むconfig objectが空の場合だけ1,024を使う。明示された
`null`、空文字、非数値、および正の安全な整数でない値は省略とみなさず、起動を失敗させる。

`encodeQueueLimit` は設定ファイルだけの運用設定であり、公開API、Web UI向け公開設定、IPCの業務データには追加しない。構築
済みの管理インスタンスは設定ファイルを再読込せず、変更は再起動後に反映する。

`encodeSuspendTimes` はproperty自体がない場合だけ停止時間帯なし（空配列）とする。値は配列で、各要素は`start`と`end`の二つ
の文字列を持つobjectとする。`start`は`00:00`〜`23:59`、`end`は`00:00`〜`24:00`の、時と分をそれぞれ2桁で書く`HH:mm`形
式とし、`start`と`end`は異なる時刻とする。明示された`null`、配列以外、objectでない要素、`start`・`end`の欠落、形式外の
文字列、範囲外の時刻、および`start`と`end`が同じ要素は省略とみなさず、`InvalidEncodeSuspendTimes`で構築を失敗させる。構
築時に各要素を0時からの経過分（`start`は0〜1,439、`end`は0〜1,440）へ変換して保持し、稼働中の設定ファイル変更は反映し
ない。`encodeQueueLimit`と同じく、公開API、Web UI向け公開設定、IPCの業務データには追加しない。

### 4.4 依頼の記録

依頼の記録はtable `encode_queue`へ一依頼一行で保存する。tableの定義とDB操作は`server-persistence`が所有し、本機能は
管理側の依頼記録窓口（`EncodeQueueStore`）からだけ使う。Web・API側処理はDBへ書かず、プロセス間通信で依頼記録窓口へ頼む。

| 列          | SQLite                   | MySQL                    | 値                                                                  |
| ----------- | ------------------------ | ------------------------ | ------------------------------------------------------------------- |
| `id`        | `bigint` 主キー          | `bigint` 主キー          | 識別番号（1〜`Number.MAX_SAFE_INTEGER`）。DBの自動採番は使わない。SQLiteは`integer`の主キーが行番号の別名になり自動採番されるため`bigint`（整数として保存）にする |
| `option`    | `text` NOT NULL          | `text` NOT NULL          | 依頼の内容（4.1の`EncodeRequest`）のJSON                            |
| `outputPath`| `text` NULL可            | `text` NULL可            | 変換を開始したときの出力ファイルのfull path。開始前と出力なしは`null` |
| `createdAt` | `bigint` NOT NULL        | `bigint` NOT NULL        | 記録した時刻のUNIXミリ秒。表示・診断用で、受け付け順には使わない      |

```ts
interface EncodeQueueRecord {
    id: number;
    option: EncodeRequest;
    outputPath: string | null;
    createdAt: number;
}

// Web・API側処理から見た依頼記録窓口（プロセス間通信で管理側へ渡す）
interface IEncodeQueueStorePort {
    add(option: EncodeRequest, requestToken: string): Promise<number>; // 識別番号を割り当てて記録し、識別番号を返す
    abandon(requestToken: string): Promise<void>; // addの応答を得られなかった要求の記録を取り消す
    updateOutputPath(id: number, outputPath: string): Promise<void>;
    remove(id: number): Promise<void>;
    list(): Promise<EncodeQueueRecord[]>; // 受け付け順に並べ直して返す
}
```

依頼記録窓口は、識別番号の割当てと記録の保存・更新・削除・取消し・一覧を一本の直列の処理に並べ、呼び出された順に一件ずつ行
う。管理側で最初の操作を受けたときに全記録を読み、記録が使っている識別番号の集合と、次に割り当てる識別番号を持つ。読込に失
敗した場合はその操作を失敗とし、次の操作で読み直す（読み込めるまで識別番号を割り当てない）。解釈できない記録（依頼内容の
JSONが壊れている、必須の項目が無い、識別番号が範囲外）はログへ記録して削除し、削除にも失敗した記録の識別番号は使用中として割
り当てに使わない。DB操作は`server-persistence`の再試行と待ち時間に従って完了を待ち、本機能から期限を足さない。窓口は
`IPCServer`を注入せず、録画完了依頼の送信処理を呼出しごとに受け取る（注入の循環を作らない）。存在しない識別番号への出力先の
更新と削除は、何もせずに成功とする。

-   **識別番号の割当て**: 次に割り当てる値から始め、記録が使っている値を飛ばして最初の空き値を割り当てる。記録の保存に成
    功したら次の値をその次へ進め、`Number.MAX_SAFE_INTEGER`の次は1とする。保存に失敗したら次の値を変えない（保存できな
    かった値は使われていないので、戻さないという規則に反しない）。依頼が終わって記録を削除しても次の値は戻さない（終わった識
    別番号を宛先にした古い取消が、新しい依頼に当たらないため）。同時に残る記録は、待機上限・同時実行数・復元で戻した
    依頼の数に抑えられ、識別番号の空間（2^53−1）より十分に少ないので、空き値は必ず見つかる。
-   **受け付け順の並べ直し**: 記録の識別番号を昇順に並べ、隣り合う値の差（最後の値から先頭の値へは、最大値を越えて1へ戻
    る差）が最も大きい箇所を境目とし、その直後の値から順に並べる。識別番号は一つずつ順に割り当て、同時に残る記録の幅は識別
    番号の空間より十分に狭いので、最大値から1へ戻った箇所は必ず最大の差になる。最大値を越えていない場合は、最後の値から先頭の
    値への差が最大になり、昇順のままになる。記録が一件以下ならそのままとする。差が最大の箇所が複数あるときは、最後の値から
    先頭の値への差を優先し、次に昇順で最初の箇所とする。
-   **要求ごとの値（`requestToken`）**: `add`は呼出し元が要求ごとに作った値を受け取り、その要求で記録した識別番号と対応付
    ける。呼出し元が応答を得られなかった（期限切れ・通信の失敗）場合は`abandon(requestToken)`を送り、窓口は対応する記録が
    あれば削除する。直列の処理なので、`abandon`は同じ要求の`add`の後に処理される。対応付けは記録の削除で消える。
-   **次に割り当てる値（起動時）**: 並べ直した記録の最後（最も新しい依頼）の識別番号の次の値とし、それが最大値なら1とす
    る。記録が無ければ1とする。
-   稼働中のWeb・API側処理の待機列は配列の受け付け順で開始し、識別番号で並べ替えない。最大値を越えても稼働中の開始順は変
    わらない。録画完了の依頼は管理側で番号を取ってからWeb・API側の受付を通るため、後から番号を取ったHTTPの依頼が稼働中の待
    機列で先に並ぶことがあり、再起動後は識別番号の受け付け順に並ぶ。この入れ替わりは許容する。

## 5. 処理の設計

### 5.1 依頼受付

1. `concurrentEncodeNum <= 0` なら拒否する。
2. 非同期処理へ進む前の同じ同期処理内で `admissionReservations + waitQueue.length >= encodeQueueLimit`を確認する。満杯な
   ら拒否し、識別番号、ジョブ、通知を作らない。
3. 空きがあれば同じ同期処理内で`admissionReservations`を一件増やす。複数の受付が同じevent loopで続いても、後続受付は増加
   済みの値を観測する。
4. 受付処理を直列化する実行権を取得する。
5. 実行権を保持したまま、`IRecordedResourceUsePort.acquire(recordedId, 'encoding')`を一回awaitする。この受付は
   `admissionReservations`として上限に含まれるが、成功前は識別番号、ジョブ、公開待機列、または追加通知を作らない。直列化
   により、先に受付処理へ入った依頼の成否が未確定な間に後続依頼を先に待機列へ公開しない。
6. lease取得後に依頼記録窓口の`add(option)`をプロセス間通信で一回awaitし、割り当てられた識別番号を受け取る。記録の保存に
   失敗した場合、または応答を得られない場合は、依頼を失敗とし、識別番号、ジョブ、追加通知を作らず、取得済みexact tokenと
   実行権を各一回解放する（Requirement 1.12）。応答を得られない場合（期限切れ・通信の失敗）は、`add`に渡した要求ごとの値で
   `abandon`を一回依頼する（結果は記録するだけで待たない）。`add`の成功後にジョブの生成・設定・待機列への追加が失敗した場合
   は、記録を`remove`で一回削除する。
7. 変換ジョブを生成し、受け取った識別番号、依頼内容、および取得したexact tokenを設定する。
8. 待機列の末尾へ追加し、予約一件を待機中一件へ原子的に移す。
9. 実行権を解放し、追加通知と待機列確認を行う。

受付と取消は、5.8の起動時の復元が終わるまで待つ（復元が動いていない間は待たない）。これにより、記録から戻す古い依頼が新
しい依頼より先に待機列へ並び、まだ戻していない識別番号への取消が、戻した後の依頼に届く。

3以後で失敗した場合、当該受付が所有する`admissionReservations`を一回だけ戻す。実行権の取得自体が失敗した場合は、未取得の
実行権へ解放を行わない。lease取得失敗、`blocked`相当、状態不明、または通常5秒のPM期限超過では識別番号、ジョブ、通知、
queue追加、DB・filesystem照会、およびprocess開始を0件とし、この機能から自動retryしない。期限後のlate grantedの解放はPM
adapterへ委譲する。lease取得後のジョブ生成失敗、識別番号設定失敗、待機列追加失敗では、取得済みexact tokenと実行権を各一
回だけ解放する。待機列追加の途中で失敗しても不完全なジョブを残さず、予約から待機中への移行、reservation解放、およびlease
解放を二重に行わない。releaseの送信・応答を確認できない場合は記録し、parent側は同じrecorded IDを削除可能と推測しない。実
行中一覧は待機上限の計数対象に含めない。

識別番号は4.4の規則で依頼記録窓口が割り当てる。Web・API側処理は識別番号を数えない。`add`の応答期限は通常の5秒である。期限を
過ぎた後で管理側が記録を終えた場合も、続けて送る`abandon`が直列の処理で後から処理されるため、その記録は削除される（利用者
には受付失敗として返り、次の起動で復元されない）。`abandon`は、保存の失敗を含めて`add`が成功しなかったすべての場合に送る（対応
する記録が無ければ何もしない）。

### 5.2 FIFO実行

```mermaid
stateDiagram-v2
    [*] --> LeasePending: 受付枠を予約
    LeasePending --> Waiting: lease取得後に受付成功
    LeasePending --> Rejected: lease取得失敗
    Waiting --> Running: 本機能枠と共有枠を取得
    Waiting --> Cancelled: 待機中取消
    Running --> Succeeded: 正常終了
    Running --> Failed: 開始失敗／異常終了／時間超過
    Running --> Cancelled: 実行中取消
    Rejected --> [*]
    Succeeded --> [*]
    Failed --> [*]
    Cancelled --> [*]
```

待機列確認は一回につき先頭の一件を選ぶ。`runningQueue.length < concurrentEncodeNum` の場合だけ先頭を実行中一覧へ移し、変
換ジョブを開始する。外部処理の生成時に共有枠を取得できなければ、その依頼は失敗として終了し、待機列へ戻さない。

一件の終了または開始失敗で実行中一覧から対象を除いた後、次のイベントループで待機列を再確認する。この繰返しにより、空き枠
の範囲で受付順に処理を開始する。

#### 停止時間帯

待機列確認の要求（`NEEDS_CHECK_QUEUE_EVENT`）を受けたときは、空き枠と待機依頼の有無にかかわらず、実行権を取得する前に現在
時刻（`Date`のローカル時・分）が停止時間帯に含まれるかを判定する。各時間帯は、`start < end`なら`start <= 現在 < end`、
`start > end`なら`現在 >= start`または`現在 < end`（日付を跨ぐ）で含まれると判定する。含まれる場合は、実行権を取得せず、
待機列を変更せず、ジョブを開始せずに要求を終え、待機依頼があるときだけ再開timerを設定する。含まれない場合だけ既存の待機列確
認へ進む。空き枠や待機依頼が無い時点の要求でも時間帯の中では待機列確認へ進まないので、実行権を待つ間に別の終了や受付で空き
枠・待機依頼が生じても、時間帯の中で要求された確認がジョブを開始することはない。判定は要求を受けた時点で行うため、時間帯の
開始前に実行権待ちへ入った確認だけは、そのまま既存の確認として進み、実行権を取得した後に一件を開始することがある。この待ち
の上限は実行権の取得の期限（60秒）である。既存の待機列確認（`checkQueue`）の処理は変更しない。実行中の変換、受付、取消、進
捗、結果反映は停止時間帯の影響を受けない。

停止時間帯で確認を終え、待機依頼があるときは、再開timerを一つだけ設定する。delayは、現在時刻を含む時間帯のうち最も早く終わる`end`ま
でのミリ秒数（現在の秒とミリ秒を差し引いた値、1以上）と、60,000の小さい方とする。上限を設けるのは、サマータイムの切替え
や時刻の変更でローカル時刻が実時間と異なる幅で進んでも、1分以内に時間帯を判定し直すためである（Requirement 2.13）。時計
が進む日に終了時刻が飛ばされる1時間の中にある場合も、時間帯の外に出た後の最初の判定で再開する。時計が戻る日に繰り返さ
れる時刻は、1度目と2度目のどちらも同じ時刻として判定する。時刻はprocessのローカル時刻（環境のタイムゾーン）で、本機能は
タイムゾーンを設定・変換しない。timerが既にあれば新たに設定しない。timerは`unref()`し、process
の終了を妨げない。timerが発火したらtimerを破棄し、`min(concurrentEncodeNum - runningQueue.length, waitQueue.length)`回だけ
待機列確認を要求する。各確認は既存どおり一件ずつ実行権の下で先頭を開始するため、空き枠の範囲で受付順に開始する。重なる別
の時間帯がまだ続いている場合や、上限で発火した時点でまだ時間帯の中にある場合は、最初の確認が改めて再開timerを設定する。空き枠がない場合や待機列が空の場合は確認を要求せ
ず、後続の終了・受付による確認へ任せる。現在時刻を含む時間帯の和は一つの連続した区間になるため、最も早く終わる`end`で判定し直しても、和の区間の終わりまで待って
も、ジョブを開始する時刻は同じである。最も早い`end`を使うのは、判定を時間帯ごとの計算に閉じるための実装上の選択であり、外
部から観測できる契約ではない。

### 5.3 開始前確認と外部処理

変換ジョブは待機列へ公開される前に取得したexact recorded-use tokenを待機中から保持している。待機列から実行中へ移す際に
leaseを再取得または交換しない。実行開始時は同じtokenを保持したまま次を順番に確認する。

1. 変換元の録画ファイル登録情報
2. 対象の録画済み番組
3. 録画済み番組に対応する放送局
4. 変換元の実ファイル
5. 指定された変換方法
6. 保存先と必要な出力ディレクトリ

一つでも確認できなければ外部処理を開始せず失敗とする。出力ファイルを作る変換方法では、出力ディレクトリを書式を展開した後に
`server-recording-execution`の設計6.7.2の共通関数`isSubDirectoryInsideRoot()`で検査する。録画保存先の外を指す場合は、そ
のディレクトリを使わず、指定された親保存先の直下を出力先にして運用ログへ記録し、変換を続ける。このとき登録する相対path
はfile名だけで、環境変数`SUBDIR`は空文字になる。出力ファイルを作る変換方法では、既存ファイルおよび同時実行中の予約
と重ならない名前を選ぶ。出力を作らない変換方法では出力先を `null` としてコマンドを起動し、出力先ディレクトリの検査と
書式展開は行わず、依頼のdirectoryをそのまま環境変数`SUBDIR`（`DIR`）へ渡す。

変換コマンドは引用符やshell構文を解釈せず、半角空白で実行ファイルと引数へ分け、次の置換を行う。

| 記法       | 適用位置                     | 置換値                                |
| ---------- | ---------------------------- | ------------------------------------- |
| `%NODE%`   | 実行ファイル                 | サーバーを起動したNode.js実行ファイル |
| `%ROOT%`   | 各引数                       | サーバーのroot path                   |
| `%SPACE%`  | 各引数                       | 半角空白                              |
| `%INPUT%`  | 各引数                       | 入力ファイルpath                      |
| `%OUTPUT%` | 各引数。出力先がある場合だけ | 出力ファイルpath                      |

変換processは親processの環境変数を継承し、次の変換用環境変数を上書きまたは追加する。

| 環境変数                 | 値                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `RECORDEDID`             | 録画済み番組ID                                                                                           |
| `INPUT`                  | 入力ファイルのfull path                                                                                  |
| `OUTPUT`                 | 出力ファイルのfull path。出力先なしは空文字                                                              |
| `DIR`                    | 出力を作らず依頼にdirectoryがあればその文字列。それ以外は出力ファイルのfull path。どちらもなければ空文字 |
| `SUBDIR`                 | 出力ファイルを作る変換方法では、書式を展開した後の依頼のdirectory（保存先の外を指して使わなかったときと指定なしは空文字）。出力を作らない変換方法では、展開しない依頼のdirectory（指定なしは空文字） |
| `FFMPEG`                 | 設定されたffmpeg path                                                                                    |
| `FFPROBE`                | 設定されたffprobe path                                                                                   |
| `NAME`                   | 録画済み番組名                                                                                           |
| `HALF_WIDTH_NAME`        | 録画済み番組の半角名                                                                                     |
| `DESCRIPTION`            | 番組概要。欠損時は空文字                                                                                 |
| `HALF_WIDTH_DESCRIPTION` | 番組概要の半角表現。欠損時は空文字                                                                       |
| `EXTENDED`               | 番組詳細。欠損時は空文字                                                                                 |
| `HALF_WIDTH_EXTENDED`    | 番組詳細の半角表現。欠損時は空文字                                                                       |
| `VIDEOTYPE`              | 録画済み番組の映像形式。欠損時は空文字                                                                   |
| `VIDEORESOLUTION`        | 録画済み番組の映像解像度。欠損時は空文字                                                                 |
| `VIDEOSTREAMCONTENT`     | 録画済み番組の映像stream content                                                                         |
| `VIDEOCOMPONENTTYPE`     | 録画済み番組の映像component type                                                                         |
| `AUDIOSAMPLINGRATE`      | 録画済み番組の音声sampling rate                                                                          |
| `AUDIOCOMPONENTTYPE`     | 録画済み番組の音声component type                                                                         |
| `CHANNELID`              | 録画済み番組の放送局ID                                                                                   |
| `CHANNELNAME`            | 関連する放送局名                                                                                         |
| `HALF_WIDTH_CHANNELNAME` | 関連する放送局名の半角表現                                                                               |
| `GENRE1`                 | 録画済み番組の第1ジャンル                                                                                |
| `SUBGENRE1`              | 録画済み番組の第1サブジャンル                                                                            |
| `GENRE2`                 | 録画済み番組の第2ジャンル                                                                                |
| `SUBGENRE2`              | 録画済み番組の第2サブジャンル                                                                            |
| `GENRE3`                 | 録画済み番組の第3ジャンル                                                                                |
| `SUBGENRE3`              | 録画済み番組の第3サブジャンル                                                                            |
| `START_AT`               | 録画済み番組の開始時刻                                                                                   |
| `END_AT`                 | 録画済み番組の終了時刻                                                                                   |
| `DROPLOG_ID`             | 関連するドロップログID。欠損時は空文字                                                                   |
| `DROPLOG_PATH`           | 関連するドロップログの相対path。欠損時は空文字                                                           |
| `ERROR_CNT`              | 関連するドロップログのerror count。欠損時は空文字                                                        |
| `DROP_CNT`               | 関連するドロップログのdrop count。欠損時は空文字                                                         |
| `SCRAMBLING_CNT`         | 関連するドロップログのscrambling count。欠損時は空文字                                                   |

数値は10進文字列、任意の数値情報が欠損した場合は空文字にする。チャンネル名のkeyは`CHANNELNAME`であり、この名前を維持す
る。

メディア変換プロセス管理からは、標準入出力とevent購読に使うchildと、停止に使うopaque managed handleを受け取る。変換ジョ
ブは両方を保持するが、取消または実行時間上限時にchildへ直接signalを送らず、handleでprocess managerの `requestStop()`へ停
止を依頼する。優先度入れ替えが同じ対象の停止を開始済みなら、そのstop request operationへjoinする。
開始要求には`report: { kind: 'encode', encodeId }`を添え、メディア変換プロセス管理機能がprocessの開始と終了を依頼の識別
番号とともに管理側へ知らせる（7.13）。Web・API側処理だけが異常終了したとき、管理側はこの知らせを使って変換processを取消と
同じ`SIGINT`で止め、出力途中のファイルを7.6〜7.8と同じ規則（登録済みの出力と、録画済み番組・変換元ファイルが無い依頼の出力は残す）で削除してから再起動させる（7.14。`server-application-runtime`の§7.1）。
復元の削除は`removeFileIfPresent`を使い、既に無いファイル（後始末で先に削除されたものを含む）を削除済みとして扱う。

開始前確認へ新しい期限は追加しない。既存のDB・ファイルシステム・共有処理枠の完了契約をそのまま利用する。resource leaseは
待機列への公開前から、待機、開始前確認、入力file利用、外部process、途中出力cleanup、結果登録・size更新・条件付き元file削
除を含む結果settlementの完了まで保持する。結果settlementへ到達しない開始前失敗または待機中取消は受付側がexact tokenを一
回releaseする。結果settlementへ到達したjobは、`EncodeFinishModel.finishEncode()`の成功・失敗と後続の条件付き元file削除が
確定してから、管理側（`EncodeManageModel`）がexact tokenの `release()`を一回試みる。停止要求の応答だけではprocess terminalでもfile利用終
了でもないため解放しない。releaseの送信・応答失敗は記録するがjobの既に確定した結果を巻き戻さず、parent側が同じrecorded
IDの容量不足削除を安全側に遮断する。

`IEncodeFinishModel`は同じservice child内だけで使うPromise返却の結果settlement操作（`finishEncode()`）を提供し、
`EncodeManageModel`はそれをawaitしてからexact leaseのreleaseを一回試みる。結果反映は`IEncodeEvent`のfinish listenerを使
わず、direct portだけで実行する。結果settlement内の`ipc.encodeEvent.emitFinishEncode()`による完了通知を行う。queue
finalization、画面更新、完了outcome、元file削除の順序、公開API、業務IPC、設定、DB schemaは変更しない（依頼の記録は4.4と5.7で扱う）。

### 5.4 実行時間上限と進捗

実行時間上限は次式で算出する。

```text
実行時間上限 = 録画済み番組の duration × 変換方法の rate
```

`rate` が省略されていれば4を使う。上限到達時は通常の取消処理と同じmanaged handleへの`requestStop()`を行う。この呼出しは
stdio整理と一回の`SIGINT`要求後に完了し、processのterminalを待たない。取消処理そのものに新しい監視期限や再試行規則は追加
せず、外部処理の終了通知でジョブを確定する。

停止要求の完了後も対象は実行中一覧に保持し、processのterminalを確認した場合だけ`finalize()`する。遅延または重複した
terminal eventは同じジョブのtimer、listener、実行枠、および実行中一覧を一回だけ解放し、後から到着したeventでは通知、
cleanup、次依頼開始を重複させない。

外部処理の標準出力に、JSON形式の `type: "progress"`、数値 `percent`、文字列 `log` が揃った場合だけ進捗へ反映し、更新通知
を行う。不正な行または進捗を出さない方法は進捗なしとして扱う。

同梱の`config/enc-enhance.js.template`は、ffmpegの進捗行（`frame= … size=<数値>(kB|KiB) time=… bitrate=… speed=…x`）を正規表現で読み、
`percent`と`log`を持つ上記のJSONを標準出力へ出す。sizeの単位はffmpeg 7.0未満の`kB`と7.0以降の`KiB`の両方、行頭の名前は`size=`と
最後の行の`Lsize=`の両方を受け付ける。どれにも一致しない行は進捗なしとして読み飛ばす。

### 5.5 取消

-   待機中: 対象を待機列から除き、外部処理を開始せず、保持中のexact recorded-use tokenを一回解放する。
-   実行中: 対象ジョブが保持するmanaged handleでprocess managerへ停止を要求し、外部処理の終了後に実行中一覧から除く。
-   録画済み番組単位: 待機中と実行中から対象番組の識別番号を集め、それぞれへ取消を要求する。

実行中ジョブの停止要求直前、`log.encode.info`へ`kill encode process encodeId: <エンコードID>, pid: <対象processのpid>`
を一回記録する。要求が失敗した場合は`log.encode.error`へ`stop encode process failed: <エンコードID>`を記録する。

運用者が`kill -9`等の手動介入を行う際にpidをログから追えるようにするため、対象processのpidを含むinfo行を停止要求の
直前に記録する。handleが存在する場合は`this.childProcess`も同じ生存期間で保持されているため、追加の状態を持たずpid
を取得できる。

取消要求を受け付けた時点で取消通知を行う。番組単位の取消は個別の失敗を記録し、全件を試した後、一件以上失敗していれば呼出
元へ失敗を返す。

### 5.6 正常終了と結果反映

```mermaid
sequenceDiagram
    participant Job as 変換ジョブ
    participant Queue as 待機・実行管理
    participant Result as 結果反映
    participant Recorded as 録画済み番組管理
    participant Notify as 関係機能

    Job->>Queue: 正常終了（出力パスまたはnull）
    Queue->>Result: 結果反映を通知
    Queue->>Queue: 実行中から除外し次依頼を確認
    alt 出力ファイルあり
        Result->>Recorded: 録画ファイル登録
    else 出力ファイルなし
        Result->>Recorded: 元ファイルサイズ更新
    end
    alt 登録・更新失敗
        Result->>Notify: 画面更新と完了通知
    else 登録・更新成功
        opt 削除条件成立
            Result->>Recorded: 元ファイル削除
        end
        alt 削除不要または削除成功
            Result->>Notify: 画面更新と完了通知
        else 元ファイル削除失敗
            Note over Result,Notify: 失敗を記録し後続通知を行わない
        end
    end
```

結果反映と次の待機依頼の開始は独立して進み得る。これは、ジョブ終了時に実行中枠を先に解放し、結果反映の完了を待た
ずに次の待機列確認を行う順序である。

結果反映は次の順序を厳守する。

1. 出力ファイルがあれば新しい録画ファイルの登録を依頼する。なければ元ファイルのサイズ更新を依頼する。
2. 1が失敗した場合は失敗をログへ記録し、元ファイル削除を依頼しない。
3. 1が成功し、`removeOriginal` が真で、同じ変換元を使う別の待機中・実行中ジョブがなければ元ファイル削除を依頼する。
4. 1が失敗した場合、または1が成功して元ファイル削除が不要もしくは成功した場合は、画面更新とエンコード完了通知を行う。
5. 1の成功後に元ファイル削除が失敗した場合は、その失敗を結果settlementを待つ管理側（`EncodeManageModel`）でログへ記録し、後続の画面更新とエンコード完了通
   知を行わない。

完了通知へ進む場合は、録画済み番組ID、新規録画ファイルIDまたは`null`、および変換方法を通知する。結果登録またはサイズ更新
が失敗した場合も完了通知へ進むが、元ファイル削除は依頼しない。

### 5.7 記録の更新と削除

-   変換ジョブが出力ファイルのpathを決めた後、外部処理を開始する前に、依頼記録窓口の`updateOutputPath(id, path)`を一回
    awaitする。出力を作らない変換方法では呼ばない。失敗したときはログへ記録して変換を続ける（再起動後の出力途中のファイル
    の削除と、変換済みの判定ができなくなるだけで、変換そのものは妨げない）。
-   依頼が終わったとき（正常終了の結果settlementの完了後、異常終了・実行中の取消・実行時間上限による終了の途中出力削除の後、
    開始前確認の失敗、外部処理の開始失敗、待機中の取消、録画済み番組単位の取消）は、依頼記録窓口の`remove(id)`を一回awaitしてからexact leaseを解放する。失敗したと
    きはログへ記録して終了処理を続ける。結果settlementの後で削除するので、録画ファイルとして登録した後で削除に失敗しても、
    5.8の変換済みの判定で再変換を防ぐ。

### 5.8 起動時の復元

Web・API側処理の起動時（EPGStationの起動、Web・API側処理だけの再起動の両方）に、プロセス間通信と録画済みresource利用lease
が使える状態になった直後、HTTPの受付開始を待たずに一回だけ行う。受付（5.1）と、5.9の受け渡しは、復元が終わるまで待つ。

1. 依頼記録窓口の`list()`で、受け付け順に並べた全記録を受け取り、その識別番号の集合を「一覧に含まれていた識別番号」とし
   て保持する（5.9の重複除去に使う）。`list()`が失敗した場合はログへ記録し、記録を変更せず、受付と取消の待ちを解いて、60秒
   後（`unref()`したtimer）に`list()`からやり直す。成功するまで繰り返す。やり直しで戻す依頼は、その間に受け付けた依頼の後
   に並ぶ。
2. 記録ごとに、受け付け順に次を判定する。
   1. 同じ識別番号のジョブが待機列・実行中一覧にある場合と、同じ識別番号の受け渡し（5.9）を受付中の場合は、何もしない。判定
      中の識別番号は受け渡しの重複除去にも使う。
   2. 録画済み番組（関連する録画ファイルを含む）を読み、録画済み番組、または変換元ファイル（`sourceVideoFileId`の録画ファイ
      ルがその録画済み番組に登録されていること）が無ければ、記録を削除してログへ記録し、戻さない。録画済み番組の読取に失敗し
      た場合は、ログへ記録し、記録を残して戻さない（次の起動で判定し直す）。
   3. `outputPath`があり、その録画済み番組の録画ファイルのどれかのfull path（`IVideoUtil.getFullFilePathFromVideoFile`）
      が`outputPath`と一致する、または両方が存在して同じ実体（deviceとinode）を指すなら、変換を終えた依頼とみなして記録を
      削除し、出力ファイルを削除せず、戻さない。録画保存先のpathを変えた場合（symlinkやmountの付け替え）でも、登録済みの
      完成ファイルを途中出力と誤らない。元ファイルの削除（`removeOriginal`）が済んでいなくても、ここでは依頼しない。
   4. `outputPath`があり未登録なら、`encodeRemoveInterruptedOutput`が`true`で、かつ`outputPath`が依頼の親保存先
      （`option.parentDir`の保存先）の中を指すときだけ、出力途中のファイルの削除を試みる。ファイルが無い場合と削除の失敗は
      ログへ記録して続ける。それ以外はファイルを残す。変換は終わっていたが録画ファイルの登録の前に止まった完成ファイルも、
      未登録なのでこの規則で削除し、変換し直す。
   5. 録画済みresource利用leaseを`acquire(recordedId, 'encoding')`で取得する。取得できなければ記録を削除してログへ記録
      し、戻さない。
   6. 変換ジョブを生成して記録の識別番号を設定し、待機列の末尾へ追加する。`encodeQueueLimit`を超えても追加し、追加通知は
      作らない。ジョブの生成に失敗した場合はleaseを解放し、記録を残してログへ記録する。
3. 全記録を判定した後、`min(concurrentEncodeNum - runningQueue.length, waitQueue.length)`回だけ待機列確認を要求する（停
   止時間帯の判定は通常どおり行う）。同時実行数が0以下なら開始せず、戻した依頼は記録とともに残る。

復元にかかる時間は、記録ごとのDB読取とlease取得（5秒期限）の和で、その間の受付と取消は待つ。

### 5.9 録画完了による依頼

録画完了後のworkflowが作る依頼は、管理側で依頼記録窓口が受ける（`IPCServer.setEncode`）。呼出し元へは同期で戻り、記録以
後の処理は依頼記録窓口の直列の処理で行う。

1. 識別番号を割り当てて記録を保存する。保存に失敗した場合はログへ記録して終える（依頼は作られない）。
2. Web・API側処理が稼働していれば、識別番号と依頼内容を`pushEncode`で渡す。稼働していなければ渡さず、記録は次の起動時に
   5.8で戻る。送信の失敗はログへ記録し、記録は残す。
3. Web・API側処理は、5.8の復元が終わってから、5.1の2〜5と同じ受付の検査とlease取得を行い、受け取った識別番号でジョブを
   生成して待機列へ追加し、追加通知を行う。同じ識別番号のジョブが待機列または実行中一覧にある場合、5.8の「一覧に含まれていた識別番号」
   に含まれる場合、および復元がその識別番号を判定中の場合は何もしない（復元と受け渡しが重なった場合の重複を除く）。判定はlease取得の前に行う。管理側は記録の保存と
   `pushEncode`の送信、`list()`の応答を同じ直列の処理で行い、同じIPC channelの送信順で届くため、一覧の応答より前に送られた
   `pushEncode`の識別番号は必ず一覧に含まれる。同時実行数0以下、受付上限、lease取得失敗、またはジョブの生成・待機列への追加の失
   敗で受付を拒否した場合は、取得していたleaseと実行権を解放した後で記録を削除してログへ記録する（このときだけlease解放の後に
   削除する。削除の前に止まっても、記録は次の起動で判定し直される）。

## 6. 失敗、後始末、再起動

| 状況                     | 動作                                                 |
| ------------------------ | ---------------------------------------------------- |
| 同時実行数が0以下        | 新規依頼を拒否する                                   |
| 待機上限到達             | 新規依頼だけを副作用なしで拒否する                   |
| 起動時の待機上限が不正   | 本機能の起動を失敗させる                             |
| 開始前対象・設定なし     | 外部処理を開始せず失敗とし、実行中一覧から除く       |
| 共有枠取得失敗           | 失敗として終了し、再待機しない                       |
| 外部処理の開始失敗       | 失敗通知後、実行中一覧から除く                       |
| 異常終了または取消       | 途中出力の削除をbest-effortで試みる                  |
| 実行時間上限到達         | 停止を要求し、終了通知により失敗または取消を確定する |
| 結果登録・サイズ更新失敗 | ログへ記録し、元ファイルを削除せず、完了通知へ進む   |
| 元ファイル削除失敗       | 録画済み番組管理から返る既存の失敗として扱う         |
| 機能の起動・再起動       | 記録を受け付け順に待機列へ戻す（5.8）                |
| 中断された途中出力       | 設定が有効なら復元時に削除を試み、無効なら残す。既に無いファイルは削除済みとして扱う |
| 記録の保存失敗（受付）   | 依頼を失敗とし、leaseと実行権を解放する              |
| 記録の更新・削除失敗     | ログへ記録して変換と終了処理を続ける                 |
| 記録の一覧失敗（起動時） | ログへ記録し、記録を変更せず次の起動で再試行する     |
| 戻す依頼の対象なし       | 記録を削除してログへ記録し、戻さない                 |
| 録画完了時に子が未稼働   | 記録だけを保存し、次の起動時に戻す                   |
| 記録の読込失敗（管理側） | 操作を失敗とし、次の操作で読み直す                   |
| 解釈できない記録         | ログへ記録して削除し、残りを使う                     |
| `add`の応答なし          | `abandon`で記録の取消しを依頼する                    |
| Web・API側処理だけの異常終了 | 変換processは開始時に依頼の識別番号とともに管理側へ知らされている（7.13）。管理側が取消と同じ`SIGINT`で止め、停止を始めた時点で動いていた変換の出力途中のファイルを7.6〜7.8と同じ規則で削除してから、Web・API側処理を再起動させる（7.14。手順は`server-application-runtime`の§7.1）。再起動後の復元が同じ依頼を変換し直す |
| resource lease取得失敗   | 変換元を読まずprocessを開始せず失敗として終了する    |
| resource lease解放失敗   | 記録してjob結果を維持し、容量不足削除側は遮断を維持  |

途中出力削除と元ファイル削除は異なる。途中出力は失敗したジョブが生成しかけた出力であり、元ファイルは結果反映成功後だけ削
除を依頼できる入力である。

## 7. API・IPC・DB・ファイルシステム契約

### 7.1 API

既存の次の操作とレスポンス形を維持する。

-   変換一覧取得
-   変換追加
-   識別番号による取消
-   録画済み番組に関係する変換の取消

`encodeQueueLimit` 到達は既存のエラー応答経路を使い、新しい成功レスポンス項目を追加しない。

### 7.2 IPC

-   結果反映は、録画ファイル追加、ファイルサイズ更新、元ファイル削除の既存操作を使う。
-   完了通知は録画済み番組ID、新規録画ファイルIDまたは `null`、変換方法を渡す。
-   `encodeQueueLimit` はIPCへ渡さない。
-   依頼の記録の操作は、操作対象`encodeQueue`の`add(option, requestToken)`・`abandon(requestToken)`・
    `updateOutputPath(id, outputPath)`・`remove(id)`・`list()`をWeb・API側処理から管理側へ渡す。応答期限は通常の5秒で、自動retryしない。
-   録画完了による依頼の通知`pushEncode`は、依頼内容に識別番号を加えて渡す。
-   IPCの識別、再送、応答期限は `server-process-messaging` の責務であり、本機能では変更しない。
-   録画済みresource利用leaseはPMの内部resource-control carrierを使い、公開業務operation、HTTP API、設定項目を追加しな
    い。acquire/releaseは通常5秒期限を使い、自動retryしない。

### 7.3 DB

Web・API側処理はDBを直接更新せず、開始前照会と復元時の判定は読み取りだけを行い、結果反映は録画済み番組管理へ依頼する。依頼の
記録（4.4）は、管理側の依頼記録窓口だけが`server-persistence`の`IEncodeQueueDB`で保存・更新・削除・一覧する。

### 7.4 ファイルシステム

-   保存先名は設定された録画保存先へ解決する。
-   相対ディレクトリは録画済み番組の書式置換後に保存先へ結合する。
-   出力名は元ファイル名と変換方法の拡張子から作り、衝突時は番号付き候補を選ぶ。
-   失敗・取消時は当該ジョブの途中出力だけを削除対象とする。
-   結果登録成功前に元ファイルを削除しない。

## 8. 実装対応

| 設計要素                   | 配置                                                         | 責任                                                                            |
| -------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 待機上限設定               | `src/model/IConfigFile.ts`、`src/model/Configuration.ts`     | 任意の `encodeQueueLimit` と省略値1,024を扱う                                   |
| 起動時snapshotと検証       | `src/model/service/encode/EncodeManageModel.ts`              | 正の安全な整数へ検証し、不正値で構築を失敗させる                                |
| 上限到達前の同期受付予約   | `src/model/service/encode/EncodeManageModel.ts`              | 非同期境界前に受付予約と待機中の合計を検査・予約する                            |
| 停止時間帯                 | `src/model/IConfigFile.ts`、`src/model/Configuration.ts`、`src/model/service/encode/EncodeManageModel.ts` | 任意の `encodeSuspendTimes` を起動時に検証・保持し、時間帯中は待機列から開始せず、終了時に空き枠の範囲で再開する |
| 結果反映成功による削除条件 | `src/model/service/encode/EncodeFinishModel.ts`              | 登録またはサイズ更新の成功を確認した後だけ元ファイル削除へ進む                  |
| 録画済みresource利用lease  | PM所有`RecordedResourceUseClient`とservice child composition | queue公開前のacquire、待機から結果settlement後まで保持、Task 5.3のexact release |
| 依頼記録窓口               | `src/model/operator/encode/EncodeQueueStore.ts`、`IEncodeQueueStore.ts` | 識別番号の割当て、記録の直列の保存・更新・削除・一覧、受け付け順の並べ直し、録画完了依頼の記録と受け渡し |
| 記録の操作の受け渡し       | `src/model/ipc/IPCServer.ts`、`IPCClient.ts`、`IPCMessageDefine.ts` | `encodeQueue`の4操作と、識別番号付きの`pushEncode` |
| 受付・復元・記録の更新     | `src/model/service/encode/EncodeManageModel.ts`、`EncoderModel.ts`、`IEncoderModel.ts` | 受付時の記録、起動時の復元、出力先の記録、終了時の削除、識別番号付きの受け渡しの受付 |
| 復元の起動                 | `src/model/service/ServiceExecutor.ts`                       | Web・API側処理の起動時に復元を一回始める                                        |
| 途中出力の削除設定         | `src/model/IConfigFile.ts`、`src/model/Configuration.ts`     | `encodeRemoveInterruptedOutput`（省略時`true`）                                 |

開始前確認期限と取消期限は追加しない。

## 9. 機能固有テスト設計

本機能は`server-application-runtime`が所有する共有server test foundationへ、次の機能固有suiteを追加する。testは
`test/server/encoding/`に置き、仕様testは`encode-contracts.spec.test.ts`、依頼記録窓口の`encode-queue-store.spec.test.ts`、記録と復元の
`encode-queue-restore.spec.test.ts`、実装testは `encode-internals.test.ts`と`encode-queue-store.imp.test.ts`、結合
testは`encode-boundaries.integration.test.ts`と`encode-queue.integration.test.ts`とする。次節の71行を本機能唯一の機能固有Test Matrixとし、別matrixまたは
ledgerへ判定を分散させない。

### 9.1 AC別Test Matrix

各Acceptance Criterionは一行と一意な主test IDを持つ。同じtest caseが別ACを補助できても、主test IDを兼用しない。
R8.1・R8.3・R8.5は動作のtest caseを持たず、R8.1はR1〜R7の66主testの集合、R8.3は本表、R8.5は共有gateで判定する。これらの行のIDは判定対象の名前であり、主test IDの一意性の数には含めない。
`境界`の`adapter`はportのfakeを接続する単体test、`実境界`はDB、HTTP、IPC、filesystem、processを接続する結合testを表す。
最後の列は実装状態、主testの件数、および除外を表す。

| 契約／主test            | 種別／file                                           | 入力・値域                                                                                | 状態                                         | 時間・race・late settlement                      | 資源                                                  | 外部境界                             | failure                   | 期待結果                                                                                                                                                                             | 実装状態・主test・除外                                                     |
| ----------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------- | ------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `R1.1 / EN-SPEC-R1-1`   | spec／`encode-contracts.spec.test.ts`                | 有効な番組・元file・mode・保存先                                                          | 受付前→待機                                  | 通常受付                                         | 待機枠                                                | adapter                              | なし                      | 末尾へ一件追加                                                                                                                                                                       | 実装済み／主test 1／除外なし                  |
| `R1.2 / EN-SPEC-R1-2`   | spec／同上                                           | `removeOriginal`真・偽                                                                    | 待機                                         | 依頼ごと                                         | job                                                   | adapter                              | なし                      | 値を混同せず保持                                                                                                                                                                     | 実装済み／主test 1／除外なし                                              |
| `R1.3 / EN-SPEC-R1-3`   | spec／`encode-queue-restore.spec.test.ts` | 記録窓口が返した識別番号（1と最大安全整数）                                               | 受付前→待機                                  | 連続受付                                         | ID counter                                            | adapter                              | なし                      | 記録窓口が返した識別番号をそのまま返す                                                                                                                                                                     | 実装済み／主test 1／除外なし                                              |
| `R1.4 / EN-SPEC-R1-4`   | spec／同上                                           | `concurrentEncodeNum` 0、負数                                                             | 受付前                                       | 同期拒否                                         | 待機枠・ID                                            | adapter                              | 無効設定                  | job・ID・通知0回で拒否                                                                                                                                                               | 実装済み／主test 1／除外なし                                              |
| `R1.5 / EN-SPEC-R1-5`   | spec／同上                                           | 有効依頼1件                                                                               | 待機                                         | 追加後                                           | listener                                              | event adapter                        | 通知失敗                  | 受付成功時だけ追加通知1回                                                                                                                                                            | 実装済み／主test 1／除外なし                                              |
| `R1.6 / EN-SPEC-R1-6`   | spec／`encode-contracts.spec.test.ts`                | propertyなし・空config object                                                             | 起動前                                       | 起動snapshot                                     | config値                                              | config adapter                       | 省略                      | 既定1,024を一回読取                                                                                                                                                                  | 実装済み／主test 1／除外なし                                              |
| `R1.7 / EN-SPEC-R1-7`   | spec／同上                                           | 1、最大安全整数、明示`null`、空文字、0、負数、小数、NaN、Infinity、安全でない整数、非数値 | 起動前                                       | validation                                       | instance                                              | config adapter                       | 各不正値                  | 1と最大を受理し、明示値のその他は起動失敗                                                                                                                                            | 実装済み／主test 1／除外なし                                              |
| `R1.8 / EN-SPEC-R1-8`   | spec／同上                                           | 上限1、受付中1、待機0／受付中0、待機1                                                     | 受付中・待機                                 | 同一tick                                         | admission reservation・待機枠                         | adapter                              | なし                      | 合計が上限以下                                                                                                                                                                       | 実装済み／主test 1／除外なし                                              |
| `R1.9 / EN-SPEC-R1-9`   | spec／同上                                           | 上限到達後の重複受付                                                                      | 待機満杯                                     | 同着受付・race                                   | ID・job・listener                                     | adapter                              | queue full                | 新規だけ拒否、既存不変、副作用0回                                                                                                                                                    | 実装済み／主test 1／除外なし                                              |
| `R1.10 / EN-SPEC-R1-10` | spec／同上                                           | 起動時1、稼働中変更2                                                                      | 稼働中→再起動                                | reload前後                                       | config snapshot                                       | config adapter                       | なし                      | 現instanceは1、新instanceは2                                                                                                                                                         | 実装済み／主test 1／除外なし                                              |
| `R1.11 / EN-SPEC-R1-11` | spec／同上                                           | 上限設定あり                                                                              | 稼働中                                       | API・IPC projection                              | payload                                               | HTTP・IPC adapter                    | なし                      | API、UI設定、IPC業務payloadにfieldなし                                                                                                                                               | 実装済み／主test 1／除外なし                                              |
| `R1.12 / EN-SPEC-R1-12` | spec／`encode-queue-restore.spec.test.ts`・`encode-queue-store.spec.test.ts` | 記録の保存reject・応答なし、保存後の受付失敗、abandon | 受付中→失敗 | IPC期限・reject | lease・実行権・受付予約・記録 | IPC adapter（記録port） | add reject | 依頼失敗、ID・job・通知・queue追加0、leaseと実行権を各一回解放、応答なしはabandon一回、保存後の失敗はremove一回。窓口はabandonで対応する記録だけを削除 | 実装済み／主test 1／除外なし |
| `R2.1 / EN-SPEC-R2-1`   | spec／同上                                           | 異なる3依頼                                                                               | 待機→実行                                    | 同一tickの選択                                   | FIFO queue                                            | adapter                              | なし                      | 受付順に一件ずつ開始                                                                                                                                                                 | 実装済み／主test 1／除外なし                                              |
| `R2.2 / EN-SPEC-R2-2`   | spec／同上                                           | 同時実行上限1、依頼2                                                                      | 実行中・待機                                 | 先行未確定                                       | 実行枠                                                | process adapter                      | なし                      | process開始は最大1件                                                                                                                                                                 | 実装済み／主test 1／除外なし                                              |
| `R2.3 / EN-SPEC-R2-3`   | spec／同上                                           | 実行可能依頼                                                                              | 開始中                                       | job開始前                                        | managed handle                                        | process adapter                      | なし                      | 高優先度で共有枠取得を一回要求                                                                                                                                                       | 実装済み／主test 1／除外なし                                              |
| `R2.4 / EN-SPEC-R2-4`   | spec／同上                                           | 共有枠なし                                                                                | 開始中→失敗                                  | settlement reject                                | 待機枠・実行枠                                        | process adapter                      | create reject             | 失敗確定し再待機・自動retryなし                                                                                                                                                      | 実装済み／主test 1／除外なし                                              |
| `R2.5 / EN-SPEC-R2-5`   | spec／同上                                           | 待機2、実行1                                                                              | 実行→終了                                    | terminal後の次tick                               | 実行枠・queue listener                                | process adapter                      | なし                      | 枠解放後に次の先頭を確認                                                                                                                                                             | 実装済み／主test 1／除外なし                                              |
| `R2.6 / EN-SPEC-R2-6` | spec／`encode-queue-restore.spec.test.ts` | 受付・開始・正常終了・異常終了・実行中の取消・待機中の取消・開始失敗、更新・削除reject | 受付→実行→終了 | 開始前のpath確定、settlement後 | 記録port・lease | IPC adapter（記録port） | update/remove reject | 受付でadd一回、開始でupdateOutputPath一回、終了でremove一回（lease解放の前）、reject時もログだけで変換・終了処理を継続 | 実装済み／主test 1／除外なし |
| `R2.7 / EN-SPEC-R2-7` | spec／同上 | 停止時間帯内、待機2・空き枠2 | 待機 | 時間帯開始・境界時刻 | 待機枠・実行枠・timer | adapter | なし | 開始0件、待機列の順序不変、再開timer1件 | 実装済み／主test 1／除外なし |
| `R2.8 / EN-SPEC-R2-8` | spec／同上 | 時間帯前に実行1、時間帯内に追加1 | 実行中・受付中 | 時間帯へ入る | 実行枠・待機枠・listener | process・event adapter | なし | 実行中jobへの停止要求0回、新規依頼は受付・追加通知・待機 | 実装済み／主test 1／除外なし |
| `R2.9 / EN-SPEC-R2-9` | spec／同上 | 待機3、同時実行上限2 | 待機→実行 | fake timerで終了時刻直前・到達 | timer・実行枠・待機枠 | adapter | なし | 終了時刻到達後だけ受付順に2件開始し1件待機、timer残留0 | 実装済み／主test 1／除外なし |
| `R2.10 / EN-SPEC-R2-10` | spec／同上 | `HH:mm`境界、日付跨ぎ、`24:00`、複数時間帯 | 待機 | 開始時刻・終了時刻の直前・到達 | timer | adapter | なし | 開始時刻以上・終了時刻未満だけ保持、跨ぎ・複数時間帯を判定 | 実装済み／主test 1／除外なし |
| `R2.11 / EN-SPEC-R2-11` | spec／同上 | propertyなし、起動後に設定変更 | 起動前→稼働中→再起動 | 起動snapshot | config値 | config adapter | 省略 | 省略は停止なし、稼働中instanceは起動時の値を保持し新instanceだけ変更後の値 | 実装済み／主test 1／除外なし |
| `R2.12 / EN-SPEC-R2-12` | spec／同上 | `null`、配列以外、非object要素、欠落、形式外、範囲外、同時刻、境界`00:00`・`23:59`・`24:00` | 起動前 | validation | instance・projection | config・HTTP・IPC adapter | 各不正値 | 境界を受理し不正値は起動失敗、API・UI設定・IPC業務payloadにfieldなし | 実装済み／主test 1／除外なし |
| `R2.13 / EN-SPEC-R2-13` | spec／同上 | 待機1、時間帯内でローカル時刻が実時間より先へ進む | 待機→実行 | 時刻の前進、終了時刻の直前・到達後1分 | timer | adapter | なし | ローカル時刻が終了時刻に達してから1分以内に開始、それ以前は開始0件 | 実装済み／主test 1／除外なし |
| `R3.1 / EN-SPEC-R3-1`   | spec／同上                                           | 番組・元file・局・mode・保存先                                                            | 開始前                                       | 順次確認                                         | DB参照・file                                          | DB・filesystem adapter               | なし                      | 6項目確認後だけprocess開始                                                                                                                                                           | 実装済み／主test 1／除外なし                                              |
| `R3.2 / EN-SPEC-R3-2`   | spec／同上                                           | 6項目を一つずつ欠損、`null`                                                               | 開始前→失敗                                  | 各取得reject                                     | DB参照・file・実行枠                                  | DB・filesystem・process adapter      | missing/reject            | spawn 0回、失敗終了、枠回収                                                                                                                                                          | 実装済み／主test 1／除外なし                                              |
| `R3.3 / EN-SPEC-R3-3`   | spec／`encode-contracts.spec.test.ts`                | duration 0・1・最大有効値、rate 1                                                         | 開始前                                       | timer設定                                        | timer                                                 | 非適用: 純粋計算                     | overflow/不正値は上流契約 | `duration × rate`と一致                                                                                                                                                              | 実装済み／主test 1／範囲外は上流理由                                  |
| `R3.4 / EN-SPEC-R3-4`   | spec／同上                                           | rate欠損・空field                                                                         | 開始前                                       | timer設定                                        | timer                                                 | config adapter                       | 省略                      | 倍率4                                                                                                                                                                                | 実装済み／主test 1／除外なし                                              |
| `R3.5 / EN-SPEC-R3-5`   | spec／同上                                           | deadline直前・到達・超過                                                                  | 実行中→停止中→終了                           | fake timer、明示取消とのrace、late・重複terminal | timer・listener・managed handle・実行枠               | process adapter                      | terminal遅延              | 到達後だけstopを要求し、signal要求後にterminalを待たず応答する。terminalまでは実行中一覧を保持し、到着後だけfinalizeする。遅延・重複terminalでもtimer・listener・枠を各一回解放      | 実装済み／主test 1／除外なし                                              |
| `R3.6 / EN-SPEC-R3-6`   | spec／`encode-contracts.spec.test.ts`                | start reject・同期throw                                                                   | 開始中→失敗                                  | process settlement                               | 実行枠・listener                                      | process adapter                      | start failure             | 実行中から一回除去、次依頼確認                                                                                                                                                       | 実装済み／主test 1／除外なし                                              |
| `R3.7 / EN-SPEC-R3-7`   | spec／同上                                           | 5記法、`%OUTPUT%`有・無、空引数                                                           | 開始前                                       | command構築                                      | argv                                                  | process adapter                      | 不正command               | 指定位置だけ置換しargv一致                                                                                                                                                           | 実装済み／主test 1／除外なし                                              |
| `R3.8 / EN-SPEC-R3-8`   | spec／同上                                           | 親env重複key、全規定key                                                                   | 開始前                                       | spawn直前                                        | environment                                           | process adapter                      | なし                      | 親env継承＋規定key上書き、欠落keyなし                                                                                                                                                | 実装済み／主test 1／除外なし                                              |
| `R3.9 / EN-SPEC-R3-9`   | spec／同上                                           | 任意情報`null`・空、数値0・1・最大                                                        | 開始前                                       | serialization                                    | environment                                           | process adapter                      | なし                      | 欠損は空文字、数値は10進、`CHANNELNAME`維持                                                                                                                                          | 実装済み／主test 1／除外なし                                              |
| `R4.1 / EN-SPEC-R4-1`   | spec／同上                                           | 待機・実行各1、空queue                                                                    | 待機・実行                                   | snapshot取得                                     | queue projection                                      | HTTP adapter                         | なし                      | 二一覧を分離、空は空配列                                                                                                                                                             | 実装済み／主test 1／除外なし                                              |
| `R4.2 / EN-SPEC-R4-2`   | spec／同上                                           | ID・mode・recordedId                                                                      | 待機・実行                                   | snapshot取得                                     | DTO                                                   | HTTP adapter                         | なし                      | 各項目一致                                                                                                                                                                           | 実装済み／主test 1／除外なし                                              |
| `R4.3 / EN-SPEC-R4-3`   | spec／同上                                           | percent 0・1・最大100、log空・非空                                                        | 実行中                                       | 重複progress                                     | listener・progress state                              | process adapter                      | なし                      | 最新の取得値を対象jobへ反映                                                                                                                                                          | 実装済み／主test 1／除外なし                                              |
| `R4.4 / EN-SPEC-R4-4`   | spec／同上                                           | 有効progress                                                                              | 実行中                                       | 更新後                                           | listener                                              | event adapter                        | 通知失敗                  | state反映後に更新通知1回                                                                                                                                                             | 実装済み／主test 1／除外なし                                              |
| `R4.5 / EN-SPEC-R4-5`   | spec／同上                                           | 進捗なし、不正JSON、不正型                                                                | 実行中                                       | 複数stdout chunk                                 | stream・listener                                      | process adapter                      | parse failure             | 値を創作せず既存progress不変                                                                                                                                                         | 実装済み／主test 1／除外なし                                              |
| `R5.1 / EN-SPEC-R5-1`   | spec／同上                                           | 待機ID                                                                                    | 待機→取消                                    | 開始との同着race                                 | 待機枠・listener                                      | adapter                              | なし                      | queueから一回除去、spawn 0回                                                                                                                                                         | 実装済み／主test 1／除外なし                                              |
| `R5.2 / EN-SPEC-R5-2`   | spec／同上                                           | 実行ID、重複取消                                                                          | 実行中→停止中→終了                           | deadline・優先度入替とのrace、late・重複terminal | timer・listener・managed handle・stop promise・実行枠 | process adapter                      | stop reject               | `requestStop`へ一回集約し、signal要求後にterminalを待たず応答する。terminalまでは実行中一覧を保持し、到着後だけfinalizeする。child直接signal 0回、遅延・重複terminal後の解放は各一回 | 実装済み／主test 1／除外なし                                              |
| `R5.3 / EN-SPEC-R5-3`   | spec／同上                                           | 同番組の待機2・実行2、他番組1                                                             | 待機・実行→取消                              | 全件試行                                         | queue・handle                                         | process adapter                      | 一件cancel reject         | 対象4件を各一回試し他番組不変                                                                                                                                                        | 実装済み／主test 1／除外なし                                              |
| `R5.4 / EN-SPEC-R5-4`   | spec／同上                                           | 有効ID・重複要求                                                                          | 待機・実行                                   | 受付時                                           | listener                                              | event adapter                        | 通知失敗                  | 受理した取消ごとに契約どおり通知                                                                                                                                                     | 実装済み／主test 1／除外なし                                              |
| `R6.1 / EN-SPEC-R6-1`   | spec／同上                                           | 正常終了・出力あり                                                                        | 成功→反映中                                  | queue枠解放後                                    | 出力file・IPC                                         | IPC adapter                          | add rejectはR6.4          | file追加を一回依頼                                                                                                                                                                   | 実装済み／主test 1／除外なし                                              |
| `R6.2 / EN-SPEC-R6-2`   | spec／同上                                           | 正常終了・出力`null`                                                                      | 成功→反映中                                  | queue枠解放後                                    | 元file・IPC                                           | IPC adapter                          | update rejectはR6.4       | size更新を一回依頼                                                                                                                                                                   | 実装済み／主test 1／除外なし                                              |
| `R6.3 / EN-SPEC-R6-3`   | spec／同上                                           | 同じ元fileの別待機・実行job                                                               | 反映中                                       | 別jobとのrace                                    | 元file                                                | IPC adapter                          | なし                      | delete 0回、元file保持                                                                                                                                                               | 実装済み／主test 1／除外なし                                              |
| `R6.4 / EN-SPEC-R6-4`   | spec／同上                                           | add/update reject                                                                         | 反映中→失敗                                  | late reject                                      | 元file・IPC                                           | IPC adapter                          | DB登録・更新失敗          | error記録、delete 0回                                                                                                                                                                | 実装済み／主test 1／除外なし                                              |
| `R6.5 / EN-SPEC-R6-5`   | spec／同上                                           | 反映成功、削除真、別jobなし                                                               | 反映中                                       | DB反映settlement後                               | 元file・IPC                                           | IPC adapter                          | delete rejectはR6.8       | commit point後だけdelete一回                                                                                                                                                         | 実装済み／主test 1／除外なし                                              |
| `R6.6 / EN-SPEC-R6-6`   | spec／同上                                           | add/update reject                                                                         | 反映失敗→完了                                | late failure                                     | listener・元file                                      | IPC・event adapter                   | DB反映失敗                | delete 0回、完了通知1回                                                                                                                                                              | 実装済み／主test 1／除外なし                                              |
| `R6.7 / EN-SPEC-R6-7`   | spec／同上                                           | 反映成功＋削除不要／削除成功                                                              | 反映成功→完了                                | settlement順序                                   | listener・IPC                                         | IPC・event adapter                   | なし                      | 画面更新・完了通知各1回                                                                                                                                                              | 実装済み／主test 1／除外なし                                              |
| `R6.8 / EN-SPEC-R6-8`   | spec／同上                                           | 反映成功後delete reject                                                                   | 反映成功→削除失敗                            | late reject                                      | 元file・listener                                      | IPC・event adapter                   | delete failure            | error記録、後続画面更新・完了通知0回                                                                                                                                                 | 実装済み／主test 1／除外なし                                              |
| `R6.9 / EN-SPEC-R6-9`   | spec／同上                                           | 実行1、待機1                                                                              | 実行→終了                                    | 結果反映との並行・late settlement                | 実行枠・queue listener                                | process・IPC adapter                 | 反映遅延                  | 実行中から一回除去し次依頼確認                                                                                                                                                       | 実装済み／主test 1／除外なし                                              |
| `R7.1 / EN-SPEC-R7-1`   | spec／同上                                           | 異常終了・取消、出力あり・なし                                                            | 失敗・取消                                   | terminal重複                                     | 途中出力・listener                                    | filesystem adapter                   | unlink reject             | 対象途中出力だけ一回削除試行、元file不変                                                                                                                                             | 実装済み／主test 1／除外なし                                              |
| `R7.2 / EN-SPEC-R7-2` | spec／`encode-queue-restore.spec.test.ts` | 記録3件（最大値をまたぐ）、上限1、同時実行2、復元中の受付・取消、一覧失敗 | 起動 | 復元とHTTP受付の競合、60秒のやり直し | 待機列・lease・timer | IPC adapter（記録port）・DB読取adapter | list reject | 受け付け順に全件待機へ戻し、上限超過でも戻し、追加通知0、空き枠の数だけ開始、復元中の受付・取消は復元後に処理、一覧失敗は記録不変で受付を待たせず60秒後にやり直す | 実装済み／主test 1／除外なし |
| `R7.3 / EN-SPEC-R7-3` | spec／`encode-queue-store.spec.test.ts` | 記録なし、記録あり、終了後の次の受付 | 起動・稼働中 | 起動時の読込 | 識別番号の集合 | DB adapter | なし | 記録なしは1、記録ありは最も新しい記録の次、終了で戻さない | 実装済み／主test 1／除外なし |
| `R7.4 / EN-SPEC-R7-4` | spec／`encode-queue-store.spec.test.ts` | 最も新しい記録が最大安全整数の起動、次の依頼 | 稼働中 | wrap境界 | 識別番号の集合 | DB adapter | なし | 最大値の次は1、その次は2で受付を続ける。使用中の値を飛ばす分岐は、記録の幅が識別番号の空間より狭く操作の順序では作れないため`EN-IMP-QUEUE-STORE-ID`で内部状態から固定する | 実装済み／主test 1／除外なし |
| `R7.5 / EN-SPEC-R7-5` | spec／`encode-queue-store.spec.test.ts` | 最大値をまたいだ記録、跨がない記録、0件・1件 | 起動 | 並べ直し | 記録の一覧 | DB adapter | なし | 最大値から1へ戻った箇所を境目に受け付け順、跨がなければ昇順、次の値は最も新しい記録の次 | 実装済み／主test 1／除外なし |
| `R7.6 / EN-SPEC-R7-6` | spec／`encode-queue-restore.spec.test.ts` | 出力先が登録済み（pathが一致、同じ実体） | 起動 | 復元 | 記録・出力file | DB読取・filesystem adapter | なし | 記録を削除、unlink 0回、待機へ戻さない | 実装済み／主test 1／除外なし |
| `R7.7 / EN-SPEC-R7-7` | spec／同上 | 出力先が未登録、設定`true`・`false`・省略、親保存先の外、file無し、unlink reject | 起動 | 復元 | 出力file | filesystem adapter | unlink reject | `true`・省略かつ親保存先の中はunlink一回の後に待機へ戻す、`false`と保存先の外はunlink 0回で戻す、失敗はログだけ | 実装済み／主test 1／除外なし |
| `R7.8 / EN-SPEC-R7-8` | spec／同上 | 録画済み番組なし、変換元なし、lease取得失敗、録画済み番組の読取失敗 | 起動 | 復元 | 記録・lease | DB読取・IPC adapter | 各失敗 | 記録を削除しログ、待機へ戻さない。読取失敗は記録を残して戻さない | 実装済み／主test 1／除外なし |
| `R7.9 / EN-SPEC-R7-9` | spec／`encode-queue-store.spec.test.ts` | 子あり・子なし、保存reject、送信失敗 | 録画完了 | 記録の後に送信 | 記録・送信 | DB・IPC adapter | 保存reject・send失敗 | 記録を保存してから識別番号付きで送信、子なしは記録だけ、保存失敗は送信0、送信失敗は記録を残す | 実装済み／主test 1／除外なし |
| `R7.10 / EN-SPEC-R7-10` | spec／`encode-queue-restore.spec.test.ts` | 識別番号付きの受け渡しを同時実行数0・上限・lease失敗で拒否、受理 | 受付 | 拒否 | 記録port・lease | IPC adapter | 各拒否 | 拒否はremove一回とログ、ジョブ・通知0。受理は記録の識別番号でジョブと追加通知 | 実装済み／主test 1／除外なし |
| `R7.11 / EN-SPEC-R7-11` | spec／同上 | 待機・実行中と同じ識別番号、一覧に含まれていた識別番号（終了済みを含む） | 受付 | 重複通知 | 待機列 | IPC adapter | なし | ジョブ追加0、lease取得0、記録削除0 | 実装済み／主test 1／除外なし |
| `R7.13 / EN-SPEC-R7-13` | spec／`encode-contracts.spec.test.ts` | 変換の開始 | 開始 | 実行 | 変換process | process管理adapter | なし | 開始要求に`report: { kind: 'encode', encodeId }`を添える | 実装済み／主test 1／除外なし |
| `R7.14 / EN-SPEC-R7-14` | spec／`service-child-crash.spec.test.ts` | Web・API側処理の異常終了、実行中の変換2件（親保存先の中と外） | 実行 | 停止 | 変換process・出力file | 管理側の後始末 | なし | 各processへ`SIGINT`一回、親保存先の中の出力だけ削除、その後に使用権を解放 | 実装済み／主test 1／除外なし |
| `R7.12 / EN-SPEC-R7-12` | spec／`encode-queue-store.spec.test.ts` | 読込reject、壊れたJSON・項目欠落・範囲外の識別番号、削除reject | 管理側の最初の操作 | 読込のやり直し | 記録・識別番号の集合 | DB adapter | findAll・deleteOnce reject | 操作を失敗にし次で読み直す、壊れた記録は削除しログ、削除できない番号は割り当てない | 実装済み／主test 1／除外なし |
| `R8.1 / EN-SPEC-R1-1〜EN-SPEC-R7-14（66主testの集合）` | spec／`encode-contracts.spec.test.ts`・`encode-queue-store.spec.test.ts`・`encode-queue-restore.spec.test.ts`                | R1–R7契約一覧                                                                         | 全状態                                       | 通常・失敗・race                                 | 全機能固有資源                                        | adapter群                            | 代表失敗注入              | 66契約主testが一意に存在                                                                                                                                                             | 実装済み／主test 66／除外なし                                              |
| `R8.2 / EN-SPEC-R8-2`   | imp／`encode-internals.test.ts`・`*.imp.test.ts`     | 値域・分岐一覧                                                                        | 全内部状態                                   | 境界・settlement                                 | queue・timer・process・file                           | adapter群                            | 各分岐失敗                | 指定内部caseを追加imp caseへ収容                                                                                                                                                     | 実装済み／除外なし     |
| `R8.3 / EN-MATRIX-R8-3` | Test Matrix／本節                                    | null、空、0、1、最小、最大、範囲外、不正型、重複                                          | 受付前・待機・実行・成功・失敗・取消・再起動 | 同着、取消×期限、late settlement                 | 待機枠・timer・process・途中出力・元file              | 全分類                               | 未分類cell                | 71行・主ID重複0・非適用理由あり                                                                                                                                                      | 実装済み（本表）／71 AC                                                    |
| `R8.4 / EN-INTEGRATION-T6-6-HTTP-IPC-FS-PROCESS` | integration／`encode-boundaries.integration.test.ts`・`encode-queue.integration.test.ts` | HTTP各操作、IPC各操作、衝突file、synthetic command                                        | 全状態                                       | process停止・IPC settlement                      | HTTP server・IPC peer・file・child・listener          | HTTP・IPC・filesystem・process実境界 | carrier/process/file失敗  | 9.4の境界caseを個別実行し成功・失敗・cleanupを観測                                                                                                                                   | 実装済み／主test＋境界case／DB transaction非適用                           |
| `R8.5 / EN-GATE-R8-5`   | 品質判定／共有foundation                             | 機能固有suite（spec・imp・integration）                                                   | 全状態                                       | 全件成功とC0・C1                                 | test・coverage結果                                    | 共有foundation                       | 不一致未解決              | 全件成功とRuntime Requirement 9 Acceptance Criterion 9のC0・C1成立まで未完了                                                                                                         | 実装済み（共有gate）／除外2件（`EncodeFileManageModel.getFilePath`、`EncodeManageModel.checkQueue`） |

入力観点の非適用は次のように限定する。TypeScript内部interfaceだけに対する不正型はcompile時型検証の責務であり、runtime
castで存在しないvalidationを創作しない。ただし設定、HTTP payload、process stdoutの不正型は実際のruntime境界として検証す
る。空は省略設定、空文字の環境変数・log・引数・空queueへ、`null`は出力なし・欠損外部取得へ、0と1は上限・件数・進捗・数値
環境変数へ割り当てる。最小・最大・範囲外は`encodeQueueLimit`、`encodeSuspendTimes`の時刻、識別番号、progress、durationへ割り当て、承認済み最大値がな
い項目は上流validation境界として理由付き非適用にする。重複は同着受付、重複取消、重複progress、重複terminal・通知へ割り当
てる。

### 9.2 必須観点と追加実装case

R1からR7の66 ACはすべて、`encode-contracts.spec.test.ts`、Web・API側処理の異常終了の契約（R7.14）を`service-child-crash.spec.test.ts`、依頼記録窓口の契約（R1.12の取消し、R7.3〜R7.5、R7.9、R7.12）を`encode-queue-store.spec.test.ts`、Web・API側処理の記録と復元の契約（R1.3、R1.12、R2.6、R7.2、R7.6〜R7.8、R7.10、R7.11）を`encode-queue-restore.spec.test.ts`の一意な`EN-SPEC-*`主testで判定する。次の`EN-IMP-*`はR8.2を満たす
追加caseであり、主testの代替や重複したAC traceにはしない。

| 必須観点               | 主test／追加case                                                                                            | 判定とassertion                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `encodeQueueLimit`値域 | `EN-SPEC-R1-6`、`EN-SPEC-R1-7`／`EN-IMP-QUEUE-LIMIT-VALIDATION`                                             | propertyなし・空config objectだけが1,024。明示`null`、空文字、非数値、非安全整数は起動失敗                                                   |
| 依頼の記録と復元 | `EN-SPEC-R1-12`、`EN-SPEC-R2-6`、`EN-SPEC-R7-2`〜`EN-SPEC-R7-11`／`EN-IMP-QUEUE-STORE-ID`、`EN-IMP-QUEUE-STORE-ORDER`、`EN-IMP-QUEUE-STORE-SERIAL`、`EN-IMP-QUEUE-RESTORE` | 識別番号は1〜最大安全整数、最大値の次は1、使用中を飛ばす。並べ直しは0件・1件・跨ぎあり・なし。保存・更新・削除・一覧の各reject。復元の各判定の順序（対象なし→登録済み→途中出力→lease）と、復元中の受付の待ち |
| 停止時間帯 | `EN-SPEC-R2-7`〜`EN-SPEC-R2-13`／`EN-IMP-SUSPEND-TIMES-VALIDATION`、`EN-IMP-SUSPEND-TIMES-RESUME`、`EN-IMP-SUSPEND-TIMES-LOCK-WAIT`、`EN-IMP-SUSPEND-TIMES-DST` | propertyなしだけが停止なし。境界`00:00`・`23:59`・`24:00`を受理し、明示`null`・不正型・形式外・範囲外・同時刻は起動失敗。再開timerは重複せず、delayは最も早い`end`までと60秒の小さい方、発火時の確認要求は空き枠と待機数の小さい方の回数。時間帯の開始前に要求され実行権を待っていた確認は、取得後に一件だけ開始する。時間帯の中で要求された確認は、空き枠・待機依頼が無い時点の要求でも実行権を求めず、開始しない。日付を跨ぐ時間帯の後半と終了1ミリ秒前のdelay、終日の時間帯、時間帯中の取消、開始失敗の後始末が出す確認を固定する。サマータイムのある時刻帯（子processの`TZ`）で、時計が進む日・戻る日の終了と、飛ばされる・繰り返される時刻を判定する |
| 再入                   | `EN-SPEC-R2-5`、`EN-SPEC-R6-9`／`EN-IMP-QUEUE-REENTRY`                                                      | queue確認中の追加・終了event再入でも同じjobを二重dequeueせず、実行権と枠を各一回だけ解放                                                     |
| 受付実行権の取得失敗   | `EN-SPEC-R1-8`／`EN-IMP-ADMISSION-CLEANUP`                                                     | 受付reservationを一回解放。未取得の実行権は解放0回、ID・job・通知・queue追加0回                                                              |
| job生成失敗            | `EN-SPEC-R1-9`／`EN-IMP-ADMISSION-CLEANUP`                                                       | 受付reservationと取得済み実行権を各一回解放し、不完全job・ID公開・通知0回                                                                    |
| queue追加失敗          | `EN-SPEC-R1-9`／`EN-IMP-ADMISSION-CLEANUP`                                                     | 受付reservationと取得済み実行権を各一回解放し、部分追加・二重移行・通知0回                                                                   |
| timeout                | `EN-SPEC-R3-3`、`EN-SPEC-R3-4`、`EN-SPEC-R3-5`／`EN-IMP-TIMEOUT-BOUNDARY`                                   | 算出値、既定4、直前・到達・超過を分離し、到達後だけstop一回                                                                                  |
| process settlement     | `EN-SPEC-R3-5`、`EN-SPEC-R3-6`、`EN-SPEC-R5-2`／`EN-IMP-R3-5-R5-2`                              | stop応答はterminalを待たず、一覧はterminalまで保持。遅延・重複terminalでtimer・listener・枠・finalize各一回                                  |
| command・environment   | `EN-SPEC-R3-7`、`EN-SPEC-R3-8`、`EN-SPEC-R3-9`／`EN-IMP-COMMAND-REPLACEMENT`、`EN-IMP-ENVIRONMENT`、`EN-IMP-ENVIRONMENT-CHANNEL-FALLBACK`                               | 置換有無、全key、欠損空文字、10進文字列、親env上書き順を分岐ごとに固定                                                                       |
| DB登録・更新と元file   | `EN-SPEC-R6-1`から`EN-SPEC-R6-8`／`EN-IMP-RESULT-REFLECTION`、`EN-IMP-SOURCE-DELETION`、`EN-IMP-R6-4-5`、`EN-IMP-R6-8`                                           | IPC settlement成功を削除commit pointとし、失敗・別job・削除不要では元file保持                                                                |
| resource利用lease      | `EN-SPEC-R1-1`、`EN-SPEC-R3-1`、`EN-SPEC-R3-2`、`EN-SPEC-R5-1`、`EN-SPEC-R5-2`／`EN-IMP-RECORDED-USE-PRE-SETTLEMENT`、`EN-IMP-RECORDED-USE-WAIT-CANCEL`、`EN-IMP-RECORDED-USE-RELEASE-LEDGER`、`EN-IMP-RECORDED-USE-SETTLEMENT` | queue公開前acquire、取得失敗時ID/job/queue/通知/read/spawn 0、待機取消または結果settlement後でexact release、late/double/stale release無作用 |
| 利用中snapshot         | supporting cross-spec case／`EN-IMP-RECORDED-USE-SNAPSHOT-INACTIVE`                                                  | 待機中・実行中recorded IDの和集合をread-onlyで返し、列挙不能時は部分集合でなくunknown。queue状態とleaseを変更しない                          |
| 重複通知               | `EN-SPEC-R4-4`、`EN-SPEC-R5-4`、`EN-SPEC-R7-1`／`EN-IMP-R3-5-R5-2`、`EN-IMP-R7-1-5`                     | 同じprogress・取消・terminalの重複deliveryでも状態反映、通知、cleanupを契約回数だけ行いlistenerを一回回収                                    |
| DB transaction         | owner委譲のため非適用                                                                                       | 本機能はtransactionを開始・commit・rollbackせず、`server-recorded-content`のDB portをIPC経由で利用する。transaction検証は同owner spec        |

### 9.3 状態と資源

| 分類           | 期待状態・結果                                                                              | 一回だけの回収または保持assertion                                                      |
| -------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 受付前・受付中 | 起動snapshotの上限で同期予約し、直列化したままlease取得、満杯・取得失敗なら副作用なしで拒否 | reservationをlease付き待機一件へ移すか失敗時に一回解放                                 |
| 待機           | FIFO末尾でexact leaseとともに保持し、取消なら開始しない                                     | 待機枠とleaseを各一回解放、process生成0回                                              |
| 停止時間帯中   | 待機列を変更せず開始せず、再開timerを一つだけ保持する。実行中・受付・取消は影響を受けない | 再開timerの設定は一回、発火後に破棄し、空き枠の範囲だけ開始する |
| 実行・停止中   | 高優先度handleを保持し、取消・期限・入替えは同じstop operationへjoin                        | timer、listener、stop promiseを重複生成せずchild直接signal 0回                         |
| 成功・反映中   | 実行枠を先に解放し、DB登録または更新のsettlementを待つ                                      | queue finalize一回、結果反映一回                                                       |
| 反映成功       | DB登録・更新成功を元file削除可否のcommit pointとする                                        | 全削除条件成立時だけ元file削除一回                                                     |
| 反映失敗       | 元fileを保持して失敗を記録し、完了通知へ進む                                                | 元file削除0回、完了通知一回                                                            |
| 削除失敗       | 失敗を記録し、後続通知を行わない                                                            | 画面更新・完了通知0回                                                                  |
| 取消・異常終了 | 当該途中出力だけを削除試行する                                                              | cleanup一回、元file削除0回、重複terminalは無作用                                       |
| 再起動         | 記録を受け付け順に待機へ戻し、進捗は戻さない。識別番号は記録の続きから割り当てる | 戻せない記録は削除、出力途中のファイルは設定に従い削除または保持 |
| lease取得中    | queueへ公開せず、ID・jobを作らず、PMの通常5秒結果を待つ                                     | 失敗・期限超過でqueue/通知/DB/file/process 0、late grantedはPMが解放                   |
| lease保持中    | queue公開前から待機・実行・結果settlement完了まで同じtokenを保持                            | 受付失敗またはTask 5.3のsettlement後にrelease一回、release未確認は削除可能と推測しない |

### 9.4 結合境界case

結合testは共有foundation上の`encode-boundaries.integration.test.ts`に配置し、各caseで成功、失敗、およびcleanupを個別に観
測する。IPCは実際の`IPCClient`と`IPCServer`を接続し、相手側だけをsynthetic recorded-content handlerまたはsynthetic
operator-event handlerとする。DB connectionやtransaction fixtureを本機能へ持ち込まない。

| 境界／case ID                                                        | 成功case                                                                  | failure case                          | cleanup・保持assertion                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------- |
| HTTP一覧・追加／`EN-INTEGRATION-T6-6-HTTP-IPC-FS-PROCESS`                | 有効payloadでIDを返し、実行中のjobをresponseへ返す                        | 不正payloadの拒否                     | 拒否時にproviderを呼ばず、ID・jobを作らない                                                 |
| HTTP識別番号取消／`EN-INTEGRATION-T6-6-HTTP-IPC-FS-PROCESS`、`EN-INTEGRATION-HTTP-CANCEL-WAITING-ID` | 実行中のIDを取消し、stopを一回要求する。待機中のIDの取消は同じrouteから待機枠を外し、開始せず実行中のjobに触れない | 存在しないIDは待機列・実行中の一覧を変えず、取消通知を一回発行して200を返す | 対象外queue不変、listener・stop operation重複0件 |
| 番組単位取消（管理側）／`EN-SPEC-R5-3`、`EN-SPEC-R5-3-4`（`encode-contracts.spec.test.ts`）。`DELETE /recorded/{recordedId}/encode`のrouteは`server-service-interface`のroute test（`route-contracts.ts`の`recorded/{recordedId}/encode`）、`RecordedApiModel.stopEncode`の委譲は`test/server/recorded-content/cleanup.spec.test.ts`の`stopEncode`のcase | 対象番組の全jobを取消                                                     | 一件失敗後も残件を試行し、最後に`StopEncodeError` | 他番組不変、各対象の取消を一回ずつ試行                                                      |
| IPC file追加・size更新・元file削除・完了通知／`EN-INTEGRATION-T6-6-HTTP-IPC-FS-PROCESS`、`EN-INTEGRATION-RECORDED-RESULT`、`EN-INTEGRATION-RECORDED-RESULT-FAILURE` | real client/serverでsynthetic handlerへpayloadを一回ずつ配送する          | handler reject・serialization failure | 失敗後も元fileを保持し、削除失敗時は画面更新・完了通知0回                                  |
| IPC resource lease／`EN-INTEGRATION-RECORDED-USE-ORDER`、`EN-INTEGRATION-RECORDED-USE-REJECT` | queue公開前にencoding leaseを取得し待機・実行・結果settlement完了まで保持 | lease carrierのreject                 | 未取得時ID/job/queue/通知/read/spawn 0                                                      |
| IPC resource snapshot／`EN-INTEGRATION-RECORDED-USE-SNAPSHOT-INACTIVE` | 待機中・実行中IDをsnapshotとして返す                                      | provider列挙不能（`EN-IMP-RECORDED-USE-SNAPSHOT-INACTIVE`） | unknownへ収束し、queue変更・取消・lease操作0回                                              |
| filesystem出力名衝突／`EN-INTEGRATION-T6-6-HTTP-IPC-FS-PROCESS`                | temporary directoryで既存名を避け番号付き候補を選択する                    | —                                     | 既存fileの内容が不変                                                                        |
| filesystem途中出力／`EN-INTEGRATION-FS-PARTIAL-CLEANUP`              | 異常・取消時に対象途中出力だけ削除                                        | unlink reject                         | 削除試行一回、別file・元file不変、失敗記録                                                  |
| filesystem元file保持／`EN-INTEGRATION-RECORDED-RESULT-FAILURE`       | 反映失敗で元fileを保持                                                    | delete要求が誤って届けばtest失敗      | 元file存在、delete call 0回                                                                 |
| process起動・環境／`EN-INTEGRATION-T3-1`、`EN-INTEGRATION-T3-3`、`EN-INTEGRATION-T6-2-OUTPUT` | synthetic commandを実childで起動しargv・全env・progressを返す             | 起動失敗（共有枠の拒否）。不正progressは`EN-SPEC-R4-5`・`EN-IMP-R4-PROGRESS-PARSER` | stdio・listener・child参照・実行枠をterminal後に一回回収                                    |
| process停止／`EN-INTEGRATION-PROCESS-STOP`、`EN-INTEGRATION-LIFECYCLE-ACTUAL-DEADLINE` | 取消・期限でmanaged stopを一回要求                                        | terminal遅延。stop rejectは`EN-IMP-R5-2` | 応答はterminal非待機、一覧はterminalまで保持しtimer・listener・枠を一回回収                 |

HTTP routeの契約は`server-service-interface`のroute testが検査する。容量削除との競合を含む実際のPM IPC・Runtime境界は、`test/server/process-messaging/integration/process-messaging.integration.test.ts`、
`test/server/application-runtime/storage-pressure-deletion.integration.test.ts`、
`test/server/application-runtime/service-child-recorded-use-registry.integration.test.ts`、
`test/server/service-interface/recorded-resource-use-binding.integration.test.ts`が検査し、本機能の結合testは
consumer側をfake carrierで検査する。

外部network、実運用DB、実録画file、実設定値は使用しない。録画済み番組のDB transactionは`server-recorded-content`のowner境
界であり、本機能では非適用理由だけを記録する。

依頼の記録の結合testは`encode-queue.integration.test.ts`に置き、次を個別に観測する。DBは共有foundationのSQLite（一時
directory）とMySQL fixtureを使い、IPCは実際の`IPCClient`と`IPCServer`を接続する。

| 境界／case ID                                   | 成功case                                                                                 | failure case                         | cleanup・保持assertion                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------- |
| 記録のDB往復／`EN-INTEGRATION-QUEUE-DB`         | SQLite・MySQLへ追加・出力先の更新・削除・一覧が行の値（最大安全整数の識別番号を含む）を保つ | 存在しない識別番号の削除・更新        | 他の行が不変                                 |
| 記録の再読込／`EN-INTEGRATION-QUEUE-RELOAD`     | 依頼記録窓口を作り直すと、最大値をまたいだ記録が受け付け順に並び、次の識別番号が続く       | —                                    | DB上の行が不変                               |
| IPCの記録操作／`EN-INTEGRATION-QUEUE-IPC`       | real client/serverで`add`・`updateOutputPath`・`remove`・`list`を管理側の窓口へ配送する    | 窓口のreject                         | 応答の待ちが残らない                         |
| 復元／`EN-INTEGRATION-QUEUE-RESTORE`            | 実DBの記録からWeb・API側の管理を作り直すと、受け付け順に待機へ戻り、途中出力の一時fileを設定どおり削除・保持する | 録画済み番組が無い記録 | 削除した記録がDBから消え、残すfileが残る     |

補足として、同じfileの`EN-INTEGRATION-REAL-FFMPEG`の2 caseは、node のscriptで代用しているencode commandを、同梱の`config/enc.js.template`と本物の ffmpeg（入力は ffmpeg の lavfi で作る合成の TS）に置き換え、待機列の順の実行・出力の登録（実際の MP4 の video・audio stream）と、実行中の取消（途中出力の削除、待機列・実行中の一覧が空になる）を確かめる。AC の主testを兼ねず、上の Test Matrix の行数に数えない。

同様に、`config/enc-enhance.js.template`の進捗行の解析は、`test/server/encoding/enc-enhance-progress.spec.test.ts`が、進捗行を標準エラー出力へ出す代用のffmpegを渡して実際に起動し、`kB`・`KiB`の各`size=`行と`Lsize=`行から進捗のJSONが出ること、一致しない行では出ないことを確かめる。これもACの主testを兼ねず、Test Matrixの行数に数えない。

## 10. 要件トレーサビリティ

| 要件 | 設計箇所      | 検証観点                                       |
| ---- | ------------- | ---------------------------------------------- |
| 1.1  | 4.1、5.1      | 指定した依頼が待機列へ入る。手動依頼の保存先外のdirectoryは拒否 |
| 1.2  | 4.1、5.6      | 依頼ごとの `removeOriginal`                    |
| 1.3  | 4.4、5.1      | 記録窓口が割り当てる識別番号                   |
| 1.4  | 4.3、5.1      | 同時実行数0以下の受付拒否                      |
| 1.5  | 3、5.1        | 受付成功時の追加通知                           |
| 1.6  | 4.3、9.1      | propertyなし・空config objectだけが省略時1,024 |
| 1.7  | 4.3、8、9.1   | 明示`null`・空文字を含む不正値の起動失敗       |
| 1.8  | 5.1           | 受付処理中と待機中の合計上限                   |
| 1.9  | 5.1、9.2      | 上限拒否時と受付段階失敗時の副作用なし         |
| 1.10 | 4.3           | 起動snapshot                                   |
| 1.11 | 4.3、7.1、7.2 | 非公開設定                                     |
| 1.12 | 5.1           | 記録の保存失敗時の受付失敗                     |
| 2.1  | 5.2           | FIFO先頭選択                                   |
| 2.2  | 5.2           | 同時実行数上限                                 |
| 2.3  | 2.3、5.2      | 共有枠取得                                     |
| 2.4  | 5.2、6        | 共有枠失敗時の終了                             |
| 2.5  | 5.2、5.6、9.2 | 終了後の次依頼確認と再入                       |
| 2.6  | 4.4、5.7、7.3 | 受付から終了までの記録、出力先の記録、終了時の削除 |
| 2.7  | 5.2           | 停止時間帯中の待機保持                         |
| 2.8  | 5.1、5.2      | 停止時間帯中の実行継続と受付                   |
| 2.9  | 5.2           | 停止時間帯終了後の空き枠の範囲での再開         |
| 2.10 | 4.3、5.2      | 時間帯の判定（境界・日付跨ぎ・ローカル時刻）   |
| 2.11 | 4.3           | 起動時の読込・省略時なし・再起動時の反映       |
| 2.12 | 4.3、7.1、7.2 | 値の検証と非公開設定                           |
| 2.13 | 5.2           | サマータイム・時刻変更後の1分以内の再判定      |
| 3.1  | 5.3           | 開始前の6項目確認。保存先外のdirectoryは親保存先直下へ |
| 3.2  | 5.3、6        | 確認失敗時の終了                               |
| 3.3  | 5.4           | duration×rate                                  |
| 3.4  | 4.3、5.4      | 既定倍率4                                      |
| 3.5  | 5.4、6、9.2   | 上限時の停止応答とterminal後finalize           |
| 3.6  | 5.2、6        | 開始失敗時の実行中除外                         |
| 3.7  | 5.3、7.4      | command置換                                    |
| 3.8  | 5.3、7.4      | 変換用環境変数                                 |
| 3.9  | 5.3、7.4      | 欠損値・数値・key名                            |
| 4.1  | 4.2           | 待機・実行の分離                               |
| 4.2  | 4.2           | ID・方法・録画済み番組                         |
| 4.3  | 5.4           | 進捗率・メッセージ反映                         |
| 4.4  | 3、5.4、9.2   | 進捗通知と重複delivery                         |
| 4.5  | 4.2、5.4      | 進捗非推定                                     |
| 5.1  | 5.5           | 待機中取消                                     |
| 5.2  | 5.5、9.2      | 実行中停止応答とterminal後finalize             |
| 5.3  | 5.5           | 番組単位取消                                   |
| 5.4  | 5.5、9.2      | 取消通知と重複delivery                         |
| 6.1  | 5.6、9.4      | 出力ファイル登録                               |
| 6.2  | 5.6、9.4      | 元ファイルサイズ更新                           |
| 6.3  | 5.6           | 同じ元ファイル利用時の削除抑止                 |
| 6.4  | 5.6、6        | 反映失敗の記録と元ファイル保持                 |
| 6.5  | 5.6           | 反映成功後の条件付き削除                       |
| 6.6  | 5.6、9.4      | 反映失敗時の完了通知                           |
| 6.7  | 5.6、9.4      | 削除不要・成功時の完了通知                     |
| 6.8  | 5.6、6、9.4   | 元ファイル削除失敗時の通知抑止                 |
| 6.9  | 5.2、5.6      | 実行中除外と次依頼確認                         |
| 7.1  | 6、7.4、9.3   | 異常・取消時の途中出力削除                     |
| 7.2  | 5.1、5.8、6   | 起動時に記録を受け付け順に戻す                 |
| 7.3  | 4.4           | 最も新しい記録の次から割当て、終了で戻さない   |
| 7.4  | 4.4           | 最大値の次は1、使用中の識別番号を飛ばす        |
| 7.5  | 4.4           | 最大値を越えた箇所を境目にした受け付け順       |
| 7.6  | 5.8           | 出力先が登録済みなら変換済みとして削除         |
| 7.7  | 5.8、4.3      | 未登録の出力途中のファイルの削除設定           |
| 7.8  | 5.8、6        | 対象なし・lease失敗の記録の削除                |
| 7.9  | 5.9           | 録画完了依頼は記録してから渡す                 |
| 7.10 | 5.9           | 受け渡しの拒否時に記録を削除                   |
| 7.11 | 5.8、5.9      | 同じ識別番号の受け渡しの重複除去（一覧の識別番号を含む） |
| 7.12 | 4.4、6        | 記録の読込失敗と解釈できない記録               |
| 7.13 | 5.3           | 変換processの開始を識別番号とともに管理側へ知らせる |
| 7.14 | 6             | Web・API側処理の異常終了時の`SIGINT`停止と途中出力の削除（runtime §7.1） |
| 8.1  | 9.1           | R1–R7の仕様testと一意な主test                  |
| 8.2  | 9.1、9.2      | 内部値域・分岐と追加imp case                   |
| 8.3  | 9.1、9.2、9.3 | 71 ACの状態・race・資源分類                    |
| 8.4  | 9.1、9.4      | HTTP・IPC・filesystem・process                 |
| 8.5  | 9.1           | 単体・結合testの全件成功とC0・C1の品質判定     |

## 11. ソース対応表

具体的な実装を確認・変更するときは、機能説明ではなく本節から辿る。

| 機能                      | 主なソース                                                                                                                               | 主な型・処理                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 受付、待機、実行中、取消  | `src/model/service/encode/EncodeManageModel.ts`                                                                                          | `push()`、`checkQueue()`、`cancel()`、`finalize()`                                                         |
| 管理インターフェース      | `src/model/service/encode/IEncodeManageModel.ts`                                                                                         | `IEncodeManageModel`、`EncodeQueueInfo`                                                                    |
| 一件の変換処理            | `src/model/service/encode/EncoderModel.ts`                                                                                               | `start()`、`cancel()`、`childEndProcessing()`                                                              |
| 変換ジョブ型              | `src/model/service/encode/IEncoderModel.ts`                                                                                              | `EncodeOption`、`EncodeProgressInfo`                                                                       |
| 共有メディア処理          | `src/model/service/encode/EncodeProcessManageModel.ts`                                                                                   | `create()`、共有数と優先度                                                                                 |
| command解釈               | `src/util/ProcessUtil.ts`                                                                                                                | `%NODE%`、`%ROOT%`、`%SPACE%`                                                                              |
| 出力名選択                | `src/model/service/encode/EncodeFileManageModel.ts`                                                                                      | `getFilePath()`、`release()`                                                                               |
| 手動操作と一覧            | `src/model/api/encode/EncodeApiModel.ts`                                                                                                 | `add()`、`getAll()`、`cancel()`                                                                            |
| 結果反映                  | `src/model/service/encode/{IEncodeFinishModel,EncodeFinishModel}.ts`                                                                     | child-local settlement portと`finishEncode()`                                                              |
| 変換イベント              | `src/model/event/EncodeEvent.ts`、`src/model/event/IEncodeEvent.ts`                                                                      | add、cancel、progress、finish、error                                                                       |
| 録画済み番組へのIPC       | `src/model/ipc/IPCClient.ts`、`src/model/ipc/IPCServer.ts`                                                                               | addVideoFile、updateVideoFileSize、deleteVideoFile                                                         |
| 録画済みresource利用lease | PM所有`RecordedResourceUseClient`とservice child composition                                                                             | queue公開前acquire、待機・実行・結果settlement中保持、generation/request identity、Task 5.3のexact release |
| 録画済みresource snapshot | `EncodeManageModel`の待機列・実行中一覧とservice child composition                                                                       | 両queueのrecorded ID和集合をread-onlyで返し、列挙不能時はunknown                                           |
| 設定型と既定値            | `src/model/IConfigFile.ts`、`src/model/Configuration.ts`                                                                                 | encode設定、`encodeQueueLimit`                                                                             |
| 公開操作                  | `src/model/service/api/encode.ts`、`src/model/service/api/encode/{encodeId}.ts`、`src/model/service/api/recorded/{recordedId}/encode.ts` | 一覧、追加、取消                                                                                           |
| 機能固有仕様test          | `test/server/encoding/encode-contracts.spec.test.ts`                                                                                     | R1–R7の外部契約とR8.1                                                                  |
| 機能固有実装test          | `test/server/encoding/encode-internals.test.ts`                                                                                          | 値域・分岐assertion                                                         |
| 機能固有結合test          | `test/server/encoding/encode-boundaries.integration.test.ts`                                                                             | HTTP・IPC・filesystem・process                                                         |
| 依頼記録窓口（管理側）    | `src/model/operator/encode/{IEncodeQueueStore,EncodeQueueStore}.ts`                                                                      | 識別番号の割当て、記録の直列の操作、受け付け順の並べ直し、`requestToken`と`abandon` |
| 記録port（Web・API側）    | `src/model/service/encode/IEncodeQueueStorePort.ts`、`src/model/ModelContainerSetter.ts`の記録port adapter                               | `IPCClient.encodeQueue`へ渡す                                                          |
| 記録・復元のtest          | `test/server/encoding/encode-queue-store.{spec,imp}.test.ts`、`encode-queue-restore.spec.test.ts`、`encode-queue.integration.test.ts`      | R1.3、R1.12、R2.6、R7.2〜R7.12                                                        |
| 機能固有Test Matrix       | 本設計の§9.1                                                                                                                             | 71 ACの一意な主test                                                                    |

待機列・実行中一覧の所有構造、queue公開前のlease取得、recorded IDの保持時点、service child snapshot handler、または容量
削除候補filterを変更する場合は、利用中snapshot、resource lease、Runtimeの最終deletion gate、および
`snapshot empty → encode lease/deletion tokenの競合 → final delete`のinterleavingを同じ変更単位で再検証する。

## Primary production source ownership

本節は、本機能が主に所有する製品 source と、その owner-local test の置き場所を示す。次の primary source の動作、公開 API、
IPC wire、DB schema、設定、保存形式は、本節の対応表と4.4・7.2の記録に関する追加を除いて変更しない。owner-local test locator は既存 test directory の範囲を示すものであり、
個別 source の characterization 網羅を主張しない。

| Primary source | Owner-local test locator | Cross-spec consumer |
| --- | --- | --- |
| `src/model/api/encode/IEncodeApiModel.ts` | `test/server/encoding/**/*.test.ts` | — |
| `src/model/api/encode/EncodeApiModel.ts` | `test/server/encoding/**/*.test.ts` | — |
