# RUNBOOK — one-shot Adobe ground-truth collection (company laptop)

> **Who runs this:** paste this whole file into opencode on the machine that
> has Adobe LiveCycle Designer 11 + this repo (without `reference/`).
> **Mission:** produce the return package in §6 and stop. Do **not** modify,
> fix, or commit any repo file. Do **not** open, print, or paste the contents
> of any company file — work with paths and counts only (commands below
> already do this; never `cat`/`type` a company XDP, XML, XSD, or PDF).
> All work happens in a temp dir; nothing company-related may enter the repo.

## Hard privacy rules (never violate)

1. Company PDFs, XDP/XSD/XML, and facts extracted from company forms never
   leave this machine. Return **only** the files listed in §6.
2. Every returned facts file must be produced by `redact-facts.py`, which
   strips all text, char codes, ToUnicode maps, file paths, and metadata
   (keeps numbers/geometry only). The script *refuses* to write output that
   still contains a text-bearing key — a refusal means stop and report.
3. Never paste PDF/XDP/XSD/XML content, text runs, or form URLs into chat.
   Font names, page counts, and operator counts are safe; field names,
   values, and project identifiers are not.
4. Delete the temp work dir when done (§7).

## 0. Setup (repo root in every command)

```bash
git pull
npm install && npm run build
python3 -c "import pypdf; print('pypdf ok')" || pip install pypdf
node --version && python3 --version
```

Expected: node ≥ 20, `dist/workflows/render-pdf.js` exists, pypdf imports.
On Windows, if `python3` is missing use `py` everywhere below (and pass
`--python py` to `compare-local.mjs`).

```bash
mkdir -p <TMP>/oracle-kit/outbox
```

`<TMP>` = `%TEMP%` (Windows) or `/tmp` (WSL/Linux). Keep every intermediate
PDF/facts file under `<TMP>/oracle-kit/` — never in the repo.

## 1. Designer version (30 seconds)

Open Designer → Help → About → write the exact version string to
`<TMP>/oracle-kit/outbox/designer-version.txt` (one line, e.g.
`Adobe LiveCycle Designer 11.0.1.20140926.1. resume…` — whatever it shows).

## 2. Probe oracles (synthetic forms — no company data involved)

For EACH of `p1-metrics`, `p2-borders`, `p3-subforms`:

1. Open `scripts/oracle-kit/probes/<name>.xdp` in Designer (sibling `.xsd`/`.xml`
   supply schema + data if prompted).
2. `View → Preview PDF` (F5). Wait until the preview tab finishes rendering.
3. Save the preview to `<TMP>/oracle-kit/<name>-expected.pdf` (exact name).
   If the preview tab has no Save: File → Print → Adobe PDF printer → same path.
4. Extract + redact (repo root):
   ```bash
   python3 scripts/oracle-kit/extract-facts.py <TMP>/oracle-kit/<name>-expected.pdf -o <TMP>/oracle-kit/<name>-expected.facts.json
   python3 scripts/oracle-kit/redact-facts.py <TMP>/oracle-kit/<name>-expected.facts.json -o <TMP>/oracle-kit/outbox/<name>-expected.redacted.json
   ```
5. Self-check per probe: the outbox file exists, contains `"redacted": true`,
   and `num_pages` ≥ 1. (p3 spans 2 pages; p1/p2 are 1 page. A blank/failed
   preview shows 0 text runs — redo step 2–3 if `text_runs` is empty.)

Do NOT extract facts from any company PDF in this step — probes only.

## 3. Company forms (up to 3, worst-looking first)

For EACH form (call it `<FORM>` — a short label like `invoice-a`, no project names):

1. In Designer, open the company `.xdp` (+ `.xsd`/`.xml` as usual) → F5 preview
   → save to `<TMP>/oracle-kit/<FORM>-expected.pdf` (stays local, never returned).
2. Render locally (repo root; strict first):
   ```bash
   node dist/cli.js render --xdp <FORM-PATH>.xdp --xsd <FORM-PATH>.xsd --data <FORM-PATH>.xml -o <TMP>/oracle-kit/<FORM>-ours.pdf
   ```
   If it fails with a validation error, retry adding `--lenient` and record
   `"lenient": true` for this form in the manifest (§6). Any other failure:
   record the error code/message in the manifest and continue with the next form.
