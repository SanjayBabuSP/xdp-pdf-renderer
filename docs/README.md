# Documentation index

This is the entry point for humans and AI agents. Read in this order.

## 1. Canonical knowledge

- [`01-canonical/AI_WIKI.md`](01-canonical/AI_WIKI.md) — **source of truth** for
  architecture, behaviour, rationale, verification commands and the change
  ledger. Update it in the same change as any code edit.

## 2. Rules

- [`AGENTS.md`](AGENTS.md) — mandatory research + plan rule, naming scheme,
  installed skills and the deduplication policy. All agents must follow it.

## 3. Research (evidence and observations)

- [`02-research/ads-parity-brief.md`](02-research/ads-parity-brief.md) — ADS
  parity brief.
- [`02-research/analysis.md`](02-research/analysis.md) — general analysis.
- [`02-research/designer-data-request.md`](02-research/designer-data-request.md)
  — data requested from Designer/oracle.
- [`02-research/expected-vs-current-comparison.md`](02-research/expected-vs-current-comparison.md)
  — expected versus current output comparison.
- [`02-research/pdf-output-issues.md`](02-research/pdf-output-issues.md) —
  observed PDF output defects.
- [`02-research/2026-11-21-example2-en-cn-parity.md`](02-research/2026-11-21-example2-en-cn-parity.md)
  — Example-2 EN/CN defect evidence.
- [`02-research/2026-11-21-unit-coverage-all-source.md`](02-research/2026-11-21-unit-coverage-all-source.md)
  — Unit coverage baseline and gap analysis.
- [`02-research/2026-11-21-ci-cff-test-asset.md`](02-research/2026-11-21-ci-cff-test-asset.md)
  — CI failure caused by an optional Adobe font asset.
- [`02-research/2026-11-22-i18n-need-assessment.md`](02-research/2026-11-22-i18n-need-assessment.md)
  — Assessment of translation i18n versus locale-aware XFA formatting.
- [`02-research/2026-11-22-locale-aware-formatting.md`](02-research/2026-11-22-locale-aware-formatting.md)
  — Locale propagation and picture-formatting evidence.
- [`02-research/2026-11-22-library-improvements.md`](02-research/2026-11-22-library-improvements.md)
  — Evidence for hardening, packaging and DX changes.
- [`02-research/2026-11-22-windows-ci-dependabot.md`](02-research/2026-11-22-windows-ci-dependabot.md)
  — Windows line-ending CI failure and Dependabot PR volume evidence.
- [`02-research/2026-11-22-sandbox-fix-and-followups.md`](02-research/2026-11-22-sandbox-fix-and-followups.md)
  — Global-object escape reproduction and v0.5.0 follow-up baseline.
- [`02-research/2026-11-22-adobe-style-parity-gaps.md`](02-research/2026-11-22-adobe-style-parity-gaps.md)
  — Adobe vs generated PDF style gaps and xfa.js review.
- [`02-research/2026-11-22-preview-pdf-parity.md`](02-research/2026-11-22-preview-pdf-parity.md)
  — Evidence and measurements for Preview PDF geometry/font/layout parity.
- [`02-research/2026-11-22-visual-parity-defects.md`](02-research/2026-11-22-visual-parity-defects.md)
  — Root causes for the nine reported visual defects.
- [`02-research/2026-11-22-remaining-visual-defects.md`](02-research/2026-11-22-remaining-visual-defects.md)
  — Root causes for the remaining border, bold, gap and pagination defects.
- [`02-research/2026-11-22-final-parity-defects.md`](02-research/2026-11-22-final-parity-defects.md)
  — Root causes for the final URL, glyph and page-split defects.
- [`02-research/2026-11-22-overlap-and-anchor-defects.md`](02-research/2026-11-22-overlap-and-anchor-defects.md)
  — Root causes for the Example-2 text overlap and Example-3 misplaced rule.
- [`02-research/2026-11-22-footer-fragment-nbsp-defects.md`](02-research/2026-11-22-footer-fragment-nbsp-defects.md)
  — Root causes for the footer grid, fragment cutoff and NBSP tofu defects.
- [`02-research/2026-11-22-midline-split-band-defects.md`](02-research/2026-11-22-midline-split-band-defects.md)
  — Root causes for the mid-line page-split overlap and cutoff.
- [`02-research/2026-11-23-paragraph-table-parity.md`](02-research/2026-11-23-paragraph-table-parity.md)
  — Root causes for the paragraph spacing and table render defects.
- [`02-research/2026-11-23-table-double-shift.md`](02-research/2026-11-23-table-double-shift.md)
  — Root causes for the straddling-table double shift and leaf split.
- [`02-research/2026-11-24-ci-optional-font-tests.md`](02-research/2026-11-24-ci-optional-font-tests.md)
  — Optional Adobe font tests that fail on clean CI checkouts.
- [`02-research/_TEMPLATE.md`](02-research/_TEMPLATE.md) — template for new
  research notes.

## 4. Plans

- [`03-plans/implementation-plan.md`](03-plans/implementation-plan.md) —
  implementation plan.
- [`03-plans/mechanicalseal-adobe-parity-plan.md`](03-plans/mechanicalseal-adobe-parity-plan.md)
  — Mechanicalseal parity plan.
- [`03-plans/2026-11-21-example2-en-cn-parity.md`](03-plans/2026-11-21-example2-en-cn-parity.md)
  — Example-2 EN/CN implementation plan.
