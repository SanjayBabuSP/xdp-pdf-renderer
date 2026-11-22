# Research note — Windows CI formatting and Dependabot PR flood

- Date: 2026-11-22
- Author: opencode
- Status: confirmed
- Related plan: `docs/03-plans/2026-11-22-windows-ci-dependabot.md`

## Question

Why does `Check formatting` fail only on `windows-latest`, and why did adding
Dependabot create eight pull requests within four minutes?

## Evidence

- CI screenshot: `Node v24.x on windows-latest` failed at `Check formatting`
  with 229 `[warn]` lines and `Code style issues found in 229 files`.
- CI screenshot: `ubuntu-latest` and `macos-latest` passed the same step.
- Workflows screenshot: `CI #78` etc. opened by `dependabot[bot]` for npm and
  GitHub Actions dependency bumps within three to four minutes.
- Pull requests screenshot: 9 open PRs, eight from Dependabot (#5–#12) and one
  release PR (#4). Several Dependabot PRs have failing checks.
- Source: `.prettierrc` has no `endOfLine` setting; Prettier defaults to LF.
- Source: `.github/dependabot.yml` allowed five open PRs per ecosystem.
- Source: `.github/workflows/ci.yml` runs `npm run format:check` on all three
  operating systems.

## Findings

- `actions/checkout` on Windows checks out text files with CRLF by default.
  Prettier's default `endOfLine: 'lf'` then reports every text file as badly
  formatted on Windows only. Confidence: high.
- The repository has no `.gitattributes`, so Git normalisation is left to the
  runner's `core.autocrlf` setting. Confidence: high.
- Dependabot opens PRs immediately after a config is added, up to
  `open-pull-requests-limit` per ecosystem. With npm=5 and github-actions=5,
  eight PRs in one run is expected, not a bug. Confidence: high.
- Major upgrades (GitHub Actions 6→7, release-please 4→5, ESLint 9→10,
  `@types/node` 22→26, pixelmatch 5→8) are the PRs most likely to fail CI and
  should be reviewed manually rather than auto-opened. Confidence: high.

## Measurements

| Case | Observed | Expected | Delta |
| --- | --- | --- | --- |
| Windows `format:check` | 229 files flagged | 0 | CRLF/LF mismatch |
| Ubuntu/macOS `format:check` | pass | pass | none |
| Open Dependabot PRs | 8 | <=2 desired | reduce limit/group updates |
| Failing Dependabot PRs | 5 of 8 | 0 | ignore major updates |

## Open unknowns

- Whether the existing Dependabot PRs should be closed or merged; that is a
  repository-management decision, not a CI fix.
- Whether any of the major upgrades are actually desirable; they need a
  separate review and test pass.

## Conclusion

Force LF line endings in Git and make Prettier's LF expectation explicit. Keep
Dependabot, but lower its limits, group compatible updates and ignore major
version bumps so the bot does not flood the PR list or open PRs that cannot pass
CI without deliberate work.
