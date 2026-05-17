# CLI audit (Phase 3)

Compares the current CLI surface (today's `packages/1-framework/3-tooling/cli/src/`) against the vocabulary resolved in `domain.md`. Friction signals were drawn from the CLI journey tests at `test/integration/test/cli-journeys/` — those tests model real user workflows end to end, and the awkwardness shows up loudest in the test harness helpers that paper over missing verbs.

## Method

1. Enumerated current commands from `cli.ts` and `commands/*.ts`.
2. For each command, read what options it accepts and what journey tests invoke it.
3. For each helper in `test/integration/test/utils/journey-test-helpers.ts` that exists *only because the CLI lacks a verb*, flagged the missing surface.

## Current surface (as of audit)

```
prisma-next
├── init                              # project scaffold
├── contract
│   ├── emit
│   └── infer
├── db
│   ├── init                          # bootstrap a DB
│   ├── update [--to <hash>]          # off-graph reconciliation, dev-only
│   ├── verify [--schema-only|--marker-only|--strict]
│   ├── sign                          # signs current contract.json only
│   └── schema                        # show live schema
└── migration
    ├── plan [--name <slug>] [--from <hash>]
    ├── new
    ├── show
    ├── status [--ref <name>] [--graph] [--limit <n>] [--all]
    ├── apply [--ref <name>]          # advance DB to target
    └── ref
        ├── set <name> <hash>
        ├── get <name>
        ├── list
        └── delete <name>
```

## Findings

Each finding cites evidence from the journey tests or the CLI command files. Findings are grouped by severity: **L1** = real user-visible smell (helper workarounds, redundant flags), **L2** = vocab alignment, **L3** = missing surface that the vocab implies but the CLI has never shipped.

---

### L1. Missing verb: `migration compile`

**Evidence:**

- `test/integration/test/utils/journey-test-helpers.ts:408-462`:
  ```ts
  // runMigrationEmit ... Self-emits a migration package by running its
  // `migration.ts` directly with `tsx`. The migration.ts invokes
  // `MigrationCLI.run(import.meta.url, …)`, which serializes the class's
  // operations to `ops.json` and attests `migration.json`.
  //
  // ... `runMigrationPlanAndEmit` ... Mirrors the old `migration plan`-
  // auto-emits behaviour that journey tests relied on before the
  // `migration emit` command was removed.
  ```
- `test/integration/test/cli-journeys/init-journey/harness.ts:588-610`:
  ```ts
  /**
   * Self-emits the most recently planned migration package by executing
   * its `migration.ts` directly via Node's native type stripping. The
   * draft module calls `MigrationCLI.run(import.meta.url, …)` ...
   *
   * The CLI flow used to do this implicitly inside `migration plan`; it
   * is now a separate user-driven step, so the journey performs it
   * explicitly here.
   */
  export async function selfEmitLatestMigration(project) {
    return runStep(project, [
      'node',
      '--env-file-if-exists=.env',
      '--experimental-strip-types',
      '--no-warnings=ExperimentalWarning',
      migrationTs,
    ]);
  }
  ```

**Smell.** The vocabulary work named this step **`migration compile`** — execute the planner-emitted `migration.ts` to lower it to `ops.json`. Today there is no CLI verb for it. Users (and the test harness) re-discover the right `node --experimental-strip-types ...` flag set every time, and the inner loop becomes a three-step dance with no first-class verb to anchor it:

1. `prisma-next migration plan --name X` → writes `migration.ts`.
2. `node --experimental-strip-types --no-warnings=ExperimentalWarning migrations/app/<dir>/migration.ts` → writes `ops.json`. **No CLI verb.**
3. `prisma-next migration apply` → advances the DB.

The `migration emit` verb used to exist (the comment "before the `migration emit` command was removed" confirms it was deliberately deleted), but the operation it named — lowering `migration.ts` to `ops.json` — is still load-bearing. Renaming it to `migration compile` and bringing it back makes the user's mental model match the vocabulary the docs already use.

**Resolution:** Add `prisma-next migration compile [--dir <path>] [--dry-run]`. Calls into the same code path the helper invokes via `tsx`/`node`. The user-facing inner loop becomes `plan` → `compile` → `migrate --to <ref>`, three first-class verbs.

---

### L1. `ref` nested under `migration` is a category error

**Evidence:**

- `packages/1-framework/3-tooling/cli/src/cli.ts:253` mounts ref under migration:
  ```ts
  const migrationRefCommand = createMigrationRefCommand();
  migrationCommand.addCommand(migrationRefCommand);
  ```
- Journey usage `test/integration/test/cli-journeys/ref-routing.e2e.test.ts:61-64`:
  ```ts
  const refProd = await runMigrationRef(ctx, ['set', 'production', c1Hash]);
  const refStaging = await runMigrationRef(ctx, ['set', 'staging', c2Hash]);
  ```
  which invokes `prisma-next migration ref set production <hash>`.

**Smell.** A ref is a **contract reference**, not a migration artifact. It points to a contract (a node), not to a migration (an edge). The `migration` namespace is for things that *are* migrations or that read/write/describe migrations. A ref is on the same footing as a contract — they're both subjects in their own right.

The current path `prisma-next migration ref set production <hash>` reads as "set the ref-of-this-migration", which doesn't match the model. The intended reading is "set ref named `production` to contract `<hash>`" — a ref-level operation, not a migration-level one.

**Resolution:** Promote `ref` to a top-level subject namespace:

```
prisma-next ref
├── set <name> <contract>
├── show <name>             # renamed from `get` for consistency with `migration show` / `contract show`
├── list
└── delete <name>
```

`migration ref` keeps working as an alias for at least one release to avoid breaking users mid-stream.

---

### L1. `migration apply --ref X` is the wrong subject *and* the wrong flag

**Evidence:**

- `packages/1-framework/3-tooling/cli/src/commands/migration-apply.ts:314-316`:
  ```ts
  .option('--db <url>', 'Database connection string')
  .option('--config <path>', 'Path to prisma-next.config.ts')
  .option('--ref <name>', 'App-space target ref name from migrations/app/refs/')
  ```
- Every journey that advances a DB invokes it — e.g. `test/integration/test/cli-journeys/ref-routing.e2e.test.ts:87`:
  ```ts
  const applyStaging = await runMigrationApply(ctx, ['--ref', 'staging', '--json']);
  ```

**Smell — two-part.**

1. **Subject:** `migration apply` is filed under the `migration` namespace, which the vocabulary reserves for artifact / graph operations. The verb here *advances the live database*. That's a `db`-shaped operation in spirit — and the right home for it in the vocabulary is a top-level `migrate` verb, since "migrate the database to a state" is the canonical bare verb in our model.

2. **Flag:** `--ref <name>` accepts only a ref name. The vocabulary's "contract reference" grammar is broader — a `<contract>` can be a ref name, a hash (full or prefix), a migration directory name, `<dir>^` (the dir's *from*-contract), or a filesystem path. Calling the flag `--ref` artificially restricts what the user can name as a target. The vocab-aligned flag is `--to <contract>`.

