# Summary

Extensions and other in-tree contract authors (monorepo packages) currently have no honest way to contribute schema objects to a Prisma Next application's database; they install SQL via a side-channel (`databaseDependencies.init`) and the resulting schema goes untracked, which causes `dbInit`'s strict verifier to reject those objects as extras. This project introduces **contract spaces** — disjoint `(contract.json, migration-graph)` units that the framework treats uniformly, with the live database as the integration point — so extensions become first-class schema contributors using the same planner, runner, and migration shape as application authoring. As part of the same project, the existing in-tree extensions (cipherstash, pgvector, arktype-json) are migrated to contract spaces and the `databaseDependencies.init` mechanism is removed so the framework has a single mechanism for schema-contributing extensions after this project lands.

# Context

## At a glance

A Prisma Next application today owns exactly one contract: the user's. Extensions live alongside it but contribute *only* via the `databaseDependencies.init` hook — a runtime SQL escape hatch that runs during `dbInit` and is invisible to every other part of the system (planner, verifier, types). Anything an extension installs in the database that the verifier can see therefore looks like an "extra." That is the immediate cause of the cipherstash blocker, but the underlying gap is broader: there is no honest seam through which a non-application party can declare "I own these persistence structures; manage them with the same machinery you manage the application's."

The settled design promotes **contract spaces** to a first-class concept. Each space is a unit of `(contract.json, migration-graph)`. A single application's database is the **integration point** for all spaces it depends on. The framework runs the same planner per space, the same runner per space, and the same migration shape per space. The marker table grows one row per space; the schema gains a `space` column whose value identifies the row's owner. Aggregation across spaces happens in memory, only at the boundaries that strictly need it (verifier, typed DSL emission).

```
Application's DB
├── prisma_contract.marker
│   ├── (space=app)              applied-hash, applied-invariants
│   └── (space=cipherstash)      applied-hash, applied-invariants
├── (user tables, owned by app space)
└── (eql_v2_* tables / types, owned by cipherstash space)
```

Extensions own one space per extension package. Codecs (referenced by every column via `codecId`) gain a plan-time lifecycle hook, fired on field-added/dropped/altered events, that emits migration ops captured into the *consuming application's* migration JSON. Schema-driven extension behaviour (e.g. `addSearchConfig` for each searchable encrypted column) flows through codec hooks; static extension scaffolding (the EQL bundle, the `eql_v2_configuration` table) flows through the extension's own contract space.

The user's `migrations/` directory grows a subdirectory per loaded extension space; app-space migrations stay at the root. Each extension space's subdirectory carries the extension's **current contract pinned on disk** alongside the migrations themselves — the user's repo is a complete, WYSIWYG record of every space the database depends on:

```
migrations/
├── 20260507T1530_add_user/                  ← app-space, flat at root
├── 20260507T1545_add_post/                  ← app-space
├── cipherstash/
│   ├── contract.json                        ← cipherstash-space CURRENT contract (pinned)
│   ├── contract.d.ts                        ← cipherstash-space CURRENT typings (pinned)
│   ├── refs/
│   │   └── head.json                        ← cipherstash-space head ref (pinned)
│   ├── 20250101T0000_install_eql_bundle/    ← cipherstash-space, name preserved
│   └── 20250215T1000_add_config_column/
└── pgvector/
    ├── contract.json
    ├── contract.d.ts
    ├── refs/
    │   └── head.json
    └── 20240601T0000_install_vector/
```

App-space's current `contract.json` continues to live at the project root (today's convention preserved); extension-space contracts live under `migrations/<space-id>/`. The asymmetry is deliberate: app-space is the user's authoring surface (its contract sits next to the PSL/TS schema), whereas extension-space contracts are *pinned mirrors* of state owned by the extension package.

## Problem

The cipherstash extension installs ~5,750 lines of SQL into the user's database via `databaseDependencies.init`: 1 schema, 1 table (`eql_v2_configuration`), 7 composite types (including the `eql_v2_encrypted` domain that user `Encrypted<string>` columns reference via `nativeType`), 3 domains, 169 functions, 46 operators, 4 casts, 9 operator classes/families, 1 enum (`eql_v2_configuration_state`). None of these objects are described in the contract. `dbInit`'s strict verifier walks the live database and rejects every one of them as an unexpected extra column / extra table / extra type. Two band-aid solutions surfaced during cipherstash project execution and were both rejected:

1. **Globally relax `strictVerification`** in the `db init` runner. Changes the user-facing semantics of the CLI (suddenly `dbInit` ignores extras the user *did* introduce, e.g. by hand-editing the database). Quietly weakens a safety property users may rely on.
2. **Per-extension allowlist on `ComponentDatabaseDependency.installs.{tables,schemas}`**. The framework keeps strict mode for the user's surfaces but turns a blind eye to declared extension scaffolding. Architecturally a band-aid: extensions declare *what tables they install* but not *what shape those tables have*, so the verifier can only check existence, not structure. The user can still drift the extension's tables and dbInit won't catch it.

