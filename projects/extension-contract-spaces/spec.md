# Summary

Extensions and other in-tree contract authors (monorepo packages) currently have no honest way to contribute schema objects to a Prisma Next application's database; they install SQL via a side-channel (`databaseDependencies.init`) and the resulting schema goes untracked, which causes `dbInit`'s strict verifier to reject those objects as extras. This project introduces **contract spaces** — disjoint `contract.json` + migration-graph units that the framework treats uniformly, with the live database as the integration point — so extensions become first-class schema contributors using the same planner, runner, and migration shape as application authoring.

# Context

## At a glance

A Prisma Next application today owns exactly one contract: the user's. Extensions live alongside it but contribute *only* via the `databaseDependencies.init` hook — a runtime SQL escape hatch that runs during `dbInit` and is invisible to every other part of the system (planner, verifier, types). Anything an extension installs in the database that the verifier can see therefore looks like an "extra." That is the immediate cause of the cipherstash blocker, but the underlying gap is broader: there is no honest seam through which a non-application party can declare "I own these persistence structures; manage them with the same machinery you manage the application's."

The settled design promotes **contract spaces** to a first-class concept. Each space is a unit of `(contract.json, migration-graph)`. A single application's database is the **integration point** for all spaces it depends on. The framework runs the same planner per space, the same runner per space, and the same migration shape per space. The marker table grows one row per space. Aggregation across spaces happens in memory, only at the boundaries that strictly need it (verifier, typed DSL emission).

```
Application's DB
├── marker[space=app]              applied-hash, applied-invariants
├── marker[space=cipherstash]      applied-hash, applied-invariants
├── (user tables, owned by app space)
└── (eql_v2_* tables / types, owned by cipherstash space)
```

Extensions own one space per extension package. Codecs (referenced by every column via `codecId`) gain a plan-time lifecycle hook, fired on field-added/dropped/altered events, that emits migration ops captured into the *consuming application's* migration JSON. Schema-driven extension behaviour (e.g. `addSearchConfig` for each searchable encrypted column) flows through codec hooks; static extension scaffolding (the EQL bundle, the `eql_v2_configuration` table) flows through the extension's own contract space.

## Problem

The cipherstash extension installs ~5,750 lines of SQL into the user's database via `databaseDependencies.init`: 1 schema, 1 table (`eql_v2_configuration`), 7 composite types (including the `eql_v2_encrypted` domain that user `Encrypted<string>` columns reference via `nativeType`), 3 domains, 169 functions, 46 operators, 4 casts, 9 operator classes/families, 1 enum (`eql_v2_configuration_state`). None of these objects are described in the contract. `dbInit`'s strict verifier walks the live database and rejects every one of them as an unexpected extra column / extra table / extra type. Two band-aid solutions surfaced during cipherstash project execution and were both rejected:

1. **Globally relax `strictVerification`** in the `db init` runner. Changes the user-facing semantics of the CLI (suddenly `dbInit` ignores extras the user *did* introduce, e.g. by hand-editing the database). Quietly weakens a safety property users may rely on.
2. **Per-extension allowlist on `ComponentDatabaseDependency.installs.{tables,schemas}`**. The framework keeps strict mode for the user's surfaces but turns a blind eye to declared extension scaffolding. Architecturally a band-aid: extensions declare *what tables they install* but not *what shape those tables have*, so the verifier can only check existence, not structure. The user can still drift the extension's tables and dbInit won't catch it.

Both options paper over the underlying gap: extensions are not first-class. The framework has a contract concept and a migration graph concept, but only one party (the user) can use them. Anything else that touches the database has to wedge itself in through `databaseDependencies.init` and live in the verifier's blind spot. Cipherstash is the example forcing the conversation; monorepos with multiple internal contract owners exhibit the same shape.

The `databaseDependencies.init` hook itself is not the problem — it is a reasonable runtime escape valve. The problem is that there is no *upstream* seam at the contract layer through which an extension can say "I own these structures, plan and verify them as you would mine." This project introduces that seam.

## Approach

### Contract spaces

A **contract space** is a `(contract.json, migration-graph)` unit. Every party that contributes persistence structures to a database owns exactly one space. The application owns one. Each installed extension owns one. A monorepo aggregator package can compose multiple internal-package spaces with its own.

The framework operates per space:

- **Planner**: runs per space. Diffs the prior contract for that space against the new contract for that space; produces a migration JSON for that space.
- **Runner**: applies each space's migrations against the live database. Each space's marker-table row tracks its own applied hash + applied invariants.
- **Verifier**: runs per space, but constructs an in-memory aggregate union of all spaces before checking expected schema against live schema. The aggregate exists only at verification time; it is never serialized.

