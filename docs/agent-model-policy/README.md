# Agent Model / Reasoning Effort 選定方針

## 目的

この文書は、EPGStation の agentic development で、主担当とsubagentへどのmodel / reasoning effortを割り当てるか、その判断根拠を定める。

model名は将来変更される。したがって、役割と評価基準を恒久方針、具体的なmodel mappingを更新可能なsnapshotとして分離する。

project-scoped custom agentのrole登録は `.codex/config.toml`、各roleの設定layerは `.codex/agents/*.toml`、主担当のmodel / effortはcomposerまたはsession設定を実行時の正本とする。この文書は設定理由と更新手順の正本である。個人用の `~/.codex/agents/` にはEPGStation固有agentを重複配置しない。

## 選定原則

1. 先に役割と失敗時の影響を決め、その後でmodelとeffortを選ぶ。
2. 要求、承認境界、互換性、統合判断は主担当に残し、反復量の多い作業をsubagentへ渡す。
3. 実装担当とreview担当を分離する。同じagentの自己reviewだけで完了させない。
4. 品質条件を満たす範囲で最も低コスト・低遅延の設定を使う。単に安価であることを採用理由にしない。
5. model名、effort、agent名が実際に反映されたことをsession開始時にUI / session / subagent metadataで確認する。agent自身の自己申告や設定fileの存在だけで適用済みとみなさない。
6. model変更は印象ではなく、同一commit・同一prompt・同一検証条件の比較証跡で決める。
7. custom roleを起動するときは`spawn_agent`の`agent_type`へrole名を明示する。`task_name`は作業threadの識別子であり、role選択には使わない。

custom role名はCodex runtimeの制約に合わせて小文字英数字とunderscoreだけを使う。hyphenを含む名前は起動前に拒否される。

## Multi-Agent V2 routingの前提

GPT-5.6 SolがMulti-Agent V2を選択する環境では、spawn metadataを隠す設定のままだと`agent_type`、`model`、
`reasoning_effort`が`spawn_agent`の入力schemaから除かれ、custom roleを選べず親sessionのmodel / effortを継承する場合がある。
`task_name`をrole名にしても代替にならない。

EPGStationではprojectの`.codex/config.toml`に次の設定を保持する。

```toml
[features.multi_agent_v2]
hide_spawn_agent_metadata = false
tool_namespace = "agents"
```

この設定またはcustom agent設定を変更した後は、Codexを再起動してfresh sessionを開始する。実作業の前に
`fork_turns="none"`の無害なprobeを1回実行し、session metadataで`agent_role`、model、effortが選択したroleと一致することを
確認する。schemaに`agent_type`がない、roleが`null`、またはmodel / effortが親設定のままならroutingは未確認ではなく失敗と
扱い、高コストなsubagent作業を開始しない。

これらのMulti-Agent V2設定はCodex versionに依存する互換設定である。Codex更新時は設定名の存在、tool namespace、
spawn schema、実metadataを再検証し、公式実装で不要になったことを確認するまでは削除しない。

## 判断軸

| 判断軸 | 低い場合 | 高い場合 |
| --- | --- | --- |
| 要求の曖昧さ | 承認済みtaskの局所実装 | 仕様・source・runtime evidenceの矛盾 |
| 互換性リスク | 内部utility、fixture | 公開API、DB、config、migration |
| 時間・並行性 | 純粋関数、決定論的処理 | scheduler、race、late settlement、resource lifecycle |
| 調査量 | 小さい対象file | 大量source、log、文書の棚卸し |
| 判断の可逆性 | test追加、局所修正 | 永続data変更、公開contract変更 |
| 独立性 | 他taskとfileが重ならない | 複数spec・moduleを横断する |

高リスクの軸が1つでもある場合、単純なworker設定へ自動的に落とさない。作業量が大きいだけで判断が単純な場合は、探索用modelへ分離して主担当へ要約を返す。

承認済みtaskでもrace、永続data、resource破壊を含む場合、主担当が契約、test oracle、rollback、task境界を確定してから`server_worker`へ渡す。`server_reviewer`は実装担当にならず独立reviewを維持する。reviewerへ修正を依頼した場合は、別agentを新しい独立reviewerにする。

## 現在のmapping

fresh session probeで、主担当、全custom roleの`agent_role`、model、effortをruntime metadataから確認する。
role設定はproject-localの`.codex/config.toml`と`.codex/agents/*.toml`だけを正本とし、個人用のglobal設定へEPGStation固有roleや
global agent上限を置かない。

