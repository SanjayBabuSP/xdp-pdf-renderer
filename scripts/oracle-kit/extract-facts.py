#!/usr/bin/env python3
"""
extract-facts.py — pull objective, comparable facts out of a PDF.

STANDALONE COPY for the oracle kit (scripts/oracle-kit/). The canonical
source is reference/tools/extract-pdf-facts.py, which is not available on
machines where reference/ is not checked out. Keep the two in sync when the
parser changes; the JSON schema is identical.

Emits a single JSON object. Intended to be run on BOTH the Adobe
LiveCycle Designer "Preview as PDF" output and the xdp-pdf-renderer output
for the same input, so the two JSON files can be diffed field by field.

It reports only what is literally in the file. It does not interpret,
guess, or normalise anything.

Usage:
    python3 extract-facts.py <input.pdf> [-o out.json]

Requires: pypdf   (pip install pypdf)
"""

import json
import re
import sys
import zlib

try:
    from pypdf import PdfReader
    from pypdf.generic import IndirectObject, ArrayObject, DictionaryObject, NameObject, NumberObject, ByteStringObject, StreamObject
except ImportError:
    sys.exit("ERROR: pypdf not installed. Run:  pip install pypdf")


# ── low-level helpers ────────────────────────────────────────────────────────

def deref(obj, depth=0):
    """Resolve indirect references to direct objects (bounded)."""
    while isinstance(obj, IndirectObject) and depth < 32:
        obj = obj.get_object()
        depth += 1
    return obj


def num(v):
    """Coerce a PDF number-ish object to a float, or None."""
    v = deref(v)
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def inum(v):
    f = num(v)
    return int(f) if f is not None else None


def pstr(v):
    """PDF name object -> '/Name' string; plain str passthrough."""
    v = deref(v)
    if v is None:
        return None
    s = str(v)
    return s if s.startswith("/") else "/" + s


def decode_bytes(raw):
    """PDF string bytes -> python str. Assumes PDFDocEncoding/WinAnsi-ish."""
    if raw is None:
        return ""
    if isinstance(raw, str):
        return raw
    try:
        return bytes(raw).decode("latin-1")
    except Exception:
        return repr(raw)


def stream_bytes(stream):
    """Fully decompress a stream object's raw data."""
    try:
        return stream.get_data()
    except Exception:
        pass
    try:
        raw = stream._data
        if stream.get("/Filter") and "FlateDecode" in str(stream.get("/Filter")):
            raw = zlib.decompress(raw)
        return raw
    except Exception:
        return b""


def serialise(v, depth=0):
    """Best-effort JSON-safe conversion of a PDF object."""
    if depth > 12:
        return "<maxdepth>"
    v = deref(v)
    if v is None:
        return None
    if isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, NameObject):
        return "/" + str(v)
    if isinstance(v, ArrayObject) or isinstance(v, list):
        return [serialise(x, depth + 1) for x in v]
    if isinstance(v, DictionaryObject):
        return {str(k): serialise(val, depth + 1) for k, val in v.items()}
    if isinstance(v, StreamObject):
        return {"__stream__": True, "dict": {str(k): serialise(val, depth + 1) for k, val in v.items()}}
    try:
        return str(v)
    except Exception:
        return "<unserialisable>"


# ── ToUnicode CMap ───────────────────────────────────────────────────────────

