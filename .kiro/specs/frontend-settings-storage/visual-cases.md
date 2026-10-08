# Visual Cases: 設定ストレージ契約

## 目的

Settings Storage は UI owner ではないため、画面の screenshot も board も持たない。consumer UI が参照する storage state matrix と境界は、次の契約 case を unit test が検査する。

## Contract Cases

| Case | State | Mock Dataset | 検査する test | 不変条件 |
| --- | --- | --- | --- | --- |
| settings-storage-overview | storage state overview | `settingsStorageStateMatrix` | `unittest/spec/settingsStorage.contract.spec.test.ts` | `settings` key、saved/tmp、default/backfill、invalid existing field policy が UI layout と混同されない。 |
| settings-storage-platform-defaults | platform defaults | `settingsStorageStateMatrix` | `unittest/spec/settingsStorage.contract.spec.test.ts` | desktop / iOS / Android の platform-dependent default が consumer へ渡る。 |
| settings-storage-adjacent-keys | adjacent storage keys | `adjacentStorageFixtures` | `unittest/spec/settingsStorage.adjacent.spec.test.ts` | adjacent workflow keys を `settings` object に吸収せず、owner spec へ委譲する。 |

## Interaction / Geometry Cases

- Settings Storage は `/settings` 画面の control placement、snackbar placement、navigation regeneration visual を所有しない。それらは `frontend-settings-screen` と `frontend-app-shell` の visual cases を正とする。
- write failure 時の user-facing 表示は storage owner では固定しない。契約 case では `writeFailureMode` と owner boundary だけを扱う。
- unknown additional field は typed consumer contract に含めないが、read/write 時に保持してよいことを明示する。
