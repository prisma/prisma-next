# ADR (draft) — Polymorphic `storage.types`: first-class IR kinds coexist with codec-typed entries

> **Status:** Draft (lives under `projects/target-extensible-ir/specs/` while the project executes; promoted to `docs/architecture docs/adrs/` with a permanent ADR number at close-out per the M6 plan task).
>
> **Project:** [target-extensible IR (TML-2459)](../spec.md). Shipped at M4 alongside the enum exemplar (the first real consumer of both the IR class hierarchy and the pack-contributed entity authoring mechanism).
>
> **Companion ADRs:** [3-layer polymorphic IR convention](3-layer-polymorphic-ir-convention.md), [Target-extensible authoring via pack contributions](target-extensible-authoring.md), [Architectural principles: affordances and cross-target consistency](architectural-principles.md). The 3-layer convention establishes the IR class hierarchy this ADR populates; the authoring ADR establishes the contribution mechanism users reach through to construct instances of the new IR kinds; this ADR pins the on-disk shape and hydration dispatch rule for the inflection point where target-specific IR kinds coexist with family-shared codec-typed entries.

## At a glance

`Contract.storage.types[name]` becomes a **polymorphic value**: `StorageTypeInstance | PostgresEnumType` (and future target-specific IR kinds whose lifecycle is named-type-shaped: e.g. `PostgresCompositeType`, `PostgresDomain`). Enum entries carry a literal `kind: 'sql-enum-type'` and hydrate into target subclasses (`PostgresEnumType`); codec-typed entries (pgvector, decimal, varchar) inherit the family base's non-enumerable `kind` and continue through the existing codec-typed `StorageTypeInstance` path unchanged.

The hydration walker dispatches on shape/kind. The verifier and planner walk first-class IR instances natively; the codec-hook glue specific to enums (`pgEnumControlHooks.verifyType` / `pgEnumControlHooks.planTypeOperations`) is removed. Codec-typed entries continue through codec-hook dispatch for their own concerns.

**Scope: Contract IR only.** Schema IR enum representation stays annotation-shaped (`schema.annotations.pg.storageTypes`) — the new verifier walk carries a small bridging adapter from the annotation shape to a normalised view for the diff. Schema IR enum lift is deferred to a follow-up project (tracked under `plan.md § Open items`).

## Context

`storage.types` is the contract's home for named, parameterised types — values shaped like `{ name: string, typeParams: …, codecId: … }`. Today it carries three populations:

- **Codec-typed parameterised entries** — pgvector dimensions (`Vector(1536)`), decimal precision, varchar length, etc. Each entry references a codec via `codecId`; the codec's `paramsSchema` validates `typeParams`. The verifier dispatches through codec control hooks for these.
- **Codec-typed enum entries** — Postgres enums were shoehorned into the same shape under a `pg/enum@1` codec ID, with the enum's `values` carried via `typeParams`. The verifier dispatched through `pgEnumControlHooks.verifyType`; the planner consumed them through `pgEnumControlHooks.planTypeOperations`. The control-hook surface was a generic codec affordance bent to carry a target-specific entity kind.
- **Future target-specific IR kinds with named-type lifecycle** — Postgres composite types, domains, range types; potentially MongoDB Atlas user-defined types. These are first-class target entities (own DDL lifecycle, own diff semantics, own renderer); none of them fit the codec-typed shape cleanly.

M4's framing — "enums become first-class IR" — forces a decision on the on-disk shape: when an enum is first-class, where does it live? Three options were on the table at M4 entry:

- **Option A — dedicated `storage.enums`.** Filter enum entries out of `storage.types`; introduce a parallel `storage.enums` namespace; verifier and planner walk it directly.
- **Option B — polymorphic `storage.types`.** Keep one named-type namespace; the value is `StorageTypeInstance | PostgresEnumType` (and future first-class kinds); hydration dispatches on shape/kind.
- **Option C — codec-typed entry remains the on-disk truth; framework hydrates an IR-class view.** Keep `storage.types[<enumName>]` codec-typed on disk; hydration synthesises a `PostgresEnumType` wrapper for in-memory consumption; codec-hook removal is cosmetic (hooks stop being called; the codec ID still exists in storage).

## Decision

