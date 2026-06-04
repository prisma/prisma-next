# Slice: read-command consistency

_In-project slice. Parent project: `projects/migration-graph-rendering/`. Outcome: the migration read-verb family the project built (`list` / `graph` / `status` / `log`, plus `show` / `check`) is consistent at the surface — same param grammar, JSON envelope, error path, decoration flags, and space behaviour — and that consistency is test-locked._

## At a glance

Brings the six migration **read** verbs — `status`, `list`, `graph`, `log`, `show`, `check` (in `packages/1-framework/3-tooling/cli/src/commands/migration-*.ts`) — into line on the six axes from [TML-2801](https://linear.app/prisma-company/issue/TML-2801): params, formatting, behaviour, naming, help text, and structured errors. Most of it is wiring existing shared primitives (`mapRefResolutionError`, `resolveGlyphMode`, the contract/migration ref parsers, exported `{ ok, … }` output schemas) into the commands that skipped them; one piece — making `check` validate every contract space — is a real behaviour change. The full state comparison is in [`../../read-command-consistency-audit.md`](../../read-command-consistency-audit.md) (findings F1–F7); the fix clusters in [`../../read-command-consistency-followups.md`](../../read-command-consistency-followups.md).

## Chosen design

Six fixes, addressed as one sweep across the sibling command files. Five are wiring; one (F1 / `check` multi-space) is the spine.

### F3 — Unify `--json` envelopes + export schemas

`log` emits a **bare array** ([migration-log.ts:134](../../../../packages/1-framework/3-tooling/cli/src/commands/migration-log.ts)); `graph` builds `{ ok, nodes, edges, summary }` **inline** with no exported schema. Both violate Style Guide §JSON Semantics (co-located exported schema; shared `ok` discriminator).

- `log` → `{ ok: true, entries: [...] }` (exported type).
- `graph` → co-located exported output type, like `status`/`list`/`show`/`check` already have.
- Sweep primary-payload field names for a documented convention.

### F5 — One error path

- `check` builds ref-resolution errors inline ([migration-check.ts:173–184](../../../../packages/1-framework/3-tooling/cli/src/commands/migration-check.ts)); route them through the shared `mapRefResolutionError` that `status` ([:330,342](../../../../packages/1-framework/3-tooling/cli/src/commands/migration-status.ts)) and `show` ([:235](../../../../packages/1-framework/3-tooling/cli/src/commands/migration-show.ts)) use.
- `log` raises `errorDatabaseConnectionRequired` then a separate `errorDriverRequired` ([:51,59](../../../../packages/1-framework/3-tooling/cli/src/commands/migration-log.ts)); `status` folds both into one condition ([:274](../../../../packages/1-framework/3-tooling/cli/src/commands/migration-status.ts)). Extract one shared "needs a live DB (connection + driver)" precondition and call it from both. Confirm `meta.missingFlags` is set per Style Guide §Errors.

### F2 — Align `show` / `check` path grammar (align up)

`show` accepts a filesystem path to a migration dir (`looksLikePath` + path resolution); `check` passes the positional straight to `parseMigrationRef` ([:172](../../../../packages/1-framework/3-tooling/cli/src/commands/migration-check.ts)), so it rejects paths. Give `check` path support by sharing `show`'s existing path helper. Both then accept the same forms (dir name / hash / ref / path); help text for both describes the identical grammar. The required-(`show`)-vs-optional-(`check` no-arg = whole-graph) positional distinction stays.

### F6 — Help-text polish

- `check`'s see-also gains `migration show` (currently omitted, [:288–292](../../../../packages/1-framework/3-tooling/cli/src/commands/migration-check.ts)).
- Every JSON-emitting verb gets a `--json` example (notably `show`, which lacks one).
- Uniform "Offline — does not consult the database" / "Requires a database connection" phrasing in every long description (`show` is offline but doesn't say so).

### F4 — `--ascii` where a laned tree is drawn

`status` renders the shared laned tree but **hardcodes** `ui.resolveGlyphMode(false)` at [:377](../../../../packages/1-framework/3-tooling/cli/src/commands/migration-status.ts) and [:452](../../../../packages/1-framework/3-tooling/cli/src/commands/migration-status.ts) — it can never go ASCII. Add `--ascii` and thread `options.ascii === true`, matching `list`/`graph`. `log`'s table (`migration-log-table.ts`) uses box-drawing → add `--ascii` there too. `show` (op preview) and `check` (`✔`/`✗`/`fix:` lines) draw no laned-tree glyphs → no `--ascii`.

### F1 — `check` multi-space (the spine)

Today `check`'s explicit graph checks — file-existence, reachability, dangling-ref — iterate **app space only** ([:142–253](../../../../packages/1-framework/3-tooling/cli/src/commands/migration-check.ts)); only `loadAggregateIntegrityViolations` ([:255](../../../../packages/1-framework/3-tooling/cli/src/commands/migration-check.ts)) already spans all spaces via the aggregate. Extend the app-only loops to run **per contract space**, adopting the project's established policy: **all spaces by default, `--space <id>` to narrow** (same as `list`/`graph`/`status`).

This is grounded, not new machinery: the aggregate already exposes `spaces()` / `space(id)` ([aggregate.ts:262–263](../../../../packages/1-framework/3-tooling/migration/src/aggregate/aggregate.ts)), each space carries its own graph, and `migrationSpaceListEntriesFromAggregate` ([migration-list.ts:98](../../../../packages/1-framework/3-tooling/cli/src/commands/migration-list.ts)) already iterates them. `check` reuses `aggregate.spaces()` + the shared `isValidSpaceId` / space-filter validation from `@prisma-next/migration-tools/spaces` (the same `errorInvalidSpaceId` / `errorSpaceNotFound` factories `list` uses). Net: `check` validates every space's graph, and `--space` narrows.

`show` stays single-migration (no `--space` — the migration's space is already pinned by the reference). `log` stays unscoped (all spaces merged in apply order) — documented in its long description, not flagged. `check` keeps its custom exit codes (F7 — Style-Guide-correct, no change beyond confirming they're documented in `--help`).

### DoD lock

Extend [`test/commands/migration-read-commands-parity.test.ts`](../../../../packages/1-framework/3-tooling/cli/test/commands/migration-read-commands-parity.test.ts) (today: rendering parity only) to assert, across all six verbs: `{ ok, … }` JSON envelope shape; symmetric see-also graph; the shared missing-DB error shape; and `check`'s multi-space behaviour. A regression that reintroduces any F1–F6 defect must fail this test.

## Coherence rationale

One reviewable claim — "the six read verbs are now consistent" — evaluated once, against one extended parity test that proves it. Splitting into per-fix PRs would re-touch the same six sibling files and the same shared helpers repeatedly, serialising on conflicts and re-loading the same context for the reviewer each time. The diff is one sweep across `migration-*.ts` + the shared error/glyph/space helpers + the parity test, rollback-able as a unit.

## Scope

**In:** the six read-command files under `cli/src/commands/migration-{status,list,graph,log,show,check}.ts`; the shared helpers they wire to (`mapRefResolutionError`, the missing-DB precondition, `resolveGlyphMode`, `show`'s path helper, `migration-tools/spaces` validation); `migration-log-table.ts` (`--ascii`); exported output schemas for `graph` + `log`; `check`'s per-space check loops; the parity test extension.

**Out:**
- Any change to `migrate` or the authoring verbs (`plan` / `new`) — write verbs, not in this family.
- The control-api ↔ CLI surface reconciliation ([TML-2780](https://linear.app/prisma-company/issue/TML-2780)) — internal API naming, separate slice.
- `ref list` consistency — adjacent subject, not audited here.
- Whether `show` / `check` should accept the **contract** reference grammar (ref names, `<dir>^`) — they resolve a package, not a contract; out by decision.
- Real `--space` filtering on `show` (rejected by design — single pinned migration).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| `log` JSON consumers depend on the bare-array shape | Accept the break | No external consumers in-repo; the envelope change is the point. Update in-repo snapshots/golden tests in the same diff. |
| `check` multi-space surfaces pre-existing integrity failures in non-app spaces | Expected, not a regression | `check` currently under-validates non-app spaces; newly-surfaced real failures are the fix working. Fixture set must include a multi-space case so the new failures are intentional, not surprising. |

## Slice-specific done conditions

- [ ] The extended parity test fails if any F1–F6 convention regresses (envelope, see-also symmetry, missing-DB error shape, `check` multi-space).

## Open Questions

1. **Does the `check` multi-space work stay in this slice?** Working position: **yes**, as the spine dispatch. Escape hatch — if cross-space graph reconstruction proves gnarlier than `aggregate.spaces()` makes it look (e.g. cross-space ref semantics need design), spin **only** the `check` multi-space piece into a sibling slice and ship the other five fixes as pure wiring. The plan should sequence `check` multi-space as its own dispatch so the cut is clean.
2. **`log` JSON payload field name** (`entries` vs other). Working position: `entries`. Settle when the schema is authored; low stakes.

## Required-section notes

- **Contract-impact:** none. No change to `packages/0-shared/contract/**` or framework-core.
- **Adapter-impact:** none functionally — the CLI read verbs are family-agnostic; `check` multi-space operates on hashes/graphs via the aggregate, not target SQL. The parity test is fixture-based (existing Postgres fixtures); no per-adapter code changes.
- **ADR pointer:** none. This is consistency wiring under the existing CLI Style Guide; no architectural shift. The Style Guide ([`docs/CLI Style Guide.md`](../../../../docs/CLI%20Style%20Guide.md)) is the governing standard.

## References

- Parent project: [`projects/migration-graph-rendering/spec.md`](../../spec.md)
- Audit + findings: [`../../read-command-consistency-audit.md`](../../read-command-consistency-audit.md), [`../../read-command-consistency-followups.md`](../../read-command-consistency-followups.md)
- Linear issue: [TML-2801](https://linear.app/prisma-company/issue/TML-2801)
- Standard: [`docs/CLI Style Guide.md`](../../../../docs/CLI%20Style%20Guide.md) §§ JSON Semantics, Errors, Exit Codes, Flag Conventions
- Prior surface-shape audit: [`projects/migration-domain-model/cli-audit.md`](../../../migration-domain-model/cli-audit.md)