**Resolution:**

```
prisma-next migrate --to <contract>
```

Replaces `prisma-next migration apply --ref <name>`. The flag accepts the full contract reference grammar (ref names included), so today's calls migrate cleanly with no loss of expressiveness.

For the deprecation transition: keep `migration apply` as an alias that prints a deprecation note and forwards to `migrate --to <ref>`.

The fact that `migration apply` is the single most-invoked command across the journey suite (every `runMigrationApply(...)` callsite) makes this the highest-leverage rename in the audit.

---

### L1. `migration status` is doing five jobs

**Evidence:**

- `packages/1-framework/3-tooling/cli/src/commands/migration-status.ts:1069-1074`:
  ```ts
  .option('--db <url>', 'Database connection string')
  .option('--config <path>', 'Path to prisma-next.config.ts')
  .option('--ref <name>', 'Target ref name from migrations/refs/')
  .option('--graph', 'Show the full migration graph with all branches')
  .option('--limit <n>', 'Maximum number of migrations to display (default: 10)')
  .option('--all', 'Show full history (disables truncation)')
  ```

**Smell.** The current `migration status` answers at least five different questions depending on flag combinations:

| Invocation | Question | Vocab-aligned verb |
|---|---|---|
| `migration status --ref X` | What needs to happen to reach `X`? | `migration status --to X` |
| `migration status` | What needs to happen to reach the current contract? | `migration status` |
| `migration status --graph` | What's the topology of the migration graph? | `migration graph` |
| `migration status --all` | What's the full execution history? | `migration log` |
| `migration status` (offline mode) | What migrations exist on disk? | `migration list` |

It conflates *path computation* (which is live and depends on the marker), *graph topology* (offline, filesystem-only), *execution history* (live, from the ledger), and *artifact enumeration* (offline, filesystem-only). Each is a different question with a different freshness model.

**Resolution.** Split into the five verbs the vocab work already named:

- `migration status [--to <contract>] [--from <contract>]` — path / pending. Live by default; offline when `--from` is supplied.
- `migration log` — execution history (live, reads the ledger).
- `migration list` — flat enumeration of migrations on disk (offline).
- `migration graph` — graph topology with branches and ref markers (offline).
- `migration show <m>` — single migration (offline).