Both options paper over the underlying gap: extensions are not first-class. The framework has a contract concept and a migration graph concept, but only one party (the user) can use them. Anything else that touches the database has to wedge itself in through `databaseDependencies.init` and live in the verifier's blind spot. Cipherstash is the example forcing the conversation; monorepos with multiple internal contract owners exhibit the same shape.

The `databaseDependencies.init` hook itself is not the problem — it is a reasonable runtime escape valve. The problem is that there is no *upstream* seam at the contract layer through which an extension can say "I own these structures, plan and verify them as you would mine." This project introduces that seam, then removes `databaseDependencies.init` so there is one mechanism, not two.

## Approach

### Contract spaces

A **contract space** is a `(contract.json, migration-graph, head-ref)` unit. Every party that contributes persistence structures to a database owns exactly one space. The application owns one. Each installed extension owns one. A monorepo aggregator package can compose multiple internal-package spaces with its own.

The framework operates per space:

- **Planner**: runs per space. Diffs the prior contract for that space against the new contract for that space; produces a migration JSON for that space.
- **Runner**: applies each space's migrations against the live database. Each space's marker-table row tracks its own applied hash + applied invariants.
- **Verifier**: runs per space, but constructs an in-memory aggregate union of all spaces before checking expected schema against live schema. The aggregate exists only at verification time; it is never serialized.

Spaces are disjoint at the artefact level (separate `contract.json`, separate migration graph) and integrate only via the live database. There is no "merged contract" data structure on disk; the database itself is what guarantees that all spaces are simultaneously satisfied. Each space's contract is materialised on disk in the user's repo (app-space at the project root; extension-space under `migrations/<space-id>/`), so the repo alone fully describes every space the database depends on — no `node_modules` access is required to read, hash, review, or verify the expected schema.

A user's `prisma-next.config.ts` declares an extension by importing its descriptor module and adding it to `extensionPacks`. The framework consumes the descriptor at composition time — there is no `node_modules` filesystem-walking, which means the design works under Yarn PnP, Deno, pnpm symlinks, and bundlers without exception cases. An extension descriptor exposes its contract space as in-memory JSON values via the module dependency graph:

> _Illustrative — exact field names and types are up to the implementer:_
>
> ```ts
> interface ExtensionDescriptor {
>   // existing fields (codecs, query operations, target/family, …)
>   contractSpace: {
>     contractJson: ContractJson;
>     migrations: ReadonlyArray<MigrationPackage>;  // each carries manifest + ops + contract.json snapshot
>     headRef: { hash: string; invariants: readonly string[] };
>   };
> }
> ```

Extension authors use the same emit pipeline as application authors: PSL or TS schema → emitter → `contract.json` + per-migration directories. The descriptor module wires up those JSON artifacts via `import` declarations so they flow through the bundler / module resolver of the consuming application without filesystem assumptions.

**Pinned per-space artefacts on disk.** The descriptor is the *extension's view of itself* (its current contract, migration graph, and head ref, in-memory at authoring time). The user's repo holds a *pinned mirror* of that view: for each loaded extension space, the framework writes `migrations/<space-id>/contract.json`, `migrations/<space-id>/contract.d.ts`, and `migrations/<space-id>/refs/head.json` into the user's repo on every emit. Bumping an extension shows up in the user's PR diff as: (a) updated pinned `contract.json` / `contract.d.ts` / `refs/head.json`, plus (b) one or more new migration directories under `migrations/<space-id>/`. Both halves are reviewable, hashable, and version-controlled. The mental model is "vendored extension contract + lockfile-equivalent head ref" — the user's repo never delegates "what schema does my database need" to a `node_modules` import at apply or verify time.

Drift detection follows naturally: at every `migrate` invocation, the framework compares the descriptor's current `contractJson` against the on-disk pinned version; mismatch means "you've bumped this extension in `node_modules` but haven't run `migrate` yet" and prompts for emit.

### Marker table

The marker table grows from one row to N rows: one per `(space, applied-hash, applied-invariants)` triple. The schema gains a `space` column (text, not null) whose value is the space identifier (e.g. `app`, `cipherstash`, `pgvector`); the primary key changes from `id` to `space`. Each space tracks its own progression independently. The runner updates a space's row only when migrations from that space apply.

