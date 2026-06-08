# ADR 226 — Cross-contract foreign-key references

## Status

Accepted (TML-2500). Depends on [ADR 212 — Contract spaces](./ADR%20212%20-%20Contract%20spaces.md), [ADR 221 — Contract IR two planes](./ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md), and [ADR 225 — Three-layer extensibility](./ADR%20225%20-%20Three-layer%20extensibility%20for%20pack-contributed%20entity%20kinds.md).

## Context

Extensions that ship a contract space (see [ADR 212](./ADR%20212%20-%20Contract%20spaces.md)) own their own tables — for example, the Supabase extension owns `auth.users`, `auth.identities`, and related tables. Applications frequently need FK references into those tables: `public.profile.user_id REFERENCES auth.users(id) ON DELETE CASCADE` is the canonical example.

Before this work, there was no seam for such a reference. The FK reference carrier in Contract IR carried only local model/field coordinates; the authoring surfaces (TS builders and PSL) had no syntax for naming a model in another contract space; and the planner had no way to resolve a cross-space target from the contract aggregate. Users were left with either no referential integrity at the database layer or hand-rolled FK migration SQL that the framework could not verify.

The architectural seam was missing, not the implementation: the contract aggregate built from `extensionPacks` already contained the information needed; what was absent was a carrier shape, an authoring surface, and a resolution rule.

## Decision

### FK carrier gains an optional `spaceId` field

The FK reference carrier in Contract IR (`ForeignKeyReference`) gains an optional `spaceId` field rather than a `source` discriminator or a parallel type:

```ts
export class ForeignKeyReference extends SqlNode {
  readonly namespaceId: NamespaceId;  // UNBOUND_NAMESPACE_ID ('__unbound__') for single-namespace refs
  readonly tableName: string;
  readonly columns: readonly string[];
  declare readonly spaceId?: string;  // absent = local; present = cross-space
}
```

Discrimination is presence-based: `spaceId` absent means local (the referenced table is in the same contract-space); `spaceId` present means cross-space (the referenced table is in the contract-space identified by `spaceId`). This keeps local-FK JSON byte-identical to contracts authored before cross-space support was added — a `spaceId`-absent serialization is indistinguishable from a pre-226 FK.

The carrier is target-agnostic at the framework and family layers. SQL and Mongo family concretions inherit the shape unchanged.

### Implicit resolution via `extensionPacks` — no PSL `use` directive

Cross-contract names resolve implicitly against the contract aggregate the framework already builds from `extensionPacks`. There is no PSL `use` directive, no TS resolver function, and no separate registration step.

The lowering pass walks each FK reference. When `spaceId` is absent it resolves within the current contract. When `spaceId` is present it looks up the named space in the aggregate, then the model, then the column. Failed resolution is a fail-fast diagnostic at lowering time that names the missing pack.

A future `use ... as` aliasing directive is reserved as additive on top of implicit resolution. Implicit resolution remains the canonical path.

`extensionPacks` serves double duty in v0.1: it is both the import declaration (which extension models are reachable) and the dependency declaration (load ordering). Splitting them into `dependsOn` + `imports` is additive and deferred.

### Contract-space dependencies form a directional acyclic graph

`extensionPacks` in `defineContract` declares this contract's dependencies. Extensions can declare their own `extensionPacks` recursively. The aggregate enforces load order (depended-on spaces load first) and rejects:

- **Cycles** — A depends on B depends on A.
- **Reverse references** — an extension contract references an app model.

Both produce fail-fast diagnostics at aggregate-load time.

### Namespaces open for extension; primitives owned; collisions fail-fast

Multiple contracts can contribute models to the same namespace. The contract that declares a given primitive (model, enum, type) is its owner. Cross-contract primitive collisions — two contracts declaring the same `(namespace.id, name)` primitive — are fail-fast load errors naming both contributors.

### Cross-space relations are declared but non-navigable in v0.1

