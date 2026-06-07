# Summary

App contracts must be able to declare FK references that target tables owned by *another* contract — typically tables shipped by an extension package (e.g. `auth.users` from `@prisma-next/extension-supabase`). Today the framework supports FKs within a single contract (and, post-TML-2459, across namespaces within a contract); references that cross the contract-space boundary have no representation in the IR, no authoring surface, and no verifier/planner path. This project introduces cross-contract-space FK references as a first-class capability, with a TS surface unified with local FKs (model handles imported from extensions carry a brand, no separate call signature), a PSL surface using colon-prefixed dot-qualified type references (`supabase:auth.User`), implicit resolution via `extensionPacks`, a directional-acyclic dependency graph, and explicit ownership rules. The deliverable is target-agnostic at the framework layer and Postgres-flavoured at the DDL layer; SQLite and Mongo concretions follow the same SPI seams.

# Context

## At a glance

App contract today — a local FK references a model that lives in the same contract:

```prisma
namespace public {
  model Profile {
    id       String @id @default(uuid())
    authorId String
    author   Author @relation(fields: [authorId], references: [id])  // Author lives in this contract
  }
}
```

After this project, the same `@relation` mechanism works against a model that lives in *another contract space* — distinguished by a colon-prefixed type identifier:

```prisma
namespace public {
  model Profile {
    id       String @id @default(uuid())
    userId   String @unique
    user     supabase:auth.User @relation(fields: [userId], references: [id], onDelete: Cascade)
  }
}
```

`userId` is `@unique` to make the relationship a true 1:1 — at most one `Profile` row per `auth.User`. Without it, the FK would permit n:1 and any RLS policy keying off "this row's `userId` is the calling user" would be re-attachable to another user, defeating the policy.

The colon-prefix `supabase:` is the only new PSL grammar token; `@relation`'s shape is unchanged from the within-contract cross-namespace case introduced in TML-2459 (FR16b). The framework resolves `supabase` against the `extensionPacks` list configured in `prisma-next.config.ts`.

The TS surface uses the same call shape as a local FK; the framework distinguishes cross-contract from local by the brand on the imported model handle (`AuthUser` is imported from `@prisma-next/extension-supabase/contract`):

```ts
// app/contract.ts — referencing another contract space
import { AuthUser } from '@prisma-next/extension-supabase/contract';
import supabasePack from '@prisma-next/extension-supabase/pack';

export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
    namespaces: ['public'],
    extensionPacks: [supabasePack],  // ← declares dependency on the 'supabase' contract space
  },
  ({ field, model }) => {
    const Profile = model('Profile', {
      namespace: 'public',
      fields: { id: field.id.uuidv4(), userId: field.uuid(), username: field.text() },
    });
    return {
      models: {
        Profile: Profile.relations({
          // Same call shape as a local rel.belongsTo. The framework distinguishes
          // cross-contract from local by the brand on the AuthUser handle.
          user: rel.belongsTo(AuthUser, { from: 'userId', to: 'id' }),
        }).attributes(({ fields, constraints }) => ({
          // userId is unique → the relation is 1:1 in shape, not 1:n.
          uniques: [constraints.unique(fields.userId, { name: 'profile_userId_unique' })],
        })).sql(({ cols, constraints }) => ({
          table: 'profile',
          foreignKeys: [
            constraints.foreignKey(cols.userId, AuthUser.refs.id, {
              name: 'profile_userId_fkey',
              onDelete: 'cascade',  // permitted; no diagnostic for cross-contract cascade
            }),
          ],
        })),
      },
    };
  },
);
```

Lowered DDL emitted by the planner (target home namespace is named `auth`):

```sql
ALTER TABLE "public"."profile"
  ADD CONSTRAINT "profile_userId_fkey"
  FOREIGN KEY ("userId")
  REFERENCES "auth"."users"("id")
  ON DELETE CASCADE;
```

If the target's home namespace is `__unspecified__` (e.g. a SQLite-targeted extension or a multi-tenancy Postgres extension that defers to `search_path`), the `REFERENCES` clause is unqualified — `REFERENCES "users"("id")` — symmetric with TML-2459's table-creation DDL rule for `__unspecified__`.

## Problem

Three concrete pain points motivate this project:

