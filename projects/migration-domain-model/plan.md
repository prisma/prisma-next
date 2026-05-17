# Migration CLI restructure — plan

**Spec:** [`spec.md`](./spec.md)
**Audit:** [`cli-audit.md`](./cli-audit.md)
**Vocabulary:** [`domain.md`](./domain.md)
**Linear:** [TML-2546](https://linear.app/prisma-company/issue/TML-2546/review-migration-cli-commands-and-vocabulary) for shaping; per-milestone tickets are created when each milestone starts.

## Summary

Eight milestones, eight PRs. Milestones M2 through M7 are independent and could land in any order or in parallel (one PR each); M1 is foundational and must land first; M8 is close-out. The work is sized by how much it changes the user-facing CLI surface and how heavily the journey suite exercises the affected verbs.

```
M1 ── foundation ────────────────┐
                                 ▼
       M2 (migrate)   M3 (ref)   M4 (status split)   M5 (sign args)   M6 (check)   M7 (preflight)
                                 │
                                 ▼
                              M8 ── close-out (docs + cleanup)
```

The dominant per-milestone cost is **journey-test rewrite, not implementation**. Every milestone that renames or moves a verb touches `test/integration/test/cli-journeys/*.e2e.test.ts` and the helpers in `test/integration/test/utils/journey-test-helpers.ts`. We size each milestone accordingly.

## Cross-project dependencies

None. The CLI is downstream of every framework subsystem this work doesn't touch (planner, runner, verifier, marker / ledger). The journey suite already exercises every path this project changes.

## Risk surface (principal engineer's read)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Journey test churn** | High | Per-milestone PR review burden | Each milestone owns its journey-test updates atomically. No transitional aliases means tests rewrite once, not twice. |
| **Reference resolver bugs** in M1 land everywhere downstream | Medium | Test failures appear in M2+ PRs and look like rename bugs | M1 ships with unit tests covering every grammar form, every ambiguity rule, every error path. Errors are localised to the resolver, not the consuming command. |
| **`migration preflight` sandbox provisioning** | Medium | M7 may discover the existing test infra isn't reusable as-is | If discovered: scope M7 down to "framework + Postgres only" and file a follow-up for Mongo. PGlite is already a peer of every CLI integration test path. |
| **Vocabulary drift in subsystem docs** | Medium | Docs reference removed verbs (`migration apply`, `migration ref`) and confuse future readers | M8 grep-sweeps `docs/` for the old names; the close-out PR is the gating point. |
| **Internal helper renames are opportunistic, then forgotten** | Low | Internal naming carries the rejected "applied" past close-out | The opportunistic rule is documented in the spec's Non-goals; a follow-up Linear ticket captures the residual sweep. |

## Milestones

### M1 — Reference-resolver foundation (FR5)

**Goal:** the contract-reference and migration-reference grammars are implemented as resolvers consumed by every command that takes a `<contract>` or `<migration>` argument. The existing flag *names* don't change yet; their argument grammars broaden.

**Architectural shape.** Two resolvers, two types:

- `ContractRef` is a parsed-and-resolved value carrying the storage hash plus provenance (which grammar form produced it). `parseContractRef(input, ctx)` reads the file system / refs index and either returns a `ContractRef` or a structured error.
- `MigrationRef` is the parallel type for the `<migration>` grammar (directory name or hash).
- Both resolvers live next to the existing migration-tools code (`packages/1-framework/3-tooling/migration/src/refs/` is the obvious neighbour to `refs.ts`).

The resolver yields one error type with cases for each failure mode in the spec's AC2 / FR5 — `NotFound`, `Ambiguous` (with candidate list), `WrongGrammar` (passed a `<contract>` reference where a `<migration>` was expected), `InvalidFormat`.

**Tasks (TDD; tests first):**

- [ ] Unit-test the contract-reference resolver covering all five grammar forms, all ambiguity cases, and all error paths. The test fixture builds a small on-disk graph (a few hashes, a few refs, a couple of migration directories with deliberately hex-shaped names to exercise ambiguity).
- [ ] Implement `parseContractRef` + `parseMigrationRef`.
- [ ] Update existing CLI commands to use the resolver for the *argument* they already accept (not yet renamed):
  - `migration plan --from <hash>` → underlying parse goes through `parseContractRef`.
  - `migration apply --ref <name>` → underlying parse goes through `parseContractRef`. (Keeps the `--ref` flag name; the broader grammar is M2's surface concern.)
  - `db update --to <hash>` → broaden to full grammar.
  - `migration ref set <name> <hash>` → broaden.
  - `migration status --ref <name>` → broaden.
  - `migration show <dir-name>` → already accepts a directory name; route through `parseMigrationRef` so other forms work.
- [ ] Add the help text for each command's argument noting it accepts the full grammar (one-line description, link to a help topic).
- [ ] Journey tests that pass hashes / ref names where the resolver should accept either continue to pass.

**Validation.** AC2 verified by unit test. `pnpm test:journeys` passes unchanged. No surface rename has happened yet — every command in the current surface still exists and accepts its current flag names.

**Why this first.** Every subsequent milestone takes the resolver as a given. Landing it as a self-contained foundation means M2–M7 are pure verb-surface changes that don't also have to re-derive the grammar.

---

### M2 — Top-level `migrate --to <contract>` (FR1)

**Goal:** the bare-verb form for advancing the live database is `prisma-next migrate --to <contract>`. The old `prisma-next migration apply [--ref X]` is gone.

**Tasks (TDD; tests first):**

- [ ] Update the journey-test helper: `runMigrationApply(ctx, ['--ref', X])` → `runMigrate(ctx, ['--to', X])`. Rename the helper; update every call site (~10 journeys).
- [ ] Update journey-test assertions referencing the verb name in error messages (e.g., `migration-apply-edge-cases.e2e.test.ts` — assertions on "no path" error text).
- [ ] Add `packages/1-framework/3-tooling/cli/src/commands/migrate.ts` implementing the new top-level verb. Implementation is the existing `migration-apply.ts` body with the flag renamed, the resolver from M1 wired in, and the help text rewritten.
- [ ] Register the new command in `cli.ts`. Remove the `migrationApplyCommand` registration. Delete `migration-apply.ts`.
- [ ] Update the help text and error envelopes in `cli.ts` "Unknown command" handler — running `prisma-next migration apply ...` now triggers an unknown-command error with a candidate-suggestion pointing at `migrate`.
- [ ] Update `docs/architecture docs/subsystems/7. Migration System.md` for every reference to `migration apply`. (Scope: only the references that exist; the larger doc rewrite is M8.)

**Validation.** AC1 (no `migration apply` in `--help`), AC7 (journey suite green). Manual verification: `prisma-next migrate --to <hash>`, `prisma-next migrate --to production`, `prisma-next migrate --to ./other/contract.json` all do the right thing on a live test DB.

**Why before M3-M7.** This is the highest-leverage rename and the one most disruptive to the journey suite. Landing it first makes M3–M7's helper renames smaller deltas against a settled base.

---

### M3 — Top-level `ref` namespace (FR2)

**Goal:** `prisma-next ref *` replaces `prisma-next migration ref *`. The `get` sub-verb becomes `show`.

**Tasks (TDD; tests first):**

- [ ] Update `runMigrationRef(ctx, ['set', name, hash])` → `runRef(ctx, ['set', name, hash])` in `journey-test-helpers.ts`. Update every call site (~5 journeys, predominantly `ref-routing` and `divergence-and-refs`).
- [ ] Add `packages/1-framework/3-tooling/cli/src/commands/ref.ts` (or `commands/ref/` for the four subcommands) hosting `set`, `show`, `list`, `delete`. Implementation copies from `migration-ref.ts` with `get` renamed to `show`. The `<contract>` argument goes through the M1 resolver.
- [ ] Register the new top-level `ref` command in `cli.ts`. Remove the `migrationRefCommand` mounting under `migrationCommand`. Delete `migration-ref.ts`.
- [ ] Update help text and unknown-command-suggestion paths.

**Validation.** AC1 (no `migration ref` in `--help`), AC7 (journey suite green).

---

### M4 — Split `migration status` into five verbs (FR3)

**Goal:** `migration status`, `migration log`, `migration list`, `migration graph` are four separate verbs, each answering one question. The old multi-flag `status` is gone.

**Architectural shape.** The current `migration-status.ts` (~1100 lines) houses four interrogative responses behind flag combinations. The split:

- `migration status` retains the path/pending question. New flag surface: `--to <contract>` / `--from <contract>`. Reads marker + computes path.
- `migration log` reads the ledger and renders the executed-migrations history.
- `migration list` enumerates `migrations/<space>/*` on disk, topologically ordered.
- `migration graph` renders the graph (ASCII tree by default, `--json` / `--dot` for other formats).

The split is a mechanical extraction of the four response-rendering paths inside `migration-status.ts` into four sibling commands. Shared helpers (the renderer fragments) move to a shared module.

**Tasks (TDD; tests first):**

- [ ] In `journey-test-helpers.ts`:
  - Update `runMigrationStatus` to use `--to` instead of `--ref`.
  - Add `runMigrationLog`, `runMigrationList`, `runMigrationGraph`.
- [ ] Update journey tests:
  - `migration status --ref X` → `migration status --to X` (~6 journeys).
  - `migration status --all` callers (if any) → `migration log` or `migration list` per intent.
  - `migration status --graph` callers (if any) → `migration graph`.
- [ ] Extract the response renderers to `commands/migration-status/renderers/`.
- [ ] Add `commands/migration-log.ts`, `commands/migration-list.ts`, `commands/migration-graph.ts`. Each is a thin entry point that calls the relevant renderer.
- [ ] Slim `commands/migration-status.ts` down to the path/pending question + `--to`/`--from` flags. Remove `--ref`, `--graph`, `--all`, `--limit`.
- [ ] Register the three new commands in `cli.ts`.

**Validation.** AC1, AC3, AC7. Manual verification of each new verb's stdout against the previous all-in-one shape.

---

### M5 — `db sign` contract argument (FR4)

**Goal:** `db sign` accepts an optional contract argument (positional or `--contract`). With no argument, the current behavior (sign with `contract.json`) is preserved exactly.

**Tasks (TDD; tests first):**

- [ ] Extend `runDbSign` to accept extra args.
- [ ] Add a journey test (extend `brownfield-adoption.e2e.test.ts` or add a small new journey) exercising:
  - `db sign` (no arg, default) — current behavior, regression-protected.
  - `db sign <hash>` (positional, hash prefix).
  - `db sign --contract <ref>` (explicit, ref name).
- [ ] Extend `db-sign.ts`: positional `[<contract>]` argument and `--contract <contract>` flag. The two are equivalent; mutually exclusive at the parse step (CLI usage error if both are supplied). Argument goes through the M1 resolver.
- [ ] Update help text.

**Validation.** AC4. Smallest and most contained of the surface changes; could land in parallel with any other milestone.

---

### M6 — `migration check [<m>]` (FR6 part 1)

**Goal:** the artifact / graph integrity verb exists. With a `<m>` argument, checks one migration. Without, checks the graph.

**Architectural shape.** `migration check` is read-only over the filesystem. The per-migration check recomputes the migration's hashes from its on-disk artifacts and compares to the stored manifest; it validates the `ops.json` matches its declared shape. The graph-wide check additionally walks every edge and verifies the `from` / `to` contracts referenced exist on disk and connect to neighbouring migrations correctly, and walks the refs index verifying every ref's target hash exists in the graph.

The functions for hash recomputation already exist (used by `migration plan`'s manifest emission); this verb wraps them in an interrogative shape.

**Tasks (TDD; tests first):**

- [ ] Adversarial-fixture journey tests covering AC6:
  - Clean graph passes.
  - Hand-mutated `ops.json` (hash mismatch) fails with a localized message.
  - Corrupted manifest (missing files) fails.
  - Orphan migration (no graph-connecting edge) fails.
  - Dangling ref (target hash absent) fails.
- [ ] Add `commands/migration-check.ts`. Per-migration and graph-wide code paths.
- [ ] Register in `cli.ts`.
- [ ] Resolve open question — exit-code semantics: integrity failure vs CLI-usage failure get distinct exit codes (see spec Open Questions).
- [ ] Add to `journey-test-helpers.ts` as `runMigrationCheck`.

**Validation.** AC6.

---

### M7 — `migration preflight <m>` (FR6 part 2)

**Goal:** the behavioral sandbox verb exists. Sandbox-executes a single migration and reports outcome. Production DB is untouched.

**Architectural shape.** Reuses the existing test-infra primitives for ephemeral DB acquisition:

- For Postgres: spin a PGlite instance in-process (the same mechanism `test/integration` uses).
- For Mongo: `mongodb-memory-server` (likewise).
- The sandbox is initialised to the migration's `from`-contract state, then the migration is executed against it. Outcome (success / failure / which op failed) is reported.

The trick is that the framework already has a runner; preflight is a runner invocation against a sandbox + reporting wrapper. The infra to acquire a sandbox per-invocation needs to live in the CLI (not in `test-utils`, which is a test-only dependency).

**Tasks (TDD; tests first):**

- [ ] Journey tests for AC5: green migration → success + production untouched; data-violating migration → reported failure + production untouched. Two journeys: one Postgres-flavored, one Mongo-flavored.
- [ ] Promote the test-utils sandbox-acquisition primitives that aren't test-specific into a CLI-consumable package, or move them to a position the CLI can depend on. Decide which during M7 design — may surface a layering question (`test/utils` is a test-tree package; the CLI is in `packages/`).
- [ ] Add `commands/migration-preflight.ts`. Takes a `<m>` argument; resolves via M1 resolver; acquires sandbox; initialises to `from`-contract; runs the migration; reports.
- [ ] Resolve open question on initial-sandbox state (spec Open Questions). Working assumption: initialise to `from`-contract by replaying every migration from `∅` up to but not including `<m>` on the sandbox. If that's too slow for graphs with many migrations, switch to "operator provides initial state" via a flag — but design first; don't optimise speculatively.
- [ ] Register in `cli.ts`.

**Validation.** AC5. **Highest-risk milestone** for unexpected scope. Worth dedicating spike time before committing to a one-PR shape.

---

### M8 — Close-out (docs + cleanup)

**Goal:** docs match the surface; the project directory is deleted; vocabulary lives in canonical locations.

**Tasks:**

- [ ] Promote `domain.md`'s settled vocabulary into `docs/glossary.md` (or fold and replace; depends on what's there).
- [ ] Update `docs/architecture docs/subsystems/7. Migration System.md` for the full new verb taxonomy. Remove references to `migration apply`, `migration ref`, `migration status --ref/--graph/--all`. Add the verification triad. Update the Git-inspired analogy section to use the resolved vocabulary (contract / migration / ref distinctions).
- [ ] Update `docs/CLI Style Guide.md` for the new top-level subjects.
- [ ] Grep-sweep `docs/` and `packages/*/README.md` / `DEVELOPING.md` for references to removed verb names. Replace or remove.
- [ ] File a follow-up Linear ticket for the residual internal renames (`MigrationApplied` event, `control-api/operations/` → `commands/`, etc.) that this project explicitly carries as non-goals.
- [ ] Delete `projects/migration-domain-model/`.

**Validation.** AC1, AC8. `pnpm fixtures:check` and `pnpm lint:deps` pass. `pnpm test:journeys` and `pnpm test:all` are green.

## Implementation rules (apply to every milestone)

- **Tests first.** Per the workspace rules — write the journey-test changes (the assertion against the new verb name / shape) *before* the implementation. The journey suite is the spec; failing tests pin the new shape down.
- **No transitional aliases.** Each rename is atomic. If a milestone leaves the journey suite red on its own PR boundary, the milestone hasn't landed.
- **Opportunistic internal renames only.** If a milestone touches `apply-aggregate.ts` and renaming it costs an extra five minutes, rename it. If the rename spans untouched files, it goes on the follow-up ticket.
- **One PR per milestone.** Where M7 may be too large for one PR, split as `M7a` (Postgres preflight, journey + infrastructure) and `M7b` (Mongo preflight) — design-time decision, recorded in the milestone before opening the first PR.
- **Update `journey-test-helpers.ts` atomically.** Helpers follow the new verb names; callers update in the same PR. Don't leave helper names lagging behind the verbs.
- **Help text and error envelopes are part of the rename.** The CLI's "Unknown command" suggestion engine should already help when somebody runs the old name; verify in each milestone that the suggestion lands on the right new verb.

## Linear tracking

Per the workspace rules, Linear issues exist for visibility, not for project bookkeeping. The intended cadence:

- One Linear issue per milestone (M1–M8). Branch names and PR titles carry the issue ID so the GitHub-Linear integration auto-transitions issues on merge.
- TML-2546 (the audit ticket) gets closed when M8 merges and the project directory is deleted.

Issues are created when a milestone starts, not up-front, to avoid stale tickets sitting around if the plan shifts.