Spaces are disjoint at the artefact level (separate `contract.json`, separate migration graph) and integrate only via the live database. There is no "merged contract" data structure on disk; the database itself is what guarantees that all spaces are simultaneously satisfied.

```
projects/my-app/                                  ← application space
├── contract.json                                  
├── migrations/M_001.json                          
└── migrations/M_002.json                          

node_modules/@prisma-next/extension-cipherstash/  ← cipherstash space (extension-shipped)
├── contract.json                                  
└── migrations/M_001.json                          
```

A user's `package.json` declaring a dependency on `@prisma-next/extension-cipherstash` plus listing it in `extensionPacks` is what causes the framework to load the cipherstash space alongside the application space at emit and verify time.

### Marker table

The marker table grows from one row to N rows: one per `(space, applied-hash, applied-invariants)` triple. Each space tracks its own progression independently. The runner updates a space's row only when migrations from that space apply.

### Codec-as-seam for schema-driven ops

Some extension behaviour is *not* a function of the extension version but of the consuming application's schema. Cipherstash is the canonical example: when a user adds an `Encrypted<string>` column with `searchable: true`, the database needs `SELECT eql_v2.add_search_config(table, column, …)` executed. That op is per-`(table, column)`, not per-cipherstash-version.

Codecs already exist as first-class objects: every column in the contract names its codec via `codecId`. This project promotes codecs to also carry a **plan-time lifecycle hook**. The hook signature, illustratively:

> _Illustrative — exact field names and types are up to the implementer:_
>
> ```ts
> interface CodecMigrationHook {
>   onFieldEvent(
>     event: 'added' | 'dropped' | 'altered',
>     ctx: {
>       priorTable?: TableIR;
>       newTable?: TableIR;
>       priorField?: FieldIR;
>       newField?: FieldIR;
>     },
>   ): MigrationOp[];
> }
> ```

The hook fires during emit (plan time), receives the table IR before and after the change, and returns migration ops. Each op carries its own `invariantId`. Returned ops are captured into the consuming application's migration JSON. The codec implementation that runs is the one *active at plan time*; the resulting JSON pins that snapshot of the codec's behaviour. Apply-time replay just runs the captured ops.

Codec-emitted ops land in the **application's** contract space, not in the extension's. The data invariant *"search-config registered for `User.email`"* is conceptually about application content. Cipherstash's contract space stays a pure function of cipherstash's package version; consuming-app activity never reaches into it. Cross-space writes (the codec's app-space op populates rows in cipherstash-space's `eql_v2_configuration` table) are fine because the database integrates.

### IR vocabulary boundary

The contract IR (used by the planner and verifier per space) admits anything a column or field can name as `nativeType`:

- **In IR**: tables (with columns, primary keys, foreign keys, indexes, uniques), enums, composite types, domains.
- **Not in IR**: schemas, functions, operators, casts, operator classes/families, anything else not a column type.

For the cipherstash extension's space, that means the `contract.json` carries:

- `eql_v2_configuration` table.
- `eql_v2_configuration_state` enum.
- `eql_v2_encrypted` composite type.
- `eql_v2.bloom_filter`, `eql_v2.hmac_256`, `eql_v2.blake3` domains, plus the various `ore_*` composites.

Total contribution to the user's contract: ~3-5 KB pretty-printed. The remaining ~5,750 lines of bundle SQL (functions, operators, casts, op classes, the `eql_v2` schema itself) live as the body of one migration op (`installEqlBundle`) inside cipherstash's migration graph. That op carries its own `invariantId` and is treated by the runner as an opaque DDL step.

### Migration JSON shape

A single user emit produces one migration JSON per changed space. The application's space's migration JSON is the **flattened** form of all the ops that the application's migration introduces — including any extension ops the framework inlines from extension graphs. Concretely, the application migration's `operations` array is mixed-source:

> _Illustrative — final shape is up to the implementer:_
>
> ```jsonc
> {
>   "from": "<app prior hash>",
>   "to": "<app new hash>",
>   "operations": [
>     // From cipherstash extension's graph (invariantId: cipherstash:install-eql-v1)
>     { "invariantId": "cipherstash:install-eql-v1", "execute": ["...EQL bundle SQL..."] },
>     // From user authoring (invariantId: app:create-table-User-v1)
>     { "invariantId": "app:create-table-User-v1", "execute": ["CREATE TABLE \"User\" (...)"] },
>     // From cipherstash codec hook on User.email (invariantId: cipherstash-codec:User.email-v1)
>     { "invariantId": "cipherstash-codec:User.email-v1", "execute": ["SELECT eql_v2.add_search_config(...)"] }
>   ]
> }
> ```

