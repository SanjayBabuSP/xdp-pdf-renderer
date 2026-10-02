#!/usr/bin/env python3
"""Dump the Adobe PDF417 constant tables out of pdf417pmp.dll.

Table addresses come from reference/decompiled/pdf417pmp_disasm.c:
  cluster 0 patterns : s_31111136_12b13088   (929 x 9 bytes)
  cluster 3 patterns : s_51111125_12b15138   (= 12b13088 + 0x20B0)
  cluster 6 patterns : s_21111155_12b171e8   (= 12b15138 + 0x20B0)
  RS coefficients    : DAT_12b0f668 (levels 0..8, 2/4/8/16/32/64/128/256/512 words)
  text submodes      : DAT_12b13028 / 12b13040 / 12b13058 / 12b13070 (4 x 24 B)
"""
import json
import struct

DLL = 'reference/Adobe-LiveCycle-Designer-11.0/barcode_data/pdf417pmp.dll'
OUT = 'scripts/pdf417-adobe-tables.json'

b = open(DLL, 'rb').read()

pe_off = struct.unpack_from('<I', b, 0x3c)[0]
nsec = struct.unpack_from('<H', b, pe_off + 6)[0]
optsize = struct.unpack_from('<H', b, pe_off + 20)[0]
opt = pe_off + 24
imgbase = struct.unpack_from('<I', b, opt + 28)[0]
so = opt + optsize

sections = []
for i in range(nsec):
    base = so + i * 40
    name = b[base:base + 8].rstrip(b'\0').decode(errors='replace')
    vsize, vaddr, rsize, roff = struct.unpack_from('<IIII', b, base + 8)
    sections.append((name, imgbase + vaddr, imgbase + vaddr + vsize, roff, rsize))


def read(va: int, n: int) -> bytes:
    for _name, lo, hi, roff, _rsize in sections:
        if lo <= va < hi:
            return b[roff + (va - lo): roff + (va - lo) + n]
    raise KeyError(f'address {va:#x} outside any section')


def ascii_table(va: int, count: int, width: int) -> list[str]:
    rows = []
    raw = read(va, width * 929)
    for i in range(929):
        cell = raw[i * width: (i + 1) * width]
        rows.append(cell.split(b'\0')[0].decode('ascii'))
    return rows


CLUSTER_SIZE = 9  # 8 chars + NUL terminator, per the decompile's `+ iVar3 * 9` indexing

clusters: dict[str, list[str]] = {}
for name, va in (('cluster0', 0x12b13088), ('cluster3', 0x12b15138), ('cluster6', 0x12b171e8)):
    rows = []
    for i in range(929):
        cell = read(va + i * CLUSTER_SIZE, CLUSTER_SIZE)
        rows.append(cell.decode('ascii', errors='replace').rstrip('\0'))
    clusters[name] = rows
    print(f'{name} row0={rows[0]!r} row300={rows[300]!r} row928={rows[928]!r}')

# --- Reed-Solomon generator coefficients -----------------------------------
# EC level -> { va, count } from the switch in FUN_12b0bc30 (11008-11091).
switch = [
    (0x12b0f668, 2), (0x12b0f670, 4), (0x12b0f680, 8), (0x12b0f6a0, 16),
    (0x12b0f6e0, 32), (0x12b0f760, 64), (0x12b0f860, 128), (0x12b0fa60, 256),
    (0x12b0fe60, 512),
]
rs_by_level: dict[int, list[int]] = {}
for level, (va, count) in enumerate(switch):
    rs_by_level[level] = list(struct.unpack(f'<{count}I', read(va, count * 4)))
print('RS level sizes', {k: len(v) for k, v in rs_by_level.items()})
print('RS level0', rs_by_level[0])
print('RS level8 tail', rs_by_level[8][-4:])

# --- text submode tables (4 x 24 bytes) ------------------------------------
# --- text submode tables (4 x 24 bytes, in .data) --------------------------
text_submodes = []
for va in (0x12b13028, 0x12b13040, 0x12b13058, 0x12b13070):
    text_submodes.append(read(va, 24).decode('ascii', errors='replace').rstrip('\0'))
print('text submodes', text_submodes)

out = {
    'clusters': clusters,
    'rs': {str(k): v for k, v in rs_by_level.items()},
    'textSubmodes': text_submodes,
}
with open(OUT, 'w', encoding='utf8') as fh:
    json.dump(out, fh)
print('wrote', OUT)
