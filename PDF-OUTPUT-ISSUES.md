# PDF Output Issues — MechanicalSeal Datasheet

Comparison baseline: [test/final-test/MechanicalSeal_Datasheet_Expected.pdf](test/final-test/MechanicalSeal_Datasheet_Expected.pdf)
(reference/oracle render) vs. current output produced by
[src/workflows/render-pdf.ts](src/workflows/render-pdf.ts) for the same
[MechanicalSeal_Datasheet.xdp](test/final-test/MechanicalSeal_Datasheet.xdp) /
[MechanicalSeal_schema.xsd](test/final-test/MechanicalSeal_schema.xsd) /
[MechanicalSeal.xml](test/final-test/MechanicalSeal.xml) fixture.

Observed symptoms in the current output:
- Page 1: field values overlap each other (e.g. the three min/rated/max numbers for
  Density/Viscosity/pressure rows are stacked on top of one another instead of appearing in
  three separate columns), some captions overlap adjacent field values (e.g. "Pos." overlapping
  "Machine location"), and the vertical section labels down the left margin (General, Pump/Machine,
  Seal Data, Type, Supply Systems, Specifications, Process Data, Buffer/Barrier, Flush Data,
  Remarks) are missing entirely.
- Page 2 (Site Conditions / Process Fluid / Cooling / Quench / Geometry / Operation Limit table)
  is completely blank — only the header/logo master-page decoration renders, none of the page's
  field content appears.

Below are the concrete, code-verified root causes, ordered by severity.

## 1. (Critical) Pagination drops all content on every page after the first