def parse_tounicode(data):
    """Parse the bfchar / bfrange sections of a ToUnicode CMap."""
    m = {}
    try:
        txt = data.decode("latin-1", "replace")
    except Exception:
        return m

    def hex_to_str(h):
        h = re.sub(r"\s+", "", h)
        try:
            b = bytes.fromhex(h)
        except ValueError:
            return ""
        try:
            return b.decode("utf-16-be", "replace")
        except Exception:
            return ""

    for block in re.findall(r"beginbfchar(.*?)endbfchar", txt, re.S):
        for src, dst in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block):
            m[int(src, 16)] = hex_to_str(dst)
    for block in re.findall(r"beginbfrange(.*?)endbfrange", txt, re.S):
        # <lo> <hi> <dststart>
        for lo, hi, dst in re.findall(
            r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", block
        ):
            lo_i, hi_i = int(lo, 16), int(hi, 16)
            base = int(dst, 16)
            for k in range(lo_i, min(hi_i, lo_i + 65535) + 1):
                try:
                    m[k] = chr(base + (k - lo_i))
                except ValueError:
                    pass
        # <lo> <hi> [ ... ]  (array form)
        for lo, hi, arr in re.findall(
            r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[(.*?)\]", block, re.S
        ):
            lo_i = int(lo, 16)
            for off, dst in enumerate(re.findall(r"<([0-9A-Fa-f]+)>", arr)):
                m[lo_i + off] = hex_to_str(dst)
    return m


# ── content-stream tokenizer ─────────────────────────────────────────────────

TOKEN = re.compile(rb"""
      (?P<str>\((?:\\.|[^()\\]|\((?:\\.|[^()\\])*\))*\))
    | (?P<hex><[0-9A-Fa-f\s]*>)
    | (?P<arr>[\[\]])
    | (?P<num>[-+]?(?:\d+\.?\d*|\.\d+))
    | (?P<name>/[^\s/\[\]<>(){}%]*)
    | (?P<op>[A-Za-z'"*][A-Za-z0-9'"*]*)
""", re.X | re.S)

UNESCAPE = {b"n": b"\n", b"r": b"\r", b"t": b"\t", b"b": b"\b",
            b"f": b"\f", b"(": b"(", b")": b")", b"\\": b"\\"}


def unescape_literal(raw):
    """Decode a PDF literal string body (without the outer parens)."""
    out = bytearray()
    i = 0
    while i < len(raw):
        c = raw[i:i + 1]
        if c == b"\\" and i + 1 < len(raw):
            nxt = raw[i + 1:i + 2]
            if nxt in UNESCAPE:
                out += UNESCAPE[nxt]
                i += 2
                continue
            if nxt.isdigit():
                oct_digits = b""
                j = i + 1
                while j < len(raw) and len(oct_digits) < 3 and raw[j:j + 1].isdigit():
                    oct_digits += raw[j:j + 1]
                    j += 1
                out.append(int(oct_digits, 8) & 0xFF)
                i = j
                continue
            if nxt in (b"\n", b"\r"):
                i += 2
                continue
            out += nxt
            i += 2
            continue
        out += c
        i += 1
    return bytes(out)


def tokenize(data):
    """Yield (kind, value) tuples from a content stream."""
    for m in TOKEN.finditer(data):
        kind = m.lastgroup
        val = m.group(kind)
        if kind == "num":
            yield ("num", float(val))
        elif kind == "name":
            yield ("name", val.decode("latin-1"))
        elif kind == "op":
            yield ("op", val.decode("latin-1"))
        elif kind == "str":
            yield ("str", unescape_literal(val[1:-1]))
        elif kind == "hex":
            h = re.sub(rb"\s+", b"", val[1:-1])
            if len(h) % 2:
                h += b"0"
            try:
                yield ("str", bytes.fromhex(h.decode("ascii")))
            except ValueError:
                yield ("str", b"")
        elif kind == "arr":
            yield ("arr", val.decode("latin-1"))
        else:
            yield (kind, None)


def mat_mul(m, n):
    """2-D affine multiply: m then n applied as PDF's cm/matrix conventions."""
    a, b, c, d, e, f = m
    A, B, C, D, E, F = n
    return (
        a * A + b * C,
        a * B + b * D,
        c * A + d * C,
        c * B + d * D,
        e * A + f * C + E,
        e * B + f * D + F,
    )


def apply_mat(m, x, y):
    a, b, c, d, e, f = m
    return (a * x + c * y + e, b * x + d * y + f)


# ── font inventory ───────────────────────────────────────────────────────────

