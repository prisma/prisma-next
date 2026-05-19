# drive/qa — project-context for manual QA

Loaded by `drive-qa-plan` and `drive-qa-run` when authoring manual-QA scripts and running them against this repo.

> **Trial period in effect (ends 2026-06-02).** When any drive-* skill in this category produces a finding, record it in [`findings.md`](./findings.md). Quality bar, tags, and format live in [`docs/drive/trial.md`](../../docs/drive/trial.md).

## Consumer audiences

Manual-QA scripts for prisma-next slices that touch user-observable surface should name and exercise both consumer audiences:

- **Extension authors.** Audience that authors `@prisma-next/extension-*` packages and consumes the framework's authoring substrate, IR, and ADR-defined extension points.
  - Substrate location: `packages/3-extensions/` (worked examples of real extensions) + the framework export surface in `packages/0-framework/` and `packages/1-sql/` / `packages/1-document/`.
  - Common probes: "does the upgrade-skills coverage gate fire on a planted regression?"; "does the ADR's new extension point work end-to-end for at least one example extension?"; "do the extension's tests still pass after a framework substrate change?"
- **End users.** Audience that uses prisma-next via the demo or example apps.
  - Substrate location: `examples/` (the demo + the example apps under `examples/*`).
  - Common probes: "does `pnpm demo` still run cleanly?"; "does the example app's `pnpm dev` produce the expected first-run output?"; "does a deliberately-malformed schema produce the documented error envelope?"

Scripts that touch only one audience must say so explicitly in the "What this script is testing" block — that's a coverage statement, not a gap.

## Substrate locations

| Surface | Where to find it |
|---|---|
| Demo (end-user happy path) | `pnpm demo` from repo root |
| Example apps | `examples/<app>/` — each has its own `README.md` describing what it demonstrates |
| Extension worked-examples | `packages/3-extensions/<extension>/` — each has its own tests describing the extension's contract |
| Upgrade-skills coverage gate | `pnpm check:upgrade-coverage` (relevant for any framework-breaking change) |
| Fixture suite | `pnpm fixtures:check` (relevant for any IR / emitter / serialiser change) |
| Standard test gates | `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e` (these are CI gates, not manual QA — listed here so scripts don't redundantly re-author them) |

## Standard pre-QA gate

A clean pre-QA tree means `pnpm typecheck && pnpm test:packages && pnpm fixtures:check` all green. QA against an unverified tree wastes the runner's time discovering broken assertions that a 1-minute `pnpm test:packages` would have surfaced.

## Known coverage-gate gaps

QA's comparative advantage over CI in this repo is **judgement-class observation**: `pnpm test:packages` and `pnpm test:e2e` exercise structural shape and exit codes; they do not verify:

- **Error envelope copy quality** (`fix:` lines, suggested verbs, legibility, freshness, cross-reference correctness). `pnpm test:packages` asserts shape, not legibility. A script that says "the user pastes their broken schema; does the error message tell them what to fix?" is the only way to catch error-copy regressions.
- **CLI diagnostic flow.** `pnpm test:e2e` runs end-to-end but doesn't read the output the way a human would. Scripts that re-run a known-broken CLI flow and judge diagnostic clarity catch what e2e tests cannot.
- **Generated artefact shape** (the `contract.d.ts` consumers actually edit against). Fixtures check that the emitted shape matches the golden; manual QA should sometimes open the generated `.d.ts` and read it as a downstream type-author would.
- **Migration applicability across the demo's history.** Migrations apply forward in test fixtures, but a manual run that walks the demo through its migration history and confirms each step produces a usable database is uniquely valuable when a migration-system slice ships.
- **`--help` text legibility, freshness, cross-reference correctness.**
- **Multi-command developer journeys** (A then B then C as a real user would).
- **Output legibility** (table formatting; JSON envelope shape against `--json` consumers' expectations).
- **Negative-control gate behaviour** (whether a lint / strict throw actually fires on a planted violation; CI only checks today's clean tree).

Manual-QA scripts should preferentially target these gaps. Re-running the automated suite is **not** a QA scenario.

## Where QA artefacts live

- **In-project slices** (project under `projects/<x>/`): `projects/<x>/manual-qa.md` (script) + `projects/<x>/manual-qa-reports/<YYYY-MM-DD>-<runner>.md` (one per run).
- **Orphan slices**: inline in the PR description (script under `## Manual QA` heading; findings as a review-comment thread).
- **Artefacts referenced by findings**: `projects/<x>/manual-qa-reports/artefacts/F-<N>/`.

Both `drive-qa-plan` and `drive-qa-run` enforce these locations.

## Slice-DoD overlay (QA-side items)

In addition to the canonical slice DoD:

- [ ] `drive-qa-plan` script exists + ≥1 `drive-qa-run` report exists.
- [ ] No unresolved 🛑 Blocker findings.
- [ ] Script names **both** prisma-next QA audiences (extension authors via `packages/3-extensions/`, end users via `examples/`) where relevant — OR explicit "N/A — no user-observable change" with a one-line rationale.

## When to mark "N/A"

A slice may legitimately mark "Manual QA: N/A" when:

- The change is internal-refactor with no user-observable surface (no new envelope copy, no new CLI surface, no new error path, no new extension contract).
- The change is doc-only (a README rewrite, an ADR addition).
- The change is purely infrastructural (a CI workflow tweak, a build-config change) that has no consumer-visible behaviour.

The slice's DoD records the N/A with a one-line rationale; the project DoD's QA-coverage check confirms the rationale is honest. An "internal refactor" that turns out to have changed a user-visible error message is the failure mode this check exists to catch.

## When this file should change

Append (rather than overwrite) when any of the following surface during a QA round:

- A new consumer audience the existing two categories don't cover.
- A new substrate location that QA scripts repeatedly touch.
- A coverage-gate gap previously not enumerated.
- A reusable fixture worth adding to the catalogue.

Reduce or remove (with explanation) when an entry is no longer relevant.
