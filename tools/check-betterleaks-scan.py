#!/usr/bin/env python3
"""stage された変更に個人情報や secret が含まれていないか betterleaks で検査する。

tools/check-tracked-secrets.py は private network host と credential らしき
key=value だけを正規表現で検査する軽量な仕組みだった。それとは別に、開発者個人の
home directory path（例: `/home/<user>/...`）のような個人情報や、より広い種類の
secret（API key、private key 等）を漏らさないため、betterleaks
(https://github.com/betterleaks/betterleaks) を使った検査をここに追加する。

検査は 2 回 betterleaks を実行する:

  1. default rule set（`betterleaks` 同梱の secret 検出 rule）で staged diff を検査する。
  2. tools/personal-info.betterleaks.toml の汎用 rule に、実行時の $HOME・実行 user 名・
     非公開の作業 directory の path と名前から生成した rule を追記した一時 config で staged diff を検査する。

2 回に分けるのは、default config の global filter が `/home/...` や `/Users/...` 形式の
文字列を「よくある無害な path」として意図的に除外しており、personal-info rule を
`[extend]` でこれに乗せると個人情報の finding ごと握り消されるため（実測で確認済み）。
personal-info 用の config は `[extend]` を使わない独立 config として持つ。

**この file 自身と tools/personal-info.betterleaks.toml に実 username・実 home
directory・非公開の作業 directory の path や名前を書いてはならない。** 書けば検査対象の
tracked file 自身が規則違反になる。実際の値は実行時に環境（$HOME、実行 user、
EPGSTATION_PRIVATE_DIRS、repository と同じ階層の隠し directory）から読み、一時 file に
だけ書く。

betterleaks が未install の場合は、事故防止のため検査失敗として commit を止める
（黙って検査を skip すると、個人情報や secret が未検査のまま commit されうる）。
install 方法は docs/betterleaks.md を指すエラーで案内する。

false positive の扱い:
  - default rule set 側は repo root の .gitleaksignore の fingerprint
    （`path:rule-id:line`）で許可する。betterleaks の既定の gitleaks-ignore-path は
    カレント dir (".") で、本 file は cwd=REPO_ROOT で betterleaks を呼ぶため自動で
    読まれる。既存の合成 fixture（synthetic private key 等）と doc の placeholder は
    ここで許可済み。この file名は tools/check-tracked-secrets.py が既に
    `.gitleaksignore` の fingerprint 行を credential 誤検知から除外する仕組みを
    持っているため、それに合わせている（`.betterleaksignore` ではない）。
  - personal-info 側は tools/personal-info.betterleaks.toml の rule-level filter で、
    既知の非個人 placeholder user（doc 例示用の hoge/fuga/piyo、CI runner の既定 user、
    devcontainer の既定 user 等）を許可している。

失敗したら non-zero で終了する。pre-commit hook から呼ばれる。
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

REPO_ROOT = subprocess.run(
    ['git', 'rev-parse', '--show-toplevel'],
    capture_output=True, text=True, check=True).stdout.strip()

PERSONAL_INFO_TEMPLATE = os.path.join(REPO_ROOT, 'tools', 'personal-info.betterleaks.toml')

INSTALL_HELP = '''betterleaks が見つからない (PATH: betterleaks)。

個人情報 (home directory path 等) と secret の commit 前検査に betterleaks が必要。
docs/betterleaks.md の install 手順（pinned version + checksum 検証）に従って
~/.local/bin などへ install すること。
https://github.com/betterleaks/betterleaks

install するまでは commit を止める。検査を skip して個人情報や secret を
未検査のまま commit させないため。'''


def _escape_toml_basic_string(value):
    """TOML の basic string (\"...\") 内で安全な形へ escape する。"""
    return value.replace('\\', '\\\\').replace('"', '\\"')


def _escape_regex_literal(value):
    """value をそのまま regex の literal として扱えるよう特殊文字を escape する。"""
    specials = '\\.+*?()|[]{}^$'
    out = []
    for ch in value:
        if ch in specials:
            out.append('\\' + ch)
        else:
            out.append(ch)
    return ''.join(out)


PRIVATE_DIRS_ENV = 'EPGSTATION_PRIVATE_DIRS'


def find_private_dirs():
    """検査対象にする非公開の作業 directory（絶対 path）の一覧を返す。

    取得元は 2 つ:
      - 環境変数 EPGSTATION_PRIVATE_DIRS（os.pathsep 区切り、複数可）
      - repository root と同じ階層にある隠し directory のうち、名前が
        `.` + repository root の basename + `-` で始まるもの（大文字小文字は区別する）
    """
    found = []
    for item in os.environ.get(PRIVATE_DIRS_ENV, '').split(os.pathsep):
        item = item.strip()
        if item:
            found.append(os.path.abspath(os.path.expanduser(item)))

    parent = os.path.dirname(REPO_ROOT)
    prefix = '.' + os.path.basename(REPO_ROOT) + '-'
    try:
        entries = sorted(os.listdir(parent))
    except OSError:
        entries = []
    for entry in entries:
        full = os.path.join(parent, entry)
        if entry.startswith(prefix) and os.path.isdir(full):
            found.append(full)

    unique = []
    for path in found:
        if path not in unique:
            unique.append(path)
    return unique


def build_identity_rules():
    """実行時の $HOME・実行 user 名・非公開の作業 directory から個人情報 rule を生成する。

    どの値も literal のまま tracked file には書かず、この関数が返す文字列は
    呼び出し側が一時 file にだけ書き出す。非公開の作業 directory は絶対 path と
    directory 名（`../<名前>` や `$HOME/work/<名前>` のような相対の言及を含む）の
    2 種類の literal で検出する。
    """
    home = os.path.expanduser('~')
    try:
        user = os.getlogin()
    except OSError:
        user = os.environ.get('USER') or os.environ.get('LOGNAME') or ''

    rules = []
    if home and home != '/':
        rules.append({
            'id': 'personal-injected-home-directory',
            'description': '実行時の $HOME literal path',
            'regex': _escape_regex_literal(home),
        })
    if user:
        rules.append({
            'id': 'personal-injected-username',
            'description': '実行時の login user 名（bare word）',
            'regex': r'\b' + _escape_regex_literal(user) + r'\b',
        })
    names = []
    for path in find_private_dirs():
        rules.append({
            'id': 'personal-injected-private-dir-path',
            'description': '実行時に得た非公開の作業 directory の絶対 path literal',
            'regex': _escape_regex_literal(path),
        })
        name = os.path.basename(path.rstrip(os.sep))
        if name and name not in names:
            names.append(name)
    for name in names:
        rules.append({
            'id': 'personal-injected-private-dir-name',
            'description': '実行時に得た非公開の作業 directory の名前 literal',
            'regex': r'(?m)(?:^|[^A-Za-z0-9_.-])' + _escape_regex_literal(name)
                     + r'(?:[^A-Za-z0-9_-]|$)',
        })
    return rules


def render_identity_config(rules):
    parts = []
    for rule in rules:
        parts.append('[[rules]]')
        parts.append(f'id = "{_escape_toml_basic_string(rule["id"])}"')
        parts.append(f'description = "{_escape_toml_basic_string(rule["description"])}"')
        parts.append("regex = '''" + rule['regex'] + "'''")
        parts.append('')
    return '\n'.join(parts)


def run_betterleaks(binary, args, report_path):
    """betterleaks を実行し、(proc, findings) を返す。

    finding が 0 件のとき betterleaks は report file へ JSON の `null` を書く
    （空配列 `[]` ではない。実測で確認済み）。`findings` は「scan 自体は完了した」
    ことを示すため、finding 無しは `[]`、finding 有りはその配列を返す。scan が
    完了しなかった場合（report file が無い、または list でも null でもない
    想定外の内容）は `findings=None` を返し、呼び出し側はこれを tool の実行
    失敗として扱う。
    """
    cmd = [binary, 'git', '--staged', '--no-banner', '--redact',
           '--report-format', 'json', '--report-path', report_path] + args
    proc = subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True)
    findings = None
    if os.path.exists(report_path):
        try:
            with open(report_path, encoding='utf-8') as fh:
                data = json.load(fh)
            if data is None:
                findings = []
            elif isinstance(data, list):
                findings = data
        except (OSError, json.JSONDecodeError):
            findings = None
    return proc, findings