def font_inventory(reader):
    """Every font resource reachable from any page, with its descriptor."""
    seen = {}
    order = []

    def visit_font(key, fdict, page_no):
        fdict = deref(fdict)
        if not isinstance(fdict, DictionaryObject):
            return
        sig = f"{page_no}:{key}"
        entry = {
            "page": page_no,
            "resource_name": key,
            "subtype": pstr(fdict.get("/Subtype")),
            "basefont": pstr(fdict.get("/BaseFont")),
            "encoding": serialise(fdict.get("/Encoding")) if fdict.get("/Encoding") is not None else None,
            "first_char": inum(fdict.get("/FirstChar")),
            "last_char": inum(fdict.get("/LastChar")),
            "has_to_unicode": fdict.get("/ToUnicode") is not None,
            "fontfile": None,
            "font_descriptor": None,
            "widths_sample": None,
        }
        widths = deref(fdict.get("/Widths"))
        if isinstance(widths, ArrayObject):
            vals = [num(w) for w in widths]
            entry["widths_sample"] = {
                "count": len(vals),
                "first_30": vals[:30],
                "non_null_count": sum(1 for v in vals if v is not None),
            }
        ff = fdict.get("/FontDescriptor")
        if ff is None:
            # Type0 fonts put the descriptor on the descendant
            desc = deref(fdict.get("/DescendantFonts"))
            if isinstance(desc, ArrayObject) and len(desc):
                ff = deref(desc[0]).get("/FontDescriptor")
        ff = deref(ff)
        if isinstance(ff, DictionaryObject):
            entry["font_descriptor"] = {
                "ascent": num(ff.get("/Ascent")),
                "descent": num(ff.get("/Descent")),
                "capheight": num(ff.get("/CapHeight")),
                "fontbbox": [num(x) for x in deref(ff.get("/FontBBox"))] if deref(ff.get("/FontBBox")) is not None else None,
                "italicangle": num(ff.get("/ItalicAngle")),
                "stemv": num(ff.get("/StemV")),
                "flags": inum(ff.get("/Flags")),
                "missingwidth": num(ff.get("/MissingWidth")),
                "fontname": pstr(ff.get("/FontName")),
            }
            for k in ("/FontFile", "/FontFile2", "/FontFile3"):
                if ff.get(k) is not None:
                    st = deref(ff.get(k))
                    entry["fontfile"] = {
                        "key": k,
                        "subtype": pstr(st.get("/Subtype")) if isinstance(st, DictionaryObject) else None,
                        "length1": inum(st.get("/Length1")) if isinstance(st, DictionaryObject) else None,
                        "length2": inum(st.get("/Length2")) if isinstance(st, DictionaryObject) else None,
                        "length3": inum(st.get("/Length3")) if isinstance(st, DictionaryObject) else None,
                    }
        if sig not in seen:
            order.append(sig)
            seen[sig] = entry
        return entry

    for pno, page in enumerate(reader.pages, start=1):
        res = deref(page.get("/Resources"))
        if not isinstance(res, DictionaryObject):
            continue
        fonts = deref(res.get("/Font"))
        if isinstance(fonts, DictionaryObject):
            for key in fonts:
                visit_font(key, fonts[key], pno)

    # page-level /ToUnicode maps, keyed by font resource name
    tou = {}
    for pno, page in enumerate(reader.pages, start=1):
        res = deref(page.get("/Resources"))
        if not isinstance(res, DictionaryObject):
            continue
        fonts = deref(res.get("/Font"))
        if not isinstance(fonts, DictionaryObject):
            continue
        for key in fonts:
            fd = deref(fonts[key])
            if not isinstance(fd, DictionaryObject):
                continue
            tu = deref(fd.get("/ToUnicode"))
            if tu is None:
                continue
            m = parse_tounicode(stream_bytes(tu))
            if m:
                tou[f"{pno}:{key}"] = {str(code): m[code] for code in sorted(m)}
    return [seen[k] for k in order], tou


# ── content-stream walk ──────────────────────────────────────────────────────