WYSIWYG-the-runnable is preserved per space: the runner reads only the JSON, never the extension package, at apply time. The TS authoring surface can be more flexible (it can compose, reference, or embed extension migrations); the on-disk JSON is always the flattened form. Generated comments above each op (or each group) annotate provenance for human readability.

Convention ordering within a single migration: scaffolding ops → application structural ops → codec-emitted ops. No formal cross-op dependency graph for v1; the convention is sufficient because all ops apply in a single transaction.

### Apply-time atomicity

A user emit may produce migrations in multiple spaces (e.g. user bumped cipherstash and refactored their own tables in the same emit). All migrations across all changed spaces apply in a **single transaction**. This matches the existing transaction control surface and makes partial-failure recovery moot: either every space advances or none do.

### Verification flow

`dbInit` (and any other verifier path) constructs an in-memory aggregate of all loaded contract spaces:

1. Read the application's `contract.json`.
2. For each `extensionPacks` entry, read the extension's `contract.json` (must be present in `node_modules` — same constraint as today, since codecs already require packages to be installed).
3. Aggregate to a single in-memory `expected schema` representation.
4. Compare against the live database; reject if any space's marker-row hash mismatches its expected hash.

The single canonical "merged hash" question goes away: each space's hash is checked individually against the marker-table row for that space. Strict mode is preserved for every space.

### What this design does not do

- It does not merge `contract.json` files on disk. They stay separate per space.
- It does not introduce cross-space dependencies as a first-class concept. Conventions and the single-transaction property cover the v1 cases.
- It does not change the authoring surface of `prisma-next.config.ts` beyond what `extensionPacks` already provides; an extension being listed there continues to mean "use this extension" — what changes is the framework's interpretation of that listing.

# Requirements

## Functional Requirements

- **FR1.** Extensions ship a contract space (a `contract.json` + a migration graph) inside their published package. The package layout is the implementer's call within reasonable defaults.
- **FR2.** The framework loads each `extensionPacks` entry's contract space at emit time and at verify time alongside the application's contract space.
- **FR3.** The marker table tracks per-space applied state: one row per `(space-identifier, applied-content-hash, applied-invariants)`.
- **FR4.** The migration planner runs per space, producing one migration JSON per space whose contract changed in this emit.
- **FR5.** The migration runner applies each space's migrations in order, updating the corresponding marker-table row. All applied migrations across all changed spaces in a single emit are committed in a single transaction.
- **FR6.** The verifier constructs an in-memory aggregate of all loaded spaces' contracts and checks the live database against the aggregate. Each space's marker-row hash is checked against its own contract's content hash; strict mode rejects mismatches per space.
- **FR7.** Codecs may declare a plan-time lifecycle hook fired on field-added / field-dropped / field-altered events. The hook receives the relevant table/collection IR before and after the change and returns migration ops, each with its own `invariantId`.
- **FR8.** Codec-emitted migration ops are captured into the consuming application's migration JSON (application space), not into the extension's space. The application's emitter runs the hook for each event in the application contract diff.
- **FR9.** The contract IR vocabulary admits anything a column / field can name as `nativeType`: tables, enums, composite types, domains. Persistence structures not in this set (schemas, functions, operators, casts, op classes/families) are carried inside migration ops as opaque steps with `invariantId`s; they are not modelled in the IR.
- **FR10.** A space's migration JSON is self-contained at apply time: the runner does not need the originating package installed to apply it (the body of any extension migration ops is captured into the JSON at emit time).
- **FR11.** Extension `invariantId`s, once published in a release, are immutable. Renaming or removing a published `invariantId` is a breaking change for downstream consumers.
- **FR12.** The aggregate construction in FR6 is in-memory only; no merged contract is persisted on disk. Each space's `contract.json` remains the single source of truth for that space.
- **FR13.** The cipherstash extension's existing `databaseDependencies.init` hook either:
    - (a) continues to work as a transitional shim while still installing the same SQL, or
    - (b) has a documented and tooled migration path to the new mechanism (extension-as-contract-space).
    Implementer's call which path; the spec does not pin (a) vs (b).

## Non-Functional Requirements

