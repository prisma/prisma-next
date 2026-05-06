# ADR 210 — Index-type registry

**Status:** Proposed
**Date:** 2026-05-06
**Domain:** SQL family — contract authoring, validation, schema migration

**Spec:** [projects/index-type-registry/spec.md](../../../projects/index-type-registry/spec.md)

## Context

The SQL family supports `@@index` in PSL and `constraints.index(...)` in TS authoring, but both surfaces only carry columns and an optional name today. The Contract IR has placeholder fields named `using` and `config` that no active codepath populates: the PSL parser ignores them, the schema IR omits them, and the Postgres adapter emits a plain `CREATE INDEX` without an index method or storage parameters. The placeholder names also misalign with Prisma's `@@index(type:)` precedent.

Extensions that need a non-default index method work around this with bespoke per-extension helpers that hand-build an IR node carrying the right `using` value and a typed payload. There is no central concept that knows which index types exist, what their option shapes look like, or how those options should be rendered. The asymmetry creates three concrete problems: authors can put any string into the type slot and any payload into the options slot, and the contract round-trips silently — the divergence only surfaces at DDL time, if at all; extension authors duplicate the typing-and-validation work per index type; and there is no clean extension point for users to add their own index types without forking the schema validator.

## Decision

Introduce an **index-type registry** in the SQL family's `1-core/contract` package, alongside `IndexSchema`. An entry is keyed by a `type` literal and carries a single piece of data: an arktype validator describing the entry's `options` shape. The registry is the only place that knows which `type` values are legal in a contract. Five aligned choices fall out of treating the registry as the single source of truth.

### 1. Field-name convention: `type` and `options`

The IR fields are renamed `using` → `type` and `config` → `options` across `IndexDef`, the authoring `IndexNode`/`IndexOptions`/`IndexConstraint`, the schema validator, the schema IR, and contract lowering — in lockstep, with no compatibility shim. The names match Prisma's `@@index(type:)` precedent and stay dialect-neutral: the Postgres-specific keywords `USING` and `WITH` live exclusively inside the renderer and never appear in the contract vocabulary.

The lockstep rename is justified by the fields being inert today. The only in-repo writers of those names are the bespoke helpers being replaced as part of the same change. There is no observable behaviour to preserve, so a shim would only widen the surface area without protecting any caller.

### 2. Factory builder declares the type literal once

Index types are contributed via a factory builder. The call site names the literal, attaches the arktype validator for `options`, and the builder exposes both a runtime registration helper and a derived TypeScript type extracted by `typeof` from the builder's output. Because the validator is constructed via the repo's `type.declare<T>().type(...)` pattern, the runtime shape is constrained at compile time to match the canonical TS type. Drift between the two halves becomes a TypeScript error at the place where the entry is declared, rather than a runtime surprise downstream.

The single-declaration-site property is the load-bearing one. It is what lets extension authors add an entry without touching framework code, and what lets the validator and the adapter share a single canonical shape.

### 3. Extension-pack threading via the registration value

Each pack stores its registered index types in a single field whose value is the read-only output of the factory builder. The same value carries both the runtime entry list and a TypeScript-only phantom carrying the map of literal → option shape; the builder type extends a read-only registration interface that exposes only those two fields, so the pack can't be misused as a mutable registry. The contract-definition pipeline reads each pack's registration, intersects the per-pack maps, and threads the merged map into the contract authoring surface. When `constraints.index(cols.x, { type: 'X' })` is authored, `options` is narrowed against the merged map's entry for `'X'`; an unregistered `type` literal is a compile error.

No global `declare module` augmentation is used; the merged set is purely a function of the packs attached to a given contract. This avoids cross-contract coupling — two contracts with different pack lists in the same workspace see different valid `type` sets, as they should.

### 4. Validation seam at the SQL-family boundary

Registry-aware validation runs from `validateSqlStorage`, the SQL family's storage validator that the framework's `validateContract` dispatches into. Framework core stays family-agnostic: it does not know about indexes, let alone index types. When an `IndexDef` carries a `type`, `validateSqlStorage` looks up the entry and validates `options` against the entry's arktype validator. An unregistered `type`, an `options` payload that fails the validator, or `options` set without `type` are all rejected with errors that name the offending index type or key.

Strictness — whether unknown keys in `options` are rejected — is a property of the validator each registrant constructs, not something the framework imposes on top. arktype is loose-by-default; a registrant who wants extra-key rejection opts in when building their option-shape validator. The recommendation is to do so: an entry's option shape is a contract between the registrant and the renderer, and an unrecognised key is much more likely to be a typo than a genuine extension point. Silently dropping it at validate time would mask it from authors and produce surprising DDL.

### 5. Single framework-owned renderer for `WITH (...)`

The Postgres adapter's `createIndex` reads `type` and `options` directly from the validated IR and renders `CREATE INDEX ... USING <method> ... WITH (key = literal, ...)`. There is **no per-entry rendering hook**. A single universal renderer formats `options` as `key = literal, ...`, using the adapter's existing scalar quoting and escaping helpers for strings, numbers, and booleans.

Two consequences are worth naming. First: validators constrain `options` leaves to scalar types, so the universal renderer covers every entry — past, present, and future. Second: the absence of an extension-supplied rendering path means an extension author cannot accidentally introduce an unsafe rendering path. SQL injection risk is bounded to the framework-owned helpers, which already round-trip Postgres literals correctly elsewhere in the adapter.

Index-IR changes that affect `columns`, `type`, or `options` are emitted by the migration planner as `DROP INDEX` followed by `CREATE INDEX`. Postgres has no `ALTER INDEX ... SET METHOD` for changing the index method, and option changes are inconsistent across `WITH` keys, so `ALTER` is the wrong primitive for these fields uniformly.

