# Spec — Promote the `migration` CLI to the contract-space aggregate (M6)

**Status:** drafted; ready to drive M6 implementation.

**Origin:** End-to-end verification surfaced four user-visible findings (F1, F3, F4, F7) sharing one root cause: the framework treats contract spaces as first-class as of M2.5, but the canonical user-facing CLI surface (`migration plan` / `status` / `apply`) does not. See [`../e2e-verification.md`](../e2e-verification.md) — § "Pattern: CLI commands assume a single contract space" is the load-bearing summary. F2 (operation-label wording) is folded in because the same formatter changes touch operation rendering. F5 / F6 / F8 are out of scope and called out below.

## At a glance

The framework's deploy story has two flavours:

| Surface | Role | Multi-space today? |
|---|---|---|
| `migration plan` / `status` / `apply` | **Canonical production path.** Plan in dev → commit → apply in prod. | No — app-space only. |
| `db init` / `db update` / `db verify` | Dev-time conveniences. Introspect + plan + apply in one go. | Yes (since M2.5). |

This is the wrong split: the canonical surface is the one missing the framework's first-class semantics. M6 fixes it.

After this slice, **every user-facing migration command operates on the contract-space aggregate by default**, reusing the same per-space ordering, marker checks, and output shape that the `db` family already shares. `migration apply` walks the aggregate (extensions alphabetically, then app — same `concatenate-space-apply-inputs` helper that drives `db init` / `db update`). `migration status` enumerates every on-disk space. `migration plan` summarises by space. Output surfaces per-space markers, applied directories, and applied operations grouped by space, on both success and failure.

The framework already has the plumbing (`db-apply-aggregate.ts`, `concatenate-space-apply-inputs.ts`, the M2.5 `ContractSpaceAggregate` types and loader). M6 is a CLI-side refactor of three commands plus an output-shape redesign across the migration and db families, not new framework infrastructure.

### Worked example: `migration apply` on a pgvector-using app

The snapshot test's surface (and the simplest cross-space example) is an app schema with a `vector(N)` column. The first plan materialises pgvector's pinned baseline (one op: `installVectorExtension`) alongside the app's `CREATE TABLE` migration.

Today, `migration apply` would silently miss the pgvector space (single-space load via `loadMigrationPackages`) — the `CREATE TABLE` then fails with `type "vector" does not exist`, the same class of cross-space-dependency failure cipherstash hit in e2e step 7.

