# Summary

Restructure the contract IR around two **planes** — `domain` and `storage` — with a **uniform entity coordinate `(namespace, kind, name)`** addressing every concept in either plane, and a **target-pack-contributed entity-kind mechanism** that lets target packs add new entity kinds without framework changes. Postgres enum is the first kind to migrate off the framework-shared `types` slot and onto the new pack-contribution path, proving the substrate end-to-end.

# Purpose

Make the contract IR target-extensible at the entity-kind level: target packs contribute new entity kinds (Postgres enum today; RLS policies, roles, sequences, materialised views tomorrow) through a single framework-level mechanism, with a uniform IR shape that every consumer can walk by entity coordinate. Without this restructure, every new pack-contributed kind would hardcode itself into the framework the way Postgres enum currently does — the substrate this project builds is what makes the rest of the Target-Extensible IR + Namespaces umbrella ship.

# At a glance

Today the contract is namespace-asymmetric: storage is per-namespace (`storage.namespaces.<ns>.tables.<name>`) but every other concept — models, value objects, types — sits flat at the contract root. Postgres enum is structurally wedged in: it lives in the framework-shared `storage.namespaces.<ns>.types` slot whose payload type is `PostgresEnumStorageEntry` (a Postgres target name leaking into the SQL family base, with a parallel leak into SQLite which has to import the same Postgres-named type just to spell out *"reject enum_values_changed issues"*).

After this project the contract is symmetric, namespace-everywhere, and pack-extensible by entity kind:

```jsonc
{
  "target": "postgres",
  "targetFamily": "sql",
  "domain": {
    "auth": {
      "models":       { "User":    { /* fields, relations */ } },
      "valueObjects": { /* … */ },
      "types":        { /* codec aliases like Embedding1536 */ }
    },
    "public": {
      "models":       { "Post":    { /* … */ } },
      "valueObjects": {},
      "types":        {}
    }
  },
  "storage": {
    "storageHash": "...",
    "auth":   { "tables": { "user": { /* … */ } } },
    "public": {
      "tables":       { "post": { /* … */ } },
      "enum": { "user_role": {
        "kind": "postgres-enum",
        "name": "user_role",
        "nativeType": "user_role",
        "values": ["admin", "member", "guest"]
      } }
    }
  },
  "roots":           { "user": { "namespace": "auth", "model": "User" } },
  "capabilities":    { /* … */ },
  "extensionPacks":  { /* … */ }
}
```

Three structural moves combine to deliver this:

1. **Two planes** (`domain`, `storage`) replace the flat-at-root model/relation/types siblings.
2. **Uniform shape** `<plane>.<ns>.<entityKind>.<entityName>` — no `"namespaces"` indirection segment at either plane.
3. **Pack-contributed entity-kind slots** — `enum` is a slot the Postgres pack contributes via the framework's existing `AuthoringContributions.entityTypes` surface (named per the *essence + singular* convention recorded in ADR Decision 5 — `enum`, not `postgresEnums`, not `enums`); the framework-shared `storage.<ns>.types` slot is deleted as a load-bearing surface (the per-target codec-alias / value-binding `domain.<ns>.types` stays; the storage-side `types` was always the leak).

The single canonical addressing primitive becomes the **entity coordinate** `(namespaceId, entityKind, entityName)`. Every consumer of the IR — migration disjoint calculation, planner diffing, validator collision checks, cross-plane references — addresses entities by this tuple, replacing today's mixed bag of `(namespaceId, tableName)` pairs, `findSqlTable(contract, name)` global-scan helpers, and string-keyed flat lookups.

# Context

## Problem

Today's IR shape carries three asymmetries the namespace exemplar (PR #534) intentionally left in place because fixing them would have blown the PR scope:

1. **Storage is namespace-aware; everything else is flat.** A user can have `auth.user` and `public.user` as distinct tables; they cannot have `auth.User` and `public.User` as distinct models. The model-name lookup is global. The standard multi-tenant pattern (a Supabase-style `auth.User` alongside an application-defined `public.User`) is structurally blocked at the model layer even though it works at the storage layer.

2. **Code at every consumer reinvents *"find by name across namespaces."*** Helpers like `findSqlTable(contract, name)` exist because the storage shape has namespaces and the model shape doesn't, so the layer that bridges them has to do an O(namespaces × tables) scan and assert uniqueness. The framework canonicalizer carries SQL-specific paths because it has to preserve empty storage namespaces (a family concept the framework conceptually doesn't know about). `SqlNamespacePayload`, `DEFAULT_NAMESPACES`, `stripNamespaceKinds`, the `instanceof NamespaceBase` brand check — all are direct expressions of the asymmetry leaking into framework-shaped code.