**Source of truth.** The composition declared in `prisma-next.config.ts` (specifically, the `extensionPacks` list plus the always-present application space) is canonical. The set of marker rows must match this composition exactly. **Orphan marker rows** (rows for spaces no longer present in `extensionPacks`) are reported as errors with a clear remediation hint (manual cleanup of the orphan row). Extension removal is a v1 non-goal, but the verifier's behaviour on encountering this case is well-defined.

**Lazy creation.** A space's marker row is created on the first successful apply of one of its migrations — whether triggered by `db init`, `db update`, or `migration apply`. Spaces declared in `extensionPacks` but never applied have no marker row yet, which the verifier handles by treating the space as needing initial application.

### Codec-as-seam for schema-driven ops

Some extension behaviour is *not* a function of the extension version but of the consuming application's schema. Cipherstash is the canonical example: when a user adds an `Encrypted<string>` column with `searchable: true`, the database needs `SELECT eql_v2.add_search_config(table, column, …)` executed. That op is per-`(table, column)`, not per-cipherstash-version.

Codecs already exist as first-class objects: every column in the contract names its codec via `codecId`. This project promotes codecs to also carry a **plan-time lifecycle hook**. The hook contract:

- **Synchronous.** Hook is a pure function over IR; no async I/O at plan time.
- **Triggered events:** `'added'`, `'dropped'`, `'altered'`. `'altered'` fires when a field exists in both contracts and any field property has changed *except* `codecId` (codec-id-changed is a v1 non-goal — see Non-goals).
- **IR scope:** the hook receives the prior + new IR for *the table containing the changed field*, scoped to the application's contract space. No cross-space visibility at hook time. Codec authors who need version information put it in the returned ops' `invariantId` (e.g. `cipherstash-codec:User.email@v1`).
- **Return value:** `MigrationOp[]`, each carrying its own `invariantId`. Returned ops are inlined into the consuming application's migration JSON (app space). Codec-emitted ops are app-space-bound by API shape — the hook cannot return ops targeting other spaces. Cross-space *SQL writes* are still possible inside an op's body (e.g. `INSERT INTO eql_v2.eql_v2_configuration ...` — the database integrates regardless), but the migration op record is app-space.

> _Illustrative hook signature:_
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

The hook fires during emit (plan time), receives the table IR before and after the change, and returns migration ops. Each op carries its own `invariantId`. The codec implementation that runs is the one *active at plan time*; the resulting JSON pins that snapshot of the codec's behaviour. Apply-time replay just runs the captured ops.

Codec-emitted ops land in the **application's** contract space, not in the extension's. The data invariant *"search-config registered for `User.email`"* is conceptually about application content. Cipherstash's contract space stays a pure function of cipherstash's package version; consuming-app activity never reaches into it.

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

The same boundary applies to other extensions: pgvector's `vector` type is in its contract IR; the `CREATE EXTENSION vector` DDL is the body of one migration op.

### Migration JSON shape and on-disk layout

A single user emit produces one migration JSON directory per space whose contract changed in this emit, plus pinned per-space `contract.json` / `contract.d.ts` / `refs/head.json` files for every loaded extension space. Each migration directory is the ADR 197 shape (`{manifest, ops, contract.json snapshot}`); the framework writes everything into the user's repo using the **per-space subdirectory convention**:

- App-space migrations live under `migrations/<migration-name>/`. App-space's current `contract.json` lives at the project root (today's convention).
- Each loaded extension space's migrations live under `migrations/<space-id>/<migration-name>/`. Each extension space's *current* `contract.json` (and its `contract.d.ts` and `refs/head.json`) lives at `migrations/<space-id>/`.

For extension spaces, the framework reads the extension's `contractJson`, `migrations`, and `headRef` from the extension descriptor's in-memory values (loaded via the module dependency graph at authoring time) and **emits** them as JSON files into the user's `migrations/<space-id>/`. Byte-equivalence with the extension's own canonical form is guaranteed by the canonicalization rules already used for hashing — same data in, same JSON out, regardless of bundler / package-manager / runtime context.

```
migrations/
├── 20260507T1530_add_user/
│   ├── manifest.json
│   ├── ops.json                       ← carries app structural ops + codec-emitted ops
│   └── contract.json                  ← app-space contract snapshot at the time of emit
├── cipherstash/
│   ├── contract.json                  ← cipherstash-space CURRENT contract (pinned)
│   ├── contract.d.ts                  ← cipherstash-space CURRENT typings (pinned)
│   ├── refs/
│   │   └── head.json                  ← cipherstash-space head ref (pinned)
│   ├── 20250101T0000_install_eql_bundle/
│   │   ├── manifest.json
│   │   ├── ops.json                   ← carries the EQL bundle SQL as the body of one op
│   │   └── contract.json              ← cipherstash-space contract snapshot
│   └── 20250215T1000_add_config_column/
│       └── …
└── pgvector/
    ├── contract.json
    ├── contract.d.ts
    ├── refs/
    │   └── head.json
    └── 20240601T0000_install_vector/
        └── …
```