**1. The Supabase example is currently inexpressible.** The Supabase integration's canonical worked example is `Profile.user → AuthUser.id` (with cascading delete). `AuthUser` belongs to the Supabase extension's contract — a separate contract space, declared in a different `defineContract(...)` call (the one inside `@prisma-next/extension-supabase/contract`). The app's `defineContract` cannot reach into that contract from any existing API surface. The blocking gap is structural, not ergonomic.

**2. Extensions that publish their own schemas have no way to be referenced.** Every extension that ships a contract space — Supabase today, observability backends, vault-style secret-managers, future auth providers — hits the same wall. Each ships a `contract.json` describing tables in `auth` / `vault` / `observability` schemas; each one a user is then expected to reference from app code. Today the user has two options: (a) drop the reference and live with a logical FK only, losing referential integrity at the database layer; or (b) hand-roll the FK in a raw SQL migration and lose the framework's awareness of it for verification and planning. Neither is acceptable.

**3. The architectural seam is missing, not the implementation.** TML-2459 lifts both Contract IR and Schema IR to a polymorphic class hierarchy, and it introduces a contract-aggregate loaded from `extensionPacks`. The aggregate already contains the necessary information to resolve a cross-space reference. What's missing is (a) an IR carrier shape that admits a `spaceId` coordinate on the target side of an FK, (b) a TS surface that lets the user name an extension model without lexically rebinding it, and (c) a PSL grammar token that distinguishes a cross-space type reference from a local type reference. The work is small in volume but load-bearing in semantics: it's the framework's first proof that cross-space references are first-class.

## Approach

### Three orthogonal pieces

The project lands three orthogonal pieces of design:

- **A type-system surface that distinguishes local vs cross-contract references** — unified TS call shape, colon-prefixed PSL grammar. Both keyed off a brand carried by the target model handle / type-position identifier.
- **An IR shape that carries the cross-space coordinate** — the FK reference carrier gains a `source: 'local' | 'space'` discriminator with `spaceId` + namespace + table + column on the space variant.
- **A resolution rule that walks the contract aggregate built from `extensionPacks`** — implicit, no PSL `use` directive, no separate TS resolver call. The same aggregate-loading machinery the framework already runs for namespace resolution is the resolver.

The three pieces are independent in scope but settle into the same milestone because they're useless in isolation: the IR carrier with no authoring surface to produce it is dead code; the authoring surface without an IR carrier has nowhere to lower to; resolution rules with neither are vacuous.

### TS surface is unified with local FK calls

There is **no `refIn` / `refExt` / `belongsToExternal` call**. Cross-contract references reuse `constraints.foreignKey(cols, OtherModel.refs.field, …)` and `rel.belongsTo(OtherModel, …)` — the same call shapes used for local references. The framework distinguishes the two from the **brand on the target model handle**, not from a separate signature.

This is the right shape for three reasons:

- **The handle is already branded** by its origin contract space. Extension `/contract` subpaths export model handles branded with the extension's `spaceId`; the app's own `model(...)` factory produces handles branded `<self>`. The brand is on the value; the call site can inspect it without ceremony.
- **The visual signal is the import statement**, not the call. A reader sees `import { AuthUser } from '@prisma-next/extension-supabase/contract'` at the top of the file and `AuthUser.refs.id` at the call site and infers cross-contract from those. Bifurcating the call shape would duplicate that signal redundantly.
- **`rel.belongsTo` and `constraints.foreignKey` already accept a `ColumnRef` shape;** extending that shape to carry a `spaceId` field is additive on the type side and structural on the runtime side. No new ergonomics surface to learn.

The single type-level addition the project needs is a `ColumnRef<TSpaceId>` brand parameter on the column-reference type. `<self>` for local refs (the value-imported `Model.refs.field` from the same contract) and the extension's `spaceId` for cross-contract refs (`AuthUser.refs.id` is `ColumnRef<'supabase'>`).

### PSL surface uses colon-prefix dot-qualified type references

PSL gains one new grammar element: an optional colon-prefix on type identifiers in field-type position:

```
type_ref ::= [ <space>:] <namespace>. <name>
           | [ <space>:] <name>
           | <name>
```