- **NFR1.** No user-facing semantic change to `dbInit` strict mode. The `strictVerification: false` workaround introduced under cipherstash project execution is reverted as part of this work.
- **NFR2.** Migration JSON files on disk remain WYSIWYG-runnable: a reader of the JSON can predict the SQL the runner will execute without consulting any package outside the application's repo. (Extension packages must still be installed at runtime — see NFR3 — but only for verifier aggregation, not to read or apply migration JSONs.)
- **NFR3.** Extension packages declared in `extensionPacks` must be installed at the application's runtime for verifier aggregation. This matches today's constraint — extensions referenced by `codecId` already need to be installed — and is not a new requirement.
- **NFR4.** The cipherstash team's vendored EQL bundle SQL remains valid as-is. The bundle SQL becomes the body of one migration op in cipherstash's contract space; no fork or split of the bundle is required of the cipherstash team.
- **NFR5.** Performance: extension-space planning and verifier aggregation must not measurably regress emit-time or `dbInit` performance for applications with no extensions. Target: < 5% wall-clock overhead on a representative no-extension emit + dbInit.
- **NFR6.** The aggregation pass for verification is deterministic and order-independent across `extensionPacks` ordering: two applications with the same set of installed extensions produce the same aggregate regardless of declaration order.

## Non-goals

- **Extension removal semantics.** What happens when a user removes an extension from `extensionPacks` while their schema still depends on extension-installed types (e.g. `Encrypted<string>` columns referencing `eql_v2_encrypted`). Defer to a follow-up; until then, removal is unsupported and the framework may leave the live DB in an inconsistent state.
- **Codec-id-changed lifecycle event.** When a user upgrades an extension in a way that changes a codec ID (`cipherstash/string@1` → `@2`), the codec needs a way to emit a "rotate" migration op. Cleanly extends the existing event vocabulary; deferred until needed.
- **Multi-extension interactions.** Two extensions claiming the same table name, ordering across extensions, dependency between extensions. Convention-based ordering only for v1.
- **Formal cross-space dependency graph.** Convention ordering (scaffolding → structural → codec) inside a single migration is sufficient given the single-transaction property.
- **Replacing or restructuring the application's existing contract IR.** The application's contract.json shape is unchanged; what changes is the framework treating multiple such files as siblings rather than the only one.
- **Authoring tools for the cipherstash team's contract space.** They will use Prisma Next's existing tooling (the same way an application author would). No new tooling is needed.

# Acceptance Criteria

