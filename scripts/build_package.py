#!/usr/bin/env python3
"""Build the deterministic Shimmory SD-plugin archive."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PACKAGE_FILES = (
    "README.md",
    "config.example.json",
    "device.json",
    "manifest.json",
    "plugin.js",
)
FIXED_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def build(output: Path) -> None:
    missing = [name for name in PACKAGE_FILES if not (ROOT / "shimmory" / name).is_file()]
    if missing:
        raise SystemExit(f"missing package files: {', '.join(missing)}")

    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            prefix=f".{output.name}.", suffix=".tmp", dir=output.parent, delete=False
        ) as handle:
            temporary = Path(handle.name)
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED) as archive:
            for name in PACKAGE_FILES:
                info = zipfile.ZipInfo(f"shimmory/{name}", FIXED_TIMESTAMP)
                info.create_system = 3
                info.compress_type = zipfile.ZIP_STORED
                info.external_attr = (0o100644 << 16)
                archive.writestr(info, (ROOT / "shimmory" / name).read_bytes())
        os.replace(temporary, output)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)

    print(f"built {output} ({len(PACKAGE_FILES)} files)")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "dist" / "shimmory-plugin.zip",
        help="archive output path",
    )
    return parser.parse_args()


if __name__ == "__main__":
    build(parse_args().output)
