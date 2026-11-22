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
- [`03-plans/_TEMPLATE.md`](03-plans/_TEMPLATE.md) — template for new plans.

## 5. Decisions

- [`04-decisions/fixes.md`](04-decisions/fixes.md) — historical fix rationale.
- [`04-decisions/2026-11-22-script-isolation.md`](04-decisions/2026-11-22-script-isolation.md)
  — trusted-template script isolation decision.
- [`04-decisions/_TEMPLATE.md`](04-decisions/_TEMPLATE.md) — template for new
  decision records.

## 6. Reference

- [`05-reference/rendering-behavior.md`](05-reference/rendering-behavior.md) —
  observed and decompiled Adobe rendering behaviour.
- [`05-reference/API.md`](05-reference/API.md) — public API, defaults, error
  codes and security notes.
- [`05-reference/_TEMPLATE.md`](05-reference/_TEMPLATE.md) — template for new
  reference notes.

## Naming scheme

`NN-category/YYYY-MM-DD-slug.md` for dated working documents;
`NN-category/slug.md` for long-lived documents. `NN` is a two-digit ordering
prefix from the table in `AGENTS.md`. Keep new root-level markdown out of
`docs/`.
