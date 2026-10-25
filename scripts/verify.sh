#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

for f in shimmory/manifest.json shimmory/device.json shimmory/plugin.js shimmory/README.md shimmory/config.example.json; do
  [[ -s "$f" ]] || fail "missing $f"
done
[[ -s scripts/build_package.py ]] || fail 'missing deterministic package builder'
[[ -d tests ]] || fail 'missing tests'

python3 -m unittest discover -s tests -v
python3 scripts/build_package.py
[[ -s dist/shimmory-plugin.zip ]] || fail 'package zip missing'

sha1=$(sha256sum dist/shimmory-plugin.zip | cut -d' ' -f1)
python3 scripts/build_package.py
sha2=$(sha256sum dist/shimmory-plugin.zip | cut -d' ' -f1)
[[ "$sha1" == "$sha2" ]] || fail 'package build is not deterministic'

python3 - <<'PY'
import zipfile
p='dist/shimmory-plugin.zip'
with zipfile.ZipFile(p) as z:
    names=z.namelist()
    required={
     'shimmory/manifest.json', 'shimmory/device.json', 'shimmory/plugin.js',
     'shimmory/README.md', 'shimmory/config.example.json'
    }
    assert set(names) == required, (set(names)-required, required-set(names))
    assert all(n.startswith('shimmory/') for n in names), names
    assert z.testzip() is None
print('zip entries:', len(names))
PY

git diff --check
printf 'PASS sha256=%s\n' "$sha2"