| 役割 | Model | Effort | 設定場所 | 選定理由 |
| --- | --- | --- | --- | --- |
| 主担当 | `gpt-5.6-terra` | `max` | `.codex/config.toml`およびsession | 要求、承認、互換性、cross-spec統合、最終判断を保持する |
| `server_explorer` | `gpt-5.6-terra` | `medium` | `.codex/agents/server-explorer.toml` | 読み取り中心のsource調査、棚卸し、証跡整理を高速に処理する |
| `server_worker` | `gpt-5.6-terra` | `xhigh` | `.codex/agents/server-worker.toml` | 通常実装と、明示的に割り当てた高リスク実装を承認済みpacketへ限定して処理する |
| `server_reviewer` | `gpt-5.6-sol` | `xhigh` | `.codex/agents/server-reviewer.toml` | correctness、race、resourceを実装担当から独立して敵対的に確認する |
| `spec_reviewer` | `gpt-5.6-sol` | `xhigh` | `.codex/agents/spec-reviewer.toml` | 複数spec間の矛盾、依存、interface不整合を独立して確認する |

主担当はTerra maxを維持する。公開contract、DB、config、migration、録画scheduler、削除、IPC、child process、timer、stream、race、
resource lifecycleを含むcandidateは、Sol xhighの`server_reviewer`による独立gateを省略しない。仕様矛盾、owner境界、release可否の
最終判断はreview結果を根拠として主担当が保持する。

## Task routing

| 作業 | 第一候補 | Review / escalation |
| --- | --- | --- |
| source・設定・DB schemaの棚卸し | `server_explorer` | 主担当が根拠とunknownを確認 |
| 通常リスクの承認済みtask、characterization、fixture、test | `server_worker` | `server_reviewer` |
| DB migration、公開API、録画scheduler、削除、IPC、child process、timer、stream、race、resource lifecycle | 主担当がtask分解後に`server_worker` | `server_reviewer`を実装から分離 |
| timeout、複雑な非同期failure | `server_reviewer` | 主担当へ分類判断を返す |
| Requirements / Designのcross-spec review | `spec_reviewer` | 主担当がowner境界を判定 |
| 公開contract、migration、scheduler設計 | 主担当 | 専門agentの調査と独立reviewを併用 |
| 最終統合・release可否 | 主担当 | reviewer結果とfresh verificationを統合 |

subagentには、対象file、承認済みinput、禁止事項、完了条件、返却形式を明示する。raw logや長い探索過程ではなく、file参照、command、件数、結果、unknownを含む短いhandoffを返させる。

新しいsubagentは可能な限り`fork_turns="none"`で起動し、必要な契約、base / head、file ownership、検証結果、既知riskだけを短いpacketで渡す。会話全履歴やmutationのraw logを渡さない。

## Slotとthreadの運用

並列枠は固定の担当者ではなく、taskごとに適切なprofileを割り当てる実行容量として扱う。ただし、起動済みagent threadのmodel / effortを
途中で変更するhot swapは前提にしない。

1. 同じprofileと文脈で続ける関連taskは、既存threadへfollow-upして再利用できる。
2. 調査から実装へ、または実装からreviewへ役割が変わる場合は、完了したthreadの枠を解放し、必要なprofileで新しいthreadを起動する。
3. reviewerは自分が実装したcandidateをreviewしない。reviewerが修正を担当した場合は、別threadを独立reviewerとして起動する。
4. 新規threadは原則`fork_turns="none"`とし、task packetへ必要な契約、base / head、file ownership、検証証跡だけを渡す。
5. 同じfileを複数のwrite agentへ同時に割り当てない。空き枠を埋めるためだけに依存順序やownershipを崩さない。
6. runtimeの同時thread上限を超えてprofileを常駐させない。agent完了後は次taskのriskに応じてprofileを選び直す。

つまり、task途中のagentをTerraからSolへ変換するのではなく、task境界でthreadを入れ替えることで動的routingを実現する。

## Model更新のtrigger

次の場合にmappingを再評価する。

- 設定中modelの廃止、利用不能、名称変更
- OpenAI公式のmodel / reasoning guidance変更
- 同一taskでの重大な見落とし、unsupported claim、scope逸脱の反復
- latency、token使用量、費用が役割の価値に見合わない
- tool use、context容量、parallel agent能力の改善
- project phaseが仕様中心から実装中心、またはrelease判定へ移る