## How matching, lookup, and dispatch compose

When an extension pack declares its index types, the factory call site is the single point where the type literal is named. The builder produces a single value that carries both the runtime entry list — `(type, options-validator)` pairs ready to be aggregated — and a TypeScript-only phantom map of literal → option shape. The pack stores that value verbatim in its registration field; both halves stay in lockstep automatically.

When a contract is defined, two things happen — strictly per-contract, with no global state. On the type side, the contract-definition pipeline walks the attached packs, reads each pack's registration, and intersects the per-pack maps. The merged map is what narrows `options` per-`type` for `constraints.index(...)`. Every contract sees only the packs it asked for. On the runtime side, contract assembly creates a fresh per-contract registry and calls `register` for each entry the attached packs contribute. A duplicate `type` across packs surfaces as a registration-time error naming the conflict; this is contract-level, not workspace-level.

When a contract is validated at runtime, `validateSqlStorage` consults that contract's registry. Lookup is by `type` literal; validation of `options` is one arktype invocation per index, against whichever shape the registrant constructed (loose or strict). The framework owns the Postgres-shaped renderer for `options`; per-entry validators have no rendering responsibility and no rendering surface area.

When the Postgres adapter renders DDL, it consults only the validated IR. The renderer never re-invokes the registry: by the time a node reaches the adapter, its `options` is already canonical. This keeps the adapter's surface narrow and means the registry's correctness needs to hold only at validate time.

## Alternatives considered

**Per-entry rendering hooks.** Let each registered entry carry a function that turns its options into a string. Rejected on uniformity and security grounds. The repo already exposes safe scalar quoting helpers; an extension authoring its own renderer would either duplicate them or, worse, build SQL by string concatenation. The universal renderer is sufficient because validators constrain leaves to scalars.

**`declare module` augmentation for index types.** A common pattern in TypeScript libraries: each pack augments a global type to add its entries. Rejected because it does not compose with our pack model — two contracts in the same workspace would see the union of all packs ever loaded, not just their own. Storing the per-pack registration value keeps the merged set scoped to each contract.

**Capability gating per index type.** The capability system exists to negotiate runtime environment features (e.g. is a particular operation supported by this connection, this server version). It is not the right vocabulary for a design-time decision about whether a contract can name a given `type` value. The registry is the design-time vocabulary; capabilities are orthogonal. A registered entry does not assert that the database has the underlying server-side extension installed — that surfaces as a Postgres DDL error at apply time, which is the right behaviour.

**Backward-compatibility shim for `using`/`config`.** Keep accepting the old field names alongside the new ones. Rejected because the fields are inert today (no PSL or TS surface populates them through any active codepath) and the only in-repo writers are being replaced as part of the same change. A shim would expand the validated IR shape with no caller to protect.

**Closed-set identifier syntax in PSL (`type: BTree`).** Prisma's stable PSL uses identifier values for `@@index(type:)`. Rejected because our registry is open-ended by design — extension packs contribute new types — and a closed-set grammar would either need to be regenerated per workspace or fall through to the same string-typed argument anyway. PSL accepts a string-quoted `type` value, validated downstream against the merged registry just like the TS surface.

## Consequences

### Positive

- An extension author adds a new index type by writing a single factory call and storing the resulting registration on their pack. The TS authoring surface, the runtime validator, and the Postgres DDL renderer all light up without touching framework code.
- Type narrowing of `options` per-`type` happens at the call site, against the exact set of packs the contract asked for. Unknown types, mistyped keys, and bad values are compile errors at the call site or runtime errors at validate time, not surprise DDL output.
- The IR vocabulary is dialect-neutral. The contract is portable across adapters even though the renderer is Postgres-shaped today.
- The validation surface is bounded to one registry lookup plus one arktype invocation per index — no measurable regression versus today's `IndexSchema`.

### Negative

- The IR rename touches a small but non-trivial set of in-repo call sites in lockstep. We accept this in exchange for not carrying a shim for fields that nothing populates.
- Future SQL adapters that don't share Postgres's `USING <method> WITH (...)` shape would need their own rendering path if they ever want to read `type`/`options`. The IR vocabulary stays neutral; the renderer is per-adapter.
- Any change to an index's `type` or `options` rebuilds the index. This is an inherent property of how Postgres handles index method and `WITH`-key changes, not a regression introduced here.
- PSL must learn object-literal grammar for `options: { ... }`. V1 admits string literals as leaves only; booleans and numbers are deferred to the same follow-up that seeds built-in entries (which actually need them).

## Non-goals

- Built-in registry entries for `btree`, `hash`, `gin`, `gist`, `brin`, `spgist`. Tracked as a follow-up. V1 ships the mechanism; in-repo extensions that already needed a registry-shaped helper are migrated onto it in the same change.
- Boolean and number literals in PSL `options` payloads. V1 supports string-leaf only; the parser extension and the built-in-entry seeding ship together.
- Rendering paths for any future SQL adapter beyond Postgres. The IR vocabulary is neutral; the renderer is Postgres-shaped.
- Per-column index options (e.g. `gist`'s per-column operator classes). V1 carries `options` as a single object on the index, not per-column.
- `ALTER INDEX` paths for `type`/`options` changes. Always `DROP` + `CREATE`.
- Capability gating per index type. The registry is the design-time gate; runtime extension presence is verified by Postgres at apply time.

## References

- [ADR 117 — Extension capability keys](ADR%20117%20-%20Extension%20capability%20keys.md) — the orthogonal mechanism that index types are *not*
- [ADR 161 — Explicit foreign key constraint and index configuration](ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md) — neighbouring decision in the index/constraint area
