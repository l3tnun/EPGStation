export type RuleLayout = 'table' | 'list'

// v2 `client/src/components/rules/RuleItems.vue:3` は `elementWidth >= 780 - 24`（= 756）を、
// padding を持たない component root `.rules-wrap` の `clientWidth` で判定する（同 file 41 行目と
// 48 行目の `ResizeObserver`）。v2 を実ブラウザで測ると `.rules-wrap` の `clientWidth` は viewport より
// 24px 狭く（Vuetify container の左右 padding 12px）、viewport 779px で list、**780px で table** に
// 切り替わる（実測。779 → wrap 755 → list、780 → wrap 756 → table）。
//
// v3 が測る `.page` は `box-sizing: border-box` で自身に padding 12px を持つため `clientWidth` に
// padding が含まれ、全幅のとき viewport と一致する。したがって v2 の「content 幅 756」は
// v3 の「`.page` clientWidth 780」と同じ境界である。drawer が開いて container が狭くなっても
// 両者の差は 24px で一定なので、この対応は幅によらず保たれる。
const RULE_TABLE_LAYOUT_MIN_WIDTH = 780

export function resolveRuleLayout(width: number): RuleLayout {
  return width >= RULE_TABLE_LAYOUT_MIN_WIDTH ? 'table' : 'list'
}
