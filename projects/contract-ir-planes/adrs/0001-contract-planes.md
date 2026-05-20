# ADR 0001 — Contract IR is structured as two planes (`domain` and `storage`) with a uniform entity coordinate and a pack-contributed entity-kind mechanism

**Status:** Proposed
**Date:** 2026-05-20
**Project:** [`contract-ir-planes`](../spec.md)
**Tracking ticket:** [TML-2584](https://linear.app/prisma-company/issue/TML-2584/restructure-contract-ir-into-two-planes-domain-storage-with-uniform)

> _This ADR lives under the project's `adrs/` while shaping. Migrates to `docs/architecture docs/adrs/` at project close-out._

---

## Context

The contract IR today is asymmetric. Storage is per-namespace (`contract.storage.namespaces.<ns>.tables.<name>`) but application concepts — `models`, `relations`, `valueObjects`, `types` — sit flat at the contract root. Two consequences this ADR exists to resolve:

**Collision-realism mismatch.** A user can have `auth.user` and `public.user` as distinct tables; they cannot have `auth.User` and `public.User` as distinct models. The model lookup is global. The Supabase-style pattern of an `auth.User` from an auth namespace alongside an application-defined `public.User` is structurally blocked at the model layer even though it works at the storage layer.

**Pack-contributed entities have no first-class place in the IR.** Postgres enum lives wedged into a framework-shared `storage.<ns>.types` slot whose payload type is `PostgresEnumStorageEntry` — a target name leaking into the SQL family base. The SQL family validator hardcodes the enum schema; the emitter hardcodes the `kind: 'postgres-enum'` literal in `contract.d.ts` codegen; **SQLite imports `PostgresEnumStorageEntry` by name** in four files just to spell out *"this target doesn't have enums."* Every future pack-contributed Postgres entity kind (RLS policies, roles, sequences, materialised views) would follow the same hardcoded path absent this restructure.

The full project context, audit, scope decisions (Tier 1 only — no user-facing affordances), and load-bearing assumptions live in [`spec.md`](../spec.md). This ADR captures the durable architectural decisions only.

---

## Decision

The contract IR is restructured around **two planes**, a **uniform per-plane namespace-scoped shape**, a **canonical entity coordinate**, and a **target-pack-contributed entity-kind mechanism**.

### Decision 1 — Two planes: `domain` and `storage`

The contract has exactly two top-level planes for entity content. `domain` carries application concepts the user defines: models, value objects, type aliases (codec bindings). `storage` carries the family-owned persistence projection: tables for SQL families, collections for Mongo, plus any target-pack-contributed entity kinds.

Storage is already structurally a plane in everything but name — [ADR 004](../../../docs/architecture%20docs/adrs/ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md) treats it as an independently-hashed, family-owned segment. This decision promotes that recognition into the IR shape and gives application content a peer name.

The framework / family ownership boundary becomes structural: framework code that names `storage.<...>.tables` is doing something wrong — `tables` is a family idiom and shouldn't appear at the framework layer.

### Decision 2 — Uniform shape: `<plane>.<namespaceId>.<entityKind>.<entityName>`

Both planes use identical indexing. Top-level keys under each plane are namespace IDs; under each namespace are entity-kind-keyed maps; under each kind are entity-name-keyed instances. The word `"namespaces"` does not appear as an IR segment.

```text
contract
├── domain
│   └── <namespaceId>
│       ├── models       → { <ModelName> → ContractModel }
│       ├── valueObjects → { <ValueObjectName> → ContractValueObject }
│       └── types        → { <TypeAliasName> → ContractTypeAlias }
├── storage
│   └── <namespaceId>
│       ├── tables       → { <table_name> → StorageTable }                  // SQL family built-in
│       ├── postgresEnums → { <enum_name> → PostgresEnumStorageEntry }      // Postgres pack-contributed
│       └── collections  → { <collection_name> → MongoCollection }          // Mongo family built-in
└── <global metadata>
    ├── target, targetFamily, schemaVersion
    ├── roots, capabilities, extensionPacks
    └── meta, execution, profileHash
```

One indexing pattern to learn; consumers can write generic walkers (`for (const ns of Object.keys(contract.domain)) for (const kind of …)`). The intermediate proposal of extending `storage.namespaces.<ns>.tables` to `contract.namespaces.<ns>.models` keeps the `"namespaces"` segment at two levels conveying nothing extra; dropping it removes the redundancy.

### Decision 3 — Canonical entity coordinate `(namespaceId, entityKind, entityName)`

Every IR entity is addressed by the tuple `(namespaceId, entityKind, entityName)`. The `Storage` interface exposes a polymorphic `elementCoordinates()` walk that yields these tuples generically across built-in and pack-contributed kinds. Every IR consumer — migration disjoint calculation, planner diffing, validator collision checks, cross-plane references — addresses entities by this coordinate.

Without a canonical coordinate, every consumer reinvents what *"same entity"* means: today's codebase has `findSqlTable(contract, name)` global scans, mixed `(namespaceId, tableName)` pairs, string-keyed flat lookups, and the duck-typed `extractStorageElementNames` helper. Disagreements between these consumers ship as bugs in disjoint calculation (the migration planner must know two operations target the same entity; if one consumer thinks "name only" identifies the entity and another thinks "(namespace, name)" identifies it, the diff is wrong).

The kind is part of the coordinate, not derived from the entity-instance type — this matters when consumers diff JSON envelopes without rehydrating to classes first, and when packs contribute kinds with overlapping name conventions.

### Decision 4 — Cross-references encoded as object pairs

Every cross-namespace reference carries `{ namespace, model }` (or `{ namespace, table, columns }` for storage-plane references). Consistent with the `ForeignKey.target.{namespaceId, tableName, columns}` shape PR #534 already shipped.

```jsonc
{ "namespace": "auth", "model": "User" }                                 // relation.to, model.base, roots[*]
{ "namespaceId": "auth", "tableName": "user", "columns": [...] }         // FK references
```

No dot-qualified strings (`"auth.User"` requires split-on-dot at every consumer, forbids dots in entity names, introduces escape-character edge cases). No implicit same-namespace resolution (forces every consumer to handle both implicit and explicit variants).

The authoring DSL takes entity handles (`rel.belongsTo(User, …)`) so users never type the object pair themselves. The encoding is an IR-on-the-wire choice.

### Decision 5 — Pack-contributed entity-kind mechanism

Target packs contribute new entity kinds through the framework-level `AuthoringContributions.entityTypes` surface, extended to carry the storage-slot key, IR-class factory, serializer hydration registration, and validator schema contribution as a single descriptor.

Framework-known built-ins (`tables` for SQL families, `collections` for Mongo) stay hardcoded inside each family-pack — they guarantee a stable family-shape contract for consumers, and retrofitting them onto the descriptor mechanism is a large job that delivers no user value. The dual-surface (hardcoded built-ins + descriptor-driven contributed kinds) is **deliberate paid debt**; it could be migrated later if a concrete need emerges.

The descriptor mechanism is the only typology that satisfies both *"framework-level contribution surface"* (so authoring tools — PSL interpreter, TS DSL, emitter — see the contribution) and *"no Postgres-named symbol in the framework or sibling-target packages."* The cheapest alternative considered — keeping enum hardcoded but moving the hardcode from framework into the Postgres pack — leaves the slot name leaking into framework authoring-tool dispatch, defeating the architect-lens decision.

### Decision 6 — Framework `Namespace` interface narrowed

The framework's `Namespace` interface declares only `{ id, kind }`. Family-specific slots move to family-shaped namespace types — `SqlNamespace = Namespace & { tables: …, [...packContributedSlots] }`, `MongoNamespace = Namespace & { collections: … }`. The framework is honest about what it knows.

IR constructors accept only fully-constructed `Namespace` instances. No POJO normalisation in the IR; no default-singleton injection; no `instanceof` brand checks. All convenience lives in the authoring layer (where user input becomes IR) and the serialization layer (where IR becomes JSON and back, with class identity resolved by the family serializer from `(targetFamily, target)` + position + pack-contributed kind registry).

---

## Consequences

### Positive

- **Symmetric IR.** Collision-realism applies uniformly: `auth.User` + `public.User` works the same way `auth.user` + `public.user` works.
- **One indexing pattern to learn.** Every consumer reaches for `contract.<plane>.<ns>.<entityKind>.<entityName>`. Generic walkers possible.
- **Canonical entity coordinate replaces a flotilla of ad-hoc identity helpers.** `findSqlTable`, `assertUniqueSqlTableNames`, `extractStorageElementNames` all delete; migration disjoint calc, planner diff, and validator collision checks consume a single tuple.
- **Framework / family boundary explicit in the IR.** `domain` is framework-shaped; `storage` is family-owned. Layering violations become structurally visible.
- **Pack-contributed kinds are a first-class concept.** Adding RLS policies, roles, sequences, materialised views, or any future Postgres-only entity kind is one descriptor registration; the framework dispatches generically.
- **Subsumes existing cleanup tickets.** [TML-2579](https://linear.app/prisma-company/issue/TML-2579), [TML-2580](https://linear.app/prisma-company/issue/TML-2580), [TML-2582](https://linear.app/prisma-company/issue/TML-2582) all fall out as natural consequences of the reshape.
- **[TML-2581](https://linear.app/prisma-company/issue/TML-2581) / [TML-2550](https://linear.app/prisma-company/issue/TML-2550) (namespace-aware DSL surface) becomes cheaper.** `db.auth.User` reads `domain.auth.models.User` directly; no flat-by-name collapse to invert.

### Negative

- **Universal hash changes.** Every in-tree contract's `storageHash` AND `profileHash` shift. Every fixture regenerates.
- **Wide-blast-radius migration.** Every `contract.models[name]` call site becomes `contract.domain[ns].models[name]`. Audit-confirmed ~50 source files touched, plus ~10 on-disk contract.json files.
- **Coordinated reference-encoding rename.** `relation.to`, `model.base`, `roots[*]` all change from `"ModelName"` to `{ namespace, model }`. Authoring DSL takes handles so users don't see the change; emitted contract shape changes for every reference site.
- **`contract.d.ts` shape change.** Downstream TypeScript inference of `Db<C>` and friends rewires.
- **Both family serializers rewrite.** `PostgresContractSerializer` and `MongoTargetContractSerializer` both restructure serialize / deserialize / hydrate.
- **Dual-surface for entity kinds.** Built-ins hardcoded + contributed kinds via descriptor is a deliberate paid debt; future contributors must understand which surface their work belongs on.

### Neutral / project-discipline

- **Lands as a sequence of focused PRs** under [`projects/contract-ir-planes/`](../). The project plan ([`projects/contract-ir-planes/plan.md`](../plan.md)) sequences the work.
- **External pack authors notified once.** This is a breaking-change for `@prisma-next/*` consumers; documented per the repo's `record-upgrade-instructions` protocol when the project lands.

---

## Alternatives considered

### A. Status quo (do nothing; accept asymmetry)

**Rejected.** The collision-realism gap (`auth.User` + `public.User` blocked) and the typology defect (framework code naming family idioms) compound: every new feature has to decide whether to follow the storage namespace shape or the flat model shape. The cleanup work surfaced by PR #534's review is permanent debt unless the underlying shape is corrected.

### B. Per-axis namespacing (`contract.models[ns][name]`, `contract.valueObjects[ns][name]`, …)

**Rejected.** Visually noisy at top-level; no family-ownership boundary. Querying "everything in namespace X" still walks each axis independently.

### C. Single per-namespace container (`contract.namespaces[ns].{ models, tables, types, … }`)

**Rejected.** Couples domain and storage into one container; loses the framework / family ownership boundary. Family slots (`tables`, `collections`) live next to framework slots (`models`, `valueObjects`) under the same per-namespace key, blurring layer responsibility.

### D. Three planes (`domain` + `storage` + a shared bridge for cross-plane references)

**Rejected.** Overcomplicates. The "codecs straddle the line" intuition is solved by references (D4), not by a third plane.

### E. Dot-qualified strings for cross-references (`relation.to: "auth.User"`)

**Rejected.** Cheap to read; expensive at every consumer (see D4 reasoning).

### F. Implicit same-namespace + explicit override

**Rejected.** Optimises the common case; introduces asymmetric IR shape every consumer has to handle.

### G. Hardcoded slot per pack-contributed kind (no descriptor mechanism)

**Rejected.** Leaves the slot name leaking into framework authoring-tool dispatch (PSL interpreter, TS DSL, emitter all walk the storage shape). The framework would still have to "know" about each pack-contributed slot somewhere.

### H. Single generic `storage.<ns>.entities.<kind>.<name>` slot (no per-kind slot names)

**Rejected.** Kinds carry their own discriminator field; framework walks a uniform map. Loses the typed `contract.d.ts` emission story — every consumer of the emitted types would have to narrow on the discriminator instead of getting the kind in the type path.

### I. Retrofit `tables` / `collections` onto descriptor mechanism

**Rejected.** Cost-disproportionate. The built-ins work; the descriptor mechanism's value is in extensibility, not in retrofitting stable surfaces.

### J. `(namespaceId, entityName)` coordinate; derive kind from instance type

**Rejected.** Loses uniqueness when packs contribute kinds with overlapping name conventions; couples the coordinate to runtime IR-class identity (consumers diffing from JSON envelopes can't dispatch without rehydrating).

### K. Three-segment string ID (`auth/postgres-enum/user_role`) as coordinate

**Rejected.** Same separator-collision concerns as dot-qualified-string references (rejected in E for the same reasons).

### L. Bolt the reshape onto PR #534

**Rejected at project shaping time.** PR #534 was 121 commits / 437 files. Adding the reshape on top turns it into an unreviewable monolith. Landing PR #534 first also lets the namespace exemplar prove itself in `main` before sitting under a structural reshape.

---

## Migration

External consumers (`@prisma-next/*` and extension pack authors) experience this as a **breaking change in the IR shape**:

- `contract.json` shape changes universally (root keys, namespace nesting, reference encoding, pack-contributed entity-kind slot names).
- `contract.d.ts` shape changes; TypeScript downstream may not type-check until updated.
- Both `storageHash` and `profileHash` change for every existing contract.

The reshape ships with a recorded upgrade recipe per the repo's `record-upgrade-instructions` protocol. The recipe captures the IR shape transformation (visual diff: before → after), the TypeScript downstream changes (handle-based authoring stays the same; programmatic IR-walking changes shape), and the hash-impact summary.

---

## Related decisions

- **TML-2520 / PR #534** — established `ForeignKey.target.{namespaceId, tableName, columns}` as the cross-namespace reference shape. This ADR generalises that pattern.
- **TML-2537** — target-contributed top-level PSL blocks. Independent of this ADR but related; this ADR defines the entity-kind contribution mechanism (storage IR + serializer + validator), TML-2537 defines the syntax-contribution mechanism (PSL block grammar). Both share `AuthoringContributions` as the substrate.
- **TML-2581** / **TML-2550** — namespace-aware DSL surface. Natural follow-up; not blocked by this ADR but cheaper to build on top.
- **`postgres-enum-finishing` project** — consumes this ADR's substrate to ship first-class enum authoring affordances (typed value references, `db.enums.X`, codec narrowing).

---

## References

- Project spec: [`projects/contract-ir-planes/spec.md`](../spec.md)
- Predecessor PR: [#534](https://github.com/prisma/prisma-next/pull/534) (TML-2520), merged at commit `66da80f96`
- [ADR 004 — Storage Hash vs Profile Hash](../../../docs/architecture%20docs/adrs/ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md)
- [Architecture Overview](../../../docs/Architecture%20Overview.md)
- PR #534 review artifacts that surfaced the gaps this ADR resolves:
  - [`projects/namespace-exemplar/reviews/pr-534/system-design-review.md`](../../namespace-exemplar/reviews/pr-534/system-design-review.md)
  - [`projects/namespace-exemplar/reviews/pr-534/code-review.md`](../../namespace-exemplar/reviews/pr-534/code-review.md)
