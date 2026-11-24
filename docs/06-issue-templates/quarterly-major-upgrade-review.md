---
name: Quarterly major upgrade review
about: Review major dependency upgrades that Dependabot is configured to ignore
title: 'Quarterly major upgrade review: jest, eslint, commander'
labels: maintenance
assignees: ''
---

Dependabot is configured to group compatible minor/patch updates and ignore
major bumps. Review these packages once per quarter and open a migration issue
only when an upgrade has a concrete benefit:

- `jest`
- `eslint`
- `commander`
- any other direct dependency with a pending major release

For each package, record the current version, latest version, breaking changes
that affect this repository, estimated work, and a decision to upgrade or defer.