`supabase:auth.User` reads broad-to-narrow: contract space `supabase`, namespace `auth`, model `User`. `supabase:User` (no namespace) targets a model in the extension's `__unspecified__` namespace. `auth.User` (no colon prefix) is the local cross-namespace form already introduced in TML-2459. Bare `User` is the local same-namespace form.

The `@relation(fields: …, references: …)` attribute is unchanged — `references:` continues to take plain column names because the parser knows which model the columns belong to from the type position.

Required tokenizer change: the lexer must treat `:` as a distinct token in identifier position. The parser then accepts `<ident>:<ident>.<ident>` (and the partial forms above) in type positions. AST changes: `PslField.typeContractSpace?: string` carries the colon-prefix coordinate, alongside `typeNamespace?: string` from TML-2459's FR16a.

The PSL surface is deliberately strict where TS is permissive: PSL accepts only the colon-prefixed forms for cross-contract refs, with no aliasing or import grammar in v0.1. See § "Future-additive `use` story".

### Implicit resolution via `extensionPacks`

Cross-contract names resolve **implicitly** against the contract aggregate the framework already builds from `extensionPacks`. No PSL `use` directive, no TS resolver function, no separate registration step.

The lowering pass walks each FK reference. For `source: 'local'`, it resolves within the current contract (existing behaviour from TML-2459's M5b). For `source: 'space'`, it looks up the named space in the aggregate, then the model, then the column. Materialised target coordinates flow into the Schema IR FK constraint.

If the named space isn't in the aggregate, lowering fails fast with a diagnostic that names the missing pack — *"FK references space `supabase` model `AuthUser`, but no such contract space is registered; add `supabasePack` (imported from `@prisma-next/extension-supabase/pack`) to `extensionPacks` in `defineContract`."*

### Future-additive `use` story

The framework reserves the option to add a PSL `use` declaration if name collisions or readability ever push for aliasing:

```prisma
// Future, not v0.1:
use supabase from "@prisma-next/extension-supabase" as auth_ext;

namespace public {
  model Profile {
    user auth_ext:auth.User @relation(...)
  }
}
```

The commitment: any future `use` form is aliasing on top of implicit resolution, not a prerequisite for it. Today's implicit-resolution code keeps working forever. `use` is shipped only if real ambiguity surfaces; the project does not ship it speculatively.

### Contract-space dependency graph

Cross-contract references are constrained by a **directional acyclic graph**. Apps depend on extensions; extensions can depend on other extensions; cycles are rejected at aggregate-load time.

The graph is inferred from the aggregate's construction order, which today is driven by `extensionPacks`:

- `defineContract({ extensionPacks: [supabasePack], … })` declares "this app contract depends on the supabase contract space."
- `extensionPacks` is therefore doing **double duty** for v0.1 — it's both the *import declaration* (which extensions' models are reachable) and the *dependency declaration* (this contract depends on those extensions for load ordering).
- Extensions can declare their own `extensionPacks` in their bundled contract; the aggregate enforces "depended-on contracts load first" and rejects cycles.

References must follow the dependency arrows: an app contract can reference a Supabase model; the Supabase contract cannot reference an app model. The load-time check rejects reverse references with a clear diagnostic.

The conflation of imports + dependency declaration is acceptable for v0.1. If we later need to separate concerns (e.g. "depend on X for load order without importing its models"), `extensionPacks` can split into `dependsOn` + `imports` additively without breaking the existing single-list form.

### Namespace ownership

**Namespaces are open for extension. Primitives are not.**

Multiple contracts can contribute models to the same namespace:

- The Supabase contract owns `auth.User`, `auth.Identity`, `storage.Bucket`, etc.
- An app contract that adds `auth.MyExtraThing` does so by declaring `model MyExtraThing { … }` inside `namespace auth { … }` — the namespace is shared.
- The app contract becomes the **owner** of `auth.MyExtraThing` and is responsible for migrating that table. The Supabase contract is the owner of `auth.User` and is the one that marks it with `control: 'external'`.

**Cross-contract name collisions are fail-fast load errors.** If the app declares `model Session { … }` inside `namespace auth { … }` and the Supabase contract already declares `auth.Session`, the aggregate fails to load with a diagnostic naming both contributors. This mirrors the database-level reality (Postgres permissions on the `auth` schema reject duplicate `CREATE TABLE auth.session`), surfaced at authoring time rather than at migration time.

