# ADR 0001 — Contract IR is structured as two planes (`domain` and `storage`) with a uniform per-plane namespace coordinate system

**Status:** Proposed
**Date:** 2026-05-19
**Project:** [`contract-ir-planes`](../spec.md)
**Tracking ticket:** [TML-2584](https://linear.app/prisma-company/issue/TML-2584/restructure-contract-ir-into-two-planes-domain-storage-with-uniform)
**Predecessor work:** [TML-2520](https://linear.app/prisma-company/issue/TML-2520) (namespace exemplar; PR #534)

> _This ADR lives under the project's `adrs/` while shaping. Migrates to `docs/architecture docs/adrs/` at project close-out per `drive/calibration/dod.md § ADR audit`._

---

## Context

### Prior art: storage is already a plane in everything but name

[ADR 004 — Storage Hash vs Profile Hash](../../../docs/architecture%20docs/adrs/ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md) already treats the contract's `storage` section as an independently-hashed, family-owned segment:

> `storageHash` is computed from a canonicalized object that includes: `schemaVersion`, `targetFamily`, `target`, `storage`. It intentionally excludes `models`, `relations`, `capabilities`, `extensionPacks`, and `meta`.

In other words: storage is already structurally treated as a self-contained section of the contract, with its own identity (the `storageHash`), its own consumer (the family-specific serializer + planner), and its own evolution rules (changes to storage invalidate migrations; changes elsewhere don't). The application-side content (`models`, `relations`, `valueObjects`, `types`, `roots`) doesn't get the same treatment — it sits as a flat collection of root-level keys, with no name for the segment as a whole.

This ADR promotes the existing recognition into the IR shape and gives the application-side content a peer name: the `domain` plane.

### What the namespace-exemplar work (TML-2520, PR #534) shipped

PR #534 introduced `storage.namespaces[id]` as the only site where storage entities live. Tables, postgres-enums, and the qualifier-emission logic are all namespace-scoped within the storage section. Cross-namespace FKs are first-class via `ForeignKey.target.{namespaceId, tableName, columns}`. PSL gained `namespace { … }` blocks; the TS builder gained `namespaces` and per-model `namespace`.

The work left the IR **namespace-asymmetric**:

| Section | Shape after PR #534 |
| --- | --- |
| `storage` | `storage.namespaces[ns].tables[name]` — namespace-scoped |
| `models`, `relations`, `valueObjects`, `types`, `roots` | flat at contract root — *not* namespace-scoped |

Two consequences surfaced during PR #534's review:

1. **Collision-realism mismatch.** A user can have `auth.user` and `public.user` as distinct tables; they cannot have `auth.User` and `public.User` as distinct models. The model-name lookup is global. The standard multi-tenant pattern (a Supabase-style `auth.User` alongside an application-defined `public.User`) is structurally blocked at the model layer even though it works at the storage layer.
2. **Code at every consumer reinvents "find by name across namespaces."** Helpers like `findSqlTable(contract, tableName)` exist because the storage shape has namespaces and the model shape doesn't, so the layer that bridges them has to do an O(namespaces × tables) scan and assert uniqueness. The framework canonicalizer carries SQL-specific paths because it has to preserve empty storage namespaces (a family concept the framework conceptually doesn't know about). The `SqlNamespacePayload` shim, the `DEFAULT_NAMESPACES` constant, the `instanceof NamespaceBase` brand check, and the `stripNamespaceKinds` workaround are all direct expressions of the asymmetry leaking into framework-shaped code.

### How the structural shape was chosen

A discussion-mode design session on 2026-05-19 (architect + principal-engineer lenses, sequenced) walked through candidate shapes for extending the namespace concept to the rest of the contract — per-axis namespacing, a single per-namespace container, two planes with a uniform shape, and a few others. The full set with rejection reasons is recorded in § Alternatives considered below. The session converged on **two planes with a uniform `<plane>.<ns>.<slot>` shape** as the accepted decision.

The principal-engineer lens additionally flagged the blast radius (every `contract.models[…]` index site in the codebase, both contract hashes change universally, both family serializers rewrite) and recommended landing this as a separate project rather than bolting it onto the in-flight namespace-exemplar PR. The structural and operational lenses converged on the same answer.

---

## Decision

The contract IR is restructured around **two planes** with **uniform indexing**:

### Top-level shape

```text
contract
├── domain
│   └── <namespaceId>
│       ├── models
│       │   └── <ModelName> → ContractModel
│       ├── valueObjects
│       │   └── <ValueObjectName> → ContractValueObject
│       └── types
│           └── <TypeAliasName> → ContractTypeAlias
├── storage
│   └── <namespaceId>
│       ├── tables        // SQL family
│       │   └── <table_name> → StorageTable
│       ├── types         // SQL family (DDL-level types: postgres-enum, etc.)
│       │   └── <type_name> → StorageType
│       └── collections   // Mongo family
│           └── <collection_name> → MongoCollection
└── <global metadata>
    ├── target, targetFamily, schemaVersion
    ├── roots, capabilities, extensionPacks
    └── meta, execution, profileHash
```

### Plane charters

- **`domain` plane** carries the application concepts the user defines: models, value objects, type bindings (codec aliases). Target-agnostic shape. The DSL/ORM reads from this plane at runtime. The authoring DSL emits into this plane.
- **`storage` plane** is **family-owned** and describes how domain concepts project onto persistence. Slot shape is family-specific (`tables` + `types` for SQL; `collections` for Mongo). The framework knows the plane exists; it knows nothing about the slot shapes inside.

### Cross-references

Every cross-namespace reference encoded as an **object pair**:

```jsonc
{ "namespace": "auth", "model": "User" }     // relation.to, model.base, roots[*]
{ "namespaceId": "auth", "tableName": "user", "columns": [...] }  // FK references (already shipped)
```

No dot-qualified strings. No implicit same-namespace resolution. Consistent with the FK shape TML-2520 already shipped.

### Namespace coordinate identity

The `<namespaceId>` key appears in both planes. Domain namespace `auth` projects to storage namespace `auth`. In persistence systems without native namespaces (sqlite, single-database Mongo), domain namespaces project to the `__unbound__` storage namespace. The framework validator asserts that every storage namespace has a corresponding domain namespace and vice versa.

### Framework `Namespace` interface

Narrowed to `{ id, kind }`. Family-specific slots (`tables`, `collections`) move to family-shaped namespace types (`SqlNamespace = Namespace & { tables: …, types?: … }`, `MongoNamespace = Namespace & { collections: … }`). The framework is honest about what it knows.

### IR construction discipline

IR constructors accept only fully-constructed `Namespace` instances. No POJO normalisation in the IR; no default-singleton injection; no `instanceof` brand checks. All convenience lives in the **authoring layer** (where user input becomes IR) and the **serialization layer** (where IR becomes JSON and back, with class identity resolved by the family serializer from `(targetFamily, target)` + position).

---

## Consequences

### Positive

- **Symmetric IR.** Collision-realism applies uniformly: `auth.User` + `public.User` works the same way `auth.user` + `public.user` works.
- **One indexing pattern to learn.** Every consumer reaches for `contract.<plane>.<ns>.<slot>`. Generic walkers possible: `for (const ns of Object.keys(contract.domain)) walk(contract.domain[ns].models)`.
- **Framework / family boundary explicit in the IR.** `domain` is framework-shaped; `storage` is family-owned. Layering violations become structurally visible: framework code that names `storage.<…>.tables` is doing something wrong.
- **Subsumes existing follow-up work.** Three tickets filed against the predecessor PR to track individual smells — TML-2579 (framework canonicalizer contains SQL-specific paths), TML-2580 (replace `extractStorageElementNames` duck-typing with `Storage.elementCoordinates()`), TML-2582 (rename `UnboundTables<C>`) — and the broader cleanup pass originally scoped as a follow-up branch all fall out as natural consequences of the reshape. No separate work needed; each ticket closes as a duplicate of this project.
- **TML-2581 (namespace-aware DSL surface) becomes cheaper.** `db.auth.User` reads `domain.auth.models.User` directly; no flat-by-name collapse to invert.

### Negative

- **Universal hash changes.** Every in-tree contract's `storageHash` AND `profileHash` shift. Every fixture regenerates. Every descriptor-self-consistency check sees new hashes.
- **93+ call-site migration.** Every site doing `contract.models[name]` becomes `contract.domain[ns].models[name]`. Mechanical but wide-blast-radius.
- **Coordinated reference-encoding rename.** `relation.to`, `model.base`, `roots[*]` all change from `"ModelName"` to `{ namespace, model }`. Authoring DSL takes handles so users don't see the change; emitted contract shape changes for every reference site.
- **`contract.d.ts` shape change.** Downstream TypeScript inference of `Db<C>` and friends rewires.
- **Both family serializers rewrite.** `PostgresContractSerializer` and `MongoTargetContractSerializer` both restructure their serialize / deserialize / hydrate paths.
- **Codec-alias redeclaration in multi-namespace contracts.** Two namespaces both wanting `Embedding1536 = pgvector.Vector(1536)` declare it twice (or use a cross-namespace reference — solved as needed). Verbosity accepted as the price of uniform shape.

### Neutral / project-discipline

- **One PR's worth of work is unrealistic.** Lands as a sequence of focused PRs under a single project (`projects/contract-ir-planes/`). The project's plan (drafted next) sequences the work.
- **External pack authors are notified once.** This is a breaking-change for `@prisma-next/*` consumers; documented per the repo's `record-upgrade-instructions` protocol when the project lands.

---

## Alternatives considered

### A. Status quo (do nothing; accept asymmetry)

**Rejected.** The asymmetry is a known correctness gap (`auth.User` + `public.User` blocked) and a known typology defect (framework code naming family idioms). The cost compounds: every new feature on the contract has to decide whether to follow the storage namespace shape or the flat model shape. The cleanup work surfaced by PR #534's review is permanent debt unless the underlying shape is corrected.

### B. Apply per-axis namespacing (`contract.models[ns][name]`, `contract.valueObjects[ns][name]`, …)

**Rejected.** Visually noisy at top-level (three independent per-namespace registries, each evolving separately); doesn't introduce the family-ownership boundary the `domain` / `storage` planes give us. Code that wants to "ask the contract about everything in namespace X" still has to query each axis independently.

### C. Single per-namespace container (`contract.namespaces[ns].{ models, tables, types, … }`)

**Rejected.** Couples domain and storage into one container; loses the framework / family ownership boundary. Family slots (`tables`, `collections`) live next to framework slots (`models`, `valueObjects`) under the same per-namespace key, blurring the layer responsibility. Also harder to query the IR for "all the application concepts" vs "all the storage projections."

### D. Three planes (`domain` + `storage` + a shared bridge for cross-plane references)

**Rejected.** Overcomplicates. The "codecs straddle the line" intuition (codec instances serve both planes) is solved by references, not by a third plane. Cross-namespace codec reuse is a reference problem, not a placement problem.

### E. Dot-qualified strings for cross-references (`relation.to: "auth.User"`)

**Rejected.** Cheap to read; expensive at every consumer. Requires split-on-dot at every parse site; forbids dots in model names; introduces escape-character edge cases. The FK shape we already shipped uses object pairs; consistency wins.

### F. Implicit same-namespace + explicit override (`relation.to: "User"` resolves locally; cross-namespace uses object pair)

**Rejected.** Optimises the common case; introduces asymmetric IR shape. Every consumer has to handle both the string-implicit and the object-explicit variants. Saves typing at the authoring site (already moot — the authoring DSL takes handles) at the cost of doubled complexity at every read site.

### G. Bolt the reshape onto PR #534

**Rejected.** PR #534 is 121 commits / 437 files. Adding the reshape on top turns it into an unreviewable monolith. The reviewer can no longer distinguish "namespace exemplar landed" from "IR plane structure rewrote." Landing PR #534 first also lets the namespace exemplar prove itself in `main` before sitting under a structural reshape. Discussed and chosen during the design session's principal-engineer cross-pollination.

---

## Migration

External consumers (`@prisma-next/*` and extension pack authors) experience this as a **breaking change in the IR shape**:

- `contract.json` shape changes universally (root keys, namespace nesting, reference encoding).
- `contract.d.ts` shape changes; TypeScript downstream may not type-check until updated.
- Both `storageHash` and `profileHash` change for every existing contract.

The reshape ships with a recorded upgrade recipe per the repo's `record-upgrade-instructions` protocol. The recipe captures:

- The IR shape transformation (visual diff: before → after).
- The TypeScript downstream changes (handle-based authoring stays the same; programmatic IR-walking changes shape).
- The hash-impact summary (expected; documented; no action needed if consumers don't pin hashes).

---

## Related decisions

- **TML-2520 / PR #534** — established `ForeignKey.target.{namespaceId, tableName, columns}` as the cross-namespace reference shape. This ADR generalises that pattern.
- **TML-2537** — enum reshape (target-contributed top-level PSL blocks). Independent of this ADR but related; both move enums between planes (this ADR puts them in `storage.<ns>.types` after they're projected; TML-2537 deals with the source-side declaration shape).
- **TML-2581** — namespace-aware DSL surface (`db.<ns>.<Model>`). Natural follow-up; not blocked by this ADR but cheaper to build on top of the planes shape.

---

## References

- Project spec: [`projects/contract-ir-planes/spec.md`](../spec.md)
- Predecessor PR: [#534](https://github.com/prisma/prisma-next/pull/534) (TML-2520)
- PR #534 review artifacts that surfaced the gaps:
  - [`projects/namespace-exemplar/reviews/pr-534/system-design-review.md`](../../namespace-exemplar/reviews/pr-534/system-design-review.md)
  - [`projects/namespace-exemplar/reviews/pr-534/code-review.md`](../../namespace-exemplar/reviews/pr-534/code-review.md)
