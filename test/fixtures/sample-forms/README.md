# Sample forms

Privacy-safe replicas of real-world XFA forms (Adobe LiveCycle Designer / SAP
ADS) for end-to-end testing. Every human-readable value, image and piece of
metadata was replaced by [`scripts/sanitize-forms.mjs`](../../../scripts/sanitize-forms.mjs),
and so were the names of form objects and data elements. Layout, fonts, data
bindings and script logic are unchanged, so the forms render like the originals
(same pages, images, fonts and script outcomes).

| Form                                   | Template (`.xdp`)                             | Schema (`.xsd`)                | Data (`.xml`)                     | Pages |
| -------------------------------------- | --------------------------------------------- | ------------------------------ | --------------------------------- | ----- |
| Example-1 (datasheet)                  | `Example-1/Example-Datasheet.xdp`             | `Example-1/Example-Schema.xsd` | `Example-1/Example-Test-data.xml` | 2     |
| Example-2 EN / CN / ESP (cover letter) | `Example-2/Example-Datasheet-{EN,CN,ESP}.xdp` | `Example-2/Example-Schema.xsd` | `Example-2/Example-Test-Data.xml` | 5     |
| Example-3 (datasheet)                  | `Example-3/Example-Datasheet.xdp`             | `Example-3/Example-Schema.xsd` | `Example-3/Example-Test-Data.xml` | 2     |

[`forms.json`](forms.json) lists the combinations the tests use.

## What was replaced

- **Text** (data values, labels, rich text, Designer render caches, comments):
  word for word, same length, case and script (Latin, accented, Chinese, …).
  Latin letters only swap within glyph-width classes, so text wraps like the
  original. Numbers keep their format, dates stay valid and values stay valid
  for their XSD type.
- **Scripts:** string literals, comments and names (see below). Keywords, SOM
  paths, picture clauses and values the scripts compare against are kept, so
  every script takes the same branch as with the original data.
- **Names:** subform, field, draw, page and script-object names, ids, XSD
  element names, XML data tags and names declared in scripts became generated
  names such as `Subform_0002`, `Field_0101`, `Element_0890` or `var_0003`. A
  name maps to the same new name everywhere it is used: bindings, SOM
  references, scripts, the XSD and the XML data. Names made only of generic
  XFA/JavaScript/Designer words (`value`, `Page1`, `ContentArea`, `Image_12`,
  `event__click`, …) are kept.
- **Images:** grey `PLACEHOLDER W×H` boxes with the same format, pixel size,
  transparency and DPI. Each carries a marker the audit checks for.
- **Contact and system details:** emails and URLs point to `example.com`, file
  paths keep only a file name (and only if it is one of these fixture files),
  ids, hashes and XMP metadata are fake.

Not replaced, by design: generic XFA/Designer names, layout geometry, fonts and script logic.

## Using them

```bash
npm run sample-forms                                    # build, then render every form into results/ (git-ignored)
npx jest test/integration/workflow/sample-forms.test.ts # render checks through the public API
```

```ts
import { render } from 'xdp-pdf-render';

const result = await render({ xdp, xsd, data }); // file contents as strings
```

## Known issue

None. The ESP cover letter previously failed with `XML_1004` because the XML
parser rejected Designer's `<?renderCache.subset "…"?>` processing
instructions; `parseXml` now strips ignorable PIs before parsing.

## Regenerating (maintainers only)

The originals live in `test/final-test/`, which is git-ignored. Never commit it.

```bash
npm run sanitize:forms                                     # rewrite this folder; writes nothing if the leak check fails
node scripts/sanitize-forms.mjs --check                    # leak-check these files against the originals
node scripts/sanitize-forms.mjs --audit                    # no originals needed: emails, URLs, paths, real images, unrecognised names
npm run build && node scripts/sanitize-forms.mjs --compare # render original vs. sanitized and compare
```

- `test/final-test/.sanitize-salt` keeps the output identical between runs.
  Keep it private: with it, anyone could confirm a guessed word.
- List names that must never appear (company, customers, products) in
  `test/final-test/.sanitize-terms.txt`, one per line. They are replaced
  everywhere, including element names, and the run fails if one survives.
