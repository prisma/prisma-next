# CLI audit (Phase 3)

Compares the current `prisma-next` CLI surface (today's `packages/1-framework/3-tooling/cli/src/`) against the vocabulary resolved in [`domain.md`](./domain.md). Friction signals were drawn from the CLI journey tests at `test/integration/test/cli-journeys/`.

This document is a state comparison only. It is not an implementation plan, a deprecation schedule, or a sequencing proposal.

## Method

1. Enumerated current commands from `cli.ts` and `commands/*.ts`.
2. For each command, read what options it accepts.
3. Cross-checked against the journey tests — every command in the surface is exercised there, and the tests expose how the user composes them in practice.
4. Compared the resulting picture to the vocabulary in [`domain.md`](./domain.md).

## Current surface

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
    ├── plan [--name <slug>] [--from <hash>]    # emits migration.ts + ops.json
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

Each migration directory's `migration.ts` is independently executable (shebang) and re-emits its own `ops.json` when run. This is the canonical user-facing path for recompiling a hand-edited migration.

## Intended surface

The shape implied by [`domain.md`](./domain.md):

```
prisma-next
├── init                              # project scaffold
├── migrate --to <contract>           # advance live DB to a contract
├── contract
│   ├── emit
│   └── infer
├── db
│   ├── init
│   ├── update [--to <contract>]
│   ├── verify [--schema-only|--marker-only|--strict]
│   ├── sign [<contract>] [--contract <contract>]
│   └── schema
├── migration
│   ├── plan [--name <slug>] [--from <contract>]    # emits migration.ts + ops.json
│   ├── new
│   ├── show <m>
│   ├── status [--to <contract>] [--from <contract>]
│   ├── log                           # execution history from the ledger
│   ├── list                          # flat enumeration of migrations on disk
│   ├── graph                         # topology with branches and ref markers
│   ├── check [<m>]                   # artifact / graph integrity
│   └── preflight <m>                 # sandbox-execute to verify behavior
└── ref
    ├── set <name> <contract>
    ├── show <name>
    ├── list
    └── delete <name>
```

Each migration directory's `migration.ts` remains independently executable. No `migration compile` verb — direct shebang execution is the canonical recompile path.

## Gap summary

| Concern | Current | Intended | Kind |
|---|---|---|---|
| Top-level "advance the live DB" verb | `prisma-next migration apply [--ref <name>]` | `prisma-next migrate --to <contract>` | rename + move + flag grammar |
| Refs subject | nested as `prisma-next migration ref *` | top-level `prisma-next ref *` | move |
| Ref read verb | `migration ref get` | `ref show` | rename for cross-subject consistency |
| `migration status` target flag | `--ref <name>` (ref-only grammar) | `--to <contract>` (full reference grammar) | flag rename + grammar broadening |
| Graph topology query | `migration status --graph` | `migration graph` | split into own verb |
| Execution-history query | `migration status --all` | `migration log` | split into own verb |
| Flat enumeration query | implicit in `migration status` | `migration list` | split into own verb |
| Artifact / graph integrity check | (absent) | `migration check [<m>]` | new |
| Behavioral sandbox check | (absent) | `migration preflight <m>` | new |
| `db sign` contract selection | always signs current `contract.json` | accepts `[<contract>]` positional or `--contract <contract>` | additive |
| `migration plan` `--from` grammar | `<hash>` (single form) | full contract reference grammar | flag-grammar broadening |
| `db update` `--to` grammar | `<hash>` | full contract reference grammar | flag-grammar broadening |
| Recompile a hand-edited migration | direct shebang execution of `migration.ts` | unchanged | no gap |
| `db verify` modes | `--schema-only`, `--marker-only`, `--strict` flags | unchanged | no gap |

## Findings

### F1. `migration apply [--ref X]` is the wrong subject and the wrong flag grammar

**Current.** `packages/1-framework/3-tooling/cli/src/commands/migration-apply.ts:314-316`:

```ts
.option('--db <url>', 'Database connection string')
.option('--config <path>', 'Path to prisma-next.config.ts')
.option('--ref <name>', 'App-space target ref name from migrations/app/refs/')
```

Every journey that advances a database invokes this verb. The most-frequent shape across the journey suite is `runMigrationApply(ctx, ['--ref', '<env>', '--json'])` — e.g. `test/integration/test/cli-journeys/ref-routing.e2e.test.ts:87`:

```ts
const applyStaging = await runMigrationApply(ctx, ['--ref', 'staging', '--json']);
```

**Vocabulary.** The verb advances the live database. That is a database-shaped operation; in the vocabulary the bare canonical verb for this is **`migrate`**, which sits at the top level alongside `init`, `contract`, `db`, `migration`, `ref`. The `migration` namespace in the vocabulary is reserved for *artifact / graph* operations; "advance the live DB" does not belong there.

The `--ref <name>` flag also constrains the argument grammar artificially. The intended grammar is `<contract>` — a contract reference, which can be:

- a hash (full or prefix),
- a ref name,
- a migration directory name (resolves to the migration's `to`-contract),
- `<dir>^` (resolves to the migration's `from`-contract),
- a filesystem path.

`--ref` accepts only the second of these.

**Gap.** `prisma-next migration apply [--ref X]` is intended to be `prisma-next migrate --to <contract>`. Top-level subject; `--to` flag accepting the full reference grammar.

---

### F2. `ref` is nested under `migration`; it is a top-level subject in the vocabulary

**Current.** `packages/1-framework/3-tooling/cli/src/cli.ts:253-254` mounts ref under migration:

```ts
const migrationRefCommand = createMigrationRefCommand();
migrationCommand.addCommand(migrationRefCommand);
```

Journey usage `test/integration/test/cli-journeys/ref-routing.e2e.test.ts:61-64`:

```ts
const refProd = await runMigrationRef(ctx, ['set', 'production', c1Hash]);
const refStaging = await runMigrationRef(ctx, ['set', 'staging', c2Hash]);
```

invokes `prisma-next migration ref set production <hash>`.

**Vocabulary.** A ref is a named **contract reference**. It points to a contract (a graph node), not to a migration (a graph edge). Refs and contracts share a noun family; refs and migrations do not. The vocabulary puts `ref` at the top level alongside `contract` and `migration`.

**Gap.** `prisma-next migration ref *` is intended to be `prisma-next ref *`. The subcommand surface keeps the same shape; only the parent moves. Separately, the read verb `migration ref get` becomes `ref show` for cross-subject consistency with `contract show` and `migration show`.

---

### F3. `migration status` is doing five jobs

**Current.** `packages/1-framework/3-tooling/cli/src/commands/migration-status.ts:1069-1074`:

```ts
.option('--db <url>', 'Database connection string')
.option('--config <path>', 'Path to prisma-next.config.ts')
.option('--ref <name>', 'Target ref name from migrations/refs/')
.option('--graph', 'Show the full migration graph with all branches')
.option('--limit <n>', 'Maximum number of migrations to display (default: 10)')
.option('--all', 'Show full history (disables truncation)')
```

**Vocabulary.** Five different questions are conflated under one verb. Each has a distinct freshness model (live or offline) and a distinct data source (path computation, graph file enumeration, ledger):

| Invocation | Question | Source | Live/offline |
|---|---|---|---|
| `migration status [--to X]` | What needs to happen to reach `X`? | marker + graph | live (offline when `--from` is supplied) |
| `migration status --graph` | What's the topology of the graph? | filesystem | offline |
| `migration status --all` | What's the full execution history? | ledger | live |
| `migration status` (no flags, looking at disk) | What migrations exist on disk? | filesystem | offline |

**Gap.** Each question becomes its own verb:

- `migration status [--to <contract>] [--from <contract>]` — path / pending. Live by default; offline when `--from` is supplied.
- `migration log` — execution history (live, reads the ledger).
- `migration list` — flat enumeration of migrations on disk (offline).
- `migration graph` — topology with branches and ref markers (offline).

`migration show <m>` already exists and is unchanged. The new `--to <contract>` flag broadens the target grammar from ref-name-only to the full reference grammar (parallel to F1).

---

### F4. `db sign` cannot name the contract to sign with

**Current.** `packages/1-framework/3-tooling/cli/src/commands/db-sign.ts:208-209`:

```ts
.option('--db <url>', 'Database connection string')
.option('--config <path>', 'Path to prisma-next.config.ts')
```

No positional argument, no `--contract` flag. The verb always signs the current `contract.json`.

**Vocabulary.** `db sign [<contract>]` accepts an optional contract reference (positional), or the explicit form `db sign --contract <contract>`. Default with no argument is the current `contract.json`. Useful for adoption flows where the operator wants to sign with a *specific* historical or named contract from the graph rather than whatever happens to be in `contract.json`.

**Gap.** Additive: the no-argument default is unchanged; the positional and `--contract` forms are new capability.

---

### F5. Flag grammars for `--from` / `--to` are inconsistent across commands

**Current.**

- `migration-plan.ts:526`:
  ```ts
  .option('--from <hash>', 'Explicit starting contract hash (overrides latest migration target)')
  ```
- `migration-status.ts:1071`:
  ```ts
  .option('--ref <name>', 'Target ref name from migrations/refs/')
  ```
- `migration-apply.ts:316`:
  ```ts
  .option('--ref <name>', 'App-space target ref name from migrations/app/refs/')
  ```
- `db-update.ts` accepts `--to <hash>`.

Three different flag spellings (`--from`, `--ref`, `--to`) and two different argument grammars (`<hash>` and `<name>`) are in play for what is fundamentally the same operation: naming a contract.

**Vocabulary.** The "ways of identifying a contract" umbrella is **contract reference**. Wherever the CLI needs the user to name a contract, the flag is `--to <contract>` (target) or `--from <contract>` (origin), and the argument grammar is the full reference grammar (hash, ref name, migration directory, `<dir>^`, filesystem path).

**Gap.** Every flag that today names a contract — `--from <hash>`, `--ref <name>`, `--to <hash>` — is intended to be `--to <contract>` / `--from <contract>` with the broad grammar. The current narrowing (hash-only or ref-name-only) is implementation detail leaking into the argument surface.

---

### F6. Net-new verbs for verification

**Current.** `db verify` is the only verification verb. Nothing else verifies migration artifacts or behaviors.

**Vocabulary.** Three verbs split along *what's being verified* (live DB / migration artifact / migration behavior):

| Verb | Verifies | Touches live DB? |
|---|---|---|
| `db verify` | Live DB satisfies its contract | Yes (read-only) |
| `migration check [<m>]` | Artifact / graph integrity | No |
| `migration preflight <m>` | Migration's behavior on a sandbox | Sandbox only |

`migration check` with an argument validates that one migration's hashes recompute and its on-disk artifacts are complete; with no argument it runs a holistic check over the graph (every migration self-consistent; every edge's `from`/`to` lines up; no orphan nodes; no dangling refs). `migration preflight` sandbox-executes a migration to verify behavior — the verb has no analog in any surveyed migration system (Atlas's `--dev-url` is bundled into apply; Prisma current's shadow replay is implicit inside `migrate dev`; Liquibase's `update-sql` / `validate` are preview / structural; Sqitch's `verify` runs post-deploy).

**Gap.** `migration check` and `migration preflight` are net-new surface. `db verify` is unchanged.

---

### F7. Recompiling a hand-edited migration has an elegant solution; no CLI verb needed

**Observation, not a gap.** `migration plan` writes both `migration.ts` and `ops.json` in one step. The user only needs to re-derive `ops.json` if they have hand-edited `migration.ts` — which is supported by executing `migration.ts` directly via its shebang. No `migration compile` verb in the intended surface.

The integration test harness contains helpers (`runMigrationEmit`, `runMigrationPlanAndEmit`, `selfEmitLatestMigration`) that re-derive `ops.json` by spawning `tsx` / `node --experimental-strip-types` on `migration.ts`. This is a test-specific shape — the helpers exist because the journey tests invoke commands in-process, which bypasses the subprocess execution path that the real CLI uses, not because the user-facing CLI is missing a verb. The helpers can be updated opportunistically; nothing about the user surface depends on them.

---

### F8. `db verify` modes — no gap

**Observation, not a gap.** `db verify --schema-only`, `db verify --marker-only`, and `db verify --strict` answer related debugging questions around one canonical "does the DB satisfy its contract?" question. The flag-based shape is workable and the modes are used as-is across the drift and brownfield journeys. Considered splitting into sub-verbs; declined — the flags are clear, the verb is one verb, the operation is one operation. No change recommended.

---

## Cross-cutting observations

- **Subject namespaces match the vocabulary.** The current `contract` / `db` / `migration` namespaces are correctly factored. The gap is in *placement* — `migrate` belongs at the top level, `ref` belongs at the top level — not in the namespaces themselves.
- **Flag-grammar leakage is the most pervasive pattern.** Five separate flag definitions (`--from <hash>`, `--ref <name>`, `--to <hash>`, the `migration apply --ref`, the `migration status --ref`) all name a contract but each accepts a different argument shape. The vocabulary collapses these to one grammar (`<contract>`) under two flag spellings (`--to` for targets, `--from` for origins).
- **The `migration` namespace is overloaded as a catch-all.** Today it hosts (a) artifact authoring (`plan`, `new`), (b) the artifact `show`, (c) a multi-question `status`, (d) the live database verb (`apply`), and (e) a sub-namespace (`ref`). The vocabulary splits (d) up to top-level `migrate`, (e) up to top-level `ref`, and breaks (c) into separate verbs. What remains under `migration` is the authoring, inspection, and verification of *migration artifacts and the graph they form* — a single coherent subject.