| Concept | Open for extension? | Owner | Collision rule |
|---|---|---|---|
| Namespace | Yes (multiple contracts contribute) | N/A (no single owner) | N/A |
| Primitive (model, enum, type) | No (declared once) | The declaring contract | Fail-fast load error on duplicate |

### `__unspecified__` × cross-contract refs

A cross-contract reference can target a model whose home namespace is `__unspecified__`. The contract IR carries the target model's declared namespace coordinate; if that coordinate is `__unspecified__`, the planner emits an unqualified `REFERENCES` clause.

| Target home namespace | Emitted `REFERENCES` clause |
|---|---|
| Named (e.g. `auth`) | `REFERENCES "auth"."users"("id")` |
| `__unspecified__` | `REFERENCES "users"("id")` |

This is symmetric with TML-2459's table-creation DDL rule for `__unspecified__` (FR16/FR16b). Per-tenant multi-tenancy deployments anchor cross-tenant FKs to the per-tenant schema at the migration run that creates the constraint, because Postgres stores the resolved OID rather than the textual schema name.

The PSL syntax for a cross-contract reference to an `__unspecified__` target elides the namespace dot:

```prisma
user extsqlite:User @relation(fields: [userId], references: [id])
```

The colon prefix marks cross-contract; the absence of `.namespace` marks `__unspecified__`. The TS surface needs no change — the model handle carries the `__unspecified__` coordinate transparently.

### Cascade across the boundary

`onDelete: 'cascade'` (and the rest of the referential-action set) is permitted on cross-contract FKs. **No diagnostic is emitted.** The developer's explicit `onDelete: 'cascade'` at the call site is the audit trail; emitting a warning on every build for a path the user opted into deliberately is noise.

This is the canonical application of the repo-wide policy at [`.agents/rules/explicit-opt-in-over-diagnostics.mdc`](../../.agents/rules/explicit-opt-in-over-diagnostics.mdc): when a user has to type something to enable a risky behaviour, the typed-in code *is* the documentation of intent.