- [`03-plans/2026-11-21-unit-coverage-all-source.md`](03-plans/2026-11-21-unit-coverage-all-source.md)
  — Comprehensive unit coverage plan.
- [`03-plans/2026-11-21-ci-cff-test-asset.md`](03-plans/2026-11-21-ci-cff-test-asset.md)
  — CI-safe CFF test plan.
- [`03-plans/2026-11-22-locale-aware-formatting.md`](03-plans/2026-11-22-locale-aware-formatting.md)
  — Locale-aware XFA formatting plan.
- [`03-plans/2026-11-22-library-improvements.md`](03-plans/2026-11-22-library-improvements.md)
  — Hardening, packaging, DX and quality-gate plan.
- [`03-plans/2026-11-22-windows-ci-dependabot.md`](03-plans/2026-11-22-windows-ci-dependabot.md)
  — Windows formatting and Dependabot noise fix plan.
- [`03-plans/2026-11-22-sandbox-fix-and-followups.md`](03-plans/2026-11-22-sandbox-fix-and-followups.md)
  — Sandbox, API, package size, async I/O and maintainability plan.
- [`03-plans/2026-11-22-adobe-style-parity-gaps.md`](03-plans/2026-11-22-adobe-style-parity-gaps.md)
  — Numeric fraction and plain-text whitespace parity plan.
- [`03-plans/2026-11-22-preview-pdf-parity.md`](03-plans/2026-11-22-preview-pdf-parity.md)
  — Border, font, caption, URL, spacer and pagination parity plan.
- [`03-plans/2026-11-22-visual-parity-defects.md`](03-plans/2026-11-22-visual-parity-defects.md)
  — Draw wrapping, caption symbol, bold, keep, border and pagination plan.
- [`03-plans/2026-11-22-remaining-visual-defects.md`](03-plans/2026-11-22-remaining-visual-defects.md)
  — Uniform-border dedup, bold restore, rich sizing and leaf-keep plan.
- [`03-plans/2026-11-22-final-parity-defects.md`](03-plans/2026-11-22-final-parity-defects.md)
  — URL, glyph coverage, post-shift pagination and overflow-alignment plan.
- [`03-plans/2026-11-22-overlap-and-anchor-defects.md`](03-plans/2026-11-22-overlap-and-anchor-defects.md)
  — Rich-text line fallback and anchorType placement plan.
- [`03-plans/2026-11-22-footer-fragment-nbsp-defects.md`](03-plans/2026-11-22-footer-fragment-nbsp-defects.md)
  — Footer grid, fragment cutoff and NBSP tofu fix plan.
- [`03-plans/2026-11-22-midline-split-band-defects.md`](03-plans/2026-11-22-midline-split-band-defects.md)
  — Mid-line split band extension and tail-move plan.
- [`03-plans/2026-11-23-paragraph-table-parity.md`](03-plans/2026-11-23-paragraph-table-parity.md)
  — Paragraph spacing and table render parity plan.
- [`03-plans/2026-11-23-table-double-shift.md`](03-plans/2026-11-23-table-double-shift.md)
  — Straddling-table double-shift and leaf-split fix plan.
- [`03-plans/2026-11-24-ci-optional-font-tests.md`](03-plans/2026-11-24-ci-optional-font-tests.md)
  — Guard optional Adobe font tests for clean CI checkouts.
- [`03-plans/_TEMPLATE.md`](03-plans/_TEMPLATE.md) — template for new plans.

## 5. Decisions

- [`04-decisions/fixes.md`](04-decisions/fixes.md) — historical fix rationale.
- [`04-decisions/2026-11-22-script-isolation.md`](04-decisions/2026-11-22-script-isolation.md)
  — trusted-template script isolation decision.
- [`04-decisions/2026-11-22-null-prototype-globals.md`](04-decisions/2026-11-22-null-prototype-globals.md)
  — null-prototype context globals and deferred isolation alternatives.
- [`04-decisions/_TEMPLATE.md`](04-decisions/_TEMPLATE.md) — template for new
  decision records.

## 6. Reference

- [`05-reference/rendering-behavior.md`](05-reference/rendering-behavior.md) —
  observed and decompiled Adobe rendering behaviour.
- [`05-reference/reference-feature-gaps.md`](05-reference/reference-feature-gaps.md)
  — inventory of reference-folder capabilities not implemented, partial or
  approximated in this library, with difficulty and evidence per gap.
- [`05-reference/adobe-parity-assessment.md`](05-reference/adobe-parity-assessment.md)
  — why the output is not yet 1:1 with Adobe, the measured residual gaps,
  parity levels, acceptance gates and the phased remediation roadmap.
- [`05-reference/API.md`](05-reference/API.md) — public API, defaults, error
  codes and security notes.
- [`05-reference/_TEMPLATE.md`](05-reference/_TEMPLATE.md) — template for new
  reference notes.

## 7. Issue templates

- [`06-issue-templates/quarterly-major-upgrade-review.md`](06-issue-templates/quarterly-major-upgrade-review.md)
  — quarterly reminder for ignored major-version upgrades.

## Naming scheme

`NN-category/YYYY-MM-DD-slug.md` for dated working documents;
`NN-category/slug.md` for long-lived documents. `NN` is a two-digit ordering
prefix from the table in `AGENTS.md`. Keep new root-level markdown out of
`docs/`.