- [ ] **AC1** (covers FR2, FR6, NFR1). A fresh Postgres database has the cipherstash extension installed via the new mechanism. `dbInit` runs in strict mode (no `strictVerification: false` flag, no per-extension allowlist) and succeeds. The verifier sees `eql_v2_configuration`, `eql_v2_configuration_state`, `eql_v2_encrypted`, the various `ore_*` composites, and the domains, and recognises them as expected (because cipherstash's contract space declared them). An additional unexpected column added by hand to `eql_v2_configuration` causes `dbInit` to fail with a strict-mode error, proving strict mode is preserved.
- [ ] **AC2** (covers FR1, FR4, FR5, FR7, FR8, FR10). A user adds `cipherstash` to `extensionPacks` and adds an `Encrypted<string>` column with `searchable: true` to a fresh `User` table in their PSL. `prisma-next migrate` produces one application-space migration JSON containing: cipherstash scaffolding ops (with `invariantId` namespace `cipherstash:*`), the user's `CREATE TABLE` op, and a codec-emitted `add_search_config` op. `prisma-next db apply` runs the migration in a single transaction; the marker table afterwards has two rows (`app`, `cipherstash`), each with the expected hash.
- [ ] **AC3** (covers FR4, FR11). The cipherstash team publishes a new package version that adds one new migration to its shipped graph (e.g. adding a column to `eql_v2_configuration`). A user upgrades the package and runs `prisma-next migrate`. The resulting migration JSON includes only the new op (the prior cipherstash invariantIds are already in the user's applied set). `db apply` advances the cipherstash space's marker row.
- [ ] **AC4** (covers FR1-FR6). A monorepo with two internal packages each declaring its own contract space, plus an aggregating package that depends on both, builds successfully, emits per-space migrations on changes, and applies them. The mechanism for monorepo composition is the same as for extensions; no monorepo-specific framework code is required.
- [ ] **AC5** (covers FR3, FR6, NFR6). After applying any combination of multi-space migrations, an integration test reads the marker table and asserts (a) one row per loaded space, (b) each row's hash equals the corresponding `contract.json`'s content hash, (c) the row set is the same regardless of `extensionPacks` declaration order.
- [ ] **AC6** (covers NFR2). The runner applies a migration JSON without any extension package installed (other than what the JSON itself references inside `execute` bodies). Verification afterwards still requires the extension package; application of an existing migration does not.
- [ ] **AC7** (covers NFR4, FR13). The cipherstash extension's existing vendored EQL bundle SQL is the body of exactly one migration op in cipherstash's contract space (the `installEqlBundle` op). Bundle content is unchanged from what is shipped today.
- [ ] **AC8** (covers FR9). The contract IR includes `eql_v2_encrypted` (composite type), `eql_v2_configuration_state` (enum), and the `eql_v2` domains used as column types. The contract IR does **not** include the EQL bundle's functions, operators, casts, or operator classes/families — those live inside the body of the `installEqlBundle` migration op only.
- [ ] **AC9** (covers FR8, codec ownership of schema-driven ops). When a `searchable: true` `Encrypted<string>` column is dropped from a user table, the codec lifecycle hook emits the corresponding `remove_search_config` op into the application-space migration. No change to cipherstash's contract space's marker row results from this.

# Other Considerations

## Security

The design does not change the threat model. Extensions are still trusted code (they execute SQL in the user's database). Adding the contract-space mechanism does not give extensions any additional capability they did not have via `databaseDependencies.init`; it gives the framework more visibility into what extensions actually do. That is a net security improvement: the verifier now catches drift in extension-installed objects in strict mode, where today it cannot see them at all.

## Cost

Compute and storage costs are negligible. The marker table grows from one row to N rows where N is the number of contract spaces — typically small (1 application + a handful of extensions). Migration JSON sizes grow per emit by the inlined extension-op bodies (cipherstash's bundle adds ~150 KB of SQL string content to migration JSONs that introduce or upgrade cipherstash; one-shot, not recurring).

## Observability

The marker table's per-space rows give operators a direct view of which contract space is at which applied hash. No additional metrics are required beyond what the existing migration system emits, except that all such metrics should be tagged with the space they relate to.

## Data Protection

No PII or sensitive data crosses any new boundary. Extension contract content is shipped publicly in the extension's package; user data is in the database where it always was.

## Analytics

Not applicable.

# References

- Cipherstash project handover: `projects/cipherstash-integration/project-1/HANDOVER.md` (transient; will be removed at cipherstash project close-out — see Linear ticket for canonical follow-up).
- Cipherstash team-facing design doc: `projects/cipherstash-integration/project-1/cipherstash-team-design.md`.
- Cipherstash team open questions: `projects/cipherstash-integration/project-1/cipherstash-team-questions.md`.
- Linear: TML-2397 (this project), TML-2373 (cipherstash project parent — the immediate consumer / blocker), TML-2376 and TML-2388 (filed during cipherstash project execution; in the same neighbourhood, independent).
- The original `databaseDependencies.init` hook lives in the framework's component descriptor types — implementer should locate during pre-implementation reconnaissance.
- Invariant-aware ref routing is a prerequisite primitive, already present in the framework.

# Open Questions

These are residual decisions left for the implementer or for resolution before / during implementation. None affect the architectural shape; all are degrees of freedom inside the design above.

1. **On-disk layout of an extension's contract space.** Recommended default: `contract.json` and `migrations/*.json` at the package root (or under a conventional sub-path like `prisma-next/`). Confirm or pick an alternative; either is reasonable.
2. **Namespacing of `invariantId`s.** Recommended default: prefix convention (`cipherstash:install-eql-v1`, `app:create-table-User-v1`, `cipherstash-codec:User.email-v1`). Alternative: structured records `{source: "cipherstash@*", id: "install-eql-v1"}` carried alongside the ID. The prefix convention is simpler and sufficient for v1; structured records would only be needed if extensions need to be renamed in user repos, which is out of scope.
3. **Codec lifecycle hook synchrony.** Recommended default: synchronous, since codecs are pure functions over IR. Open if any planned codec needs async behaviour at plan time (none currently anticipated).
4. **Cipherstash project (TML-2373) integration path.** Whether the in-flight cipherstash project pivots to consume this mechanism, continues with its current band-aid until this lands, or pauses. Decision deferred to a separate conversation; not a spec-level question.
5. **`databaseDependencies.init` deprecation timeline.** The new mechanism subsumes it for schema contributions. Whether to (a) keep it as a permanent runtime escape hatch for things that genuinely don't fit the contract-space model (rare, but possible — e.g. operational seed data), (b) deprecate with a removal target, or (c) remove immediately once the new mechanism lands. Defer; resolve when migrating the existing cipherstash extension.
