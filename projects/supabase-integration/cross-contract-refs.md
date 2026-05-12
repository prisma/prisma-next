# Cross-contract-space FK references

## Problem

The Supabase example needs a FK from `public.profiles.user_id` to `auth.users.id`. Both tables exist in the same database, but they live in *different contract spaces*: `public.profiles` belongs to the app contract, `auth.users` belongs to the Supabase extension contract. The framework already supports FKs within a contract (and, post TML-2459, across namespaces within a contract). Cross-*contract-space* FKs are the gap.

This shape isn't Supabase-specific. Any extension that publishes an externally-managed contract space will hit the same need: app code wants to reference extension tables.

## Design intent

### Authoring surface — TypeScript

The TS surface is **unified with the local-FK surface**: there is no separate `refIn`. Cross-contract references reuse the existing `constraints.foreignKey(cols, OtherModel.refs.fieldName, …)` and `rel.belongsTo(OtherModel, …)` call sites. The framework distinguishes local vs cross-contract from the **brand on the target model handle**, not from a separate call signature.

```ts
import {
  defineContract,
  rel,
} from '@prisma-next/sql-contract-ts/contract-builder';
import { supabase } from '@prisma-next/extension-supabase';
import supabaseContractJson from '../migrations/supabase/contract.json' with { type: 'json' };
import type { Contract as SupabaseContract } from '../migrations/supabase/contract.d';
import sqlFamily from '@prisma-next/family-sql/pack';
import postgresPack from '@prisma-next/target-postgres/pack';

// Typed handle to the Supabase contract space. Carries `spaceId: 'supabase'`
// at runtime and provides typed `.models.<Name>.refs.<field>` accessors.
const supabaseContract = supabase.contract<SupabaseContract>(supabaseContractJson);

export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
    namespaces: ['public'],
    extensionPacks: { supabase: supabase.pack() },
  },
  ({ field, model }) => {
    const Profile = model('Profile', {
      namespace: 'public',
      fields: {
        id: field.id.uuidv4(),
        userId: field.uuid(),
        username: field.text(),
      },
    });

    return {
      models: {
        Profile: Profile.relations({
          // rel.belongsTo accepts a model handle from any registered contract
          // space; the cross-contract case is inferred from the handle's brand.
          user: rel.belongsTo(supabaseContract.models.AuthUser, {
            from: 'userId',
            to: 'id',
          }),
        }).sql(({ cols, constraints }) => ({
          table: 'profile',
          foreignKeys: [
            constraints.foreignKey(
              cols.userId,
              supabaseContract.models.AuthUser.refs.id,
              { name: 'profile_userId_fkey' },
            ),
          ],
        })),
      },
    };
  },
);
```

Three properties of the design:

- **Cross-contract-ness is implicit at the call site.** No `refIn` / `refExt` / `belongsToExternal`. Both local and cross-contract references use the same call shape; the model handle's brand tells the framework which contract space it came from. The visual signal is the **import statement** — the reader sees `import { supabase } from '@prisma-next/extension-supabase'` at the top of the file and `supabaseContract.models.AuthUser` at the call site, and infers cross-contract from those.
- **Typed completion all the way through.** `supabaseContract.models.<Tab>` lists the Supabase models; `.refs.<Tab>` lists their columns. No string literals.
- **Implicit resolution via `extensionPacks`.** The framework knows the contract space is `supabase` because the user added `extensionPacks: { supabase: supabase.pack() }` to `defineContract`'s config. If the user references `supabaseContract.models.AuthUser` without declaring `supabase` in `extensionPacks`, contract loading fails fast with a clear diagnostic ("model `AuthUser` from contract space `supabase` is referenced but `supabase` is not in `extensionPacks`").

### Authoring surface — PSL

PSL uses a **colon-prefixed dot-qualified** form for cross-contract references. The colon-prefix is the visual signal that this name resolves outside the current contract space. Resolution is implicit — the framework infers which contract space `supabase` refers to from `prisma-next.config.ts`'s `extensionPacks`.

```psl
// schema.psl

namespace public {
  model Profile {
    id       String @id @default(uuid())
    userId   String
    username String
    user     supabase:auth.User @relation(fields: [userId], references: [id])
  }
}
```

The grammar reads broad-to-narrow: contract space `supabase`, then namespace `auth`, then model `User`. The `@relation` attribute is unchanged from the local cross-namespace case (FR16b in TML-2459); the only new piece is the colon-prefixed contract-space coordinate in the type position.

Three properties of the design:

- **No PSL import grammar required for v0.1.** Contract spaces named via colon prefix resolve against the `extensionPacks` declared in `prisma-next.config.ts`. There is no `use supabase from "@prisma-next/extension-supabase"` directive to maintain. (See Open questions below for the future-additive `use` story.)
- **No new attribute.** `@relation(fields: […], references: […])` carries the FK shape; the type position carries the coordinate. Symmetric with cross-namespace refs.
- **Required tokenizer change:** the PSL tokenizer must treat `:` as a distinct token in identifier position. The parser then accepts `<ident>:<ident>.<ident>` as a type reference. AST: `PslField.typeContractSpace?: string` carries the colon-prefix coordinate (alongside `typeNamespace?: string` from TML-2459's FR16a).

### Implicit resolution and the future-additive `use` story

Cross-contract names resolve **implicitly** in v0.1. The framework walks the contract aggregate (built from `extensionPacks`) and matches names. There is no `use ... as` syntax to map colon-prefix tokens to contract spaces.

If a future contract gets large enough or an extension name collides with something in the contract, we may add a purely additive `use` declaration:

```psl
// Future, not v0.1:
use supabase from "@prisma-next/extension-supabase" as auth_ext;

namespace public {
  model Profile {
    user auth_ext:auth.User @relation(...)
  }
}
```

The commitment we're making: **any future `use` form is aliasing on top of implicit resolution, not a prerequisite for it.** Today's implicit-resolution code keeps working forever. We only add `use` if ambiguity surfaces; we don't ship it speculatively.

### Contract-space dependency graph

Cross-contract references are constrained by a **directional, acyclic dependency graph** between contract spaces. Apps depend on extensions; extensions can depend on other extensions (e.g. a future Supabase + auth-extension stack); cycles are disallowed.

The dependency graph is inferred from the contract aggregate's construction order, which today is driven by `extensionPacks`:

- `defineContract({ extensionPacks: { supabase: supabase.pack() }, … })` declares that this app contract depends on the `supabase` contract space.
- `extensionPacks` is therefore doing double duty for v0.1 — it's both **the import declaration** (which extensions' models are reachable) **and the dependency declaration** (this contract depends on those extensions).
- Extensions can declare their own `extensionPacks` in their bundled contract (e.g. a future Supabase variant that depends on a base auth extension). The aggregate construction enforces "depended-on contracts load first" and rejects cycles at load time.

This conflation is acceptable for v0.1. If we later need to separate concerns (e.g. "depend on X without importing its models, just to pin a load order"), we can split `extensionPacks` into `dependsOn` + `imports` additively without breaking the existing single-list form.

References must follow the dependency arrows: an app contract can reference a Supabase model; the Supabase contract cannot reference an app model. The load-time check rejects reverse references with a clear diagnostic.

### Namespace ownership

**Namespaces are open for extension. Primitives are not.**

Multiple contracts can contribute models to the same namespace:

- The Supabase contract owns `auth.User`, `auth.Identity`, `storage.Bucket`, etc.
- An app contract that adds `auth.MyExtraThing` does so by declaring `model MyExtraThing { … }` inside `namespace auth { … }` — the namespace is shared.
- The app contract becomes the **owner** of `auth.MyExtraThing` — it is responsible for migrating that table. The Supabase contract is the owner of `auth.User` and is the one whose contract loaders mark it with `control: 'external'`.

**Cross-contract name collisions are fail-fast load errors.** If the app declares `model Session { … }` inside `namespace auth { … }` and the Supabase contract already declares `auth.Session`, the contract aggregate fails to load with a diagnostic naming both contributors. This mirrors the database-level reality: in a real Supabase project, the database permissions on the `auth` schema will reject the app's attempt to `CREATE TABLE auth.session` anyway. The contract-level check surfaces the same conflict at authoring time rather than at migration time.

Ownership rules at a glance:

| Concept | Open for extension? | Owner | Collision rule |
|---------|---------------------|-------|----------------|
| Namespace | Yes (multiple contracts contribute) | N/A (no single owner) | N/A |
| Primitive (model, enum, type) | No (declared once) | The declaring contract | Fail-fast load error on duplicate |

### `__unspecified__` × cross-contract refs

