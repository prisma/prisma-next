# Migration Domain Model — Working Catalog

> **Status:** Working draft. This is the living vocabulary for the Prisma Next migration domain. It is built collaboratively through a DDD pass (see the [`drive-discussion`](../../.claude/skills/drive-discussion/SKILL.md) skill) and grows as the discussion progresses. Synonyms and ambiguities are deliberately preserved at this phase — they will be argued out in Phase 2 (Ubiquitous Language).

## Drives the work

- Linear: [TML-2546 — Review migration CLI commands and vocabulary](https://linear.app/prisma-company/issue/TML-2546)

## Audience priority (drives vocabulary register)

1. **Primary: agents** acting on behalf of a developer. Vocabulary is **technical, precise, unambiguous, machine-checkable**.
2. **Secondary: application developers.** Higher-level, less exhaustive, learnable. The dev-facing surface is a curated *subset and relabelling* of the agent-facing one — not a parallel vocabulary.
3. **Tertiary:** db admins reviewing pending migrations; operators running CD; extension authors owning a contract space.

## Mental-model anchor

**Git** (refs, branches, HEAD, commits, "checkout this branch into the working tree") is the deliberate analog. Where our model maps cleanly onto Git, we should reuse Git's vocabulary rather than invent our own — both because the typical user already has internalised it and because we want users to think of the migration graph as a Git-like DAG of states.

## Source material

Drawn from:
- The user's concrete scenario for the dev / PR / CI / CD workflows (see [`discussion-notes.md`](./discussion-notes.md)).
- [Migration System subsystem doc](../../docs/architecture%20docs/subsystems/7.%20Migration%20System.md).
- [CLI subsystem doc](../../docs/architecture%20docs/subsystems/11.%20CLI.md).
- [CLI Style Guide](../../docs/CLI%20Style%20Guide.md).
- ADRs: 001 (edges), 004 (storage/profile hash), 044 (checks — superseded), 122 (init/adoption), 123 (drift taxonomy), 176 (data invariants), 192 (`ops.json` is the contract), 199 (storage-only identity), 208 (invariant-aware routing), 212 (contract spaces).
- Reference summaries of established migration systems under [`references/`](./references/).

---

## Nouns (entities, value objects, identities)

Grouped by sub-area so the relationships are visible. Some terms appear in more than one group on purpose — that's the kind of overlap Phase 2 will resolve.

### Contracts, hashes, and identity

- **Contract** — the application's stated desired schema, capabilities, and policies. The system boundary; the centre of gravity. Authored in PSL or TypeScript; emitted to `contract.json` + `contract.d.ts`.
- **Contract artifact** — the emitted, on-disk representation of a contract (`contract.json` + `contract.d.ts`). What downstream tools and the runtime consume.
- **Contract IR** — the in-memory canonical form of a contract (before emission).
- **PSL** — Prisma Schema Language. One of two authoring surfaces for contracts (and the canonical one for extensions).
- **TypeScript contract** — TypeScript-authored contract using `typescriptContract(...)`. Second authoring surface.
- **Storage hash** (`storageHash`) — deterministic hash over the contract's storage-affecting parts (`schemaVersion`, `targetFamily`, `target`, `storage`). The identity of a *state* the database can be at. (Formerly `coreHash`.)
- **Profile hash** (`profileHash`) — deterministic hash over the contract's declared capabilities. The identity of a *capability profile* the database must satisfy.
- **Migration hash** (`migrationHash` / `migrationId`) — content-addressed hash over `(strippedManifest, ops)`. The identity of a migration as a *physical effect on storage*, independent of cosmetic contract details.
- **Canonical version** — the version of the canonicalization rules used when a hash was computed. Stored on the marker.
- **Canonicalization** — deterministic JSON ordering that makes hashes reproducible across runs and machines.

### Database state

- **Database** — the live target instance, identified externally by a connection URL.
- **Marker** — the database's self-record of which state(s) it is currently at. One row per **contract space**. Stores `storageHash`, `profileHash`, `invariants[]`, `canonicalVersion`, optional contract JSON. The framework's *guarantee record* about the database.
- **Ledger** — append-only audit log of applied edges (per-DB). User-owned; framework reads only the marker, never the ledger, for routing decisions.
- **Live schema** — the actual schema structure observed in the database by introspection. Distinct from the contract (the *intended* schema).
- **Drift** — divergence between contract and database. Taxonomy includes marker-level (missing / corrupt / stale / hash-mismatch), schema-level (manual DDL / partial apply / concurrent apply), graph-level (orphan database / no path / path breakage / cycle), capability (missing / downgrade / profile mismatch), transactional, cache / replica freshness, canonicalization.

### Operations and migrations

- **Migration** — a unit of intent that takes the database from one **state** to another. The artifact that records the intent and the operations.
- **Migration package** — the on-disk directory containing a migration's files (`migration.json`, `ops.json`, `migration.ts`, `start-contract.json`, `end-contract.json`, optional typings).
- **Migration artifact** — collective name for the files in a migration package, especially the ones the runner consumes (`migration.json` + `ops.json`).
- **`migration.json`** / **Manifest** — the migration's metadata file. Records `from`, `to`, `migrationHash`, `providedInvariants`, `labels`, `createdAt`, and the (non-identity) `fromContract` / `toContract` snapshots.
- **`ops.json`** — the migration's operation list in post-lowering form. *The migration contract* — what the runner trusts and replays. Never compiled, never `eval`'d at apply time.
- **`migration.ts`** — authoring surface (TypeScript). The file the developer edits. Self-emits `ops.json` + `migration.json` when run directly. Never loaded by `apply`.
- **Start contract** / **End contract** — bookend snapshots of the contracts at the migration's `from` and `to` storage hashes. Author-time conveniences; not part of identity.
- **Edge** — the graph view of a migration. An edge from `from`-state to `to`-state. (`migration` and `edge` are the same thing seen from different angles.)
- **Operation** — a single declarative step inside a migration. Carries an envelope (precheck / execute / postcheck) and an `operationClass` (`widening`, `destructive`, `data`).
- **DDL operation** — structural schema operation (create/alter/drop table, index, column, …).
- **Data transform** — operation that mutates data, often alongside structural change. Carries `operationClass: 'data'` and may carry an `invariantId`.
- **Operation envelope** / **Three-phase envelope** — the shared shape of every operation: `precheck[]` → `execute[]` → `postcheck[]`.
- **Idempotency class** — `fully idempotent` / `conditionally idempotent` / `non-idempotent`. Determines whether a partially-applied migration can be safely retried.
- **Placeholder** — a `never`-returning function used as a scaffolded slot in `migration.ts` for parts the planner could not derive. Throws `PN-MIG-2001` at emit time.
- **Intermediate state** — a fully-attested migration package whose `ops.json` is `[]` because `migration.ts` still contains unfilled placeholders. Visible to the runner but applies zero ops.

### Graph and routing

- **Migration graph** — the directed graph (possibly cyclic) of edges and the states they connect. Reconstructed from the on-disk migration packages.
- **State** — a position the database can be at, identified by a `storageHash`. Nodes in the migration graph.
- **Baseline** — a migration whose `from` is `null` (no prior state). Bootstraps a database to a known state. (`∅ → H₀`)
- **Path** — an ordered sequence of edges connecting two states.
- **Ref** — a named pointer to a desired state. Today: `{ hash: string, invariants: string[] }`. Stored as JSON files under `migrations/refs/<name>.json`. Examples: `production`, `staging`, `head`. *(The Git-analog term.)*
- **Head** — *(candidate term, contested)* the latest-known state of a contract space, often expressed as a special ref (`migrations/refs/head.json`).
- **Invariant** / **Data invariant** — a named, checkable predicate over data (e.g. "all user phone numbers are normalized to E.164"). The correctness primitive for data that the contract hash cannot capture.
- **Invariant id** (`invariantId`) — opt-in routing key on a data transform. When set, the transform is *routing-visible*: refs may require that id.
- **Provided invariants** (`providedInvariants`) — the set of `invariantId`s a migration declares. Part of the migration's identity.
- **Required invariants** — the set of invariant ids a ref declares it requires.
- **Effective required** — `ref.invariants − marker.invariants`. The invariants still pending against the database for that ref.
- **Find-path outcome** — discriminated result of routing: `ok` (path covers required) / `unreachable` (no structural path) / `unsatisfiable` (structurally reachable, but no path covers required invariants).

### Contract spaces

- **Contract space** — a `(contract.json, migrations, headRef)` triple owned by exactly one contributor. The application owns one space (`'app'`); each schema-contributing extension owns one. Spaces are disjoint on disk; they integrate only via the live database.
- **Space-id** — identifier for a contract space. `[a-z][a-z0-9_-]{0,63}`. `'app'` is reserved for the application.
- **App-space** — the application's contract space.
- **Extension-space** — a contract space owned by an installed extension (e.g. `cipherstash`, `pgvector`).
- **Pinned per-space artifacts** — the framework-owned on-disk mirror of each loaded extension's `contractSpace` (`migrations/<space-id>/{contract.json, contract.d.ts, refs/head.json, <migration dirs>}`). Apply-time and verify-time read *only* the pinned files, never the extension's descriptor module.
- **Descriptor** — the runtime/control descriptor of an extension. Carries `contractSpace` when the extension contributes schema.

### Process roles (components / services)

- **Authoring** — the act and surfaces (PSL, TypeScript) used to define a contract or a migration.
- **Emitter** — produces emitted artifacts (`contract.json` + `contract.d.ts`) from a contract source.
- **Planner** — diffs two contracts and produces an `OpFactoryCall[]` IR, which renders to operations and to `migration.ts`.
- **Runner** — executes a migration's operations against a live database, with three-phase loop, lock, marker advance, ledger write.
- **Verifier** — compares contract (or aggregated spaces) against the live database; reports structured drift kinds.
- **Adapter** — target-family-specific lowering of operations into a wire form.
- **Driver** — target-specific transport (the connection-bound thing that actually talks to the database).
- **Preflight (service)** — sandbox apply for validation. Local: shadow DB or EXPLAIN-only. Hosted: PPg (Prisma Postgres).
- **PPg** / **Prisma Postgres** — contract-aware Postgres service that hosts preflight and a contract ledger.
- **Advisory lock** — per-DB lock that prevents concurrent applies (Postgres).
- **CAS** — compare-and-swap, used as concurrency control for Mongo marker writes.

### Adoption / lifecycle

- **Adoption** — bringing an existing database under contract control. Three paths: **greenfield**, **brownfield-conservative**, **brownfield-incremental**.
- **Introspection** — read-only schema discovery of a live database.
- **Initialization** — `db init`. Bootstraps a database from `∅` to the current contract using additive-only operations.
- **Reconciliation** — `db update`. Live-introspect, diff against contract, apply the difference. Dev-only first-class workflow.
- **Squash** — collapsing a range of migrations into a single equivalent baseline.
- **Promotion** — moving a ref forward (typically: advancing `production` to match a freshly-merged change).

---

## Verbs (commands users can perform)

Grouped by intent. *Italicised* entries are terms used in current CLI commands; **bold** entries are candidate canonical verbs we may want to consolidate around.

### Authoring (produce or edit artifacts)

- **Author** — write a contract or migration in PSL or TypeScript (the meta-verb).
- ***Emit*** — produce the canonical artifacts from authored sources. Applies to:
  - Contracts: `contract emit` writes `contract.json` + `contract.d.ts`.
  - Migrations: running `migration.ts` rewrites `ops.json` + `migration.json` (self-emission).
- ***Plan*** — diff two contracts, scaffold a migration package. Today: `migration plan`.
- ***New*** — scaffold an empty migration package for hand authoring. Today: `migration new`. *Candidate for consolidation with `plan` if we choose to.*
- **Advance (a ref)** — move a ref to point at a new state. *(The promise mechanic from the dev workflow — verb TBD: `move`, `advance`, `promote`, `point`.)*

### Mutating (change live state)

- ***Apply*** — execute a migration's `ops.json` against the live database. Today: `migration apply`.
- **Migrate (database to ref)** — *user's preferred verb for the canonical "bring this DB to state X" command*. Today this maps to `migration apply --ref X`. The user proposed `prisma-next migrate --db URL --to REF` as the surface form.
- ***Init*** — `db init`: bootstrap a database with all additive operations needed to reach the current contract.
- ***Update*** — `db update`: reconcile live database against current contract. Dev-only.
- ***Sign*** — `db sign`: write/update the marker with the current contract hashes.

### Reading (interrogate state)

- ***Verify*** — `db verify`: check marker + live schema both match the contract.
- ***Status*** — `migration status`: report applied / pending against a ref.
- ***Show*** — `migration show`: dump a migration package's operations and metadata.
- ***Schema*** — `db schema`: print the live schema (tree or JSON).
- ***Infer*** — `contract infer`: read live schema, write inferred PSL contract.
- **Preflight** — sandbox apply for validation. Today: not exposed at top level; PPg-only and partial local support.

### Reading the graph specifically (interrogative gap)

These don't have explicit commands today and are the ticket's named gap:
- **What path will be taken?** — given marker + ref, show the routed path.
- **What does this branch promise?** — given a branch's refs, show the diff vs. mainline's refs.
- **What's the graph shape?** — render the graph (or branch tips, or unreachable nodes).
- **Is the graph well-formed?** — check on-disk integrity (hashes verify, no orphan dirs, all refs point at known states).

---

## Events (things that have happened)

Used both for runner telemetry and for understanding which transitions a workflow stitches together.

- **ContractEmitted** — contract source authored → artifacts produced.
- **MigrationPlanned** — a new migration package was scaffolded from a contract diff.
- **MigrationEmitted** — `migration.ts` was run; `ops.json` + `migration.json` were (re)written.
- **MigrationApplied** — runner executed a migration's ops; marker advanced.
- **MarkerAdvanced** — marker write succeeded for a contract space.
- **InvariantSatisfied** — a data transform's postcondition passed and its `invariantId` was unioned into the marker's invariants set.
- **RefMoved** — a ref's pointed state changed on disk.
- **DriftDetected** — verifier or runtime found a mismatch.
- **PreflightCompleted** — sandbox apply succeeded with diagnostics.

---

## Queries (interrogative operations)

Phrased as questions the agent (or developer / db admin) needs to be able to ask the system.

### About the database

- *Where is this database right now?* — what is its marker per space (`storageHash`, `profileHash`, `invariants`)?
- *Does the live schema match the contract?* — verifier outcome.
- *Does the marker match the contract?* — hash equality check.
- *Is the app bundle signed against the same state as this database?* — equality of the app's expected `storageHash` and the marker's.

### About the graph and refs

- *What is `<ref>` pointing at, and what invariants does it require?*
- *What path connects state A to state B?* — including invariant coverage.
- *What will run when I migrate to `<ref>`?* — the *load-bearing CI/CD question*; effectively *"resolve path from marker to ref, list ops and ref changes"*.
- *What migrations are pending against this database for `<ref>`?*
- *What are the branch tips of the graph?* — reachable leaves from a given state.
- *Is the graph internally consistent?* — every package's `migrationHash` recomputes; every ref points at a known state; no orphan dirs; no marker rows for unloaded spaces.

### About a specific migration

- *What does this migration do?* — ops + checks + invariants + bookend hashes.
- *Is this package internally consistent?* — `migrationHash` of `(manifest, ops)` matches the stored one.
- *Has the `ops.json` drifted from `migration.ts`?* — re-emit comparison.

### About the diff between branches (for PR review / CI)

- *Compared to mainline, what migrations does this branch add?*
- *Compared to mainline, how have refs changed?*
- *What's the net effect on production?* — combined ops + ref deltas.

---

## Open questions / suspect terms

These are terms or distinctions that came up in discussion and have not yet been resolved.

- **"Freeze"** — rejected by the user as not how anyone actually talks. Need a replacement verb for the act of turning an in-progress contract change into a committed migration package. Candidates: *plan*, *author*, *capture*, *materialise*, *commit*.
- **"Advance" vs "promote" vs "move" (a ref)** — verb for the dev declaring "this branch should advance `<ref>` to state X". Git uses "move" (`git update-ref`) and "merge" (which moves a branch ref). Pick deliberately.
- **`migration plan` vs `migration new`** — both scaffold a migration package; one is from a contract diff, the other empty. Do they collapse into one verb with a flag?
- **`db update` vs `migration apply`** — both advance the database, from different sources. Do they share a verb (`apply`, `migrate`) with different flags?
- **`db init` vs `prisma-next init`** — homonym; one bootstraps a DB, the other scaffolds a new project. The CLI Style Guide already flags this.
- **`migration` (overloaded)** — a directory on disk, an edge in a graph, the artifact, the act of applying. Which sense is canonical for user-facing prose?
- **`head` vs `production` vs `main` (ref names)** — Git's analog is `HEAD` / branches. Should our default ref be called `head`, or something more environment-flavored?
- **`schema` (overloaded)** — sometimes "PSL file", sometimes "live database structure", sometimes "the contract". Disambiguate.
- **`migration emit` vs running `migration.ts` directly** — the same action, but the CLI surface uses one term in command form and another in prose. Pick one.
- **`ledger`** — useful internal term, but does it ever appear in the user-facing CLI? If not, keep it internal-only.

---

## Reference systems

Summaries of established migration tools, used as comparison anchors when picking vocabulary. See [`references/`](./references/).
