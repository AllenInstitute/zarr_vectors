"""Check convention/schema.json: fresh, well-formed, and right on the examples.

Usage::

    python convention/test_schema.py

Exits non-zero on the first category of failure.  Every file in
``examples/`` must validate; every file in ``examples/invalid/`` must not.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import jsonschema

HERE = Path(__file__).resolve().parent


def main() -> int:
    stale = subprocess.run([sys.executable, str(HERE / "build.py"), "--check"])
    if stale.returncode:
        return 1

    schema = json.loads((HERE / "schema.json").read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator.check_schema(schema)
    validator = jsonschema.Draft202012Validator(schema)

    failures = 0
    valid = sorted((HERE / "examples").glob("*.json"))
    invalid = sorted((HERE / "examples" / "invalid").glob("*.json"))
    if not valid or not invalid:
        print("no examples found", file=sys.stderr)
        return 1
    for path in valid:
        errors = list(validator.iter_errors(json.loads(path.read_text(encoding="utf-8"))))
        if errors:
            failures += 1
            print(f"FAIL {path.relative_to(HERE)} should validate:")
            for err in errors[:5]:
                print(f"     {err.json_path}: {err.message[:200]}")
    for path in invalid:
        if validator.is_valid(json.loads(path.read_text(encoding="utf-8"))):
            failures += 1
            print(f"FAIL {path.relative_to(HERE)} should be rejected")
    print(f"{len(valid)} valid, {len(invalid)} invalid examples; {failures} failures")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
