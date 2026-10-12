#!/usr/bin/env bash
# tracked 全 file を betterleaks で一括検査する（pre-commit hook とは別の、
# 手動実行用の道具）。tools/check-betterleaks-scan.py は staged diff だけを
# 検査するが、これは HEAD の tracked file 全体を対象にする。
#
# 対象は「commit しようとしている変更」ではなく「今この repo に入っている
# tracked file 全部」なので、`git archive HEAD` で作った clean な export を
# scan する（working tree に untracked/gitignored な物があっても混ざらない）。
#
# default rule set（secret）と personal-info 用の config（実行時の $HOME・
# 実行 user 名・非公開の作業 directory を注入した一時 config）の 2 回を実行し、
# どちらかで finding があれば non-zero で終了する。
#
# 使い方:
#   bash tools/scan-tracked-personal-info.sh
set -uo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "$script_dir/.." && pwd)

if ! command -v betterleaks >/dev/null 2>&1; then
  echo 'betterleaks が見つからない (PATH: betterleaks)。docs/betterleaks.md の install 手順に従うこと。' >&2
  exit 1
fi

# /tmp は tmpfs で export がそのままメモリを消費するため、TMPDIR が無いときは
# repository の中の ignore された test/server/.artifacts/ を使う。
work_root="${TMPDIR:-$repo_root/test/server/.artifacts/tmp}"
mkdir -p -- "$work_root" || exit 1
export_dir=$(mktemp -d "$work_root/betterleaks-tracked-scan.XXXXXX") || exit 1
cleanup() {
  rm -rf -- "$export_dir"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$export_dir/export"
git -C "$repo_root" archive HEAD | tar -x -C "$export_dir/export"

status=0

echo '--- default rule set (secret) ---'
# .gitleaksignore の fingerprint は repo 相対 path (`path:rule-id:line`) なので、
# export dir の中へ cd してから `.` を対象にする（絶対 path を渡すと fingerprint の
# path 部分が export dir の path と一致せず ignore が効かない）。
if ! (cd "$export_dir/export" && betterleaks dir . --no-banner -v \
    -i "$repo_root/.gitleaksignore"); then
  status=1
fi

echo '--- personal info (home directory / user / private directory, generic + injected) ---'
identity_config="$export_dir/personal-info.betterleaks.toml"
python3 -B - "$repo_root" "$identity_config" <<'PYEOF'
import importlib.util
import sys

repo_root, out_path = sys.argv[1], sys.argv[2]

spec = importlib.util.spec_from_file_location(
    'check_betterleaks_scan', repo_root + '/tools/check-betterleaks-scan.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with open(repo_root + '/tools/personal-info.betterleaks.toml', encoding='utf-8') as fh:
    template = fh.read()
rules = module.build_identity_rules()
combined = template + '\n\n' + module.render_identity_config(rules)
with open(out_path, 'w', encoding='utf-8') as fh:
    fh.write(combined)
PYEOF
if ! (cd "$export_dir/export" && betterleaks dir . -c "$identity_config" --no-banner -v); then
  status=1
fi

exit "$status"
