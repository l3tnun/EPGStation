#!/usr/bin/env python3
"""stage された変更に private network host / credential が含まれていないか検査する。

実 tuner server・実 EPGStation・実 Kodi の host、port、credential は git へ記録しない
規則である。この検査は、その規則を記憶に依存せず機械的に強制するために置く。

**この file 自身に実 host や credential を書いてはならない。** 具体値を書けば、
検査器そのものが規則違反になる。よって一般形（RFC1918 の private range、
credential らしき key=value）だけで検出する。

false positive を避けるため:
  - test fixture の慣用値（127.0.0.1、0.0.0.0、192.0.2.x の TEST-NET）は許可する
  - 既に tracked な行は対象外。追加・変更された行だけを見る
  - `.githooks/` と本 file 自身は対象外

失敗したら non-zero で終了する。pre-commit hook から呼ばれる。
"""

import re
import subprocess
import sys

# RFC1918 private range。実運用 host が入るのはここ。
PRIVATE_IP = re.compile(
    r'\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}'
    r'|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}'
    r'|192\.168\.\d{1,3}\.\d{1,3})\b')

# 慣用の非実在 address。これらは fixture として正当なので許可する。
ALLOWED_IP = re.compile(r'\b(?:127\.0\.0\.1|0\.0\.0\.0|::1|192\.0\.2\.\d{1,3}'
                        r'|198\.51\.100\.\d{1,3}|203\.0\.113\.\d{1,3})\b')

# credential らしき代入。値が明らかな placeholder のものは許可する。
CREDENTIAL = re.compile(
    r'(?i)\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)\b'
    r'\s*[:=]\s*[\'"]?([^\s\'",;}]+)')
PLACEHOLDER = re.compile(
    r'(?i)^(?:|\$\{.*\}|<.*>|\.\.\.|x+|\*+|dummy|example|placeholder|changeme'
    r'|test|testpass|fake|redacted|null|none|undefined|process\.env\..*)$')

# GitHub Actions workflow の `${{ secrets.<識別子> }}` は値ではなく参照なので、参照だけで終わる場合に限り
# placeholder へ置き換えてから検査する。`${{ secrets.X }}abc` のように値が続く形は置き換えない。
WORKFLOW_PREFIX = '.github/workflows/'
SECRETS_REFERENCE = re.compile(
    r'\$\{\{\s*secrets\.[A-Za-z_][A-Za-z0-9_]*\s*\}\}(?=$|[\s\'",;}])')

SKIP_PREFIX = ('.githooks/', 'tools/check-tracked-secrets.py')
# gitleaks fingerprint 行（`[commit:]path:rule-id:line`）。rule-id の `generic-api-key` などは
# credential ではなく rule 名なので、`.gitleaksignore` 内のこの grammar の行だけは検査しない。
GITLEAKS_FINGERPRINT = re.compile(r'^(?:[0-9a-f]{40}:)?[^\s:]+:[a-z0-9-]+:[0-9]+$')


def staged_added_lines():
    """stage 済み diff の追加行を (path, lineno, text) で返す。"""
    diff = subprocess.run(
        ['git', 'diff', '--cached', '--unified=0', '--no-color',
         '--diff-filter=ACMR'],
        capture_output=True, text=True, check=False).stdout
    path = None
    lineno = 0
    for line in diff.splitlines():
        if line.startswith('+++ b/'):
            path = line[6:]
            continue
        if line.startswith('@@'):
            m = re.search(r'\+(\d+)', line)
            lineno = int(m.group(1)) if m else 0
            continue
        if line.startswith('+') and not line.startswith('+++'):
            if path and not path.startswith(SKIP_PREFIX):
                yield path, lineno, line[1:]
            lineno += 1


def main():
    problems = []
    for path, lineno, text in staged_added_lines():
        if path.endswith('.gitleaksignore') and GITLEAKS_FINGERPRINT.match(text.strip()):
            continue
        for hit in PRIVATE_IP.findall(text):
            if not ALLOWED_IP.search(hit):
                problems.append(
                    f'{path}:{lineno} に private network address が含まれている: {hit}')
        credential_text = text
        if path.startswith(WORKFLOW_PREFIX):
            credential_text = SECRETS_REFERENCE.sub('<secrets-reference>', text)
        for value in CREDENTIAL.findall(credential_text):
            if not PLACEHOLDER.match(value):
                problems.append(
                    f'{path}:{lineno} に credential らしき値が含まれている '
                    f'(key は上記行、値は伏せる)')

    if problems:
        print('private network host / credential を git へ入れようとしている:\n')
        for p in sorted(set(problems)):
            print(f'  - {p}')
        print('\nこの repository の規則により、実 host・port・credential は git へ記録しない。')
        print('fixture が必要なら 127.0.0.1 / 192.0.2.x (TEST-NET) を使うこと。')
        print('再検査: python3 tools/check-tracked-secrets.py')
        return 1

    return 0


if __name__ == '__main__':
    sys.exit(main())