def collect_last_array(stack):
    """
    Reconstruct the bracketed array that immediately precedes the operator.

    The tokenizer flattens `[`/`]` into the operand stack, so walk backwards to
    the matching `[` and return (numeric elements, first operand after `]`).
    Returns (None, None) when no well-formed array is found.
    """
    depth = 0
    after = []
    body = []
    for (k, v) in reversed(stack):
        if k == "arr":
            if v == "]":
                depth += 1
                continue
            # v == "["
            if depth == 1:
                # matching opener of the array we are inside -> done
                body.reverse()
                return body, (after[0] if after else None)
            if depth > 1:
                depth -= 1
            continue
        if depth == 0:
            after.append(v)
        else:
            body.append(v)
    return None, None


def walk_page(data, page_no, font_by_res, tounicode_maps):
    """Extract text placements and graphics state for one content stream."""
    out = {
        "text_runs": [],
        "line_widths": [],
        "dash_patterns": [],
        "line_caps": [],
        "line_joins": [],
        "stroke_colors": [],
        "fill_colors": [],
        "rectangles": [],
        "path_moves": [],
        "text_matrix_ops": [],
        "counted": {},
    }

    stack = []
    ctm = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    ctm_stack = []

    tm = tlm = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    cur_font = None
    cur_size = None
    leading = 0.0
    charsp = 0.0
    wordsp = 0.0
    hscale = 1.0
    rise = 0.0
    pending_path = []

    def counted(op):
        out["counted"][op] = out["counted"].get(op, 0) + 1

    for kind, val in tokenize(data):
        if kind != "op":
            stack.append((kind, val))
            continue
        op = val
        counted(op)

        def nums(n):
            vals = [v for (k, v) in stack[-n:]]
            return vals if len(vals) == n else [None] * n

        if op == "q":
            ctm_stack.append(ctm)
        elif op == "Q":
            if ctm_stack:
                ctm = ctm_stack.pop()
        elif op == "cm":
            m = nums(6)
            if all(v is not None for v in m):
                ctm = mat_mul(tuple(m), ctm)
        elif op == "w":
            v = nums(1)[0]
            if v is not None:
                out["line_widths"].append(v)
        elif op == "d":
            arr, phase = collect_last_array(stack)
            if arr is not None:
                out["dash_patterns"].append({
                    "array": [num(x) for x in arr],
                    "phase": num(phase),
                })
        elif op == "J":
            out["line_caps"].append(inum(nums(1)[0]))
        elif op == "j":
            out["line_joins"].append(inum(nums(1)[0]))
        elif op == "RG":
            c = nums(3)
            if all(v is not None for v in c):
                out["stroke_colors"].append(list(c))
        elif op == "rg":
            c = nums(3)
            if all(v is not None for v in c):
                out["fill_colors"].append(list(c))
        elif op == "g":
            v = nums(1)[0]
            if v is not None:
                out["fill_colors"].append([v, v, v])
        elif op == "G":
            v = nums(1)[0]
            if v is not None:
                out["stroke_colors"].append([v, v, v])
        elif op == "re":
            c = nums(4)
            if all(v is not None for v in c):
                x, y, w, h = c
                p0 = apply_mat(ctm, x, y)
                p1 = apply_mat(ctm, x + w, y + h)
                rec = {
                    "x": p0[0], "y": p0[1],
                    "w": abs(p1[0] - p0[0]), "h": abs(p1[1] - p0[1]),
                    "raw": c,
                }
                out["rectangles"].append(rec)
                pending_path.append(("re", rec))
        elif op == "m":
            c = nums(2)
            if all(v is not None for v in c):
                p = apply_mat(ctm, c[0], c[1])
                pending_path.append(("m", [p[0], p[1]]))
        elif op == "l":
            c = nums(2)
            if all(v is not None for v in c):
                p = apply_mat(ctm, c[0], c[1])
                pending_path.append(("l", [p[0], p[1]]))
        elif op in ("c", "v", "y"):
            c = nums(6) if op == "c" else nums(4)
            pts = []
            for i in range(0, len(c), 2):
                if c[i] is not None and c[i + 1] is not None:
                    p = apply_mat(ctm, c[i], c[i + 1])
                    pts.append([round(p[0], 4), round(p[1], 4)])
            if pts:
                pending_path.append((op, pts))
        elif op in ("S", "s", "f", "F", "f*", "B", "B*", "b", "b*", "n"):
            for kindp, pts in pending_path:
                if kindp in ("m", "l", "c", "v", "y"):
                    out["path_moves"].append({"op": op, "kind": kindp, "pt": pts})
            pending_path = []
        elif op == "BT":
            tm = tlm = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
        elif op == "ET":
            pass
        elif op == "Tf":
            if len(stack) >= 2:
                fname = stack[-2][1]
                fsize = stack[-1][1]
                cur_font = fname if isinstance(fname, str) else None
                cur_size = num(fsize) if isinstance(fsize, float) else None
        elif op == "TL":
            leading = nums(1)[0] or 0.0
        elif op == "Tc":
            charsp = nums(1)[0] or 0.0
        elif op == "Tw":
            wordsp = nums(1)[0] or 0.0
        elif op == "Tz":
            hscale = (nums(1)[0] or 100.0) / 100.0
        elif op == "Ts":
            rise = nums(1)[0] or 0.0
        elif op == "Tm":
            c = nums(6)
            if all(v is not None for v in c):
                tm = tlm = tuple(c)
                out["text_matrix_ops"].append({"page": page_no, "tm": list(c)})
        elif op in ("Td", "TD"):
            c = nums(2)
            if all(v is not None for v in c):
                if op == "TD":
                    leading = -c[1]
                tlm = mat_mul((1.0, 0.0, 0.0, 1.0, c[0], c[1]), tlm)
                tm = tlm
        elif op == "T*":
            tlm = mat_mul((1.0, 0.0, 0.0, 1.0, 0.0, -leading), tlm)
            tm = tlm
        elif op in ("Tj", "'", '"'):
            if op != "Tj":
                tlm = mat_mul((1.0, 0.0, 0.0, 1.0, 0.0, -leading), tlm)
                tm = tlm
            payload = None
            for (k, v) in reversed(stack):
                if k == "str":
                    payload = v
                    break
            if payload is not None:
                out["text_runs"].append(
                    text_record(page_no, cur_font, cur_size, tm, ctm, payload,
                                tounicode_maps, font_by_res, None,
                                charsp, wordsp, hscale, rise)
                )
        elif op == "TJ":
            items = []
            depth = 0
            for (k, v) in reversed(stack):
                if k == "arr":
                    if v == "]":
                        depth += 1
                        continue
                    if v == "[":
                        if depth == 0:
                            break
                        depth -= 1
                        continue
                items.append((k, v))
            items.reverse()
            if items:
                out["text_runs"].append(
                    text_record(page_no, cur_font, cur_size, tm, ctm, None,
                                tounicode_maps, font_by_res, items,
                                charsp, wordsp, hscale, rise)
                )

        stack = []
    return out