After M6 (illustrative — exact wording is implementer's call; the **shape** is pinned):

```
✔ Applied 2 operation(s) across 2 contract spaces

Extension space: pgvector
  ▾ 20260601T0000_install_vector_extension
      • pgvector.install-vector
  ◆ marker → sha256:<head-hash>

App space
  ▾ 20260509T1602_initial
      • table.embeddings
  ◆ marker → sha256:<app-marker>

Run 'prisma-next migration status' to confirm both spaces are up to date.
```

> _Illustrative — glyphs, indentation, exact phrasing are not pinned. The pinned **shape** is: every space is named, every applied directory under each space is listed, every applied op under each directory is listed, every space's resulting marker is shown, applied order is observable, and the next-step hint is present._

## Required reading (in order)

1. [`../e2e-verification.md`](../e2e-verification.md) — F1, F2, F3, F4, F7 are this spec's primary inputs. § "Pattern: CLI commands assume a single contract space" is the most important section.
2. `packages/1-framework/3-tooling/cli/src/control-api/operations/db-apply-aggregate.ts` — the multi-space apply primitive `db init` / `db update` already use; `migration apply`'s control-api operation will share or wrap this primitive.
3. `packages/1-framework/3-tooling/cli/src/control-api/operations/migration-apply.ts` — the current single-space implementation; this is what M6 rewrites.
4. `packages/1-framework/3-tooling/migration/src/concatenate-space-apply-inputs.ts` — the cross-space ordering helper (extensions alphabetically, then app); the canonical schedule for any apply path.
5. `packages/1-framework/3-tooling/migration/src/aggregate/` — the M2.5 `ContractSpaceAggregate` types + loader; M6 commands consume these.
6. `packages/1-framework/3-tooling/cli/src/utils/command-helpers.ts` — `loadMigrationPackages` (currently app-space only — F3's smoking gun).
7. `packages/1-framework/3-tooling/cli/src/utils/formatters/migrations.ts` — the formatter family touched by F1 / F4 / F7's output-shape changes.
8. `packages/3-extensions/cipherstash/src/migration/call-classes.ts` — `CipherstashAddSearchConfigCall.label` (F2's one-line fix lives here).

## Design

### Principle

**The canonical user-facing migration surface is the contract-space aggregate.** Single-space behaviour is a degenerate case of aggregate behaviour (one member, no extensions); it is not a separate code path.

This collapses the bifurcation that produced the e2e gaps. The implementation rule: every user-facing migration command consumes a `ContractSpaceAggregate` and walks its members in the canonical schedule (`concatenate-space-apply-inputs`). Single-member execution falls out for free.

### `migration apply` semantics

`migration apply` applies **what is on disk** across every contract space — it does not introspect the live database, does not re-plan, does not regenerate artefacts. The user has already run `migration plan`; the resulting directories are committed; `migration apply` is the prod-time replay step.

Concretely:

1. Load every on-disk contract space via the aggregate loader (already exists from M2.5 — same primitive `db init` / `db update` use).
2. For each space, enumerate pending migration directories (those past the current marker).
3. Schedule across spaces using `concatenate-space-apply-inputs` (extensions alphabetically, then app).
4. Apply in scheduled order. After each space's last applied directory, advance that space's marker.
5. Emit the per-space success summary (see § Output shape).

This is exactly the apply phase of `db init` / `db update`, minus the introspect+plan preamble. The implementation will share the apply primitive.

### `migration status` semantics

`migration status` enumerates every on-disk contract space and reports each one's current state:

- Per-space: current marker hash (or "not initialised"); pending migration count; each pending migration's directory + provided invariant ids; current head ref where applicable; "ahead/behind/diverged" relative to the latest planned migration.
- Cross-space: total pending migrations across all spaces, and the count of spaces with anything pending.
- Recommended-next-command line: when pending migrations exist, point at `prisma-next migration apply` (the canonical command). When none, confirm "up to date across N spaces".

The current "1 pending migration(s) — database has no marker / Run 'prisma-next migration apply' to apply pending migrations" output (e2e-verification F4) is replaced by the multi-space-aware version.

### `migration plan` semantics

`migration plan` already plans across spaces (the cipherstash space gets materialised on disk as part of step 5 in the e2e log). The gap is **reporting**: the success summary names only the app-space directory, hiding the extension-space materialisation that just happened.

Required behaviour:

- Group the planned/materialised output by space.
- Surface every extension-space materialisation as its own block (named directory, what it contains, why it was materialised — typically "pinned baseline from extension descriptor").
- The "Next:" hint always points at `prisma-next migration apply` (the canonical apply path). It does not point at `db update` even when extension spaces are present, because `db update` is the dev-time convenience.

### Output shape contract — shared across `migration apply`, `db init`, `db update`

The four output surfaces (apply summary, init summary, update summary, plan summary) share a common shape contract. Pinned observable structure:

1. **Top line** names total operations and total spaces touched (e.g. "Applied 4 operation(s) across 2 contract spaces").
2. **Per-space block** for each space involved in the run, in canonical schedule order (extensions alphabetically, then app):
   - Space label (`Extension space: <id>` or `App space`).
   - Each applied migration directory under the space, with timestamp + slug.
   - Each applied operation under each directory, with operation id + operation class.
   - Per-space marker hash after the run.
3. **Footer**: a "Next:" line pointing at the appropriate next command.

What is **not** pinned (degrees of freedom):

- Exact glyphs, indentation depth, colour usage.
- Whether per-operation lines render full op ids or shortened forms.
- Header wording (`Extension space:` vs `Extension:`, `App space` vs `App`, etc.).
- Whether the "Signature:" line in today's `db init` output is renamed to "App-space marker" or replaced entirely by the per-space marker block above. The pinned constraint is that **per-space markers are observable**; the implementer chooses how.

The error path uses the same shape, with the failing operation called out under its space and directory, and per-space markers showing how far each space progressed before the failure. Today's `Operation table.user failed during execution: create table "user" (PN-RUN-3000)` (e2e step 7) is augmented, not replaced — the structured frame is added; the operation-level error envelope stays as-is.

### Operation labels (F2)

Two parts:

1. **Extension-side**: cipherstash's `CipherstashAddSearchConfigCall.label` is reworded to action-first / column-first form, terse. Pinned constraint: the label communicates the action and the column without requiring extension-domain knowledge to parse. Exact wording is the cipherstash extension author's call (see `packages/3-extensions/cipherstash/src/migration/call-classes.ts`); examples that meet the bar:

   ```
   Enable cipherstash equality search on user.email
   Enable cipherstash pattern search on user.email
   ```

   ```
   user.email — enable cipherstash equality search
   user.email — enable cipherstash pattern search
   ```

   Both are acceptable. The current "Register cipherstash search config (unique) for user.email" is not.

2. **CLI-side**: the `[additive]` / `[mutative]` / `[destructive]` operationClass tag is removed from the default human-readable line. operationClass is metadata the planner uses; the user reviewing a plan cares about the action and the column. Open question (see § Open questions): drop entirely, or push behind `--verbose`. The implementer settles this during M6 implementation.

### Other migration commands

`migration new`, `migration ref`, `migration show` already operate at the per-directory or per-space level (a directory is implicitly tied to a space; refs live under each space's `refs/`). M6 audits them and confirms aggregate-by-default holds — no behavioural change is expected, but any single-space assumption surfaced during audit is fixed in this slice.

The general rule going forward: **any user-facing migration command operates on the aggregate by default.** New commands inherit aggregate semantics; single-space cases are a degenerate path.

## Required changes

### 1. `migration apply` rewires onto the aggregate

`packages/1-framework/3-tooling/cli/src/control-api/operations/migration-apply.ts` is rewritten to load the aggregate, schedule via `concatenate-space-apply-inputs`, and apply in canonical order. It either delegates to `db-apply-aggregate.ts`'s apply primitive (preferred, factor it out cleanly) or absorbs the same logic. The existing app-space-only `loadMigrationPackages` call is replaced by the aggregate loader.

Marker advancement happens per-space (the same primitive `db init` / `db update` already use); the aggregate `markerCheck` from M2.5 is reused for preflight and post-apply verification.

### 2. `migration status` rewires onto the aggregate

`packages/1-framework/3-tooling/cli/src/commands/migration-status.ts` (or its control-api operation if extracted) loads the aggregate and reports per-space state. The single-space layout in the formatter (`utils/formatters/migrations.ts`) gains a per-space iteration; cross-space totals are computed and rendered in the footer.

### 3. `migration plan` reporting rewires by-space

`packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts` already invokes the multi-space planner; only the success summary rendering needs to change. Group by space, surface extension-space materialisations explicitly, point "Next:" at `migration apply`.

### 4. Output-shape contract lands once, shared across commands

A single formatter (`utils/formatters/migrations.ts` or a new file under `utils/formatters/`) renders the per-space success/failure block. `migration apply`, `db init`, `db update`, `migration plan` all delegate to it. This is the structural change that makes "the migration family treats spaces as first-class" observable: one formatter, one shape, one place to update.

### 5. Operation-label cleanup

- `packages/3-extensions/cipherstash/src/migration/call-classes.ts:CipherstashAddSearchConfigCall.label` is reworded per § Operation labels.
- The CLI formatter drops `[additive]` / `[mutative]` / `[destructive]` from the default human-readable line, and either omits it entirely or moves it behind `--verbose` (open question — implementer settles).

### 6. `examples/cipherstash-integration/package.json` script parity

Adds `db:init` and `db:update` scripts matching `examples/prisma-next-demo/package.json`. The example app today wires `migration:apply` only — once M6 lands, `migration apply` is the canonical path and `db init` / `db update` are dev conveniences; both should be available.

### 7. Centralise the descriptor-import boundary

Today, every CLI utility that consumes `extensionPacks` re-implements the same `(pack) => cs ? { id, contractSpace } : { id }` projection with its own structural cast and its own narrowed result shape:

- `packages/1-framework/3-tooling/cli/src/utils/contract-space-aggregate-loader.ts` — `DeclaredExtensionEntry` (id + targetId + contractSpace { contractJson, headRef }).
- `packages/1-framework/3-tooling/cli/src/utils/contract-space-migrate-pass.ts` — `MigratePassExtensionInput` (id + contractSpace { contractJson, headRef }).
- `packages/1-framework/3-tooling/cli/src/utils/contract-space-extension-migrations-pass.ts` — `ExtensionMigrationsExtensionInput` (id + contractSpace { contractJson, migrations, headRef }).
- `packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts` — re-implements the same projection inline at lines ~237 and ~263.

This is the framework's single descriptor-import boundary, scattered. Every M6 command (and `db init` / `db update` after M2.5) re-derives it. Centralise it:

- One canonical helper, e.g. `cli/src/utils/extension-pack-inputs.ts → toExtensionInputs(extensionPacks)`, returning the **most general** shape: `{ id, targetId, contractSpace?: { contractJson, headRef, migrations? } }`.
- Per-consumer adapters (`toDeclaredExtensions`, `toMigratePassInputs`, `toExtensionMigrationsInputs`) take the canonical shape and project to what their downstream primitive needs.
- The `pack as { contractSpace?: ... }` structural cast lives **only** inside the canonical helper — no other CLI code re-implements it.

This is M6 surface work because M6 reshapes every consumer of this boundary (`migration apply` / `migration status` / `migration plan` join `db init` / `db update` as aggregate-by-default callers). Doing the centralisation outside M6 would land code M6 would immediately rework.

## Acceptance criteria

- **AC1** — `migration apply` walks the aggregate. Running `prisma-next migration apply` against an app schema using a pgvector `vector(N)` column with both an app-space migration and the pgvector extension space pending applies both, in canonical order (pgvector first, app second). The single-space-only behaviour (e2e finding F3 against cipherstash) does not reproduce against either extension.
- **AC2** — `migration status` enumerates every on-disk contract space. Running `prisma-next migration status` after `migration plan` (but before `apply`) on the pgvector-using app reports both spaces, each with its pending count and current marker state. The current "App-space-only" output (e2e finding F4) does not reproduce.
- **AC3** — `migration plan` reports by space. Running `prisma-next migration plan --name initial` on the pgvector-using app produces a summary that names both the app-space migration directory and the extension-space materialisation under pgvector. The current "1 directory mentioned, second tree on disk unmentioned" surprise (e2e F1) does not reproduce.
- **AC4** — Per-space markers are observable on success. After a successful apply (via either `migration apply`, `db init`, or `db update`), the success output exposes a marker hash for every space that was touched. The single-line `Signature: sha256:…` collapse (e2e F7) does not reproduce.
- **AC5** — Per-space ordering is observable. The success output reflects canonical schedule order (extensions alphabetically, then app). A reader of the output can tell what ran when.
- **AC6** — "Next:" hints point at canonical commands. After `migration plan` with pending migrations, the next-step hint points at `prisma-next migration apply`. After `migration status` with pending migrations, same. The current "Run 'prisma-next migration apply' to apply pending migrations" hint that triggers F3's silent failure is gone (because `migration apply` now applies them correctly).
- **AC7** — Operation labels are first-time-user-readable. Verified by a unit test on `CipherstashAddSearchConfigCall.label` asserting the new wording. The current "Register cipherstash search config (unique) for user.email" wording is replaced (verified by the same unit test asserting the old string is **not** produced).
- **AC8** — `[additive]` is no longer on the default human-readable line. Whether the implementer drops it entirely or moves it behind `--verbose`, the default plan/apply/status output does not carry operationClass tags inline with operation labels.
- **AC9** — `examples/cipherstash-integration/package.json` exposes `db:init` and `db:update` scripts that run against `process.env.DATABASE_URL`. Parity with `examples/prisma-next-demo/package.json`.
- **AC10** — Output shape is locked by snapshot test. A single end-to-end snapshot test against a pgvector-using app walks `emit → plan → status → apply → status` and locks the output of every step. Future formatter drift fails the test loudly.
- **AC11** — Single descriptor-import boundary helper. Exactly one helper module performs the `extensionPacks → { id, targetId, contractSpace? }` projection (carrying the only `pack as { contractSpace?: ... }` structural cast in the CLI). Every CLI utility / command that consumes extension descriptors goes through this helper (directly or via a per-consumer adapter). `rg "as \{[^}]*contractSpace\?" packages/1-framework/3-tooling/cli/src/` returns matches in the canonical helper only.
- **AC12** — Validation gates pass: `pnpm typecheck`, `pnpm lint:deps`, `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm build`.

## Test plan

- **E2E snapshot harness against pgvector** — primary acceptance gate for the cross-space output contract. pgvector's contract space is minimal (one op: `installVectorExtension` carrying `CREATE EXTENSION IF NOT EXISTS vector`) and runs on PGlite, so the harness is `prisma dev`-native, fast, and CI-friendly. Reuses the harness already in place at `packages/3-extensions/pgvector/test/integration/test/extension-pgvector-scenario-a.e2e.integration.test.ts` (or a sibling test under `test/integration/test/`) to walk `emit → plan → status → apply → status` against an app schema using `vector(N)`, capturing CLI output at each step and asserting against locked snapshots. Covers **AC1, AC2, AC3, AC4, AC5, AC6, AC8, AC10** in a single run.
- **Cipherstash-label unit test** — covers **AC7**. The cipherstash label rewording (`CipherstashAddSearchConfigCall.label`) is verified by a unit test under `packages/3-extensions/cipherstash/test/` that asserts the new label string against the call's expected output. No integration / e2e harness needed for this AC.
- **Per-command unit tests** — for the per-space formatter (output-shape contract), aggregate-walk semantics in `migration apply`'s control-api operation, and the loader-against-aggregate path in `migration status`. Covers the same ACs at the unit level so failures localise.
- **Cross-package validation gate** — `pnpm test:packages && pnpm test:integration && pnpm test:e2e`. Together with the pgvector snapshot harness and the cipherstash label unit test, confirms the M6 changes don't regress M2.5's aggregate work or M3/M4's extension wiring.

## Out of scope / explicitly not doing

- **F5 — PGlite cannot host the real EQL bundle.** Belongs in `examples/cipherstash-integration/README.md` plus a real-PG bootstrap script (Docker compose or `pnpm db:up`). Separate concern; not blocked on M6.
- **F6 — Upstream CipherStash bundle bug** in `eql_v2.add_encrypted_constraint`'s use of `%I` for the constraint-name fragment. Filed upstream; PR-side workaround is `@@map("users")` in the example's `prisma/schema.prisma`. Not M6 work.
- **F8 — Example app SDK envelope shape**. Resolved by the swap to `@cipherstash/stack` (see e2e § "Switching the example off the stub SDK"). Not M6 work.
- **PGlite-incompatibility surfacing.** F5's rec #3 ("wrap per-space apply to detect abrupt PGlite disconnects and emit a structured error") is a separate runtime/error concern, not a CLI surface. If it lands here as a side-effect of touching the apply path it's a bonus, but the AC bar does not require it.
- **Renaming `db init` / `db update`.** They remain `db init` / `db update` and remain advertised. The architectural inversion is that they're _conveniences_ relative to the canonical `migration apply` — a framing change in docs (M5 T5.7), not a rename in code.
- **Net-new migration commands.** M6 does not introduce new commands; it brings the existing surface up to the framework's first-class model.

## Implementation footprint

Approximate, for sizing only:

- **CLI commands**: 3 files updated (`migration-apply.ts`, `migration-status.ts`, `migration-plan.ts`); 1 control-api operation rewritten (`operations/migration-apply.ts`); possibly 1 shared formatter file added or extended (`utils/formatters/migrations.ts`); 1 new helper added (`utils/extension-pack-inputs.ts`) plus 3 existing utilities (`contract-space-aggregate-loader.ts`, `contract-space-migrate-pass.ts`, `contract-space-extension-migrations-pass.ts`) refactored to consume it.
- **Cipherstash extension**: 1 file touched (`migration/call-classes.ts`) — a label string change.
- **Examples**: 1 file touched (`examples/cipherstash-integration/package.json`) — script additions.
- **Tests**: 1 e2e snapshot test added; per-command unit tests under each touched command's `__tests__/` (paths may vary).
- **Docs**: M5's T5.3 / T5.7 already reference M6's surface; no separate doc commit in M6.

Estimated commit count: 5–8, scoped per command + the formatter + the cipherstash label + the example package.json + the snapshot test.

## Risk

- **Output-shape regression in CI**. The snapshot test is load-bearing and may flake on whitespace/ordering at first. Mitigation: lock the snapshot via a deterministic pretty-printer (the formatter is implementation-shared, so the snapshot shape is reproducible as long as the schedule is deterministic — `concatenate-space-apply-inputs` is). If flakes surface, lock the snapshot at the **structured-data level** (per-space block list, per-directory list, per-op list, per-marker map) rather than character-for-character output.
- **`migration apply` apply primitive sharing**. If the apply primitive cannot be cleanly factored out of `db-apply-aggregate.ts`, the M6 implementation may need to either (a) extract a shared `applyAggregate(aggregate, options)` primitive and have both control-api operations call it, or (b) delegate `migration apply` directly to `db-apply-aggregate` minus the introspect step. (a) is cleaner; (b) is faster. Implementer's call during M6 — see § Open questions.
- **Cross-package gate misses**. Migration command output is consumed by example apps' shell scripts and possibly third-party tooling. The repo does not currently grep for output strings as part of CI; if any test or doc fixture pins the old single-space output, M6 must update it. Validation gate includes a `rg` check for the load-bearing strings.

## Sequencing

M6 lands as its own branch off the M4 tip:

```
M4 (pgvector) → M6 (this slice) → M5 (closeout)
```

The branch name follows the project convention: `tml-2397-migration-cli-aggregate` (or similar; see plan). Branch creation, rebase cascade for M5, and PR review are handled by the orchestrator + branch-manager skills, not pinned here.

Within the M6 branch, commit-by-commit slice (illustrative — implementer may reorganise as long as each commit passes its scoped validation):

1. Add the canonical `toExtensionInputs(extensionPacks)` helper + per-consumer adapters; refactor existing utilities (`contract-space-aggregate-loader.ts`, `contract-space-migrate-pass.ts`, `contract-space-extension-migrations-pass.ts`) and the inline projections in `migration-plan.ts` onto it; verify AC11.
2. Extract `applyAggregate` primitive (if needed; see Risk note above).
3. Rewire `migration apply` onto the aggregate; verify AC1.
4. Add per-space output formatter; rewire `db init` / `db update` / `migration apply` summaries onto it; verify AC4 / AC5.
5. Rewire `migration status` onto the aggregate; verify AC2.
6. Update `migration plan` summary rendering; verify AC3 / AC6.
7. Cipherstash label rewording; CLI `[additive]` rendering change; verify AC7 / AC8.
8. Example `package.json` script parity; verify AC9.
9. E2E snapshot test against a pgvector-using app (PGlite-native); verify AC10.

## Open questions

1. **Drop `[additive]` entirely, or push behind `--verbose`?** The default human-readable line should not carry operationClass tags (AC8). The implementer settles whether `--verbose` resurrects them. Default assumption: drop entirely — `--verbose` is a separate concern and should be added intentionally rather than as a back-door for legacy output.
2. **Share the apply primitive between `db-apply-aggregate.ts` and `migration-apply.ts`, or delegate?** See Risk § for trade-off. Default assumption: share — extract `applyAggregate(aggregate, options)` cleanly so both control-api operations call it. Falls back to delegation if the extraction is non-trivial.
3. **"Signature:" → per-space marker block, or rename to "App-space marker" and keep single-line for back-compat?** Today's `db init` output is one line, one signature. AC4 requires per-space markers be observable; the implementer chooses how. Default assumption: replace with the per-space marker block from § Output shape contract — it makes the per-space invariant observable everywhere, which is the point of M6.
4. **Snapshot test backend.** Default: pgvector. Its contract space is one op (`installVectorExtension` carrying `CREATE EXTENSION IF NOT EXISTS vector`), runs on PGlite via the existing `examples/prisma-next-demo` and `packages/3-extensions/pgvector/test/integration/test/extension-pgvector-scenario-a.e2e.integration.test.ts` infrastructure, and exercises every cross-space output path AC1–AC6 require. The cipherstash-label AC (AC7) is covered by a separate unit test on `CipherstashAddSearchConfigCall.label`, so the snapshot harness does not need to host the EQL bundle. If pgvector's surface for some reason fails to exercise an AC during implementation (unlikely — single extension space + app space is exactly the cross-space shape the contract requires), the implementer may add a second snapshot run against a synthetic-bundle cipherstash variant (matching `scenario-c-bump`'s pattern). Real-PG harnesses are not required.

## References

- [`../e2e-verification.md`](../e2e-verification.md) — F1, F2, F3, F4, F7 are this spec's primary inputs.
- [`./contract-space-aggregate-spec.md`](./contract-space-aggregate-spec.md) — M2.5 aggregate types + loader; M6 consumes these.
- [`./framework-mechanism.spec.md`](./framework-mechanism.spec.md) — § 6 (`db init` / `db update` per-space) — the model M6 promotes to the migration family.
- `packages/1-framework/3-tooling/cli/src/control-api/operations/db-apply-aggregate.ts` — multi-space apply primitive M6 reuses or extends.
- `packages/1-framework/3-tooling/migration/src/concatenate-space-apply-inputs.ts` — canonical cross-space ordering helper.
