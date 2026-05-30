# ADR 221 — Contract IR is structured as two planes (`domain` and `storage`) with a uniform entity coordinate and a pack-contributed entity-kind mechanism

**Status:** Accepted
**Date:** 2026-05-20
**Tracking ticket:** [TML-2584](https://linear.app/prisma-company/issue/TML-2584/restructure-contract-ir-into-two-planes-domain-storage-with-uniform)

---

## Context

The contract IR was asymmetric. Storage was per-namespace (`contract.storage.namespaces.<ns>.tables.<name>`) but application concepts — `models`, `relations`, `valueObjects`, `types` — sat flat at the contract root. Two consequences this ADR resolves:

**Collision-realism mismatch.** A user can have `auth.user` and `public.user` as distinct tables; they could not have `auth.User` and `public.User` as distinct models, because the model lookup was global. The Supabase-style pattern of an `auth.User` from an auth namespace alongside an application-defined `public.User` was structurally blocked at the model layer even though it worked at the storage layer.

**Pack-contributed entities had no first-class place in the IR.** Postgres enum lived wedged into a framework-shared `storage.<ns>.types` slot whose payload type was `PostgresEnumStorageEntry` — a target name leaking into the SQL family base. The SQL family validator hardcoded the enum schema; the emitter hardcoded the `kind: 'postgres-enum'` literal in `contract.d.ts` codegen; **SQLite imported `PostgresEnumStorageEntry` by name** in four files just to spell out *"this target doesn't have enums."* Every future pack-contributed Postgres entity kind (RLS policies, roles, sequences, materialised views) would have followed the same hardcoded path absent this restructure.

This ADR captures the durable architectural decisions only.

---

## Decision

The contract IR is restructured around **two planes**, a **uniform per-plane namespace-scoped shape**, a **canonical entity coordinate**, and a **target-pack-contributed entity-kind mechanism**.

### Decision 1 — Two planes: `domain` and `storage`

The contract has exactly two top-level planes for entity content. `domain` carries application concepts the user defines: models, value objects, type aliases (codec bindings). `storage` carries the family-owned persistence projection: tables for SQL families, collections for Mongo, plus any target-pack-contributed entity kinds.

**Both planes are symmetric in extensibility.** Each plane ships a framework-baseline set of entity kinds (`domain`: `models` / `valueObjects` / `types`; `storage`: `tables` / `collections` per family) AND opens the same `AuthoringContributions.entityTypes` descriptor surface to target packs. A target pack contributing a domain-side kind (an analytics extension contributing `domain.<ns>.customerPersona`) goes through the same descriptor mechanism a storage-side kind does (Postgres pack contributing `storage.<ns>.enum`). The asymmetry that exists between the planes is *content* (`domain` is currently populated only with framework-known kinds because no pack contributes domain-side yet) and *target-portability* (`domain` kinds describe target-agnostic application concepts; `storage` kinds describe family-specific persistence projections) — not extensibility mechanism.

Storage is already structurally a plane in everything but name — [ADR 004](ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md) treats it as an independently-hashed, family-owned segment. This decision promotes that recognition into the IR shape and gives application content a peer name.

The framework / family ownership boundary becomes structural: framework code that names `storage.<...>.tables` is doing something wrong — `tables` is a family idiom and shouldn't appear at the framework layer. The same is true symmetrically for domain-side: a target pack that names `domain.<...>.customerPersona` from inside the framework would be the same kind of layering violation.

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
│       ├── enum         → { <enum_name> → PostgresEnumStorageEntry }       // Postgres pack-contributed
│       └── collections  → { <collection_name> → MongoCollection }          // Mongo family built-in
└── <global metadata>
    ├── target, targetFamily, schemaVersion
    ├── roots, capabilities, extensionPacks
    └── meta, execution, profileHash
```

One indexing pattern to learn; consumers can write generic walkers (`for (const ns of Object.keys(contract.domain)) for (const kind of …)`). The intermediate proposal of extending `storage.namespaces.<ns>.tables` to `contract.namespaces.<ns>.models` would have kept the `"namespaces"` segment at two levels conveying nothing extra; dropping it removes the redundancy.

### Decision 3 — Canonical entity coordinate `(plane, namespaceId, entityKind, entityName)`

Every IR entity is addressed by the tuple `(plane, namespaceId, entityKind, entityName)`. `plane` is `'domain' | 'storage'`. The framework exposes per-plane polymorphic free-function walks (`elementCoordinates(storage)`; `elementCoordinates(domain)` once domain content is populated) that yield these tuples generically across built-in and pack-contributed kinds. Each walk iterates each namespace's **own-enumerable properties structurally** — for every property whose value is a non-null entity-bearing map, the walk yields one tuple per entry, where `entityKind` is the property name and `plane` is constant for the walk's input. `id` is skipped as a known scalar; `kind` is non-enumerable per the IR-class pattern and auto-skips. The walk needs no up-front knowledge of which entity kinds each namespace kind holds — contract hydration (family-specific) has already enforced the structural shape; the walk's job is enumeration, not validation. The invariant the structural walk relies on (namespace concretions carry `id` + non-enumerable `kind` + entity-kind slot maps and nothing else) is declared in the framework `Namespace` interface JSDoc.

The `plane` axis is encoded on the coordinate (rather than partitioned across separate per-plane coordinate types) so cross-plane consumers — most importantly, the domain → storage directional reference invariant — can address either side through a single tuple type. The invariant itself (`from.plane === 'storage'` referencing `to.plane === 'domain'` is forbidden; the other direction is allowed) is a separate validator, not encoded in the coordinate shape; the coordinate carries the *axis* the validator checks.

The walk is deliberately a free function rather than a member of the `Storage` interface — adding a required method to `Storage` would propagate into every structural `Contract<SqlStorage>` consumer's storage literal (most importantly emitted `contract.d.ts` files, which print storage as plain object types with no method members), cascading byte-stability breakage through every committed fixture. The free function consumes any `Storage`-shaped value and preserves structural assignability for emitted artefacts.

Every IR consumer — migration disjoint calculation, planner diffing, validator collision checks, cross-plane references — addresses entities by this coordinate.

Without a canonical coordinate, every consumer reinvents what *"same entity"* means: the prior codebase had `findSqlTable(contract, name)` global scans, mixed `(namespaceId, tableName)` pairs, string-keyed flat lookups, and a duck-typed `extractStorageElementNames` helper. Disagreements between these consumers ship as bugs in disjoint calculation (the migration planner must know two operations target the same entity; if one consumer thinks "name only" identifies the entity and another thinks "(namespace, name)" identifies it, the diff is wrong).

The kind is part of the coordinate, not derived from the entity-instance type — this matters when consumers diff JSON envelopes without rehydrating to classes first, and when packs contribute kinds with overlapping name conventions.

### Decision 4 — Cross-references encoded as object pairs

Every cross-namespace reference carries `{ namespace, model }` (or `{ namespace, table, columns }` for storage-plane references). Consistent with the `ForeignKey.target.{namespaceId, tableName, columns}` shape the namespace exemplar (PR #534) already shipped.

```jsonc
{ "namespace": "auth", "model": "User" }                                 // relation.to, model.base, roots[*]
{ "namespaceId": "auth", "tableName": "user", "columns": [...] }         // FK references
```

No dot-qualified strings (`"auth.User"` requires split-on-dot at every consumer, forbids dots in entity names, introduces escape-character edge cases). No implicit same-namespace resolution (forces every consumer to handle both implicit and explicit variants).

The authoring DSL takes entity handles (`rel.belongsTo(User, …)`) so users never type the object pair themselves. The encoding is an IR-on-the-wire choice.

### Decision 5 — Pack-contributed entity-kind mechanism

Target packs contribute new entity kinds through the framework-level `AuthoringContributions.entityTypes` surface, extended to carry an IR-class factory (the existing `output.factory`), a serializer hydration callback (`hydrate?`), and a validator schema fragment (`validatorSchema?`) on a single descriptor. The descriptor's existing `discriminator` field (the kind's `kind:` literal in the IR envelope, e.g. `'postgres-enum'`) is the **single coordinate** the family base's hydration registry and the family validator's composition surface both key on. No separate slot-key field — the property name on the namespace envelope where entries land is purely a hydration-iteration concern that the family base handles structurally: it knows its built-in slots (`tables` for SQL, `collections` for Mongo), hydrates those through hardcoded family construction, and dispatches every other entity-bearing property's entries through the kind-keyed registry.

**Slot-key naming convention.** Pack-contributed slot keys are named by **kind essence in singular form** (e.g. `enum`, `policy`, `role`, `materializedView`), not by *who contributed them* (`postgresEnums`, `postgresPolicies`) and not by plural-collection convention (`enums`, `policies`). Two reasons. (a) The slot key reads as the entity kind — `for (const [enumName, enumEntry] of Object.entries(ns.enum))` matches the discriminator (`'postgres-enum'`) without prefix-encoding the pack that contributed it. A future SQLite enum emulation contributes to the same slot via a different discriminator. (b) Singular form is future-compatible with a planned cleanup that retires the existing plural slot names (`tables` → `table`, `collections` → `collection`) into the same convention; pack contributions don't need to migrate when the cleanup lands. The existing framework-baseline plural slots stay plural for now; their rename is deferred to a separate cleanup ticket.

Framework-known built-ins (`tables` for SQL families, `collections` for Mongo) stay hardcoded inside each family-pack — they guarantee a stable family-shape contract for consumers, and retrofitting them onto the descriptor mechanism is a large job that delivers no user value. The dual-surface (hardcoded built-ins + descriptor-driven contributed kinds) is **deliberate paid debt**; it could be migrated later if a concrete need emerges.

The descriptor mechanism is the only typology that satisfies both *"framework-level contribution surface"* (so authoring tools — PSL interpreter, TS DSL, emitter — see the contribution) and *"no Postgres-named symbol in the framework or sibling-target packages."* The cheapest alternative considered — keeping enum hardcoded but moving the hardcode from framework into the Postgres pack — leaves the slot name leaking into framework authoring-tool dispatch, defeating the architect-lens decision.

**Rejected alternative (M) — `storageSlotKey?` field on the descriptor.** An earlier iteration shipped this alternative: descriptors carried a separate `storageSlotKey?` field naming the namespace property the kind's entries land on, and the family serializer base kept a parallel `namespaceSlotHydrationRegistry: Map<storageSlotKey, hydrate>` alongside the existing `entityTypeRegistry: Map<kind, factory>`, plus a `FamilyDescriptor.reservedStorageSlotKeys` list and a slot-name collision validator. It was retired because: (a) `storageSlotKey` carried no information `discriminator` didn't already carry for every entry the registry hydrated; (b) the parallel registry doubled the hydration test surface for zero invariant the single registry didn't already enforce; (c) `reservedStorageSlotKeys` was a framework-layer table redundantly encoding what contract hydration's structural validation already enforced. The corrective is the present Decision 5 shape — single descriptor field set (`discriminator` keys both registries), single registry keyed on `discriminator`, no `reservedStorageSlotKeys`, no collision validator.

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

### Negative

- **Universal hash changes.** Every in-tree contract's `storageHash` AND `profileHash` shift. Every fixture regenerates.
- **Wide-blast-radius migration.** Every `contract.models[name]` call site becomes `contract.domain[ns].models[name]`. ~50 source files touched, plus ~10 on-disk `contract.json` files.
- **Coordinated reference-encoding rename.** `relation.to`, `model.base`, `roots[*]` all change from `"ModelName"` to `{ namespace, model }`. Authoring DSL takes handles so users don't see the change; emitted contract shape changes for every reference site.
- **`contract.d.ts` shape change.** Downstream TypeScript inference of `Db<C>` and friends rewires.
- **Both family serializers rewrite.** `PostgresContractSerializer` and `MongoTargetContractSerializer` both restructure serialize / deserialize / hydrate.
- **Dual-surface for entity kinds.** Built-ins hardcoded + contributed kinds via descriptor is a deliberate paid debt; future contributors must understand which surface their work belongs on.

### Neutral

- **Landed as a sequence of focused PRs**, each a reviewable unit, rather than a single monolithic change.
- **External pack authors notified once.** This is a breaking change for `@prisma-next/*` consumers; documented per the repo's `record-upgrade-instructions` protocol.

---

## Alternatives considered

### A. Status quo (do nothing; accept asymmetry)

**Rejected.** The collision-realism gap (`auth.User` + `public.User` blocked) and the typology defect (framework code naming family idioms) compound: every new feature has to decide whether to follow the storage namespace shape or the flat model shape.

### B. Per-axis namespacing (`contract.models[ns][name]`, `contract.valueObjects[ns][name]`, …)

**Rejected.** Visually noisy at top-level; no family-ownership boundary. Querying "everything in namespace X" still walks each axis independently.

### C. Single per-namespace container (`contract.namespaces[ns].{ models, tables, types, … }`)

**Rejected.** Couples domain and storage into one container; loses the framework / family ownership boundary. Family slots (`tables`, `collections`) live next to framework slots (`models`, `valueObjects`) under the same per-namespace key, blurring layer responsibility.

### D. Three planes (`domain` + `storage` + a shared bridge for cross-plane references)

**Rejected.** Overcomplicates. The "codecs straddle the line" intuition is solved by references (Decision 4), not by a third plane.

### E. Dot-qualified strings for cross-references (`relation.to: "auth.User"`)

**Rejected.** Cheap to read; expensive at every consumer (see Decision 4 reasoning).

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

### L. Bolt the reshape onto the namespace exemplar (PR #534)

**Rejected at shaping time.** PR #534 was 121 commits / 437 files. Adding the reshape on top would have turned it into an unreviewable monolith. Landing PR #534 first also let the namespace exemplar prove itself in `main` before sitting under a structural reshape.

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
- **TML-2581** / **TML-2550** — namespace-aware DSL surface. Natural follow-up; not blocked by this ADR but cheaper to build on top: `db.auth.User` reads `domain.auth.models.User` directly with no flat-by-name collapse to invert.

---

## References

- Predecessor PR: [#534](https://github.com/prisma/prisma-next/pull/534) (TML-2520), merged at commit `66da80f96`
- [ADR 004 — Storage Hash vs Profile Hash](ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md)
- [Architecture Overview](../../Architecture%20Overview.md)