3. **Postgres enum is hardcoded into framework + family layers.** The framework-shared `storage.namespaces.<ns>.types` slot is typed `Record<string, PostgresEnumStorageEntry>` — a Postgres-target name in a family-base type. The SQL family validator schema enforces it (`PostgresEnumTypeSchema`); the family verifier has a `verifyEnumType` function; the emitter codegen hardcodes the `kind: 'postgres-enum'` literal in `contract.d.ts` output. Most striking: **SQLite imports `PostgresEnumStorageEntry` by name** in four files just to spell out *"SQLite doesn't have enums; reject this issue kind."* A target that does not support a feature still pays a compile-time tax to know the target-specific type of the feature it doesn't support.

The third asymmetry is the load-bearing one for downstream work. Every future Postgres-only entity kind (RLS policies, roles, sequences, materialised views, partition specs, pgvector type bindings) would follow the same hardcoded-into-framework path absent this restructure. The substrate this project builds is what makes those future contributions cheap.

## Approach

The settled approach combines four decisions (D1–D6 below) that converged in two design discussions (architect + principal-engineer lenses, 2026-05-19 and 2026-05-20):

**Two planes with uniform shape.** `contract.domain` carries application concepts (models, value objects, type aliases); `contract.storage` carries family-owned persistence projections (tables, collections, pack-contributed kinds). Both planes use the identical indexing pattern: `<plane>.<namespaceId>.<entityKind>.<entityName>`. The word `"namespaces"` does not appear as an IR segment at either plane — namespace IDs are the keys directly under each plane.

**Entity coordinate as the canonical identity tuple.** `(namespaceId, entityKind, entityName)` is the addressing primitive every IR consumer uses. The framework exposes a polymorphic free-function `elementCoordinates(storage)` walk that yields these tuples generically, dispatching on `Namespace.kind` via the pack-contributed descriptor registry; consumers diff, dedupe, and collision-check against the tuple. The migration system's disjoint calculation depends on this — without a single canonical coordinate, every consumer reinvents what *"same entity"* means and disagreements ship as bugs.

**Pack-contributed entity-kind slots.** The framework ships a small base set of kinds hardcoded into each family-pack (`tables` for SQL, `collections` for Mongo) — these guarantee a stable family-shape contract for consumers and are not worth retrofitting onto the descriptor mechanism. Beyond that base, target packs contribute additional entity kinds via `AuthoringContributions.entityTypes`, extended to carry the IR-class factory + per-pack slot key. The PSL interpreter and TS DSL already dispatch through this surface for enum (`getAuthoringEntity(contributions, ['enum'])`); the restructure extends the dispatch to the storage IR layer, the validator, and the emitter codegen so the framework-shared `types` slot is no longer load-bearing.

**Cross-entity references as object pairs.** Every cross-namespace reference (`relation.to`, `model.base`, `roots[*]`) carries `{ namespace, model }`. Storage-plane references (FK targets, etc.) follow the same shape with `{ namespace, table, columns }`. Consistent with the `ForeignKey.target.{namespaceId, tableName, columns}` shape PR #534 already shipped — no dot-qualified-string shortcuts, no implicit same-namespace resolution.

## Predecessor work

This project depends on PR #534 (TML-2520, namespace exemplar) merged into `main` at commit `66da80f96`. That PR made the storage section namespace-aware and shipped cross-namespace foreign keys with the object-pair encoding. It is the precedent for both this project's coordinate system (storage already has `(namespaceId, tableName)`; this project generalises to `(namespaceId, entityKind, entityName)`) and its cross-reference encoding (FKs already use object pairs; this project extends the pattern to every reference site).

## Cleanup work absorbed by this project

Post-merge code review on PR #534 surfaced a list of smaller cleanups — `UnboundTables<C>` rename ([TML-2582](https://linear.app/prisma-company/issue/TML-2582)), framework canonicalizer SQL-specific paths ([TML-2579](https://linear.app/prisma-company/issue/TML-2579)), `extractStorageElementNames` duck-typing ([TML-2580](https://linear.app/prisma-company/issue/TML-2580)), `SqlNamespacePayload` shim, `DEFAULT_NAMESPACES` constant, `stripNamespaceKinds` workaround, `instanceof NamespaceBase` brand check. All of these are structural consequences of the storage-only namespace shape and the framework-shared `types` slot. The reshape this project proposes — symmetric planes + uniform entity coordinate + descriptor-driven slot extensibility — rewrites the same code paths and removes the conditions that produced the smells in the first place. The three filed Linear tickets close as duplicates when this project completes.

# Scope

## In scope