Each migration's `ops.json` is space-scoped: it contains only ops belonging to that space. **Codec-emitted ops belong to app-space** and are inlined into the relevant app-space migration's `ops.json`, alongside the user's own structural ops:

> _Illustrative — final shape is up to the implementer:_
>
> ```jsonc
> // app-space migration: 20260507T1530_add_user/ops.json
> {
>   "from": "<app prior hash>",
>   "to": "<app new hash>",
>   "operations": [
>     // From user authoring (invariantId: app:create-table-User-v1)
>     { "invariantId": "app:create-table-User-v1", "execute": ["CREATE TABLE \"User\" (...)"] },
>     // From cipherstash codec hook on User.email (invariantId: cipherstash-codec:User.email@v1)
>     { "invariantId": "cipherstash-codec:User.email@v1", "execute": ["SELECT eql_v2.add_search_config(...)"] }
>   ]
> }
> ```
>
> ```jsonc
> // cipherstash-space migration: cipherstash/20250101T0000_install_eql_bundle/ops.json
> {
>   "from": null,
>   "to": "<cipherstash hash>",
>   "operations": [
>     { "invariantId": "cipherstash:install-eql-v1", "execute": ["...EQL bundle SQL..."] },
>     { "invariantId": "cipherstash:create-eql_v2_configuration-v1", "execute": ["CREATE TABLE eql_v2_configuration (...)"] }
>   ]
> }
> ```

WYSIWYG-the-runnable is preserved per space, and now extends to verification: every consumer of "expected schema" — runner, verifier, `dbInit`, `db update` — reads only the JSON files under the user's repo (root-level app-space `contract.json` + per-space `migrations/<space-id>/contract.json` + migration directories). The extension descriptor module is consumed only at **authoring time** (`migration plan`, run by a dev locally) — to know the extension's current state for diffing against the pinned on-disk version. At apply time and at verify time in CD, no extension package import is required: the user's repo alone is sufficient.

### Apply-time atomicity and ordering

A user emit may produce migrations in multiple spaces (e.g. user bumped cipherstash and refactored their own tables in the same emit). All migrations across all changed spaces apply in a **single transaction**. This matches the existing transaction control surface and makes partial-failure recovery moot: either every space advances or none do.

**Cross-space ordering** follows the implicit dependency direction (app depends on extensions): all extension-space migrations apply first, app-space migrations apply second. Within a space, migrations apply in the order returned by the per-space planner (graph order). This convention is sufficient for v1 because cross-extension dependencies are a non-goal; introducing a formal cross-space dependency graph is deferred until needed.

### Verification flow

`dbInit` (and any other verifier path) constructs an in-memory aggregate of all loaded contract spaces by reading the user's repo:

1. Read the application's `contract.json` from the project root.
2. For each `extensionPacks` entry, read the pinned `migrations/<space-id>/contract.json` from the user's repo. The descriptor module is *not* imported during verification — pinned files are authoritative.
3. Aggregate to a single in-memory `expected schema` representation. Aggregation is deterministic and order-independent across `extensionPacks` declaration order (NFR6); v1 implementation: alphabetical sort by space identifier before aggregation.
4. Compare against the live database; reject if any space's marker-row hash mismatches its expected hash.
5. Reject if any marker row exists for a space not present in `extensionPacks` (orphan marker rows; see Marker table).
6. Reject if any `extensionPacks` entry has no pinned `migrations/<space-id>/contract.json` on disk (the user has declared an extension but never run `migrate`); remediation: run `prisma-next migrate`.
7. Reject if any `migrations/<space-id>/` directory exists on disk for a space not present in `extensionPacks` (orphan pinned directory); remediation: remove the directory or re-add the extension to `extensionPacks`.

The single canonical "merged hash" question goes away: each space's hash is checked individually against the marker-table row for that space. Strict mode is preserved per space; the IR vocabulary boundary (which objects are verifiable structurally) is the same as today, just applied across all loaded spaces' IRs.

### `db init` / `db update`

`db init` (greenfield) and `db update` (advance to head) become **per-space** applications of ADR 208's invariant-aware path-finding primitive:

- For each loaded space (app + each extension), look up the space's current target ref → `(hash, invariants)` from the user's repo. The application's target ref comes from the user's emitted contract; an extension's target ref comes from the pinned `migrations/<space-id>/refs/head.json`.
- Compute `effectiveRequired = ref.invariants − marker.invariants` for each space.
- Run `findPathWithDecision(currentMarkerHash, ref.hash, effectiveRequired)` per space.
- Concatenate the returned per-space paths in the cross-space ordering convention (extensions first, app-space second). Apply in a single transaction.

