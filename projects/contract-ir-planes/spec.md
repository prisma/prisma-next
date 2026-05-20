# Contract IR Planes — Project Spec

**Tracking ticket:** [TML-2584](https://linear.app/prisma-company/issue/TML-2584/restructure-contract-ir-into-two-planes-domain-storage-with-uniform)

## Refs

- **Predecessor:** [TML-2520](https://linear.app/prisma-company/issue/TML-2520) — *Namespace exemplar.* Makes the storage section namespace-aware and ships cross-namespace foreign keys. Must merge before this project starts.
- **Sibling, independent:** [TML-2537](https://linear.app/prisma-company/issue/TML-2537) — *Target-contributed top-level PSL blocks; enum reshape.* Out of scope here; it deals with the source-side declaration shape of enums, not the IR plane shape.
- **Subsumed Linear tickets** (will close as duplicates when this project completes):
  - [TML-2579](https://linear.app/prisma-company/issue/TML-2579) — *Framework canonicalizer contains SQL-specific paths.* The reshape rewrites the canonicalizer; the family-contribution hook this ticket proposed becomes part of the new shape.
  - [TML-2580](https://linear.app/prisma-company/issue/TML-2580) — *Replace `extractStorageElementNames` duck-typing with `Storage.elementCoordinates()`.* The new shape naturally exposes per-plane coordinates; the duck-typing helper dies.
  - [TML-2582](https://linear.app/prisma-company/issue/TML-2582) — *Rename `UnboundTables<C>`.* The misnamed type doesn't survive the reshape; the DSL's `Db<C>` walks `domain.<ns>.models` directly.
- **Follow-up:** [TML-2581](https://linear.app/prisma-company/issue/TML-2581) — *Namespace-aware DSL/ORM surface (`db.<ns>.<Model>`).* Natural successor project; not blocked by this one but much cheaper to build on top.
- **Orthogonal:** [TML-2583](https://linear.app/prisma-company/issue/TML-2583) — *Re-baseline historical migration snapshots.* Independent housekeeping; needs doing eventually regardless of this project.

## Reference docs

Useful context, in suggested reading order:

- [ADR 004 — Storage Hash vs Profile Hash](../../docs/architecture%20docs/adrs/ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md) — the prior art that already treats storage as an independent, family-owned segment of the contract. This project generalises that pattern.
- [Architecture Overview](../../docs/Architecture%20Overview.md) — the framework / family-pack layering this project sharpens.
- This project's own ADR: `[./adrs/0001-contract-planes.md](./adrs/0001-contract-planes.md)`.

## Summary

Restructure the contract IR around two **planes** — `domain` and `storage` — with a **uniform per-plane namespace coordinate system**. Every contract concept lives in exactly one plane, and within each plane, every entry sits under a namespace. Domain carries application concepts the user defines (models, value objects, type bindings). Storage carries the family-owned persistence projection (tables, DDL types, collections). Cross-concept references everywhere in the IR adopt the object-pair `{ namespace, model }` shape already used by foreign keys.

The plane concept is not new. [ADR 004 — Storage Hash vs Profile Hash](../../docs/architecture%20docs/adrs/ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md) already treats the contract's `storage` section as a separate, independently-hashed, family-owned segment. This project completes that idea: storage is one plane, the user's application concepts (currently scattered as flat siblings — `models`, `relations`, `valueObjects`, `types`, `roots`) become a peer `domain` plane, and both planes share one coordinate system rooted at the namespace.

## Context

### What the IR looks like before this project

Today (immediately after the in-progress namespace work lands; see § Predecessor work), the contract has this shape:

```jsonc
{
  "target": "postgres",
  "models":   { "User": { … }, "Post": { … } },     // flat
  "relations": [ … ],                                 // flat
  "valueObjects": { "Address": { … } },               // flat
  "types":    { "Embedding1536": { … } },             // flat
  "roots":    { "user": "User", "post": "Post" },     // flat
  "storage": {
    "namespaces": {                                   // namespace-scoped
      "auth":   { "tables": { "user": { … } } },
      "public": { "tables": { "post": { … } } }
    }
  }
}
```

The asymmetry is the structural problem this project fixes:

1. **Storage is namespace-aware; everything else is flat.** A user can have `auth.user` and `public.user` as separate tables; they cannot have `auth.User` and `public.User` as separate models. The model-name lookup is global. The standard multi-tenant pattern (an `auth.User` from a Supabase-style auth schema alongside an application-defined `public.User`) is structurally blocked.
2. **Code at every consumer reinvents "find by name across namespaces."** Helpers like `findSqlTable(contract, tableName)` exist because the storage shape has namespaces and the model shape doesn't, so the layer that bridges them has to do an O(namespaces × tables) scan and assert uniqueness. The framework canonicalizer carries SQL-specific paths because it has to preserve empty storage namespaces (which the framework conceptually doesn't know about). These leaks are direct consequences of the asymmetry, not separate problems.
3. **The "namespaces" word is structural noise once you generalise.** If you extend today's storage shape to domain content the obvious way, you get `contract.namespaces.<ns>.models` *and* `storage.namespaces.<ns>.tables` — the word "namespaces" appears at two levels and conveys nothing. The cleaner shape drops the word: `<plane>.<ns>.<slot>`. This is what the discussion-mode design session on 2026-05-19 converged on (architect + principal-engineer lenses; full decision log in § Decision log below).

### Predecessor work

This project depends on the in-progress namespace work (Linear: [TML-2520](https://linear.app/prisma-company/issue/TML-2520), GitHub: PR #534) landing first. That PR makes the storage section namespace-aware and introduces cross-namespace foreign keys with the object-pair encoding (`ForeignKey.target.{namespaceId, tableName, columns}`). It is the precedent for both this project's coordinate system (storage already has it; this project extends it to domain) and its cross-reference encoding (FKs already use object pairs; this project generalises the pattern).

### Cleanup work absorbed by this project

The post-merge code review on the predecessor PR surfaced a list of smaller issues — a misleading type name (`UnboundTables<C>`), framework code containing SQL-specific paths, a duck-typed "find storage element by name" helper, namespace-construction shims and default-singleton injections that exist only to paper over the asymmetric IR, an `instanceof` brand check that exists because constructors couldn't trust their inputs, and several smaller smells. They were originally scoped as a follow-up cleanup pass on the same branch.

All of those issues are structural consequences of the storage-only namespace shape. The reshape this project proposes — symmetric planes with uniform namespace-scoping and tight constructor inputs — rewrites the same code paths and removes the conditions that produced the smells in the first place. The cleanup pass is therefore subsumed by this project rather than landed independently, and three Linear tickets that were filed to track individual cleanups are folded in too (see § Subsumed Linear tickets).

## At a glance

### Canonical IR shape (in both `contract.json` and the generated `contract.d.ts`)

```jsonc
{
  "target": "postgres",
  "targetFamily": "sql",
  "domain": {
    "auth": {
      "models": {
        "User": {
          "fields": { "id": { … }, "email": { … } },
          "relations": {
            "posts": {
              "cardinality": "1:N",
              "to": { "namespace": "public", "model": "Post" },
              "on": { … }
            }
          }
        }
      },
      "valueObjects": { "Address": { … } },
      "types": { … }
    },
    "public": {
      "models": {
        "Post": {
          "fields": { … },
          "relations": {
            "user": {
              "cardinality": "N:1",
              "to": { "namespace": "auth", "model": "User" },
              "on": { … }
            }
          }
        }
      },
      "valueObjects": {},
      "types": {}
    }
  },
  "storage": {
    "storageHash": "...",
    "auth": {
      "tables": { "user": { … } },
      "types": {}
    },
    "public": {
      "tables": { "post": { … } },
      "types": { "user_type": { "kind": "postgres-enum", … } }
    }
  },
  "roots": { "user": { "namespace": "auth", "model": "User" } },
  "capabilities": { … },
  "extensionPacks": { … }
}
```

Top-level keys: `domain`, `storage`, plus the unchanged global metadata (`target`, `targetFamily`, `roots`, `capabilities`, `extensionPacks`, `meta`, `execution`, `schemaVersion`, `profileHash`).

### Plane charters

**Domain plane** carries application concepts the user defines: models, value objects, type bindings (codec aliases like `Embedding1536`). Per-namespace. Used by the DSL/ORM at runtime. Authoring DSL emits into this plane.

**Storage plane** is family-owned and describes how domain concepts project onto persistence. Per-namespace. Slot shape is family-specific (`tables` + `types` for SQL; `collections` for Mongo). The same `<ns>` identifier appears in both planes — domain namespace `auth` projects to storage namespace `auth`. In persistence systems without native namespaces (sqlite, single-database Mongo), domain namespaces project to the `__unbound__` storage namespace.

### Cross-concept references

Every cross-namespace reference encoded as object pair `{ namespace, model }` (or `{ namespace, table }` for storage-plane references). Applies to:

- `relation.to: { namespace, model }`
- `model.base: { namespace, model }`
- `roots[rootName]: { namespace, model }`
- `ForeignKey.target: { namespaceId, tableName, columns }` (already shipped by TML-2520; this is the precedent)

No dot-qualified-string shortcuts. No same-namespace-implicit. Uniform encoding across every reference site.

## Decision log

The structural decisions in this spec were settled in a discussion-mode session on 2026-05-19 (architect → principal-engineer, sequenced). The decisions, with reasoning, assumptions, and rejected alternatives:

### D1 — Two planes: `domain` and `storage`

**Decision:** The contract has exactly two top-level planes for entity content. `domain` carries application concepts; `storage` carries the family-owned persistence projection.

**Reasoning:** Two converging arguments:

1. **Prior art exists.** [ADR 004](../../docs/architecture%20docs/adrs/ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md) already treats `storage` as a separate, independently-hashed, family-owned section of the contract (the `storageHash` is computed over storage in isolation). Storage is already a plane in everything but name. This project promotes the recognition to the IR shape and adds a peer plane for the application content that's currently scattered as flat siblings (`models`, `relations`, `valueObjects`, `types`).
2. **It reflects the user's mental model.** *"My application has these domain concepts; the family projects them onto persistence."* The framework / family boundary becomes structural: framework code that names `storage.<…>.tables` is doing something wrong — that's a family idiom and shouldn't appear at the framework layer.

**Assumes:** Application concepts and storage projections always coexist within the same contract (no "domain-only" or "storage-only" contracts). Holds for every current and foreseeable use case.

**Rejected:**

- *"Single root, no planes"* (today's shape) — fails the collision-realism test for models (`auth.User` vs `public.User`); already failed it for storage tables, which is why storage was made namespace-scoped first; the asymmetry is the present-day cost.
- *"Three planes (domain + storage + bridge for shared types)"* — overcomplicates. The "codec instances straddle domain and storage" intuition is solved by treating type aliases as cross-plane references when needed, not by a third plane.

### D2 — Uniform shape: `<plane>.<ns>.<slot>`

**Decision:** Both planes use the identical indexing pattern. Top-level keys under each plane are namespace IDs; under each namespace are slot maps (`models`, `valueObjects`, `types` for domain; `tables`, `types`, `collections` for storage). The word `"namespaces"` does not appear in the IR.

**Reasoning:** One indexing pattern to learn; consumers can write generic walkers (`for (const ns of Object.keys(contract.domain)) { … }`). The intermediate proposal during the design session — `contract.namespaces.<ns>.{models, …}` extending today's `storage.namespaces.<ns>.tables` shape to domain content the obvious way — would have put the word `"namespaces"` at two levels (`contract.namespaces.<ns>.models` *and* `storage.namespaces.<ns>.tables`), conveying nothing extra. Dropping the word entirely and keying namespaces directly under each plane removes the redundancy without losing the coordinate system.

**Assumes:** The slots under each plane stay family-specific (storage's `tables` vs `collections`) but the namespace-keying shape stays uniform across planes.

**Rejected:**

- `contract.namespaces.auth.{models, tables, types, …}` (single per-namespace container holding both domain and storage slots) — couples domain + storage into one container; loses the framework / family ownership boundary D1 establishes; family slots (`tables`, `collections`) sit next to framework slots (`models`, `valueObjects`).
- `contract.namespaces.auth.models` + `contract.storage.namespaces.auth.tables` (extend the existing storage shape literally to domain content, keeping the word `"namespaces"` everywhere) — produces the two-level redundancy this decision exists to remove.

### D3 — Plane names: `domain` + `storage`

**Decision:** Application plane named `domain`. Storage plane keeps its name.

**Reasoning:** `domain` matches the user's original framing (*"storage domain vs application domain"*) and aligns with DDD vocabulary (domain model). Concise; reads naturally in IDE auto-complete.

**Assumes:** The existing internal uses of "domain" in the codebase (e.g. `validate-domain.test.ts`) don't conflict semantically — they're testing-internal and disambiguable.

**Rejected:**

- `application` — descriptive but bulky; overloaded with "the app's runtime code" in IDE auto-complete.
- `logical` / `physical` — classical data-warehouse vocabulary; cost is renaming `storage` → `physical`, unnecessary scope.
- `schema` — catastrophically overloaded (PSL schema, SQL schema, JSON schema).

### D4 — Everything namespace-scoped within a plane

**Decision:** Within each plane, every concept lives under a namespace. No flat-at-plane-root slots. Domain has `models` + `valueObjects` + `types` all per-namespace. Storage has `tables` + `types` (SQL) or `collections` (Mongo) all per-namespace.

**Reasoning:** Uniform shape across every read site. Even concepts with low collision risk in practice (codec aliases like `Embedding1536`) follow the same pattern. Two namespaces wanting the same codec binding declare it twice or use a cross-namespace reference (a *reference* problem, solved as needed, not a *placement* problem requiring IR-level support).

**Assumes:** The verbosity cost of declaring shared codec aliases twice is acceptable vs. the cost of asymmetric IR shape.

**Rejected:**

- *"Codecs flat at contract root as a shared lexicon"* — admits a third top-level container outside the two-plane framing; breaks the uniform shape.
- *"Codecs under domain but flat per-plane (no namespace)"* — asymmetric within the domain plane.

### D5 — Cross-references encoded as object pairs

**Decision:** Every cross-namespace reference (`relation.to`, `model.base`, `roots[*]`, etc.) carries `{ namespace, model }` (or `{ namespace, table }` for storage references). Consistent with the `ForeignKey.target.{namespaceId, tableName, columns}` shape shipped by TML-2520.

**Reasoning:** Consistency with the FK precedent already shipped. Same encoding for every cross-namespace reference, no asymmetric shortcuts. Mechanical to parse; no separator-character escape hatches; no implicit-resolution rules to test.

**Assumes:** The authoring DSL continues to take model handles (`rel.belongsTo(User, …)`) so users never type the object pair themselves. The encoding is an IR-on-the-wire choice.

**Rejected:**

- Dot-qualified strings (`relation.to: "auth.User"`) — cheap to read; expensive at every consumer (split-on-dot; forbid dots in model names; escape-character edge cases).
- Implicit same-namespace + explicit override (`relation.to: "User"` resolves locally; cross-namespace uses object pair) — optimises the common case but introduces asymmetric IR shape.

### D6 — ADR-worthy

**Decision:** This structural reshape carries an ADR. Drafted alongside this spec at `projects/contract-ir-planes/adrs/0001-contract-planes.md`. Migrates to `docs/architecture docs/adrs/` at project close-out.

**Reasoning:** The plane structure is part of the framework's public IR contract. Future contributors and external pack authors need to understand the typology; an ADR is the durable home for that.

### D7 — Scope: separate project, after PR #534 merges

**Decision:** This work lands as a new project on a new branch off the merged base of PR #534. Not bolted onto PR #534.

**Reasoning:** PR #534 is already 121 commits / 437 files. Adding the reshape on top turns it into an unreviewable monolith; the reviewer can no longer distinguish "namespace exemplar landed" from "IR plane structure rewrote." Landing PR #534 first also lets the namespace exemplar prove itself in `main` before sitting under a structural reshape.

**Assumes:** No forcing function (release dependency, downstream consumer blocker) requires landing both together. Confirmed at decision time.

**Cross-pollination from architect → principal-engineer:** the architect lens settled the structural shape; the PE lens immediately flagged the blast radius (93+ call sites, both hashes change universally, family serializers + validators + canonicalizer all rewrite) and recommended the separate-project shape. The structural and operational lenses converged on the same answer.

## Scope

### In scope (this project)

- IR shape change: `contract.{domain, storage}.<ns>.<slot>` structure throughout.
- Cross-reference encoding: object pairs for `relation.to`, `model.base`, `roots[*]`, and any other cross-model/cross-table reference site.
- Framework `Namespace` interface narrowed to `{ id, kind }` (family-specific slots move to family-shaped namespace types).
- IR constructor discipline: `SqlStorage` / `MongoStorage` constructors accept only fully-constructed `Namespace` instances; no POJO normalisation, no default singleton injection. All "convenience" lives in the authoring layer.
- `createNamespace` factory moves onto the target pack contribution surface; removed from user-facing `defineContract` arguments.
- Serializer rewrite: `kind` no longer in JSON; class identity resolved from `(targetFamily, target)` + position. `stripNamespaceKinds` deleted.
- `deserializeContract<T>(json): T` becomes generic at the family interface.
- Removed surface checks subsumed by the new shape: `assertUniqueSqlTableNames`, `findSqlTable`, `extractStorageElementNames` (replaced by per-plane walks).
- Framework canonicalizer no longer has SQL-specific paths (family-contribution hook for preserve-empty paths). Subsumes TML-2579.
- `Storage.elementCoordinates()` polymorphic walks (or equivalent), naturally exposed by the new shape. Subsumes TML-2580.
- `UnboundTables<C>` removed (Db walks `domain.<ns>.models` directly). Subsumes TML-2582.
- ADR `0001-contract-planes.md`.
- Migration of all in-tree contracts + fixtures to the new shape; both `storageHash` and `profileHash` change universally.

### Out of scope

- **TML-2537 enum reshape.** Independent; handles application-enum lifting from storage to domain. May overlap with this project's `types` placement decisions but is shaped separately.
- **TML-2581 namespace-aware DSL/ORM surface** (`db.auth.user` / `db.auth.User`). Natural follow-up; deferred to a successor project. This project preserves the existing flat-by-name DSL/ORM surface — it changes the IR shape, not the user-facing query API.
- **TML-2583 historical migration re-baselining.** Orthogonal; needs doing eventually regardless.
- **PSL parser changes.** PSL is namespace-keyed at the source already (`namespace foo { … }`); parser/printer adapt to the new IR shape but no new PSL surface introduced.

## Acceptance criteria

- **AC1.** `contract.json` and generated `contract.d.ts` follow the canonical shape in § At a glance for at least three in-tree examples (`prisma-next-demo`, `react-router-demo`, `mongo-blog-leaderboard`).
- **AC2.** Every cross-model / cross-table reference site emits the object-pair shape: `relation.to`, `model.base`, `roots[*]`, FKs. Round-trip through serializer + deserializer preserves the shape.
- **AC3.** Framework `Namespace` interface declares only `{ id, kind }`. SQL and Mongo family namespace types extend it with family-specific slots. No `tables` or `collections` on the framework interface.
- **AC4.** IR constructors accept only fully-constructed `Namespace` instances. No `| InputBag` union; no `DEFAULT_NAMESPACES`; no `normaliseNamespaceEntry`; no `SqlNamespacePayload` shim. Authoring layer owns all normalisation.
- **AC5.** Serializer omits `kind` from emitted contract.json namespace entries. Deserializer resolves class identity from `(contract.targetFamily, contract.target)` + position. `stripNamespaceKinds` deleted from `assertDescriptorSelfConsistency`.
- **AC6.** `deserializeContract<T>(json): T` is generic; the demo's `as unknown as typeof contract` cast is gone.
- **AC7.** Grep gates clean: zero remaining references to `SqlNamespacePayload`, `DEFAULT_NAMESPACES`, `stripNamespaceKinds`, `assertUniqueSqlTableNames`, `findSqlTable`, `normaliseNamespaceEntry`, `extractStorageElementNames`, `UnboundTables<C>` in `packages/`** and `examples/**`.
- **AC8.** ADR `0001-contract-planes.md` accepted and migrated to `docs/architecture docs/adrs/`.
- **AC9.** All in-tree examples + tests pass. `pnpm typecheck` / `pnpm test:packages` / `pnpm fixtures:check` / `pnpm lint:deps` clean.
- **AC10.** TML-2579, TML-2580, TML-2582 marked Done (subsumed by this project's deliverables).

## Failure modes to design against

1. **Inconsistent reference shapes across the IR.** Some sites use object pairs, others slip in dot-qualified strings or implicit-namespace resolution. Mitigation: a single `CrossReference<T>` shape used everywhere; grep gate forbids string-typed references to model / table names.
2. **Plane bleed.** Domain code reaches into storage shape, or storage code reaches into domain. Mitigation: layering rules in `architecture.config.json`; `pnpm lint:deps` enforces.
3. **Both-hashes-change-universally surprises.** Every in-tree contract's `storageHash` and `profileHash` shift. Fixtures need regeneration; descriptor-self-consistency checks need to operate on the new shape. Mitigation: explicit `fixtures:emit` + `fixtures:check` gate in the project plan; document the hash impact in the project's PR description so downstream consumers expect it.
4. **The cleanup symbols landing as one-by-one fixes without the structural reshape.** An earlier attempt scoped each of the smells listed in § Cleanup work absorbed by this project as a separate cleanup pass. Without the underlying plane reshape, each cleanup either re-introduces a different shim or fails to remove the asymmetric assumption that caused the smell in the first place. Mitigation: this project lands the structural change *and* the cleanup as one coherent reshape — every removed symbol disappears because its reason for existing disappears.
5. **Hardcoded namespace assumptions in cross-cutting code.** A current example is the TS builder's `POSTGRES_ENUM_NAMESPACE_ID = 'public'` constant, which assumes one specific namespace is always available. Today the framework has no way to assert "the namespace this enum should live in is the same one its consuming table lives in" — code falls back to hardcoded namespace IDs. Mitigation: the plane reshape gives every entity an explicit namespace coordinate, making this assumption testable. The fix itself either lands here as part of the reshape or via the enum-reshape sibling project (TML-2537), depending on sequencing.

## Sequencing within the project

Rough sketch (refined when the project's plan is drafted via `drive-plan-project`):

1. **Phase 1 — IR shape primitives.** Framework `Namespace` interface narrowed. New plane types added. Serializer and deserializer updated for the plane shape (with `kind` removal).
2. **Phase 2 — Cross-reference rename.** `relation.to`, `model.base`, `roots[*]` migrate to object pairs. Coordinated rename across emitter, serializer, validator, DSL.
3. **Phase 3 — Constructor discipline.** Authoring layer takes over normalisation. IR constructors tightened. Deleted symbols: `SqlNamespacePayload`, `DEFAULT_NAMESPACES`, `normaliseNamespaceEntry`, etc.
4. **Phase 4 — Subsumption.** Framework canonicalizer cleanup (subsumes TML-2579). `Storage.elementCoordinates()` (subsumes TML-2580). `UnboundTables<C>` removal (subsumes TML-2582).
5. **Phase 5 — Migration + ADR.** All in-tree contracts + fixtures regenerated. ADR accepted. PR opened.

## References

- PR #534 (TML-2520 namespace exemplar) — the IR-asymmetry observation that triggered this project.
- PR #534 review artifacts:
  - `[projects/namespace-exemplar/reviews/pr-534/system-design-review.md](../namespace-exemplar/reviews/pr-534/system-design-review.md)`
  - `[projects/namespace-exemplar/reviews/pr-534/code-review.md](../namespace-exemplar/reviews/pr-534/code-review.md)`
  - `[projects/namespace-exemplar/reviews/pr-534/walkthrough.md](../namespace-exemplar/reviews/pr-534/walkthrough.md)`
- ADR draft: [`./adrs/0001-contract-planes.md`](./adrs/0001-contract-planes.md)
- Tracking ticket: [TML-2584](https://linear.app/prisma-company/issue/TML-2584/restructure-contract-ir-into-two-planes-domain-storage-with-uniform)