A cross-contract reference can target a model whose home namespace is `__unspecified__` (e.g. a SQLite-targeted extension whose models have no schema, or a Postgres extension that intentionally leaves resolution to the connection's `search_path`).

**Resolution rule:** the contract IR carries the cross-contract reference with the target model's declared namespace coordinate. If that coordinate is `__unspecified__`, the planner emits **unqualified `REFERENCES`** (no schema prefix). The database resolves the reference via `search_path` at migration time. For per-tenant multi-tenancy deployments, this anchors the FK to the per-tenant schema at the migration run that creates the constraint — Postgres stores the resolved OID, not the textual schema name, so each tenant's FK correctly references their own tenant schema's table.

DDL emission, summarised:

| Target home namespace | Emitted `REFERENCES` clause |
|-----------------------|-----------------------------|
| Named (e.g. `auth`) | `REFERENCES "auth"."users"("id")` |
| `__unspecified__` | `REFERENCES "users"("id")` |

This is symmetric with the table-creation DDL rule TML-2459 already establishes for `__unspecified__` (FR16/FR16b): named namespaces emit qualified DDL, `__unspecified__` emits unqualified DDL and lets `search_path` resolve at migration time.

The PSL syntax for a cross-contract reference to an `__unspecified__` target elides the namespace dot:

```psl
// SQLite-style extension where models have no namespace
user extsqlite:User @relation(fields: [userId], references: [id])
```

The colon prefix marks cross-contract; the missing `.namespace` marks `__unspecified__`. The TS surface needs no change — the model handle carries the `__unspecified__` coordinate the same way it carries a named namespace.

### IR shape

The FK reference carrier in the IR gains a `source` discriminator:

```ts
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

The `spaceId` is the same identifier the contract aggregate already uses to load contract spaces (via TML-2397). When the verifier or planner sees a `source: 'space'` carrier, it walks to that space in the loaded aggregate to resolve the target.

### Resolution

Resolution happens at the lowering boundary (Contract IR → Schema IR), against the **loaded contract aggregate**, not against any single contract. The aggregate is the same one TML-2397 already constructs from `extensionPacks`.

The lowering pass:

1. For each `source: 'local'` FK ref: resolve within the current contract (existing behaviour).
2. For each `source: 'space'` FK ref: look up the named space in the aggregate, then look up the model, then look up the field. Materialise the resolved namespace + table + column coordinates into the Schema IR FK constraint.
3. If the named space isn't in the aggregate, or the model/field doesn't exist there, lowering errors out with a clear diagnostic — "FK references space `supabase` model `AuthUser`, but no such contract space is registered; add `supabase: supabase.pack()` to `extensionPacks` in `defineContract`."

### Verifier behaviour

The verifier walks the loaded aggregate and compares against the introspected schema. For cross-space FKs:

- The FK constraint itself is verified against `pg_constraint` exactly the same way local FKs are.
- The *target* table is verified by its own control policy (`external` for `auth.users`, so it's verified to exist with compatible shape but no DDL is emitted for it — see [`projects/control-policy/spec.md`](../control-policy/spec.md)).
- These are two independent checks that happen to chain through the same FK.

### Planner / DDL emission

The planner emits a qualified `REFERENCES` clause when the target namespace is named, and an unqualified `REFERENCES` clause when the target namespace is `__unspecified__` (per the rule above):

```sql
-- Named target namespace
ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_user_id_fkey"
  FOREIGN KEY ("user_id")
  REFERENCES "auth"."users"("id");

-- __unspecified__ target namespace
ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_user_id_fkey"
  FOREIGN KEY ("user_id")
  REFERENCES "users"("id");
```

Postgres FK syntax supports cross-schema references natively; the planner just renders the right qualifier.

The planner does *not* emit any DDL for the target table itself (it's `control: 'external'` in the Supabase contract). The combination "FK is `managed` (we own this FK), target table is `external` (we don't own that table)" is the normal case for cross-contract refs and works without special-casing.

### Extension publish pipeline

The Supabase extension ships a `contract.json` + `contract.d.ts` pair the same way an app contract does — they're emitted artifacts that the app imports.

Mechanics:

- The extension's source-of-truth contract lives inside the `@prisma-next/extension-supabase` package (hand-authored for v0.1; see [`extension-package.md`](extension-package.md)).
- On install (or on `prisma-next install` / equivalent), the extension's `contract.json` + `contract.d.ts` are mirrored into the app's `migrations/<spaceName>/` directory. This gives the app a pinned local copy with a stable import path.
- The user imports from the pinned mirror: `import supabaseContractJson from '../migrations/supabase/contract.json' with { type: 'json' }`. This is the same import shape they already use for their own contract.
- The pinned mirror means upgrading the extension is an explicit action (re-run the install command), not a transparent npm bump. This is intentional: cross-contract FK targets are part of the user's database schema, so a silent schema change in an extension would be a Bad Thing.

This is the same publish/consume shape TML-2459 sets up for the IR refactor, so this work is mostly "use the existing pipeline" + "make sure the pipeline supports extension-sourced contracts" — not a new pipeline.

## Open questions

- **What's the canonical path for the pinned mirror?** `migrations/<spaceName>/contract.json` is the working assumption (matches the app's own contract location). Some teams may want `node_modules/.cache/...` or a configurable location. Defer until we have user feedback.
- **Cascading actions across spaces.** PostgreSQL supports `ON DELETE CASCADE` etc. across schemas. Do we permit them across contract spaces? Probably yes — the DDL is fine, it's just the verifier that needs to be a little more careful (a cross-space `ON DELETE CASCADE` from a `managed` table to an `external` table makes the externally-managed table's lifecycle leak into our planner's awareness). Working assumption: **permit, document the implication.**
- **What's the typed handle returned by `supabase.contract<SupabaseContract>(json)`?** Is it the same shape as `validateContract`'s replacement (the SPI-based `target.contractSerializer.deserializeContract`)? Probably yes — same machinery, with the extension package providing a thin convenience wrapper that ties the contract type to its `spaceId` and exposes `.models.<Name>.refs.<field>` accessors. Specifics to settle when implementing.
- **Should the extension package's typed handle be auto-bound at install time, removing the user's manual `supabase.contract<SupabaseContract>(json)` call?** The pinned-mirror story today requires the user to import the JSON and instantiate the handle. We could have the install step emit a thin wrapper module (`migrations/supabase/contract-handle.ts`) that does this once. Cleaner DX, slightly more codegen surface. Defer to user feedback.