def format_findings(findings):
    lines = []
    for f in sorted(findings, key=lambda x: (x.get('File', ''), x.get('StartLine', 0))):
        lines.append(f"  - {f.get('File')}:{f.get('StartLine')} "
                      f"[{f.get('RuleID')}] {f.get('Description', '')}")
    return lines


def main():
    binary = shutil.which('betterleaks')
    if binary is None:
        print(INSTALL_HELP)
        return 1

    problems = []
    tool_errors = []

    with tempfile.TemporaryDirectory(prefix='betterleaks-precommit-') as tmpdir:
        default_report = os.path.join(tmpdir, 'default-report.json')
        proc, findings = run_betterleaks(binary, [], default_report)
        if findings is not None:
            if findings:
                problems.append(('default rule set (secret)', format_findings(findings)))
        else:
            tool_errors.append(('default rule set (secret)', proc.stderr.strip()))

        identity_rules = build_identity_rules()
        with open(PERSONAL_INFO_TEMPLATE, encoding='utf-8') as fh:
            template = fh.read()
        combined = template + '\n\n' + render_identity_config(identity_rules)
        identity_config_path = os.path.join(tmpdir, 'personal-info.betterleaks.toml')
        with open(identity_config_path, 'w', encoding='utf-8') as fh:
            fh.write(combined)

        personal_report = os.path.join(tmpdir, 'personal-info-report.json')
        proc, findings = run_betterleaks(
            binary, ['-c', identity_config_path], personal_report)
        if findings is not None:
            if findings:
                problems.append(('personal info (home directory / user / private directory)',
                                  format_findings(findings)))
        else:
            tool_errors.append(('personal info (home directory / user / private directory)',
                                 proc.stderr.strip()))

    if tool_errors:
        print('betterleaks の実行に失敗した:\n')
        for label, stderr in tool_errors:
            print(f'  [{label}]')
            if stderr:
                print('    ' + stderr.replace('\n', '\n    '))
        print('\n設定または install を確認すること。再検査: '
              'python3 tools/check-betterleaks-scan.py')
        return 1

    if problems:
        print('betterleaks が個人情報または secret らしき内容を検出した:\n')
        for label, lines in problems:
            print(f'[{label}]')
            for line in lines:
                print(line)
            print()
        print('既知の false positive なら repo root の .gitleaksignore '
              '(default rule set 用) または '
              'tools/personal-info.betterleaks.toml の rule-level filter '
              '(personal-info 用) を見直すこと。')
        print('再検査: python3 tools/check-betterleaks-scan.py')
        return 1

    return 0


if __name__ == '__main__':
    sys.exit(main())