- **IR shape change.** `contract.{domain, storage}.<ns>.<entityKind>.<entityName>` structure throughout. The word `"namespaces"` does not appear in the IR.
- **Entity coordinate primitive.** `(namespaceId, entityKind, entityName)` exposed via a polymorphic free-function `elementCoordinates(storage)` walk; consumers (planner diff, migration disjoint calc, validators, cross-plane references) adopt the coordinate.
- **Cross-reference encoding.** Object pairs for `relation.to`, `model.base`, `roots[*]`, FK references, and any other cross-entity reference site.
- **Framework `Namespace` interface narrowed** to `{ id, kind }`. Family-specific slots (`tables`, `collections`) move to family-shaped namespace types. SQL family namespace type is `Namespace & { tables, [...packContributedSlots] }`.
- **Pack-contributed entity-kind mechanism.** `AuthoringContributions.entityTypes` extended to carry: IR-class factory (already present), serializer hydration registration (new), validator schema contribution (new). The descriptor's existing `discriminator` field is the single coordinate; no separate `storageSlotKey` field. Postgres pack contributes its `enum` slot via this mechanism (slot key named per the *essence + singular* convention — see ADR Decision 5).
- **Framework-shared `storage.namespaces.<ns>.types` slot deleted** as a load-bearing surface. Enum entries move to `storage.<ns>.enum.<name>`. The framework-shared `domain.<ns>.types` slot stays for codec aliases / value bindings (the domain-side `types` was never the leak).
- **IR construction discipline.** `SqlStorage` / `MongoStorage` constructors accept only fully-constructed `Namespace` instances; no POJO normalisation, no default singleton injection. All convenience lives in the authoring layer.
- **`createNamespace` factory moves** onto the target pack contribution surface; removed from user-facing `defineContract` arguments.
- **Serializer rewrite.** `kind` no longer in JSON; class identity resolved from `(targetFamily, target)` + position. `stripNamespaceKinds` deleted. Hydration registry consumes pack-contributed entity-kind descriptors generically.
- **`deserializeContract<T>(json): T`** becomes generic at the family interface.
- **Removed surface checks subsumed by the new shape.** `assertUniqueSqlTableNames`, `findSqlTable`, `extractStorageElementNames` (replaced by per-plane walks keyed by entity coordinate).
- **Framework canonicalizer no longer has SQL-specific paths** (family-contribution hook for preserve-empty paths). Subsumes TML-2579.
- **Polymorphic `elementCoordinates(storage)` walks** (naturally exposed by the new shape; implemented as a free function dispatched via the descriptor registry). Subsumes TML-2580.
- **`UnboundTables<C>` removed** (DSL walks `domain.<ns>.models` directly). Subsumes TML-2582.
- **Migration** of all in-tree contracts + fixtures to the new shape; both `storageHash` and `profileHash` change universally.
- **ADR** `0001-contract-planes.md` finalised.

## Non-goals

- **Postgres enum first-class affordances.** Typed enum value references (`Role.member`), `db.enums.X` runtime surface, codec value-narrowing, `@default(EnumName.value)` lowering. These are the "make enums actually useful in user code" work; they live in the separate `postgres-enum-finishing` project. This project ships only the structural relocation (enum out of framework-shared `types` slot; pack contributes its own slot) — exactly enough that enum-finishing can build on top.
- **Pack-contributed PSL grammar.** The framework PSL parser continues to hardcode `enum {…}` as a known block kind. Pack-contributed block grammars (e.g. `policy {…}`) is the target-contributed-PSL-blocks substrate (TML-2537), a separate project. Postgres enum reuses the existing framework-known PSL block; the pack contributes the storage IR, not the syntax.
- **Open framework `SchemaIssue` union.** `EnumValuesChangedIssue` stays as a closed framework union variant for now. Targets contributing their own issue kinds is a separate extensibility seam; deferred.
- **SQLite cleanup.** SQLite continues to import `PostgresEnumStorageEntry` by name to spell out the rejection. Structurally ugly but not user-visible; tolerating it for one more release is acceptable.
- **Codec-id consolidation.** The two `PG_ENUM_CODEC_ID` literals (private in `postgres-enum-type.ts`, public in `codec-ids.ts`) are deduplicated only if it's free during the refactor; not a project goal.
- **Mongo collections symmetry.** Mongo emits `contract.domain.<ns>.models.<X>` (per uniform shape) but Mongo's pack-contributed kinds (if any) are out of scope; Mongo ships only its existing built-in `collections` kind.
- **TML-2581 / TML-2550 namespace-aware DSL surface.** `db.auth.user` / `db.auth.User` ergonomics. Natural successor project; not blocked by this one but much cheaper to build on top.
- **TML-2583 historical migration re-baselining.** Orthogonal housekeeping; needs doing eventually regardless.