3. Facts + redact for BOTH PDFs:
   ```bash
   python3 scripts/oracle-kit/extract-facts.py <TMP>/oracle-kit/<FORM>-expected.pdf -o <TMP>/oracle-kit/<FORM>-expected.facts.json
   python3 scripts/oracle-kit/extract-facts.py <TMP>/oracle-kit/<FORM>-ours.pdf -o <TMP>/oracle-kit/<FORM>-ours.facts.json
   python3 scripts/oracle-kit/redact-facts.py <TMP>/oracle-kit/<FORM>-expected.facts.json -o <TMP>/oracle-kit/outbox/<FORM>-expected.redacted.json
   python3 scripts/oracle-kit/redact-facts.py <TMP>/oracle-kit/<FORM>-ours.facts.json -o <TMP>/oracle-kit/outbox/<FORM>-ours.redacted.json
   ```
4. Structural summary (numbers only — safe to return):
   ```bash
   node scripts/oracle-kit/compare-local.mjs --xdp <FORM-PATH>.xdp --xsd <FORM-PATH>.xsd --data <FORM-PATH>.xml --expected <TMP>/oracle-kit/<FORM>-expected.pdf [--lenient] [--python py] > <TMP>/oracle-kit/outbox/<FORM>-compare.json
   ```
5. Schema-level inventory (attribute values only — no names, no content).
   Run this python (repo root, replace `<FORM-XDP>` with the company XDP path;
   it reads the file but prints only value histograms):
   ```bash
   python3 - <FORM-XDP> > <TMP>/oracle-kit/outbox/<FORM>-inventory.json <<'EOF'
   import re, sys, json, collections
   src = open(sys.argv[1], encoding='utf-8', errors='replace').read()
   inv = {}
   for attr in ['typeface', 'layout', 'breakBefore', 'breakAfter', 'placement',
                'presence', 'stroke', 'weight', 'posture', 'stock']:
       vals = re.findall(attr + r'\s*=\s*"([^"]+)"', src)
       inv[attr] = dict(collections.Counter(vals))
   print(json.dumps(inv, indent=1))
   EOF
   ```

## 4. Outbox manifest

Write `<TMP>/oracle-kit/outbox/manifest.json`:

```json
{
  "designer": "<exact version string from §1>",
  "forms": [
    {"label": "<FORM>", "lenient": false,
     "pages_expected": <N>, "pages_ours": <M>,
     "note": "<one line: worst symptom, e.g. table columns overlap page 1>"}
  ],
  "files": ["<every filename placed in outbox>"]
}
```

(`pages_expected`/`pages_ours` come from each `<FORM>-compare.json` → `pages`.)

## 5. Final self-check (must all pass before returning)

- [ ] Outbox holds exactly: `designer-version.txt`, `manifest.json`,
      3 × `p*-expected.redacted.json`, and per form 4 files
      (`-expected.redacted.json`, `-ours.redacted.json`, `-compare.json`,
      `-inventory.json`). Nothing else.
- [ ] Every `*.redacted.json` contains `"redacted": true` and no `"text"`,
      `"char_codes"`, `"tounicode"`, or local-path keys (re-run redact if unsure).
- [ ] No outbox file mentions company/project/customer identifiers
      (search the outbox for your company and project keywords — zero hits;
      font names like Arial/Myriad and numbers are fine).
- [ ] `git status` in the repo shows no company files (ideally untouched).

## 6. Return package (paste back, nothing else)

1. Full contents of `manifest.json` and `designer-version.txt`.
2. Full contents of each `*-compare.json` and `*-inventory.json`.
3. Full contents of each `*.redacted.json`
   (p1/p2/p3 first, then per-form pairs).
4. The completed self-check list from §5.

Then stop and wait for the fix commits — do not attempt fixes locally.

## 7. Cleanup

Delete `<TMP>/oracle-kit/` (expected PDFs, unredacted facts, local renders).
The outbox copies you pasted are redacted and safe; everything else must go.

## Troubleshooting

- `dist/ not built` → rerun `npm install && npm run build` from repo root.
- `pypdf not installed` → `pip install pypdf` (Windows: `py -m pip install pypdf`).
- Blank Designer preview → the Reader bridge (`.ppi`) needs Acrobat/Reader
  installed; install it, restart Designer, retry. Report if it persists.
- `compare-local.mjs` render failure → record code/message in manifest, skip
  that form's ours-side files, still return the expected-side redacted facts.
- Probe preview shows wrong pages (p3 must be 2) → re-run F5 after the tab
  fully loads; Designer sometimes previews a stale document on first F5.
