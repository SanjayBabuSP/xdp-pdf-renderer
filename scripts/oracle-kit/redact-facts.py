#!/usr/bin/env python3
"""
redact-facts.py — strip everything human-readable from an extract-facts.py
JSON so the result is safe to paste into chat or commit.

Kept (numbers/geometry only): page counts, mediaboxes, font BaseFonts,
descriptors, width tables, per-run x/y/size/rotation/scale, rectangles,
paths, dash/width/color operators, operator histograms, Producer/Creator.
Dropped: all decoded text, char codes, ToUnicode maps, local file paths,
and every other metadata value.

Usage:
    python3 redact-facts.py <in-facts.json> [-o out.redacted.json]

Exit 0 on success. Refuses to write output that still contains a "text"
key anywhere (paranoia check).
"""

import json
import sys

TEXT_KEYS = {"text", "char_codes", "tounicode", "file"}


def contains_text_key(obj):
    if isinstance(obj, dict):
        return any(k in TEXT_KEYS for k in obj) or any(
            contains_text_key(v) for v in obj.values()
        )
    if isinstance(obj, list):
        return any(contains_text_key(v) for v in obj)
    return False


def redact_run(run):
    return {
        k: v
        for k, v in run.items()
        if k not in ("text", "char_codes")
    }


def redact_page(page):
    out = {}
    for k, v in page.items():
        if k == "text_runs":
            out[k] = [redact_run(r) for r in v]
        else:
            out[k] = v
    return out


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = sys.argv[1]
    dst = sys.argv[sys.argv.index("-o") + 1] if "-o" in sys.argv else None

    with open(src, encoding="utf-8") as f:
        doc = json.load(f)

    info = doc.get("info") or {}
    redacted = {
        "redacted": True,
        "pdf_header": doc.get("pdf_header"),
        "num_pages": doc.get("num_pages"),
        "info": {
            "Producer": info.get("Producer"),
            "Creator": info.get("Creator"),
        },
        "xmp_present": doc.get("xmp_present"),
        "fonts": doc.get("fonts", []),
        "pages": [redact_page(p) for p in doc.get("pages", [])],
    }

    if contains_text_key(redacted):
        sys.exit("REFUSED: redacted output still contains a text-bearing key")

    text = json.dumps(redacted, indent=1, ensure_ascii=False)
    if dst:
        with open(dst, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"wrote {dst} ({len(text)} bytes)")
    else:
        print(text)


if __name__ == "__main__":
    main()