For app-space, the existing `db init` synthetic-edge model is preserved: when no migration exists on disk for app-space, the framework synthesizes a `∅ → head` edge derived directly from the contract IR (today's behaviour). For extension-space, synthesis from the contract alone is impossible — the IR vocabulary boundary excludes the bundle-SQL bodies — so the runner walks the extension's migration graph as emitted into the user's repo.

Like the verifier, `db init` / `db update` runtime paths consult only the user's repo (pinned head refs, pinned migration directories). Descriptor access is required only at authoring time (`migration plan`).

This gives extension authors the same authoring expressivity as application authors: multiple paths, multiple baselines, squash, and invariant-aware routing all extend to extension-space without special-casing. The per-space planner is *exactly* `findPathWithDecision`; no new graph algorithm is needed.

### What this design does not do

- It does not merge `contract.json` files into a single combined contract. Each space's pinned `contract.json` stays its own file (app-space at the project root; extension-space at `migrations/<space-id>/contract.json`). The verifier aggregates them in memory only, never on disk.
- It does not introduce cross-space dependencies as a first-class concept. Conventions and the single-transaction property cover the v1 cases.
- It does not change the authoring surface of `prisma-next.config.ts` beyond what `extensionPacks` already provides; an extension being listed there continues to mean "use this extension" — what changes is the framework's interpretation of that listing.
- It does not introduce a new authoring tool for extension authors. They use the same emit pipeline as application authors against their extension's own PSL/TS schema.
- It does not require the user to hand-edit pinned per-space artefacts. The framework owns those files and overwrites them on every `migrate`. The user's role is to declare extensions in `extensionPacks` and to run `migrate` after upgrading; the pinned files are framework-managed records, not authoring surfaces.

# Requirements

## Functional Requirements

- **FR1.** Extensions ship a contract space (a `contract.json` + a migration graph + a head ref) exposed as in-memory JSON values via the extension descriptor module. The descriptor module imports the JSON artifacts so they flow through the consuming application's bundler / module resolver — no `node_modules` filesystem walking from the framework.
- **FR2.** The framework loads each `extensionPacks` entry's descriptor only at **authoring time** (during `migration plan` / `migrate`). At apply time and verify time, the framework reads the user's repo only — no descriptor import is required.
- **FR3.** The marker table tracks per-space applied state: one row per `(space-identifier, applied-content-hash, applied-invariants)`. The marker schema gains a `space` column (text, not null) and primary keys by `space`.
- **FR4.** The migration planner runs per space, producing one migration JSON directory per space whose contract changed in this emit. Extension-space migration directories are emitted from the extension descriptor's in-memory values into the user's `migrations/<space-id>/<migration-name>/`. App-space migration directories are written at `migrations/<migration-name>/`.
- **FR5.** The migration runner applies each space's migrations in order, updating the corresponding marker-table row. Cross-space ordering: all extension-space migrations apply first, app-space migrations apply second. All applied migrations across all changed spaces in a single emit are committed in a single transaction.
- **FR6.** The verifier constructs an in-memory aggregate of all loaded spaces' contracts by reading the user's repo (app-space `contract.json` at the project root + each loaded extension's pinned `migrations/<space-id>/contract.json`). It then checks the live database against the aggregate. Each space's marker-row hash is checked against its pinned contract's content hash; strict mode rejects mismatches per space. The verifier rejects: (a) marker rows for spaces not present in `extensionPacks` (orphan markers), (b) `extensionPacks` entries with no pinned `migrations/<space-id>/contract.json` on disk (declared-but-unmigrated), and (c) `migrations/<space-id>/` directories on disk for spaces not present in `extensionPacks` (orphan pinned directories). Each rejection carries a clear remediation hint.
- **FR7.** Codecs may declare a plan-time lifecycle hook fired on field-added / field-dropped / field-altered events (where 'altered' = any field property changed except `codecId`). The hook is synchronous; receives the prior + new IR for the table containing the changed field (app-space scope only); returns `MigrationOp[]`, each with its own `invariantId`. Returned ops are inlined into the consuming application's migration JSON — the hook cannot return ops targeting other spaces.
- **FR8.** Codec-emitted migration ops are captured into the consuming application's migration JSON (application space), not into the extension's space. The application's emitter runs the hook for each event in the application contract diff.
- **FR9.** The contract IR vocabulary admits anything a column / field can name as `nativeType`: tables, enums, composite types, domains. Persistence structures not in this set (schemas, functions, operators, casts, op classes/families) are carried inside migration ops as opaque steps with `invariantId`s; they are not modelled in the IR.
- **FR10.** Per-space artefacts are self-contained at apply time and verify time: the runner and the verifier read only the JSON files under the user's repo (root-level app-space `contract.json` + each loaded extension's pinned `migrations/<space-id>/contract.json`, `contract.d.ts`, `refs/head.json`, and `<migration-name>/` directories). No extension descriptor is imported during apply or verify. Extension descriptors are consumed only at authoring time (`migration plan` / `migrate`).
- **FR11.** Extension `invariantId`s, once published in a release, are immutable. Renaming or removing a published `invariantId` is a breaking change for downstream consumers.
- **FR12.** The aggregate construction in FR6 is in-memory only; no merged contract is persisted on disk. Each space's `contract.json` remains the single source of truth for that space.
- **FR13.** The existing `databaseDependencies.init` mechanism is removed at the end of this project. The in-tree extensions that use it today (cipherstash, pgvector, arktype-json) are migrated to contract spaces in scope of this project. The framework has a single mechanism for schema-contributing extensions after this project lands.
- **FR14.** `db init` and `db update` are per-space applications of `findPathWithDecision(currentMarker, ref.hash, ref.invariants − marker.invariants)`. Per-space results are concatenated using the cross-space ordering convention (extensions first, app-space second) and applied in a single transaction. App-space's existing synthetic-edge behaviour for greenfield is preserved when no app-space migration is on disk; extension-space always walks the migration graph. Head refs are read from the user's repo: app-space ref from the project-root contract, extension-space refs from the pinned `migrations/<space-id>/refs/head.json`.
- **FR15.** Extensions ship at least one ref (the head ref) declaring their current target hash and required invariants. Multiple refs are permitted with the same semantics as application-space refs.
- **FR16.** User-repo on-disk layout: app-space's current `contract.json` lives at the project root (today's convention). App-space migrations live at `migrations/<migration-name>/`. Each loaded extension's pinned current `contract.json`, `contract.d.ts`, and `refs/head.json` live at `migrations/<space-id>/`; that extension's migrations live at `migrations/<space-id>/<migration-name>/`. Discovery is convention-based: no manifest or registry file is required.
- **FR17.** On every `migrate` invocation, the framework writes (or overwrites) each loaded extension space's pinned `contract.json`, `contract.d.ts`, and `refs/head.json` from the descriptor's current values, alongside any new migration directories. Bumping an extension produces a reviewable PR diff that includes the pinned contract change and any new migration directories. Drift detection: at every `migrate`, the framework compares the descriptor's current `contractJson` against the on-disk pinned version and surfaces mismatches as "extension bumped — run `migrate` to materialise the change."