**Option B.** `storage.types[name]` is polymorphic; first-class IR kinds and codec-typed entries coexist; the JSON envelope grows a `kind` field on first-class entries only (codec-typed entries inherit the family base's non-enumerable `kind` per the [3-layer polymorphic IR convention](3-layer-polymorphic-ir-convention.md) — no envelope change for the codec-typed population).

The hydration walker on the per-target `ContractSerializer` dispatches:

- `kind: 'sql-enum-type'` → construct `PostgresEnumType` instance via the pack-contributed `helpers.entities.enum` factory.
- (no enumerable `kind`) → construct `StorageTypeInstance` via the existing codec-typed hydration path.

The verifier walks `SqlEnumType` instances natively via the per-SPI verifier (with a small bridging adapter to the existing annotation-shape Schema IR — see § Scope below); codec-typed entries continue through codec-hook dispatch unchanged. The planner consumes `SqlEnumType` IR nodes through plain `Op` builders (`buildCreateEnumOperation`, `buildAddValueOperations`, `buildRecreateEnumOperation`) lifted verbatim from the deleted codec-hook glue.

### Hydration dispatch rule

The polymorphic-value shape is reached via the per-target `ContractSerializer` SPI (see [Contract Emitter & Types § Rehydration via the per-target ContractSerializer SPI](../../../docs/architecture%20docs/subsystems/2.%20Contract%20Emitter%20&%20Types.md)). Per-target serializers inspect each `storage.types[name]` entry, dispatch on the entry's shape (presence of enumerable `kind`, value of that `kind`), and construct the right class. Future first-class kinds (`PostgresCompositeType`, `PostgresDomain`) follow the same recipe: declare an enumerable literal `kind`, register a hydration arm on the per-target serializer, contribute the entity via `helpers.entities.<name>` for authoring.

### Scope: Contract IR only

Schema IR enum representation stays annotation-shaped (`schema.annotations.pg.storageTypes`) — introspection continues to populate the annotation; the new `SqlSchemaVerifierBase` enum walk carries a small bridging adapter from the annotation shape to a normalised view for the diff. The introspector (`pgEnumControlHooks.introspectTypes`) stays codec-hook-shaped for the same reason. Schema IR enum lift earns its own milestone — when Schema IR gains polymorphic dispatch consumers (multiple kinds of entity carrying their own metadata: enums + roles + RLS policies + views), the lift is a coherent unit of work for a focused follow-up.

## Consequences

### What this enables

- **First-class IR for enums end-to-end on the Contract IR side.** Verifier walks `SqlEnumType` instances; planner consumes them through native `Op` builders; the authoring DSL surfaces `helpers.entities.enum({ name, values })` with full type narrowing; codec-hook glue specific to enums is deleted. The codec-hook surface continues to own codec-typed concerns; first-class IR kinds own theirs.
- **Polymorphic-value shape generalises to future target-specific named-type kinds.** Postgres composite types, domain types, range types follow the same recipe (declare `kind: 'sql-composite-type'`, register hydration arm, contribute via `helpers.entities.composite`). Each new kind is mechanical against the proven shape.
- **JSON envelope blast radius is bounded.** Only first-class entries gain a `kind` field on disk; codec-typed entries inherit the family base's non-enumerable `kind` and stay byte-identical to pre-lift. The on-disk shape change is scoped to the population that actually became first-class.
- **Cross-target consistency.** Codec-typed entries continue to work the same way across every target (the family-base non-enumerable `kind` pattern transports). First-class entries work the same way as every other target-extensible IR kind (the [three-layer polymorphic IR pattern](../../../docs/architecture%20docs/patterns/three-layer-polymorphic-ir.md)). A reader who learns one reads the other.

### What this costs

- **Two populations in one namespace.** Readers walking `storage.types` see two shapes — codec-typed and first-class-IR. The hydration walker's dispatch absorbs this cost; consumer call sites that walk the hydrated representation see the discriminated union (`StorageTypeInstance | PostgresEnumType`) and narrow as needed. The cost is mild but real.
- **Authoring-side surface evolution for enums.** Per [Decision 19](../../../wip/unattended-decisions.md), the TS authoring surface evolves from the legacy `type.enum(name, values)` shape to the canonical `helpers.entities.enum({ name, values })` shape — the intentional outcome of the entities mechanism. PSL `enum X { … }` syntax is unchanged.
- **Schema IR / introspector asymmetry until Schema IR lift.** Contract IR has first-class `PostgresEnumType`; Schema IR has annotation-shaped enum state. The bridging adapter in the verifier carries the asymmetry; it is small + readable; the gap closes when Schema IR earns its own polymorphic-dispatch consumers in a follow-up.

### What this rules out

- **Dedicated `storage.enums` namespace today.** Premature severing for one consumer; same overshoot the project rejects at the IR-class layering decision (abstract base earns ≥2 consumers). Future readers earning Option A's shape (Postgres roles + RLS policies + views + enums sharing a namespace-scoped lifecycle) can promote in a focused follow-up; the polymorphic-value shape is the smallest step that earns first-class IR status, and Option A's dedicated-namespace shape is a strict superset reachable later.
- **Codec-typed entry as on-disk truth with hydrated view.** Option C above. Keeps the codec-typed shape on disk but renders an IR-class view in memory; codec-hook removal is cosmetic (the hooks stop being called but the codec ID still names the entry). The "first-class IR" framing requires the on-disk shape to reflect that enums are first-class, not codec-typed — and the project's "no backward-compat shims; update call sites instead" rule rules out preserving the codec-typed shape solely to avoid touching call sites.

## Alternatives considered

### Alternative A — dedicated `storage.enums` namespace

Filter enum entries out of `storage.types`; introduce a parallel `storage.enums`; verifier and planner walk it directly.

**Why considered.** Cleanest single-purpose namespace; no shape polymorphism at the entry level; future first-class IR kinds (composite types, RLS policies, roles) each get their own namespace if they earn it.

**Why rejected.** ~60-80 file cascade for one consumer (Postgres enums); bundles example-fixture rewrites + contract.json schema changes + dual-traversal sites that don't carry their weight in M4. The "first-class IR" framing is achievable through Option B's polymorphic value without paying the dual-namespace cost. The "abstract earns ≥2 consumers" rule applies recursively to namespace shapes: severing one population into a dedicated namespace is the same overshoot Decision 14 corrected for the SQL IR class hierarchy. If a future milestone earns Option A's shape (multiple first-class kinds sharing a namespace-scoped lifecycle), the lift from polymorphic `storage.types` to dedicated `storage.enums` is mechanical: filter enum entries; lift them; update consumer call sites. The polymorphic-value shape is the smallest step that earns first-class IR status; Option A is a strict superset reachable later.

### Alternative C — codec-typed on-disk + hydrated IR-class view

Keep `storage.types[<enumName>]` codec-typed on disk under `codecId: 'pg/enum@1'`; hydration synthesises a `PostgresEnumType` wrapper in memory; codec-hook removal is cosmetic (the hooks stop being called; the codec ID continues to name the entry on disk).

**Why considered.** Zero on-disk shape change; existing fixtures untouched; no `kind` field added to any entry.

**Why rejected. Two reasons.** First, the project's "no backward-compat shims; update call sites instead" rule rules out keeping the codec-typed shape on disk solely to preserve fixture compatibility — `contract.json` is the canonical artifact and its shape should reflect the IR's truth. Second, "first-class IR" for enums means the on-disk shape attests that the entry is a first-class kind, not a codec-typed entry pretending to be one; the `kind: 'sql-enum-type'` envelope field is exactly that attestation. Hiding it behind a codec ID is the kind of structural lie the IR class hierarchy was introduced to remove.

## Reversibility

The migration from polymorphic `storage.types` to dedicated `storage.enums` (Alternative A) is mechanical: filter enum entries out of `storage.types`; lift them to `storage.enums`; update consumer call sites; update fixtures + canonical-JSON envelopes accordingly. Estimated 2-3 implementer-days post-M4 if a future milestone earns the dedicated-namespace shape.

The migration from polymorphic `storage.types` to Schema IR first-class enum representation is independent of this ADR — it lifts the annotation-shape state on the Schema IR side, leaves Contract IR's polymorphic-value shape intact, and converges the verifier's bridging adapter into a direct walk. Estimated 1-2 implementer-days when picked up.

## Open questions (for the close-out promotion)

- **What other named-type kinds earn first-class status?** M4 ships `PostgresEnumType` as the first one. Postgres composite types and domain types are obvious candidates; the polymorphic-value shape admits them mechanically. Close-out should either name the next intended adopter or document that future-target-extension projects pick this up.
- **Does Mongo gain a parallel `storage.types` polymorphism?** Mongo does not have a parallel concept today (no named user-defined types on collections beyond schema validation). If a future Mongo extension earns one, the polymorphic-value shape transports unchanged; the parity is structural rather than fixture-shaped.
- **Naming and ADR number.** This ADR is drafted as "polymorphic storage.types". Candidates for the permanent name: "Polymorphic `storage.types`: first-class IR kinds and codec-typed entries", "Contract storage shape for first-class IR vs codec-typed entries". The permanent name should be picked at close-out alongside the companion ADRs.
