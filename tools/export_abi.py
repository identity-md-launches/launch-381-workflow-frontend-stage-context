#!/usr/bin/env python3
"""Export deterministic ABI arrays using the repository's pinned Foundry configuration."""
import argparse
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("--check", action="store_true")
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent

for name in ("CNDL", "OHLCCandleHook"):
    result = subprocess.run(
        ["forge", "inspect", f"src/{name}.sol:{name}", "abi", "--json"],
        cwd=root, check=True, text=True, capture_output=True,
    )
    output = json.dumps(json.loads(result.stdout), indent=2) + "\n"
    path = root / "docs" / "abi" / f"{name}.json"
    if args.check:
        if not path.exists() or path.read_text() != output:
            raise SystemExit(f"Stale or missing ABI: {path.relative_to(root)}")
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(output)
    print(f"{'Verified' if args.check else 'Exported'} {path.relative_to(root)}")