## Non-Functional Requirements

- **NFR1.** No user-facing semantic change to `dbInit` strict mode. The `strictVerification: false` workaround introduced under cipherstash project execution is reverted as part of this work.
- **NFR2.** The user's repo is **WYSIWYG-complete**: every artefact required to predict, hash, verify, or apply the database's expected schema lives on disk in the user's repo, version-controlled and reviewable. This applies per space — the app-space `contract.json` at the project root and each extension space's pinned `migrations/<space-id>/contract.json`, `contract.d.ts`, `refs/head.json`, and migration directories. A reader of the repo (or a CI pipeline, or an auditor) can answer "what does this database need to look like" without importing any extension package.
- **NFR3.** The framework's planner / runner / verifier consume extension descriptors only at **authoring time** (during `migration plan` / `migrate`), to emit pinned per-space contracts + migrations into the user's repo. At apply time and verify time (CD), the framework reads only the user's repo files — no descriptor-driven contract or migration data is required. (Application code at query-execution time may continue to import extension packages for codec runtime behaviour; that is unchanged and orthogonal to schema verification.)
- **NFR4.** The cipherstash team's vendored EQL bundle SQL remains valid as-is. The bundle SQL becomes the body of one migration op in cipherstash's contract space; no fork or split of the bundle is required of the cipherstash team.
- **NFR5.** Performance: extension-space planning and verifier aggregation must not measurably regress emit-time or `dbInit` performance for applications with no extensions. Target: < 5% wall-clock overhead on a representative no-extension emit + dbInit.
- **NFR6.** The aggregation pass for verification is deterministic and order-independent across `extensionPacks` declaration order: two applications with the same set of installed extensions produce the same aggregate regardless of declaration order. v1 implementation: sort by space identifier alphabetically before aggregating.

## Non-goals