PSL (`user supabase:auth.AuthUser @relation(...)`) and TS (`rel.belongsTo(AuthUser, ...)`) both declare a relationship carrier, not merely a column constraint. The emitter renders cross-space relations so that ORM traversal (`db.public.Profile.find({ include: { user: true } })`) is a compile-time error. The FK drives database-layer referential integrity and cascade; query/traverse semantics across spaces are deferred to a future project whose semantics are unsettled. The canonical usage pattern (Supabase's `public.profiles → auth.users`) does not require runtime traversal — the FK's value is the database constraint.

### Colon-prefix PSL grammar — the only new grammar token

PSL gains one new grammar element: an optional colon-prefix on type identifiers in field-type position:

```
type_ref ::= [ <space>: ] <namespace>. <name>
           | [ <space>: ] <name>
           | <name>
```

`supabase:auth.AuthUser` — contract space `supabase`, namespace `auth`, model `AuthUser`. `supabase:AuthUser` (no namespace) targets a model in the extension's `__unspecified__` namespace. `auth.AuthUser` (no colon) is the local cross-namespace form. Bare `AuthUser` is the local same-namespace form.

`@relation(fields: …, references: …)` is unchanged. `references:` continues to take plain column names; the parser knows which model the columns belong to from the type position.

AST: `PslField.typeContractSpace?: string` carries the colon-prefix coordinate, alongside `typeNamespace?: string` from the within-space cross-namespace work.

### `onDelete` permitted on cross-contract FKs with no diagnostic

`onDelete` (and the rest of the referential-action set) is permitted on cross-contract FKs. No diagnostic is emitted. The developer's explicit opt-in at the call site is the audit trail, per the repo-wide policy at [`.agents/rules/explicit-opt-in-over-diagnostics.mdc`](../../.agents/rules/explicit-opt-in-over-diagnostics.mdc). An explicit cascade on a cross-contract FK is not more dangerous than a local cascade — the risk profile is the same and the user typed it deliberately.

## Consequences

### Positive

- **The Supabase integration's canonical worked example becomes expressible.** `Profile.user → auth.users.id ON DELETE CASCADE` is the gap that motivated this work.
- **Unified call shape.** There is no `refExt` / `belongsToExternal`. The same `rel.belongsTo` and `constraints.foreignKey` calls work for local and cross-contract FKs; the distinction is visible at the import statement (`import { AuthUser } from '@prisma-next/extension-supabase/contract'`), not duplicated at the call site.
- **Additive on the IR.** Contracts with no cross-contract refs are unaffected. A `spaceId`-absent carrier is byte-identical to the pre-226 shape.

### Trade-offs

- **`extensionPacks` does double duty** as both import and dependency declaration. The conflation is acceptable for v0.1 but limits independent declarations. The split into `dependsOn` + `imports` is additive and deferred until user feedback requires it.
- **Relations are non-navigable in v0.1.** Declaring a cross-space relation without being able to traverse it via the ORM is a partial capability. The FK constraint and migration DDL work; the query surface does not. This matches the Supabase usage pattern but will need to be addressed when cross-space querying is designed.
- **Native-type matching is the author's responsibility.** The `ColumnRef<TSpaceId>` brand carries `spaceId`, not storage type. When a cross-space FK targets a column with a non-default native type (e.g. `uuid`), the author must match that type on the source column using a PSL named type alias (`types { Uuid = String @db.Uuid }`). Postgres rejects mismatched FK column types at apply time; the framework does not coerce. See the authoring rulecard at [`.agents/rules/cross-contract-fk-authoring.mdc`](../../.agents/rules/cross-contract-fk-authoring.mdc).

## References

- [ADR 212 — Contract spaces](./ADR%20212%20-%20Contract%20spaces.md) — the contract-space mechanism this ADR builds on
- [ADR 221 — Contract IR two planes](./ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md) — the IR coordinate model
- [ADR 225 — Three-layer extensibility](./ADR%20225%20-%20Three-layer%20extensibility%20for%20pack-contributed%20entity%20kinds.md) — extensibility pattern for the surrounding framework
- [`.agents/rules/explicit-opt-in-over-diagnostics.mdc`](../../.agents/rules/explicit-opt-in-over-diagnostics.mdc) — the repo-wide policy motivating no-diagnostic on cross-contract cascade
- [`.agents/rules/cross-contract-fk-authoring.mdc`](../../.agents/rules/cross-contract-fk-authoring.mdc) — authoring conventions rulecard