def text_record(page_no, font_res, size, tm, ctm, payload, tounicode_maps,
                font_by_res, tj_items, charsp, wordsp, hscale, rise):
    """Build one text placement record with device-space coordinates."""
    finfo = font_by_res.get(f"{page_no}:{font_res}") or {}
    tmap = tounicode_maps.get(f"{page_no}:{font_res}") or {}

    raw_parts = []
    kerns = []
    if tj_items is not None:
        for (k, v) in tj_items:
            if k == "str":
                raw_parts.append(v)
            elif k == "num":
                kerns.append(-v)  # TJ numbers move left by that amount
    elif payload is not None:
        raw_parts.append(payload)

    raw = b"".join(raw_parts)
    codes = list(raw)

    # decode: ToUnicode first, else identity, else WinAnsi-ish
    chars = []
    for c in codes:
        if str(c) in tmap:
            chars.append(tmap[str(c)])
        else:
            chars.append(chr(c))
    text = "".join(chars)

    full = mat_mul(tm, ctm)
    dev = apply_mat(full, 0, rise)
    # effective glyph scale = |Tm x Tm x CTM| chain on the y basis
    sx = ((full[0] ** 2 + full[1] ** 2) ** 0.5)
    # rotation: angle of the text x-axis
    rot = 0.0
    if full[0] != 0 or full[1] != 0:
        import math
        rot = math.degrees(math.atan2(full[1], full[0]))

    return {
        "page": page_no,
        "page_index": page_no - 1,
        "font_resource": font_res,
        "basefont": finfo.get("basefont"),
        "font_subtype": finfo.get("subtype"),
        "size": size,
        "tm": [round(x, 6) for x in tm],
        "x": round(dev[0], 4),
        "y": round(dev[1], 4),
        "scale": round(sx, 6),
        "rotation_deg": round(rot, 4),
        "effective_size": round((size or 0) * sx * hscale, 4),
        "char_codes": codes if len(codes) <= 64 else codes[:64],
        "n_glyphs": len(codes),
        "text": text,
        "kerns": [round(k, 4) for k in kerns[:64]],
        "charsp": charsp,
        "wordsp": wordsp,
        "raw_len": len(raw),
    }