# Approach

Five settled design decisions drive the implementation. The Decision Log below records each with its rationale, assumptions, and rejected alternatives so future contributors don't re-derive them.

## Decision log

### D1 — Two planes: `domain` and `storage`

**Decision.** The contract has exactly two top-level planes for entity content. `domain` carries application concepts (models, value objects, type aliases). `storage` carries family-owned persistence projections (tables, collections, pack-contributed entity kinds).

**Reasoning.** [ADR 004 — Storage Hash vs Profile Hash](../../docs/architecture%20docs/adrs/ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md) already treats `storage` as an independently-hashed, family-owned segment of the contract. Storage is structurally a plane in everything but name. This project promotes the recognition into the IR shape and gives the application-side content (currently scattered as flat siblings `models`, `relations`, `valueObjects`, `types`) a peer name: `domain`. The framework / family ownership boundary becomes visible in the IR: framework code that names `storage.<…>.tables` is doing something wrong — that's a family idiom.

**Assumes.** Application concepts and storage projections always coexist within the same contract. No "domain-only" or "storage-only" contracts; holds for every current and foreseeable use case.

**Rejected.**

- *Single root, no planes (today's shape).* Fails the collision-realism test for models (`auth.User` + `public.User` blocked); the asymmetry between storage and the rest is the present-day cost.
- *Three planes (domain + storage + bridge for shared types).* Overcomplicates. Cross-plane references (codecs serving both planes) are solved with object-pair references, not a third plane.

### D2 — Uniform shape: `<plane>.<ns>.<entityKind>.<entityName>`

**Decision.** Both planes use identical indexing. Top-level keys under each plane are namespace IDs; under each namespace are entity-kind maps; under each kind are entity-name → entity-instance maps. The word `"namespaces"` does not appear in the IR.

**Reasoning.** One indexing pattern to learn; consumers can write generic walkers (`for (const ns of Object.keys(contract.domain)) for (const kind of …)`). The intermediate proposal — `contract.namespaces.<ns>.{models, …}` extending today's `storage.namespaces.<ns>.tables` shape literally — would put the word `"namespaces"` at two levels (`contract.namespaces.<ns>.models` AND `storage.namespaces.<ns>.tables`), conveying nothing extra. Dropping the segment entirely keeps the coordinate system without the redundancy.

**Assumes.** Slot shapes under each plane stay family-specific (storage's `tables` vs `collections`; pack-contributed kinds named by the pack) but the namespace-keying shape stays uniform across planes.

**Rejected.**

- `contract.namespaces.auth.{models, tables, types, …}` (single per-namespace container holding both domain and storage slots) — couples domain + storage; loses framework / family ownership boundary; family slots (`tables`, `collections`) sit next to framework slots (`models`).
- `contract.namespaces.auth.models` + `contract.storage.namespaces.auth.tables` (extend the existing storage shape literally to domain content, keeping `"namespaces"` everywhere) — produces the two-level redundancy this decision exists to remove.

### D3 — Plane names: `domain` + `storage`

**Decision.** Application plane named `domain`. Storage plane keeps its name.

**Reasoning.** `domain` matches the user's original framing (*"storage domain vs application domain"*) and aligns with DDD vocabulary (domain model). Concise; reads naturally in IDE auto-complete.

**Assumes.** Existing internal uses of "domain" in the codebase (e.g. `validate-domain.test.ts`) don't conflict semantically — they're testing-internal and disambiguable.

**Rejected.**

- `application` — descriptive but bulky; overloaded with "the app's runtime code" in IDE auto-complete.
- `logical` / `physical` — classical data-warehouse vocabulary; would cost renaming `storage` → `physical`, unnecessary scope.
- `schema` — catastrophically overloaded (PSL schema, SQL schema, JSON schema).

### D4 — Cross-references encoded as object pairs

**Decision.** Every cross-namespace reference carries `{ namespace, model }` (or `{ namespace, table }` for storage-plane references). Consistent with `ForeignKey.target.{namespaceId, tableName, columns}` shape shipped by PR #534.

**Reasoning.** Consistency with the FK precedent. Same encoding for every cross-namespace reference; no asymmetric shortcuts. Mechanical to parse; no separator-character escape hatches; no implicit-resolution rules to test. The authoring DSL takes model handles (`rel.belongsTo(User, …)`) so users never type the object pair themselves — the encoding is an IR-on-the-wire choice.

**Rejected.**

- *Dot-qualified strings* (`relation.to: "auth.User"`) — cheap to read; expensive at every consumer (split-on-dot, forbid dots in model names, escape-character edge cases).
- *Implicit same-namespace + explicit override* (`relation.to: "User"` resolves locally; cross-namespace uses object pair) — optimises the common case; introduces asymmetric IR shape that every consumer has to handle.

### D5 — Pack-contributed entity-kind mechanism

**Decision.** Target packs contribute new entity kinds through the framework-level `AuthoringContributions.entityTypes` surface, extended to carry serializer hydration registration + validator schema contribution alongside the existing IR-class factory; the descriptor's existing `discriminator` field is the single coordinate the family base looks up by, with no separate `storageSlotKey` field. The framework-shared `storage.<ns>.types` slot is removed as a load-bearing surface; enum entries move to a pack-contributed `storage.<ns>.enum` slot (named per the *essence + singular* convention; see ADR Decision 5).

The framework retains hardcoded built-in kinds (`tables` for SQL, `collections` for Mongo) — these guarantee a stable family-shape contract for consumers, and retrofitting them onto the descriptor mechanism is a large job that delivers no user value. The dual-surface (hardcoded built-ins + descriptor-driven contributed kinds) is deliberate paid debt; it could be migrated later if a concrete need emerges.

**Reasoning.** The cheapest alternative I considered — keep enum hardcoded but move the hardcode from framework to the Postgres pack — leaves the slot name (a target concern) leaking into framework parser dispatch, because the PSL interpreter and TS DSL both walk the storage shape generically. The descriptor mechanism is the only typology that satisfies both *"framework-level contribution surface"* (so authoring tools see the contribution) and *"no Postgres-named symbol in the framework or sibling-target packages."*

Generalising to retrofit `tables` / `collections` is rejected on cost — the work to make every existing built-in flow through the descriptor mechanism would touch every consumer in the framework, and the only delivered value is conceptual symmetry. The architect lens already accepted the dual-surface as paid debt.

**Assumes.**

- Future pack-contributed kinds (RLS policies, roles, sequences, materialised views) will be named after what they *are*, not after who contributed them. Slot key for the Postgres pack's policy contribution would be `postgresPolicies`, not `packContributedEntities.policy` or similar.
- The migration to descriptor-driven built-ins is optional future work that may never earn its keep — the dual-surface is acceptable indefinitely.

**Rejected.**

- *Hardcoded slot per kind, moved from framework into pack.* Leaks slot name into framework authoring-tool dispatch.
- *Single generic `storage.<ns>.entities.<kind>.<name>` slot.* Kinds carry their own discriminator field; framework walks a uniform map. Loses the typed `contract.d.ts` emission story — every consumer of the emitted types would have to narrow on the discriminator instead of getting the kind in the type path.
- *Retrofit `tables`/`collections` to descriptor mechanism.* Cost-disproportionate.
- *Pack-contributed PSL grammar in scope.* Pulls TML-2537 into the project; explicitly out of the umbrella's scope-cut.

### D6 — Entity coordinate `(namespaceId, entityKind, entityName)`

**Decision.** The canonical addressing primitive for every IR entity is the tuple `(namespaceId, entityKind, entityName)`. The framework exposes a polymorphic free-function `elementCoordinates(storage)` walk that yields these tuples generically across built-in and pack-contributed kinds, dispatched on `Namespace.kind` via the pack-contributed descriptor registry. The walk is intentionally a free function rather than a member of the `Storage` interface: adding the method to the interface would require every structural `Contract<SqlStorage>` consumer's storage literal (notably emitted `contract.d.ts` files, which print storage as plain object types with no method members) to grow the same method, cascading byte-stability breakage through every committed fixture. The free function consumes any `Storage`-shaped value and preserves the structural assignability emitted artefacts rely on. Every IR consumer — migration disjoint calculation, planner diffing, validator collision checks, cross-plane references — addresses entities by this coordinate.

**Reasoning.** Without a canonical coordinate, every consumer reinvents what *"same entity"* means: today's codebase has `findSqlTable(contract, name)` global scans, mixed `(namespaceId, tableName)` pairs, string-keyed flat lookups, and the duck-typed `extractStorageElementNames` helper — and disagreements between them ship as bugs in disjoint calculation (the migration planner has to know that two operations target the same table; if one consumer thinks "name only" identifies the entity and another thinks "(namespace, name)" identifies it, the disjoint calc is wrong). The two-plane shape (D1) and uniform indexing (D2) make the coordinate the natural primitive; D6 makes it load-bearing.

**Assumes.** Entity kind is part of the coordinate, not derived from the entity-instance type. A pack-contributed `postgresEnum` entity in the same namespace as a (hypothetical, future) `postgresSequence` entity with the same name are distinct coordinates — the migration planner does not need to diff them as if they're the same thing.

**Rejected.**

- *`(namespaceId, name)` pair, derive kind from the instance type.* Loses uniqueness when packs contribute kinds with overlapping name conventions; couples the coordinate to runtime IR-class identity (consumers diffing from JSON envelopes can't dispatch without rehydrating to classes first).
- *Three-segment string ID (`auth/postgres-enum/user_role`).* Same separator-collision concerns as dot-qualified-string references — rejected for the same reasons as D4.

### D7 — ADR-worthy

**Decision.** This structural reshape carries an ADR. Drafted at `projects/contract-ir-planes/adrs/0001-contract-planes.md`. Migrates to `docs/architecture docs/adrs/` at project close-out.

**Reasoning.** The plane structure + entity coordinate are part of the framework's public IR contract. Future contributors and external pack authors need to understand the typology; an ADR is the durable home for that.

### D8 — Tier 1 scope: structural relocation, not user affordances

**Decision.** This project ships only the structural changes that satisfy PDoD3 (enum out of framework-shared `types` slot; pack contributes its own kind through the descriptor mechanism). It does NOT ship:

- Typed enum value references (`Role.member` accepted by `field.default(...)`)
- `db.enums.X` runtime surface
- Codec value-narrowing (query output typed as the enum value union)
- `@default(EnumName.value)` PSL lowering
- Pack-contributed PSL block grammar (TML-2537 territory)

User-facing affordances live in the separate `postgres-enum-finishing` project. This project builds the substrate; that project consumes it.

**Reasoning.** Scope discipline. The structural defect is in the storage IR layer; the user affordances are in the codec / authoring / DSL layers. Treating them as one project blows the scope and delays the structural fix.

**Assumes.** PDoD3 is *"no enum in framework-shared `types` slot, no Postgres-named symbol in framework public types,"* not *"users can write `Role.member` and the type system narrows."*

# Project Definition of Done

- [ ] **PDoD1.** All slices in `projects/contract-ir-planes/plan.md` delivered or explicitly deferred (in `projects/contract-ir-planes/deferred.md`).
- [ ] **PDoD2.** All in-tree contracts (`examples/*/src/prisma/contract.json` + all migration bookends + `test/fixtures/**`) follow the canonical shape: `contract.{domain, storage}.<ns>.<entityKind>.<entityName>`. Verified by `pnpm fixtures:check` and a shape-assertion test.
- [ ] **PDoD3.** Postgres enum emitted as a Postgres-pack-contributed entity at `contract.storage.<ns>.enum.<name>`. The framework-shared `storage.<ns>.types` slot no longer accepts enum entries (slot deleted as a load-bearing surface, or retained but typed against `never`). The IR class hierarchy shows the Postgres pack contributes the `'postgres-enum'` entity kind via `AuthoringContributions.entityTypes`. No hardcoded `'postgres-enum'` paths or codec-hook hacks remain in framework or SQL-family packages (audit: `rg "'postgres-enum'"` returns hits only in `packages/3-targets/3-targets/postgres/**` and `packages/3-targets/6-adapters/postgres/**`, plus the test fixtures that exercise the kind).
- [ ] **PDoD4.** Cross-namespace references everywhere use object pairs. `relation.to`, `model.base`, `roots[*]`, FK targets. Round-trip through serializer + deserializer preserves the shape. Verified by a serialization round-trip test on each shape.
- [ ] **PDoD5 (amended 2026-05-29).** Framework `Namespace` interface declares only `{ id, kind }`. SQL and Mongo family namespace types extend it with family-specific slots. The **cleanly-removable** subsumed helpers are deleted with a clean grep gate: `extractStorageElementNames`, `SqlNamespacePayload` / `MongoNamespacePayload`, `DEFAULT_NAMESPACES` (×2), `normaliseNamespaceEntry` (×2), and the framework canonicalizer's SQL-specific preserve-empty paths (replaced by a family hook).
  - **Deferred out of this project** (structural prerequisites; tracked in [`deferred.md`](./deferred.md)): `findSqlTable` + `assertUniqueSqlTableNames` (need `SqlModelStorage.table` promoted to a namespaced coordinate — `contract.json`-shape + hash regen), `stripNamespaceKinds` (needs `kind`-agnostic hashing), and the query-builder `UnboundTables<C>` (needs namespace-aware selection types — the `sql-builder` `UnboundTables` is correct and stays). The 2026-05-29 inventory established these are not deletions but structural changes; bundling them would make S1.D un-reviewably broad. The grep gate for this project covers only the symbols deleted above.
- [ ] **PDoD6.** Polymorphic free-function `elementCoordinates(storage)` walk implemented; planner diff, migration disjoint calc, validator collision checks consume it. Verified by replacing the existing per-consumer entity-lookup helpers and showing test green.
- [ ] **PDoD7.** `deserializeContract<T>(json): T` is generic at the family interface; the demo's `as unknown as typeof contract` cast is gone.
- [ ] **PDoD8.** `pnpm typecheck`, `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm fixtures:check`, `pnpm lint:deps` all clean.
- [ ] **PDoD9.** ADR `0001-contract-planes.md` accepted and migrated to `docs/architecture docs/adrs/`.
- [ ] **PDoD10 (amended 2026-05-29).** TML-2579 (closed by S1.D-2) and TML-2580 (closed by S1.D-3) marked Done. TML-2582 stays Canceled — its work (query-builder `UnboundTables` rewrite) is deferred (see [`deferred.md`](./deferred.md)) and re-ticketed when picked up; it is **not** a deliverable of this project.
- [ ] **PDoD11.** Long-lived docs migrated into `docs/`; `projects/contract-ir-planes/` deleted; repo-wide references to the project folder stripped.

# Functional Requirements

- **FR1.** Contract IR has two top-level planes: `contract.domain` and `contract.storage`. Each plane is indexed by namespace ID; each namespace contains entity-kind-keyed maps; each map contains entity-name-keyed instances.
- **FR2.** Entity coordinate `(namespaceId, entityKind, entityName)` addresses every IR entity uniquely. The free-function `elementCoordinates(storage)` walk yields the tuple stream generically.
- **FR3.** Cross-namespace references use object pairs (`{ namespace, model }` / `{ namespace, table, columns }`). No dot-qualified strings. No implicit same-namespace resolution.
- **FR4.** Framework `Namespace` interface exposes `{ id, kind }`. Family-specific slots (`tables`, `collections`) live on family-shaped namespace types.
- **FR5.** Target packs contribute new entity kinds through `AuthoringContributions.entityTypes`, supplying: storage-slot key, IR-class factory, serializer hydration factory, validator schema contribution.
- **FR6.** Postgres enum entries are stored at `contract.storage.<ns>.enum.<name>`. The framework-shared `storage.<ns>.types` slot does not accept enums.
- **FR7.** IR constructors accept only fully-constructed `Namespace` instances; no POJO normalisation, no default-singleton injection.
- **FR8.** Serializer omits `kind` from emitted JSON namespace entries. Deserializer resolves class identity from `(targetFamily, target)` + position + pack-contributed kind registry.
- **FR9.** `deserializeContract<T>(json): T` generic at the family interface.
- **FR10.** Framework canonicalizer contains no SQL-family-specific paths (family-contribution hook for preserve-empty slot paths).
- **FR11.** Both `storageHash` and `profileHash` recompute against the new shape for every in-tree contract.

# Non-Functional Requirements

- **NFR1.** No regression in `pnpm test:packages` runtime (currently ~minutes; restructure must not 2x it).
- **NFR2.** The `elementCoordinates(storage)` walk is O(entities) — no quadratic walks introduced.
- **NFR3.** Generated `contract.d.ts` files do not 2x in size — the new shape's nesting should be roughly size-neutral after the descriptor-driven type emission lands.

# Constraints + Assumptions

- **A1.** `AuthoringContributions.entityTypes` is the right substrate for `EntityKindDescriptor` registration; no new framework surface needed beyond extending what exists. Falsified if the surface turns out to lack hooks for serializer hydration or validator-schema contribution.
- **A2.** The PSL parser/printer's existing `enum {…}` hardcode is non-load-bearing for the structural defect — the defect lives in storage shape, not PSL grammar. Falsified if a downstream consumer (e.g. PSL emission of pack-contributed kinds with non-`enum` syntax) surfaces during execution.
- **A3.** SQLite's `PostgresEnumStorageEntry` import is structurally ugly but not user-visible; tolerating it for one more release is acceptable. Falsified if a Mongo or other target's compilation breaks due to the leaked Postgres symbol during the restructure (unlikely given the audit).
- **A4.** Pre-#534 on-disk migration bookends (6 files carrying `storage.types` with enums in document-scoped shape) are handled by the existing migration-replay path without requiring shape upgrades. Falsified if `pnpm fixtures:check` or migration-replay tests reject the old-shape bookends; mitigation = bookend regen pass added to Slice C.
- **A5.** Two `PG_ENUM_CODEC_ID` literals consolidate cleanly into one canonical owner during Slice A. Non-blocking if they don't; tolerated.
- **A6.** No external `@prisma-next/*` consumer is pinning specific `contract.json` shapes or hashes today. Falsified if EA users have started building tooling against the storage shape — would force a deprecation-window strategy instead of a hard cut.
- **A7.** The framework canonicalizer's family-contribution hook (TML-2579 cleanup absorbed by this project) is implementable without a circular dependency between framework-components and family packages. Falsified if the hook design needs framework to import family — would require a different mechanism (registration callback or similar).

# Open Questions

These are implementer degrees of freedom; settle during execution.

1. **Exact slot key naming.** Settled at *essence + singular* per artefact-review architect finding A08 (recorded 2026-05-21). Slot key for Postgres enum is **`enum`** (not `postgresEnums`, not `enums`). The slot key matches the entity-kind essence; the descriptor's `discriminator` (`'postgres-enum'`) carries the contributor identity. Singular form is future-compatible with a planned cleanup that retires the existing plural slots (`tables` → `table`, etc.) into the same convention; pack contributions don't pay the migration when that cleanup lands. ADR Decision 5 carries the rule. Future pack-contributed slot names (`policy`, `role`, `materializedView`, …) follow the same convention.
2. **Deprecation shim during migration window.** Whether `storage.<ns>.types` stays readable for one release (writes go to new slot) or hard-cut at restructure. Working position: **hard-cut** — A6 is the load-bearing assumption; if A6 holds, deprecation shim is wasted work.
3. **`EntityKindDescriptor` naming in code.** Extend `AuthoringEntityTypeDescriptor` (existing) vs introduce parallel `EntityKindDescriptor` concept. Working position: **extend the existing type** to avoid introducing a parallel concept.
4. **`elementCoordinates(storage)` return shape.** Plain array vs iterator vs typed stream. Working position: **iterator (`Generator<EntityCoordinate>`)** — large contracts shouldn't materialise the full coordinate list; iterator is cheap and consumers usually filter. **Settled in S1.A D1: free-function `elementCoordinates(storage): Generator<EntityCoordinate>`.**
5. **Validator-schema contribution mechanism.** How a pack's contributed kind plugs into the SQL-family validator's `NamespaceEntrySchema`. Working position: **descriptor carries an arktype schema fragment; framework assembles the namespace validator from the pack contributions at startup**. Alternative: descriptor carries a `validate(entry): ValidationResult` callback. Both work; the assembler shape is cleaner.

# References

- **Linear:** [TML-2584](https://linear.app/prisma-company/issue/TML-2584/restructure-contract-ir-into-two-planes-domain-storage-with-uniform)
- **Predecessor:** [TML-2520](https://linear.app/prisma-company/issue/TML-2520) — namespace exemplar; PR #534 merged at commit `66da80f96`
- **Sibling, independent:** [TML-2537](https://linear.app/prisma-company/issue/TML-2537) — target-contributed top-level PSL blocks; out of scope, follow-up
- **Subsumed Linear tickets** (close as duplicates on completion):
  - [TML-2579](https://linear.app/prisma-company/issue/TML-2579) — framework canonicalizer contains SQL-specific paths
  - [TML-2580](https://linear.app/prisma-company/issue/TML-2580) — replace `extractStorageElementNames` duck-typing with the free-function `elementCoordinates(storage)` walk
  - [TML-2582](https://linear.app/prisma-company/issue/TML-2582) — rename `UnboundTables<C>`
- **Follow-up:** [TML-2581](https://linear.app/prisma-company/issue/TML-2581) / [TML-2550](https://linear.app/prisma-company/issue/TML-2550) — namespace-aware DSL/ORM surface
- **Orthogonal:** [TML-2583](https://linear.app/prisma-company/issue/TML-2583) — historical migration re-baselining
- **Reference docs:**
  - [ADR 004 — Storage Hash vs Profile Hash](../../docs/architecture%20docs/adrs/ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md)
  - [Architecture Overview](../../docs/Architecture%20Overview.md)
  - This project's ADR: [`./adrs/0001-contract-planes.md`](./adrs/0001-contract-planes.md)
- **PR #534 review artifacts** that surfaced the asymmetries this project resolves:
  - [`projects/namespace-exemplar/reviews/pr-534/system-design-review.md`](../namespace-exemplar/reviews/pr-534/system-design-review.md)
  - [`projects/namespace-exemplar/reviews/pr-534/code-review.md`](../namespace-exemplar/reviews/pr-534/code-review.md)
  - [`projects/namespace-exemplar/reviews/pr-534/walkthrough.md`](../namespace-exemplar/reviews/pr-534/walkthrough.md)
- **Audit report** (2026-05-20): enum hardcoding blast radius — confirmed 50+ source files reference `PostgresEnumStorageEntry` directly; available in prior chat transcript for reference, not committed to disk.