- **Extension removal semantics.** What happens when a user removes an extension from `extensionPacks` while their schema still depends on extension-installed types (e.g. `Encrypted<string>` columns referencing `eql_v2_encrypted`). Defer to a follow-up; until then, removal is unsupported and the verifier reports orphan marker rows as errors.
- **Codec-id-changed lifecycle event.** When a user upgrades an extension in a way that changes a codec ID (`cipherstash/string@1` → `@2`), the codec needs a way to emit a "rotate" migration op. Cleanly extends the existing event vocabulary; deferred until needed.
- **Multi-extension interactions.** Two extensions claiming the same table or type name, ordering across extensions, dependency between extensions. Convention-based ordering only for v1. v1 rule for type-name collisions across spaces: the verifier errors with a clear collision report.
- **Formal cross-space dependency graph.** Convention ordering (extensions first, app-space second; scaffolding → structural → codec inside a single migration) is sufficient given the single-transaction property.
- **Replacing or restructuring the application's existing contract IR.** The application's `contract.json` shape is unchanged; what changes is the framework treating multiple such files as siblings rather than the only one.
- **Authoring tools for extension authors.** They will use Prisma Next's existing emit pipeline against their extension's own PSL/TS schema. No new tooling is needed.

# Acceptance Criteria

- [ ] **AC1** (covers FR2, FR6, NFR1). A fresh Postgres database has the cipherstash extension installed via the new mechanism. `dbInit` runs in strict mode (no `strictVerification: false` flag, no per-extension allowlist) and succeeds. The verifier sees `eql_v2_configuration`, `eql_v2_configuration_state`, `eql_v2_encrypted`, the various `ore_*` composites, and the domains, and recognises them as expected (because cipherstash's contract space declared them). An additional unexpected column added by hand to `eql_v2_configuration` causes `dbInit` to fail with a strict-mode error, proving strict mode is preserved per space.
- [ ] **AC2** (covers FR1, FR4, FR5, FR7, FR8, FR10, FR16, FR17). A user adds `cipherstash` to `extensionPacks` and adds an `Encrypted<string>` column with `searchable: true` to a fresh `User` table in their PSL. `prisma-next migrate` produces:
    - One app-space migration directory at `migrations/<timestamp>_add_user/` containing the user's `CREATE TABLE` op and a codec-emitted `add_search_config` op (with invariantId namespaced `cipherstash-codec:*`), both in the same `ops.json`.
    - Pinned cipherstash artefacts: `migrations/cipherstash/contract.json`, `migrations/cipherstash/contract.d.ts`, `migrations/cipherstash/refs/head.json` — byte-equivalent to the descriptor's current values.
    - One or more cipherstash-space migration directories at `migrations/cipherstash/<original-name>/` containing cipherstash scaffolding ops (with invariantId namespaced `cipherstash:*`).

    `prisma-next db apply` runs both migrations in a single transaction (extension-space first); the marker table afterwards has two rows (`app`, `cipherstash`), each with the expected hash.
- [ ] **AC3** (covers FR4, FR11, FR15, FR17). The cipherstash team publishes a new package version that adds one new migration to its shipped graph (e.g. adding a column to `eql_v2_configuration`) and bumps its `headRef`. A user upgrades the package and runs `prisma-next migrate`. The pinned `migrations/cipherstash/contract.json`, `contract.d.ts`, and `refs/head.json` are updated in place; one new cipherstash-space migration directory is created containing only the new op. `db apply` advances the cipherstash space's marker row.
- [ ] **AC4** (covers FR1-FR6). A monorepo with two internal packages each declaring its own contract space, plus an aggregating package that depends on both, builds successfully, emits per-space migrations on changes, and applies them. The mechanism for monorepo composition is the same as for extensions; no monorepo-specific framework code is required.
- [ ] **AC5** (covers FR3, FR6, NFR6). After applying any combination of multi-space migrations, an integration test reads the marker table and asserts (a) one row per loaded space, (b) each row's hash equals the corresponding `contract.json`'s content hash, (c) the row set is the same regardless of `extensionPacks` declaration order.
- [ ] **AC6** (covers NFR2, NFR3, FR10). Both the runner (apply path) and the verifier (`dbInit` / `db update` verify path) operate without importing any extension descriptor module — they read only the user's repo (root-level app-space `contract.json` + per-space `migrations/<space-id>/contract.json` and migration directories). Authoring (`migration plan` / `migrate`) is the only flow that needs descriptor access.
- [ ] **AC7** (covers NFR4, FR13). The cipherstash extension's existing vendored EQL bundle SQL is the body of exactly one migration op in cipherstash's contract space (the `installEqlBundle` op). Bundle content is unchanged from what is shipped today.
- [ ] **AC8** (covers FR9). The contract IR includes `eql_v2_encrypted` (composite type), `eql_v2_configuration_state` (enum), and the `eql_v2` domains used as column types. The contract IR does **not** include the EQL bundle's functions, operators, casts, or operator classes/families — those live inside the body of the `installEqlBundle` migration op only.
- [ ] **AC9** (covers FR8, codec ownership of schema-driven ops). When a `searchable: true` `Encrypted<string>` column is dropped from a user table, the codec lifecycle hook emits the corresponding `remove_search_config` op into the application-space migration. No change to cipherstash's contract space's marker row results from this.
- [ ] **AC10** (covers FR13). The pgvector extension is migrated to a contract space. `pgvector` declares the `vector` type in its `contract.json`; its initial migration installs the `vector` extension as the body of one op. A user adds pgvector to `extensionPacks`, adds a column with `nativeType: 'vector(N)'` to their schema, runs `prisma-next migrate` and `db apply`. The marker table has rows for `app` and `pgvector`. `dbInit` against the resulting database succeeds in strict mode.
- [ ] **AC11** (covers FR13). The arktype-json extension is migrated to a contract space using the same pattern as cipherstash and pgvector. `databaseDependencies.init` is removed from the framework; no in-tree extension references it.
- [ ] **AC12** (covers FR14). On a fresh database with cipherstash in `extensionPacks`, `db init` walks cipherstash-space's migration graph (applying the bundle install + scaffolding) and synthesizes the app-space delta edge from the user's contract, applying both in a single transaction. Marker rows for both spaces are created with the expected hashes.
- [ ] **AC13** (covers FR6, orphan marker handling). A user removes an extension from `extensionPacks` while a marker row for that extension still exists in the database. `dbInit` fails with a clear error identifying the orphan row and the recommended remediation (manual cleanup).
- [ ] **AC14** (covers FR17, NFR2). A user bumps cipherstash from `vX` to `vY` (descriptor's `contractJson` content changes) and runs `prisma-next migrate`. The user's PR diff includes: (a) updated `migrations/cipherstash/contract.json`, `contract.d.ts`, `refs/head.json`; (b) one new migration directory under `migrations/cipherstash/<new-migration-name>/`. No file outside `migrations/` (and the project root contract for any incidental app-space changes) is touched.
- [ ] **AC15** (covers NFR2, NFR3, FR2, FR10). The verifier and the runner are exercised in a context where extension descriptor modules are *not* importable (e.g. `node_modules` for those extensions deleted prior to the test). `dbInit` and `db apply` succeed, reading per-space contracts and migrations from the user's repo only. (`migrate` / `migration plan` is *not* required to work in this context — it needs the descriptor.)
- [ ] **AC16** (covers FR6, declared-but-unmigrated). A user adds an extension to `extensionPacks` but never runs `migrate` (no `migrations/<space-id>/` directory exists yet). `dbInit` fails with a clear error: "extension `<id>` is declared but has not been emitted; run `prisma-next migrate`." Conversely, a `migrations/<space-id>/` directory present on disk for an extension *not* in `extensionPacks` causes `dbInit` to fail with an orphan-pinned-directory error and remediation hint.

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

- ADR 197 — Migration packages snapshot their own contract.
- ADR 208 — Invariant-aware migration routing (provides the per-space `findPathWithDecision` primitive used by `db init` / `db update` / `migration apply`).
- ADR 154 — Component-owned database dependencies (partially superseded by this work for schema-contributing extensions; `databaseDependencies.init` is removed at end of project).
- ADR 021 — Contract Marker Storage (marker schema gains a `space` column under this work).
- Cipherstash project handover: `projects/cipherstash-integration/project-1/HANDOVER.md` (transient; will be removed at cipherstash project close-out — see Linear ticket for canonical follow-up).
- Cipherstash team-facing design doc: `projects/cipherstash-integration/project-1/cipherstash-team-design.md`.
- Cipherstash team open questions: `projects/cipherstash-integration/project-1/cipherstash-team-questions.md`.
- Linear: TML-2397 (this project), TML-2373 (cipherstash project parent — the immediate consumer / blocker), TML-2376 and TML-2388 (filed during cipherstash project execution; in the same neighbourhood, independent).
- The original `databaseDependencies.init` hook lives in the framework's component descriptor types — implementer should locate during pre-implementation reconnaissance.

# Open Questions

These are residual decisions left for the implementer or for resolution before / during implementation. None affect the architectural shape; all are degrees of freedom inside the design above.

1. **Namespacing of `invariantId`s.** Recommended default: prefix convention (`cipherstash:install-eql-v1`, `app:create-table-User-v1`, `cipherstash-codec:User.email@v1`). Alternative: structured records `{source: "cipherstash@*", id: "install-eql-v1"}` carried alongside the ID. The prefix convention is simpler and sufficient for v1; structured records would only be needed if extensions need to be renamed in user repos, which is out of scope.
2. **Cipherstash project (TML-2373) integration path.** Whether the in-flight cipherstash project pivots to consume this mechanism, continues with its current band-aid until this lands, or pauses. Decision deferred to a separate conversation; not a spec-level question.