def dedupe(seq):
    out = []
    for x in seq:
        if not out or out[-1] != x:
            out.append(x)
    return out


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    path = sys.argv[1]
    out_path = None
    if "-o" in sys.argv:
        out_path = sys.argv[sys.argv.index("-o") + 1]

    reader = PdfReader(path)

    meta = {}
    try:
        info = deref(reader.metadata) if reader.metadata else None
        if info:
            for k, v in info.items():
                meta[str(k).lstrip("/")] = str(v)
    except Exception as e:
        meta["__error__"] = str(e)

    doc = {
        "file": path,
        "pdf_header": open(path, "rb").read(9).decode("latin-1", "replace"),
        "num_pages": len(reader.pages),
        "info": meta,
        "pages": [],
        "fonts": [],
        "tounicode": {},
    }

    try:
        doc["xmp_present"] = reader.xmp_metadata is not None
    except Exception:
        doc["xmp_present"] = None

    fonts, tou = font_inventory(reader)
    doc["fonts"] = fonts
    # JSON keys must be strings; keep the map but flatten for readability
    doc["tounicode"] = {k: v for k, v in tou.items()}

    font_by_res = {}
    for f in fonts:
        font_by_res[f"{f['page']}:{f['resource_name']}"] = f

    for pno, page in enumerate(reader.pages, start=1):
        mb = deref(page.get("/MediaBox"))
        try:
            mediabox = [round(float(x), 4) for x in mb]
        except Exception:
            mediabox = None
        rot = inum(page.get("/Rotate"))
        try:
            content = page.get_contents()
            data = content.get_data() if content is not None else b""
        except Exception:
            data = b""
        rec = walk_page(data, pno, font_by_res, tou)
        # `page` is 1-based (PDF convention); `page_index` is 0-based so it can
        # be joined against the renderer's layout dump without off-by-one.
        rec["page"] = pno
        rec["page_index"] = pno - 1
        rec["media_box"] = mediabox
        rec["rotate"] = rot
        rec["content_bytes"] = len(data)
        for key in ("line_widths", "stroke_colors", "fill_colors", "line_caps",
                    "line_joins", "dash_patterns"):
            rec[key] = dedupe(rec[key])
        doc["pages"].append(rec)

    text = json.dumps(doc, indent=1, ensure_ascii=False)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"wrote {out_path}  ({len(text)} bytes, {doc['num_pages']} pages, "
              f"{len(fonts)} font resources, "
              f"{sum(len(p['text_runs']) for p in doc['pages'])} text runs)")
    else:
        print(text)


if __name__ == "__main__":
    main()