A future use case where the choice is genuinely non-obvious (e.g. the user can't see from local code that the target is externally-managed) would be addressed by making the API more explicit (e.g. requiring `crossContractCascade: true` as a deliberate opt-in beyond `onDelete: 'cascade'`) — *not* by adding a build-time warning.

### Declared, non-navigable cross-space relations (v0.1)

A cross-space reference declares a *relationship*, not merely a column constraint, and uses the same authoring surface as a local relation — `rel.belongsTo(AuthUser, …)` in TS, `user supabase:auth.User @relation(…)` in PSL. Both lower to a domain-plane relation carrier tagged with the foreign `spaceId`, alongside the storage-plane `source: 'space'` FK.

The relation is **non-navigable in v0.1.** The emitter renders cross-space relations so that ORM traversal (`db.public.Profile.find({ include: { user: true } })`) is a **compile-time error** — the relationship is visible and introspectable and it drives the FK, but the query/traverse semantics are deliberately left for later (we have not settled them). This matches how Supabase is used in practice: the canonical pattern is a `public.profiles` row that `references auth.users on delete cascade`, and an app does not read `auth.users` directly. (The `auth` schema is not exposed through Supabase's *PostgREST* API; Prisma Next connects direct-to-Postgres, where access would instead be a role-GRANT matter — a path we deliberately do not depend on for v0.1.) The FK's entire value is the database constraint — referential integrity and cascade — realised through migration/DDL with no runtime traversal.

Navigability, and cross-space *querying* generally, require a runtime contract-space aggregate that merges loaded spaces into the query surface; that is undesigned and out of scope here — see Non-goals.

### IR shape

The FK reference carrier in Contract IR gains a `source` discriminator:

```ts
// Illustrative — exact field names up to the implementer
type TargetFieldRef =
  | { readonly source: 'local'; readonly modelName: string; readonly fieldName: string }
  | {
      readonly source: 'space';
      readonly spaceId: string;
      readonly namespace: NamespaceCoordinate; // includes '__unspecified__' as a value
      readonly tableName: string;
      readonly columnName: string;
    };
```

- `source: 'local'` is what TML-2459's M5b produces for within-space cross-namespace FKs.
- `source: 'space'` adds the explicit `spaceId` + namespace coordinate so the reference is fully qualified independent of lexical context.

The `spaceId` is the same identifier the contract aggregate already uses to load contract spaces. When the verifier or planner sees a `source: 'space'` carrier, it walks to that space in the loaded aggregate to resolve the target.

### Verifier behaviour

The verifier walks the loaded aggregate and compares against the introspected schema. For cross-space FKs:

- The FK constraint itself is verified against `pg_constraint` exactly the same way local FKs are.
- The *target* table is verified by its own control policy (see the parallel [control-policy](../control-policy/spec.md) project) — typically `external` for extension-shipped tables, meaning the table is verified to exist with exactly-matching declared columns but the planner emits no DDL for it.
- These are two independent checks that happen to chain through the same FK.

### Planner / DDL emission

The planner emits a qualified `REFERENCES` clause for named target namespaces and an unqualified `REFERENCES` clause for `__unspecified__` targets. The planner does *not* emit any DDL for the target table itself when its control policy says so — the normal case for cross-contract refs is "FK is `managed`, target table is `external`," which works without special-casing.

### Extension publish pipeline (pinned mirror)

Extensions ship a `contract.json` + `contract.d.ts` pair the same way an app contract does. On install (`prisma-next install` or equivalent), the extension's contract is mirrored into the app's `migrations/<spaceName>/` directory. This gives the app a pinned local copy with a stable import path the planner can read.

Authoring uses the extension's `/contract` subpath imports (`import { AuthUser } from '@prisma-next/extension-supabase/contract'`) directly — no manual JSON import at the user level. The pinned mirror exists for the planner's stable view of the extension's contract; user code doesn't see it.

# Requirements

## Functional Requirements

### IR carrier

- **FR1.** The FK reference carrier in Contract IR carries a `source: 'local' | 'space'` discriminator. The `'space'` variant carries `spaceId`, `namespace` (a `NamespaceCoordinate` that admits `__unspecified__` as a value), `tableName`, and `columnName`. The `'local'` variant retains the shape TML-2459 ships in M5b (model name + field name).
- **FR2.** The carrier is target-agnostic at the framework + family layer. Family-specific concretions (SQL, Mongo) inherit the discriminator shape unchanged.

### Authoring — TypeScript

- **FR3.** Model handles exported from an extension's `/contract` subpath are branded with the extension's `spaceId`. Local model handles produced by the app's `model(...)` factory are branded `<self>`.
- **FR4.** `rel.belongsTo(OtherModel, …)` and `constraints.foreignKey(cols.x, OtherModel.refs.y, …)` accept model handles from any branded contract space. The framework distinguishes local from cross-contract by inspecting the handle's brand at lowering time; no separate call surface (`refIn` / `belongsToExternal` / etc.) is introduced.
- **FR5.** A `ColumnRef<TSpaceId>` brand parameter threads the contract-space coordinate through type-level call signatures so the IDE can autocomplete `AuthUser.refs.<Tab>` and refuse references to undeclared spaces.
- **FR6.** `onDelete` (and the rest of the referential-action set) is permitted on cross-contract FKs without diagnostic. The user's explicit opt-in at the call site is the audit trail.

### Authoring — PSL

- **FR7.** The PSL lexer treats `:` as a distinct token in identifier position. The parser accepts `<space>:<namespace>.<name>` and `<space>:<name>` as type references (in field-type position). Bare `<namespace>.<name>` and `<name>` retain their TML-2459 semantics.
- **FR8.** `PslField.typeContractSpace?: string` carries the colon-prefix coordinate, alongside `typeNamespace?: string` (introduced by TML-2459's FR16a). The lowering pass propagates both into the Contract IR FK carrier.
- **FR9.** `@relation(fields: …, references: …)` is unchanged. The colon prefix lives in the type position; `references:` continues to take plain column names.

### Resolution

- **FR10.** Cross-contract resolution happens at the lowering boundary (Contract IR → Schema IR), against the loaded contract aggregate. The aggregate is the same one TML-2459 / TML-2397 already constructs from `extensionPacks`.
- **FR11.** Failed resolution (missing space, missing model, missing column) produces a fail-fast diagnostic at lowering time. The diagnostic names the missing pack (when the space isn't registered) and the specific reference that failed.

### Dependency graph

- **FR12.** Contract-space dependencies form a directional acyclic graph. `extensionPacks` declares this contract's dependencies; extensions can declare their own `extensionPacks` recursively.
- **FR13.** Cycles in the dependency graph are rejected at aggregate-load time with a diagnostic naming the cycle members.
- **FR14.** Cross-contract references must follow the dependency arrows. An app contract can reference an extension model; an extension contract cannot reference an app model. Reverse references are rejected at load time.

### Namespace ownership

- **FR15.** Multiple contracts can contribute models to the same namespace. The contract that declares a given primitive (model, enum, type) is the owner of that primitive and is responsible for its migration lifecycle.
- **FR16.** Cross-contract primitive collisions (two contracts declaring the same `(namespace.id, name)` primitive) are fail-fast load errors. The diagnostic names both contributors.

### `__unspecified__` interaction

- **FR17.** Cross-contract references whose target model lives in `__unspecified__` emit unqualified `REFERENCES` clauses in DDL (`REFERENCES "users"("id")`). Named target namespaces emit qualified clauses (`REFERENCES "auth"."users"("id")`). Symmetric with TML-2459's table-creation rule for `__unspecified__`.
- **FR18.** The PSL syntax for a cross-contract reference to an `__unspecified__` target elides the namespace dot (`supabase:User` rather than `supabase:.User`). The TS surface needs no change.

### Verifier + planner

- **FR19.** The verifier walks `source: 'space'` FK refs identically to `source: 'local'` ones for the FK-constraint check itself. The target table's existence and shape are governed by its own control policy (not by this project).
- **FR20.** The planner emits the appropriate qualified / unqualified `REFERENCES` clause per FR17. No DDL is emitted for tables whose control policy says the framework does not own them — this composes through the control-policy project's dispatch, not via cross-contract-specific code.

### Extension publish pipeline

- **FR21.** Extension contracts can be mirrored into the consuming app's `migrations/<spaceName>/` directory at install time. The mirror is what the planner reads for its stable view of the extension's contract. Authoring uses subpath imports (`@prisma-next/extension-supabase/contract`) directly.

## Non-Functional Requirements

- **NFR1.** No regression in TML-2459's local cross-namespace FK behaviour. Existing within-space FK call sites and PSL grammar continue to work unchanged.
- **NFR2.** The IR carrier extension (`source: 'local' | 'space'`) is additive. Contracts that use no cross-contract refs serialize and deserialize byte-identically to their TML-2459 form.
- **NFR3.** Cross-contract resolution is a one-pass walk of the aggregate, no fixed-point iteration. Resolution failures surface in O(refs) time.
- **NFR4.** Layering is enforced by `pnpm lint:deps`: the cross-contract resolver lives at the same layer as the local-FK resolver (no new package layering required).
- **NFR5.** Test coverage: round-trip property tests for the new IR carrier, end-to-end authoring tests for TS and PSL surfaces, integration tests against a live Postgres with cross-schema FKs, error-path tests for missing-pack / cycle / reverse-reference diagnostics.

## Non-goals

- **Control policy / `external` table handling.** The verifier behaviour for "the target table exists but the framework doesn't own it" lives in the parallel [control-policy](../control-policy/spec.md) project. This project consumes that primitive; it does not introduce it.
- **RLS policies, runtime role binding, JWT validation, and Supabase-specific glue.** Carried by the [postgres-rls](../postgres-rls/spec.md), [runtime-target-layer](../runtime-target-layer/spec.md), and [extension-supabase](../extension-supabase/spec.md) projects respectively.
- **Cross-space querying and relation traversal at runtime.** Declaring a cross-space relation is in scope (see § "Declared, non-navigable cross-space relations"); *traversing* it from the ORM/query builder (`include`) and *querying* another space's tables directly (`db.<extns>.<Model>`) are not. Both require a runtime contract-space aggregate that merges the loaded spaces' contracts into the queryable `Db` surface — today the runtime client is built from the app's own single contract, and extension-space tables are invisible to it by design (confirmed against the current `sql()` / `orm()` factories and the pgvector precedent). The injection seam, when this is eventually designed, is `ExecutionContext` (e.g. an optional `extensionContracts` map), not a merged `Db<C>` type. Deferred to a future project whose semantics are unsettled. This is distinct from [explicit-namespace-dsl](../explicit-namespace-dsl/spec.md) (TML-2550), which navigates multiple *namespaces within a single contract space*, never across spaces.
- **PSL `use ... as` aliasing directive.** Reserved as future-additive; not in v0.1. The implicit-resolution rule shipped here remains the canonical resolution path forever.
- **Splitting `extensionPacks` into separate `dependsOn` / `imports` lists.** The v0.1 conflation is acceptable. The split is additive when (if) it becomes necessary.
- **Schema-level grant inspection.** When the app declares `model auth.MyExtraThing { … }`, we don't check at authoring time that Postgres permissions on `auth` actually allow the app's migration role to `CREATE TABLE auth.my_extra_thing`. The migration will surface that error at run time. Authoring-time permission introspection is out of scope.
- **Cross-family cross-contract refs** (e.g. an app on Postgres referencing a model declared in a Mongo extension). The framework's contract aggregate is family-scoped at load time. Cross-family references are nonsensical at the DDL layer and not in scope for v0.1.

## Sequencing constraints

This project depends on [TML-2459 — Target-Extensible IR](../target-extensible-ir/spec.md) for:

- The Contract IR class hierarchy (the FK reference carrier extension is a subclass-or-discriminator addition on a class that doesn't yet exist on `main`).
- The `Namespace` framework concept + `__unspecified__` singleton subclass pattern.
- Local cross-namespace FKs (this project's `source: 'space'` discriminator slots in *next to* the `source: 'local'` carrier shape M5b lands).
- The contract-aggregate construction from `extensionPacks`.

This project can run in parallel with [postgres-rls](../postgres-rls/spec.md) and [runtime-target-layer](../runtime-target-layer/spec.md) once TML-2459 lands. It is a hard dependency of [extension-supabase](../extension-supabase/spec.md), which consumes the FK shape to model `Profile.user → AuthUser.id`.

# Acceptance Criteria

- [ ] **AC1.** A TS app contract references an extension's model and column (`rel.belongsTo(AuthUser, …)`, `constraints.foreignKey(cols.userId, AuthUser.refs.id, …)`) using the same call shape as local references. The IDE autocompletes `AuthUser.refs.<Tab>` to the extension's column names. The lowering pass produces an FK reference IR carrier with `source: 'space'`, `spaceId: 'supabase'`, and the resolved namespace/table/column coordinates. The cross-space relation is **declared but non-navigable** (Option B): it appears in the contract and drives the FK, but the emitted types reject ORM traversal — `db.public.Profile.find({ include: { user: … } })` is a compile-time error. See § "Declared, non-navigable cross-space relations".
- [ ] **AC2.** A PSL app contract declares `user supabase:auth.User @relation(fields: [userId], references: [id])` and lowers to the same `source: 'space'` carrier as AC1's TS form. Round-trip authoring → contract.json → re-hydrated Contract IR preserves the cross-contract coordinate.
- [ ] **AC3.** A PSL cross-contract reference to a model in `__unspecified__` uses the no-namespace form (`supabase:User`) and lowers to a carrier with `namespace: __unspecified__`. The planner emits `REFERENCES "users"("id")` (unqualified) for this carrier.
- [ ] **AC4.** A cross-contract FK with `onDelete: 'cascade'` is permitted; no diagnostic is emitted at any framework layer. The emitted DDL contains `ON DELETE CASCADE`.
- [ ] **AC5.** A contract that references an extension model without declaring the extension in `extensionPacks` fails to load with a diagnostic naming the missing pack and the specific reference. Verified for both TS and PSL surfaces.
- [ ] **AC6.** Two contracts declaring the same `(namespace, name)` primitive cause the aggregate load to fail with a diagnostic naming both contributors. Cyclic `extensionPacks` graphs (A depends on B depends on A) are similarly rejected at load time.
- [ ] **AC7.** An end-to-end integration test (PGlite-backed) creates a cross-schema FK from `public.profile.user_id` to `auth.users.id`, runs `prisma-next push` (or equivalent), verifies the FK exists in `pg_constraint`, and runs the framework verifier to confirm zero issues.
- [ ] **AC8.** Round-trip property test: Contract IR with a mix of `source: 'local'` and `source: 'space'` FK carriers serializes to `contract.json` and back to class instances structurally equivalent to the original.
- [ ] **AC9.** Existing TML-2459 local cross-namespace FK tests pass unchanged.
- [ ] **AC10.** `pnpm lint:deps` passes; no new layering violations.

# Other Considerations

## Security

The cross-contract reference machinery handles metadata only — no user data flows. The one security-adjacent concern is preventing an app contract from accidentally declaring a model in an extension's namespace and triggering a `CREATE TABLE` against a schema the app's migration role doesn't own. This is handled at the namespace-ownership layer (FR15/FR16): cross-contract primitive collisions are fail-fast load errors, so the app cannot silently shadow `auth.User`. The migration-time permission check (Postgres rejects the `CREATE TABLE`) is still the last line of defence; the load-time check catches the obvious cases earlier.

## Cost

Internal engineering effort only; no infrastructure cost. The work is concentrated in three places:

- **IR carrier extension** in the SQL family (and matching Mongo lift): ~200 LOC including the family abstract base hooks.
- **PSL grammar + AST** changes: lexer recognises `:` in type position, parser threads `typeContractSpace?: string` into `PslField`, AST consumers in the lowering pass and PSL formatter pick up the new field. ~150–250 LOC depending on formatter scope.
- **TS authoring brand + lowering**: `ColumnRef<TSpaceId>` brand parameter, model-handle brand exposure on `/contract` subpath exports, lowering-pass cross-contract handling. ~100–200 LOC.

Total ~500–650 LOC of focused work plus tests. Test cost is comparable: round-trip property tests, authoring smoke tests for both surfaces, integration tests for the live-database paths, error-path tests for diagnostics.

## Observability

The new diagnostics (missing pack, cyclic dependency, reverse reference, primitive collision) reuse the existing diagnostic envelope. No new telemetry events; the existing lowering-error path covers all the new failure modes.

## Data Protection

Not applicable — no personal data.

## Analytics

Not applicable.

# References

- [Umbrella project — Supabase integration](../supabase-integration/README.md) — context for why this project exists and how it composes with siblings.
- [TML-2459 — Target-Extensible IR spec](../target-extensible-ir/spec.md) — the dependency this project builds on. Specifically FR16a/FR16b (namespace authoring + within-contract cross-namespace FKs) which this project extends.
- [Umbrella `decisions.md`](../supabase-integration/decisions.md) — canonical decision log. This project consumes **A6** (cross-contract `onDelete: 'cascade'` permitted without diagnostic), **C5** (roles as first-class contract elements — shape parallel), **C6** (subpath-only extension entrypoints), **C7** (extension `/contract` ships pre-built typed handles).
- [`.agents/rules/explicit-opt-in-over-diagnostics.mdc`](../../.agents/rules/explicit-opt-in-over-diagnostics.mdc) — the repo-wide rule motivating the no-diagnostic stance on cross-contract cascade.
- [control-policy project spec](../control-policy/spec.md) — the parallel project owning the `external` control policy that cross-contract FK target tables typically carry.

# Open Questions

- **Canonical path for the pinned-mirror layout.** Working assumption is `migrations/<spaceName>/contract.json` (matches the app's own contract location). Some teams may prefer `node_modules/.cache/...` or a configurable location. The framework can default to the working assumption and accept overrides later; defer the override mechanism until user feedback requires it.
- **Branding mechanism for `<self>`.** Local model handles are produced inside the closure of `defineContract(({ model }) => ...)`. The `<self>` brand can be applied either by `model(...)` capturing a closure-bound contract identifier (cleaner type story, requires threading the contract identifier through the builder) or by post-hoc tagging at `defineContract`'s return time (simpler but harder to make autocomplete catch). Implementer's choice; both produce the same observable AC behaviour.
- **PSL formatter handling of colon-prefix identifiers.** When the formatter encounters `supabase:auth.User`, does it wrap long lines at the colon, the dot, or stay on a single line until the column limit? Implementer's choice; aim for "reads naturally"; revisit on user feedback.
