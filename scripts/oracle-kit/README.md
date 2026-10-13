# Oracle kit — get Adobe ground truth without sharing company data

This folder is self-contained on purpose: it does **not** import anything from
`reference/` (which is git-ignored and absent on some checkouts). Everything
here runs with the repo's own `node_modules` + `dist/` and `python3 + pypdf`.

## Privacy contract

Company PDFs, XDP/XSD/XML, and any facts extracted from company forms
**never leave your laptop**. Only two things travel back:

1. `*-facts.json` from the **synthetic probes** below (their strings are
   lorem-style placeholders like `Hxpg`, `alpha bravo…` — no company data).
2. The printed JSON summary of `compare-local.mjs` (page counts, font names,
   operator counts — no text content, no paths).

`*.pdf` is already git-ignored repo-wide. Write all outputs to `%TEMP%`
(or `/tmp`) — never into the repo.

## Prereqs (company laptop)

```bash
npm install && npm run build
python3 -c "import pypdf" || pip install pypdf   # Windows: py -m pip install pypdf
```

## Part A — probe oracles (~15 min, needs Designer 11 on Windows)

The `probes/` inputs are synthetic single-variable forms (metrics, borders,
subforms/pagination). No company data involved.

1. Copy `scripts/oracle-kit/probes/` to the Windows side (or open in place):
   `p1-metrics.{xdp,xsd,xml}`, `p2-borders.{xdp,xsd,xml}`, `p3-subforms.{xdp,xsd,xml}`.
2. For each probe: open the `.xdp` in Designer → point at the sibling
   `.xsd`/`.xml` if asked → `View → Preview PDF` (F5), wait for full render →
   save the preview as `%TEMP%\oracle-kit\<name>-expected.pdf`
   (exact names: `p1-metrics-expected.pdf`, `p2-borders-expected.pdf`,
   `p3-subforms-expected.pdf`).
3. Extract facts (keep the PDFs in `%TEMP%`, they stay local):
   ```bash
   python3 scripts/oracle-kit/extract-facts.py %TEMP%/oracle-kit/p1-metrics-expected.pdf -o %TEMP%/oracle-kit/p1-facts.json
   # … repeat for p2, p3
   ```
4. Send back **only the three `*-facts.json` files**. Keep everything else local.

Regenerating probes is unnecessary (they are committed static files), but if
they ever need it: `node reference/tools/make-probes.mjs` on a checkout that
has `reference/`.

## Part B — company forms (local only, numbers back)

For each company form, with Designer open side by side:

```bash
node scripts/oracle-kit/compare-local.mjs \
  --xdp C:/path/form.xdp --xsd C:/path/schema.xsd --data C:/path/data.xml \
  --expected %TEMP%/oracle-kit/form-expected.pdf [--lenient] [--python py]
```

(`--expected` is the F5-preview PDF saved to `%TEMP%` as in Part A.
`--lenient` tolerates partial schema matches. On Windows the Python launcher
is usually `py`, hence `--python py`.)

Paste back **only the printed JSON** (pages, mediabox, toolchain, font names,
run/rect/operator counts). Do not paste PDFs, XDP/XSD/XML, or facts files.

## Part C — optional: Adobe faces for CJK/sequence work

If Designer is installed, `npm run fonts:import -- "<Designer>/Fonts"` makes
the local renderer resolve Adobe-bundled faces (CJK, Kozuka, Myriad…).
Imported files stay under `assets/fonts/adobe/`, which is git-ignored.

## What happens next (done on the other side)

Probe facts → ascent/advance/border/pagination diffs → minimal renderer fixes
with regression tests → fix commits for you to pull and re-verify locally
with `compare-local.mjs`. Fixes flow one way (code to you); company data
never flows back.