新modelが公開されたことだけを理由に即時置換しない。現在のmappingより良いことを役割別に確認する。

## 比較評価手順

1. OpenAI公式の[Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)と[Models](https://learn.chatgpt.com/docs/models)を確認し、候補modelがcustom agentと必要なeffortをサポートすることを確認する。
2. 評価開始前に、固定prompt、fixture / commit、期待結果、seedした欠陥、実行環境をevaluation記録へ保存する。途中で変更した場合は別benchmark revisionとする。
3. cleanな同一commit、同一sandbox / approval、同一promptで現行設定と候補設定をそれぞれ最低3回、独立sessionで実行する。先行agentの回答を後続agentへ見せない。
4. 少なくとも次の代表scenarioを使う。

| Scenario | 期待する必須結果 |
| --- | --- |
| 大量sourceのread-only inventory | 根拠file、事実・推測・unknownの分離、変更0件 |
| 承認済み限定taskのTDD実装 | expected RED、scope内の最小実装、required test証跡 |
| seedした欠陥を含むdiffの独立review | seedしたCritical / Importantを検出し、style-onlyで埋めない |
| 仕様・source・testの不一致 | 統一分類、互換性判断の越権禁止、owner boundary |

5. 次の指標を比較する。

| 分類 | 指標 |
| --- | --- |
| 正確性 | Critical / Important見落とし、false positive、unsupported claim |
| 契約順守 | scope外変更、承認状態変更、互換性判断の越権 |
| 証跡 | file / symbol参照、実行command、事実・推測・unknownの分離 |
| 実行品質 | test成功率、初回成功率、再試行、flake |
| 効率 | elapsed time、token / cost（取得可能な場合）、handoff量 |
| 協調 | file競合、重複作業、主担当が再調査した量 |

6. evaluation要約を `docs/agent-model-policy/evaluations/YYYY-MM-DD-<role>-<candidate>.md` に保存する。環境固有値やraw logは含めず、redacted hashまたは件数を使う。
7. 1回に1役割だけ変更する。reviewerとworkerを同時に変更して、品質差の原因を不明にしない。
8. project maintainerと、評価を実行していない独立reviewerが採否を記録する。主担当の責務や品質条件を変える場合だけowner判断へ送る。
9. `.codex/config.toml`、`.codex/agents/*.toml`、本書のmapping、設定記録日、runtime確認状態を更新する。
10. Codexを再起動し、主担当はcomposer / session表示、subagentはactivity detailsなど利用中surfaceが示すmetadataでagent名、model、effortを確認する。metadataを表示できないsurfaceでは未確認と記録し、自己申告で代替しない。
11. 対象限定の独立reviewと検証後にcommitする。

Evaluation要約には最低限、benchmark revision、commit、role、現行/候補modelとeffort、3回以上の各結果、期待結果との差、Critical / Important件数、elapsed time、取得可能なtoken / cost、maintainer、independent reviewer、採否理由を含める。

## 採用条件

- 候補modelがCritical見落とし、互換性破壊、scope逸脱を増加させない。
- explorerは根拠fileとunknownの欠落を増加させない。
- workerは承認済みtask、TDD、必要test、変更scopeを守る。
- reviewerはseedしたCritical / Importantを検出し、style-only指摘で重要issueを埋めない。
- 効率改善が小さい場合、品質実績のある現行設定を維持する。

候補が一部scenarioで失敗した場合、平均scoreで相殺しない。高リスクscenarioを満たせないmodelは、その役割へ採用しない。

## 設定が反映されない場合

custom agentを選択できない、またはmodel / effortをmetadataで確認できない場合、意図したroutingが有効だと仮定しない。

- 高リスクtask、独立review、承認判断、release判定はfail-closedとし、再起動または設定修正まで開始しない。
- 低リスクのread-only inventoryだけは続行できるが、handoffへ`UNVERIFIED_ROUTING`、実際に確認できたsurface情報、未確認理由を記載し、品質gateの証跡には使わない。
- fallbackを利用した結果は、対応するevaluation要約へ記録する。

`agents.max_threads`などの並列数設定はmodel品質とは別に管理する。並列数を増やしても、同じfileを複数agentへ同時に編集させない。