[src/domain/layout/apply-pagination.ts](src/domain/layout/apply-pagination.ts#L10-L26)

```ts
for (let pageIndex = 0; pageIndex < layout.pages.length; pageIndex++) {
  const pageDef = layout.pages[pageIndex];
  const contentH = pageHeightPts ?? pageDef.contentArea.h;
  const contentNodes = pageIndex === 0 ? layout.children : [];   // <-- bug
  const chunks = splitIntoPages(contentNodes, contentH, pageDef);
  ...
}
```

`layout.children` is the single flowed content tree for the *entire* form (both logical pages
worth of fields). The loop iterates once per declared `<pageArea>` template, but only feeds real
content in on `pageIndex === 0`; every subsequent template gets `contentNodes = []`.
`splitIntoPages([], …)` falls through to `return pages.length > 0 ? pages : [nodes]`, i.e. it
returns `[[]]` — one page with zero children — which is exactly the blank Site Conditions page
seen in the current output.

**Fix direction:** pagination should flow `layout.children` once, splitting it into as many chunks
as height requires, and only use `layout.pages[i]` for the page *template* (size, contentArea,
masterPageChildren) — cycling/re-using page templates as needed — not as a second, independent
source of "does this page get content" gating.

## 2. (Critical) Repeated subform instances are not offset — content overlaps

[src/domain/mapping/expand-repeats.ts](src/domain/mapping/expand-repeats.ts#L52-L70)

```ts
for (let i = 0; i < limit; i++) {
  const itemData = arrayData[i] as DataObject;
  const instance: SubformNode = {
    ...node,                         // <-- keeps the template's original position.x/y for every instance
    occur: undefined,
    bindRef: `${arrayRef}[${i}]`,
    children: resolveChildrenWithData(node.children, itemData),
  };
  instances.push(instance);
}
```

Every expanded instance of a repeating subform (e.g. the min/rated/max value triples, or any
`occur.max > 1` node) inherits the *same* `position.x/y` from the template node — nothing adds a
per-instance offset (row height, column width, or index-based delta). Because
[calculate-positions.ts](src/domain/layout/calculate-positions.ts#L79-L98)'s `position` layout
(the XFA default, used throughout this form — see repo memory) draws each child at
`ctx.x + child.position.x` / `ctx.y + child.position.y` verbatim, all instances land at identical
coordinates and their text draws directly on top of each other. This is the direct cause of the
overlapping min/rated/max numbers and other duplicated-looking field stacks on page 1.

**Fix direction:** `expandRepeatingSubform` needs to shift each instance's position by
`i * rowHeight` (or `i * colWidth`, depending on the repeat's intended flow direction) before
returning it, the same way `positionTableRow`/`positionLrSubform` already do for table/lr layouts.
Alternatively, treat repeated position-layout subforms as an implicit `lr`/`tb` flow when expanding.

## 3. (High) `rotate` attribute is never parsed or rendered — vertical labels missing

No occurrence of `rotate` exists anywhere under `src/domain/parsing/parse-xdp.ts` or
`src/rendering/pdf-renderer.ts`. XFA's `rotate` attribute (typically 90/270, used here for the
vertical section labels — General / Pump-Machine / Seal Data / Type / Supply Systems /
Specifications / Process Data / Buffer-Barrier / Flush Data / Remarks — running down the left
margin of the real form, on top of the gray rounded strip `Rechteck1`) is completely unsupported:
- Not read from `<draw>`/`<subform>` elements in `parse-xdp.ts`.
- Not applied to `PDFPage.drawText`'s `rotate` option in `pdf-renderer.ts`.

Without it, these labels either don't render, or render horizontally in a box sized for vertical
text (contributing to the overlap symptom, since a box authored for 90°-rotated text is narrow and
tall — treating it as a normal horizontal text box lets the wide unrotated string spill into
neighboring cells).

Note there are TWO distinct sources of rotation in this fixture:
- **Static** `rotate` attribute on the section-label draws (the vertical margin labels).
- **Script-driven** rotation on the DRAFT watermark: `<event activity="initialize">` runs
  `txtWatermark.rotate = "30";` (see [MechanicalSeal_Datasheet.xdp](test/final-test/MechanicalSeal_Datasheet.xdp#L47-L49)).
  Because this engine does not execute XFA script (declared unsupported), even if the watermark
  were made visible it would render un-rotated. See issue #6.

**Fix direction:** add `rotate?: number` to `Position`/relevant node types, parse it in
`parsePosition` (or alongside caption/para), and pass `{ rotate: degrees(rotateValue) }` to
`drawText` calls in `renderDraw`/`renderField`, adjusting the effective text-box width/height used
for alignment when rotated 90/270.

## 4. (Medium) `positionAbsoluteSubform` height ignores content, risking bogus page breaks

[src/domain/layout/calculate-positions.ts](src/domain/layout/calculate-positions.ts#L88-L98)

```ts
const height = node.position?.h ?? node.position?.minH ?? 0;
```

A `position`-layout subform whose `<subform>` element in the XDP has no explicit `h`/`minH` (common
when the container is meant to just wrap absolutely-placed children) reports height `0` back to its
parent, regardless of how far down its children actually extend. Combined with issue #1, once
pagination is fixed to actually flow content, this under-reported height means
`apply-pagination.ts`'s `estimateNodeHeight` (which for subforms sums declared child heights, see
[apply-pagination.ts](src/domain/layout/apply-pagination.ts#L82-L96)) will under-count real content
height and may pack more onto one page than actually fits, or fail to trigger a page break where
the real form has one.

**Fix direction:** when `h`/`minH` is absent, derive height from `max(child.y + child.height)`
across the subform's positioned children instead of defaulting to `0`.

## 5. (Low) Caption/value collisions on non-repeating fields (e.g. "Pos." vs "Machine location")

Some field-level overlaps (the "Pos." caption overlapping "Machine location") are not explained by
issues #1–#3 and point to `computeFieldTextLayout`/caption `reserve` handling in
[pdf-renderer.ts](src/rendering/pdf-renderer.ts#L269-L339) not fully accounting for caption
placement (`left`/`top`/`right`/`bottom`) combined with a field `w` narrower than
`reserve + captionText width + valueText width`. Needs isolated verification once #1–#3 are fixed
and the two columns of label:value pairs are no longer being mis-flowed by the position-layout
bugs above (some of what currently looks like a caption/value collision may simply be two
*different* fields sharing coordinates because of issue #2).

Related symptom: the dark/near-black rectangular blobs seen over the min/rated/max value columns in
the current output are NOT a separate black-fill bug — the fixture's only fill colors are
`0,0,0` (thin 0.65pt grid-line rectangles), `192,192,192` (the gray left strip / inverted-field
shading), `153,153,153` (watermark) and `0,0,255` (links). The blobs are overlapping repeated
field values + captions (issue #2) piling black 8pt text onto identical coordinates, reading as a
solid dark mass. They should resolve once #2 is fixed.

## 6. (Medium) DRAFT watermark: expected shows it, current output omits it

The expected reference renders a large light-gray diagonal **DRAFT** watermark across page 1
(and the second logical page). In the current output it is absent. Root cause is a deliberate
guard added earlier: the watermark lives in a `presence="invisible"` subform
([MechanicalSeal_Datasheet.xdp](test/final-test/MechanicalSeal_Datasheet.xdp#L13) and
[L246](test/final-test/MechanicalSeal_Datasheet.xdp#L246)), and `renderNode` in
[pdf-renderer.ts](src/rendering/pdf-renderer.ts#L62) now skips any node whose `presence` is
`invisible`/`hidden`/`inactive`. In Adobe LiveCycle the watermark is toggled visible by an
initialize/preview script; because this engine does not execute XFA script, the field stays
invisible and is therefore skipped.

This is a genuine divergence from the expected PDF, but the "correct" behaviour is a product
decision, not a plain bug:
- If matching the expected (preview/draft) render is required, the renderer needs a
  "preview mode" that force-shows these watermark subforms AND applies the script-driven
  `rotate = "30"` (see issue #3) — neither happens today.
- If a clean (non-draft) production render is the goal, the current omission is arguably correct
  and the expected PDF simply happens to be a preview export.

**Fix direction:** decide whether "draft/preview" output is in scope. If yes, add a render option
that treats known watermark subforms as visible and hard-codes their rotation, since full scripting
is out of scope.

## 7. (Low) `image/bmp` images cannot be embedded (silently dropped)

[src/rendering/image-embedder.ts](src/rendering/image-embedder.ts#L13-L24) only handles PNG and
JPEG (pdf-lib's `embedPng`/`embedJpg` are the only embed paths; pdf-lib has no BMP support). The
fixture contains at least one `contentType="image/bmp"` image
([MechanicalSeal_Datasheet.xdp](test/final-test/MechanicalSeal_Datasheet.xdp#L13497)); the default
branch tries `embedPng` on BMP bytes, throws, and `renderImage` swallows the error
([pdf-renderer.ts](src/rendering/pdf-renderer.ts#L528-L544)), so the image is silently omitted.
The main PNG product photos and logo embed correctly, so this is low severity unless the BMP asset
is visually required.

**Fix direction:** either transcode BMP→PNG before embedding, or document BMP as unsupported in
`src/config/supported-features.json` so the gap is explicit rather than a silent skip.

## Suggested fix order

1. Fix #1 (pagination) — required before page 2 content is visible at all.
2. Fix #2 (repeat instance offsets) — required before the min/rated/max columns are legible.
3. Re-render and re-diff against the expected PDF; re-evaluate whether #5 still reproduces.
4. Fix #3 (rotate support) — required for the vertical section labels.
5. Fix #4 (subform height inference) — hardening once #1 is exercising real multi-page content.
6. Decide #6 (watermark/preview mode) and #7 (BMP) as product/scope calls, lower priority.

## Known pre-existing gaps (already tracked, not new)

See `src/config/supported-features.json` and repo memory: FormCalc, full XFA scripting,
`checkButton`/`choiceList`/`exclGroup` fields, barcodes remain unsupported. Not exercised by this
fixture, so out of scope for this particular comparison, but relevant if the fix work touches
shared rendering code paths.