The current `migration status --ref X --graph --all` syntax is preserved as a transitional alias that forwards to the appropriate split verb.

---

### L2. `db verify`'s three flag-gated modes are really three verbs

**Evidence:**

- `packages/1-framework/3-tooling/cli/src/commands/db-verify.ts:503-510`:
  ```ts
  .option('--db <url>', 'Database connection string')
  .option('--config <path>', 'Path to prisma-next.config.ts')
  .option('--marker-only', 'Skip schema verification and only check the database marker')
  .option('--schema-only', ...)
  .option('--strict', ...)
  ```
- Used in *every* drift / brownfield journey, e.g. `drift-marker.e2e.test.ts`, `brownfield-adoption.e2e.test.ts` (both `db verify` and `db verify --schema-only` are exercised in the same test).

**Smell.** The three modes answer three distinct questions:

| Invocation | Question |
|---|---|
| `db verify` | Does the DB satisfy its claimed contract? (marker + schema) |
| `db verify --schema-only` | Does the schema match the contract? (ignore marker) |
| `db verify --marker-only` | Is the marker pointing at the contract we expect? |

`--schema-only` is heavily used in adoption flows (you don't have a marker yet, you want to know if the contract matches the live structure). `--marker-only` is a drift-debugging trick. Today the user has to know that "verify with no flags" answers a *different* question than "verify schema only" — neither is a subset of the other.

**Resolution (lower priority than L1 items).** Worth considering keeping the default verb (`db verify`) for the canonical "satisfies-its-contract" question, but giving the two narrower questions either explicit flags with clearer names *or* sub-verbs. The flag form is workable as-is; this is a docs / help-text improvement rather than a rename. **Mark as parked for now; revisit after L1 work lands.**

---

### L2. `db sign` should accept a contract argument

**Evidence:**

- `packages/1-framework/3-tooling/cli/src/commands/db-sign.ts:208-209`:
  ```ts
  .option('--db <url>', 'Database connection string')
  .option('--config <path>', 'Path to prisma-next.config.ts')
  ```
- Brownfield mismatch journey `brownfield-adoption.e2e.test.ts:111-115`:
  ```ts
  const signFail = await runDbSign(ctx);
  expect(signFail.exitCode, 'G.04: db sign fails').toBe(1);
  ```
  always uses the no-arg form because no other form exists.

**Smell.** Today `db sign` *only* signs the current `contract.json`. The vocab settled on `db sign [<contract>]` (positional) / `db sign --contract <contract>` (explicit). The explicit form is genuinely useful in adoption flows where the user wants to sign with a specific contract from the graph (e.g., to claim "the DB is at this historical contract") rather than whatever happens to be in `contract.json` today.

**Resolution:** Add the positional argument and `--contract` flag. Default behavior unchanged.

---

### L2. `migration plan --from <hash>` is correct; `migration status --ref X` is not

**Evidence:**

- `packages/1-framework/3-tooling/cli/src/commands/migration-plan.ts:526`:
  ```ts
  .option('--from <hash>', 'Explicit starting contract hash (overrides latest migration target)')
  ```
  Already uses `--from` with a contract reference. Good.
- `packages/1-framework/3-tooling/cli/src/commands/migration-status.ts:1071`:
  ```ts
  .option('--ref <name>', 'Target ref name from migrations/refs/')
  ```
  Uses `--ref` with a ref-name-only restriction. Out of step with the contract-reference grammar.

**Smell.** Two flags doing the same job — naming a target contract — using two different vocabularies. `--from <hash>` accepts the broad contract-reference grammar (currently it documents "hash" but the implementation could readily accept the broader form). `--ref <name>` only accepts ref names.

**Resolution:** Standardize on `--to <contract>` and `--from <contract>` everywhere the verb takes a *contract* target. Both flags accept any contract reference form (hash, ref name, migration directory, `<dir>^`, filesystem path).

---

### L3. Net-new verbs from the vocab work

These verbs are absent from the current CLI and need to be added to fulfill the vocabulary. None of them rename existing surface.

| Verb | Subject | Purpose | Class |
|---|---|---|---|
| `migration compile` | migration | Lower `migration.ts` → `ops.json` | mutating offline |
| `migration log` | migration | Execution history from the ledger | read-only live |
| `migration list` | migration | Flat enumeration of migrations on disk | read-only offline |
| `migration graph` | migration | Topology view with branches | read-only offline |
| `migration check [<m>]` | migration | Artifact / graph integrity check | read-only offline |
| `migration preflight <m>` | migration | Sandbox-execute to verify behavior | mutating sandbox |
| `migrate --to <contract>` | (top-level) | Advance live DB along the graph | mutating live |

`migrate` is the new top-level verb. `migration compile` is the missing re-introduction. The remaining four (`log`, `list`, `graph`, `check`, `preflight`) are net-new surface implied by the vocabulary work.

---

### L3. `db update` and `migrate` are surface-similar — keep the distinction in help text

Not friction, just a callout. The two commands look similar:

- `db update --to <contract>` — off-graph reconciliation. Dev-only. Doesn't consult the graph. Doesn't advance any ref. Doesn't write the ledger.
- `migrate --to <contract>` — graph traversal. Universal (dev + prod). Walks the graph, applies each migration, advances markers, writes the ledger.

The dev-time `db update-workflows.e2e.test.ts` and `interleaved-db-update.e2e.test.ts` journeys show both being used in the same project — the user has to know which is which. The verbs are correct (and were resolved in Phase 2); the work is to make the help text and error messages distinguish them sharply. **Track as a documentation task, not a CLI surface change.**

---

## Proposed final surface

```
prisma-next
├── init                              # project scaffold (unchanged)
├── migrate --to <contract>           # NEW — advance live DB to a contract
├── contract
│   ├── emit                          # unchanged
│   └── infer                         # unchanged
├── db
│   ├── init                          # unchanged
│   ├── update [--to <contract>]      # unchanged; dev-only
│   ├── verify                        # unchanged (flag cleanup parked)
│   ├── sign [<contract>] [--contract <contract>]  # NEW arg
│   └── schema                        # unchanged
├── migration
│   ├── plan [--name <slug>] [--from <contract>]   # --from grammar broadened
│   ├── new
│   ├── compile [--dir <path>]        # NEW (re-introduces removed verb)
│   ├── show <m>
│   ├── status [--to <contract>] [--from <contract>]   # split from old surface
│   ├── log                           # NEW (live, ledger)
│   ├── list                          # NEW (offline, flat enumeration)
│   ├── graph                         # NEW (offline, topology)
│   ├── check [<m>]                   # NEW (offline, integrity)
│   └── preflight <m>                 # NEW (sandbox)
└── ref                               # MOVED from `migration ref`
    ├── set <name> <contract>
    ├── show <name>                   # renamed from `get`
    ├── list
    └── delete <name>
```

**Renames / moves:**

- `migration apply [--ref X]` → `migrate --to <contract>` *(top-level move + flag grammar)*
- `migration ref *` → `ref *` *(top-level move; `get` → `show` for cross-subject consistency)*
- `migration status --ref X` → `migration status --to <contract>`
- `migration status --all` → `migration log` *(separate verb)*
- `migration status --graph` → `migration graph` *(separate verb)*
- *(implicit: bare enumeration of disk migrations)* → `migration list`

**Additions:**

- `migrate --to <contract>` *(top-level)*
- `migration compile`
- `migration log`, `migration list`, `migration graph`
- `migration check [<m>]`, `migration preflight <m>`
- `db sign` positional / `--contract` argument

**Aliases for the deprecation window (one release):**

- `migration apply [--ref X]` → forwards to `migrate --to <ref>` with deprecation note
- `migration ref *` → forwards to `ref *` with deprecation note
- `migration status --ref X` → forwards to `migration status --to X` with deprecation note
- `migration status --graph` → forwards to `migration graph` with deprecation note
- `migration status --all` → forwards to `migration log` with deprecation note

## Ordering / risk

Suggested execution order for the implementation phase (each is its own PR-sized change):

1. **Add `migrate --to <contract>` and deprecate `migration apply`.** Highest-leverage rename; touches every journey test; aliases keep them green during the transition. Update CLI help, the [Migration System subsystem doc](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md), and the [CLI Style Guide](../../docs/CLI%20Style%20Guide.md).
2. **Promote `ref` to top-level.** Mechanical move; aliases preserve `migration ref`. Rename `get` → `show`.
3. **Add `migration compile`.** Re-introduce the removed verb. Update the init scaffold and `migration plan` help text so the inner loop reads `plan → compile → migrate`.
4. **Split `migration status`** into `status`/`list`/`graph`/`log`, with flag-form aliases on the old verb.
5. **Add `migration check` and `migration preflight`.** Net-new verbs; no rename hazard. Add tests for both.
6. **Add `db sign` argument forms.** Small, additive; verify against the brownfield journey.
7. **Promote settled vocabulary into `docs/glossary.md`** and update subsystem docs to use the new verb names.

Steps 1–4 carry deprecation aliases; steps 5–7 are additive. Aliases come out one release after the renames land.
