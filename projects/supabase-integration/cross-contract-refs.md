# Cross-contract-space FK references

## Problem

The Supabase example needs a FK from `public.profiles.user_id` to `auth.users.id`. Both tables exist in the same database, but they live in *different contract spaces*: `public.profiles` belongs to the app contract, `auth.users` belongs to the Supabase extension contract. The framework already supports FKs within a contract (and, post TML-2459, across namespaces within a contract). Cross-*contract-space* FKs are the gap.

This shape isn't Supabase-specific. Any extension that publishes an externally-managed contract space will hit the same need: app code wants to reference extension tables.

## Design intent

### Authoring surface — TypeScript

```ts
import { supabase } from '@prisma-next/extension-supabase';
import supabaseContractJson from '../migrations/supabase/contract.json' with { type: 'json' };
import type { Contract as SupabaseContract } from '../migrations/supabase/contract.d';

const supabaseContract = supabase.contract<SupabaseContract>(supabaseContractJson);

m.model('Profile', {
  fields: {
    userId: m.field.uuid().constraints(
      m.constraints.refIn(supabaseContract, 'AuthUser', 'id'),
    ),
  },
});
```

`refIn(otherContract, ModelName, fieldName)`:
- `otherContract` — a typed handle to the other contract space. Carries the contract's `spaceId` at runtime; provides typed completion for the next two arguments at authoring time.
- `ModelName` — string literal name of the target model in that contract.
- `fieldName` — string literal name of the target field.

`m.constraints.ref(otherModel)` (within a contract) takes the model as an argument because the model object is in scope. `refIn` takes the contract first because the model isn't in lexical scope — only the contract handle is. The asymmetry is intentional: it makes "this is a cross-space reference" visually obvious at the call site.

### Authoring surface — PSL

Trickier than TS because PSL doesn't have an import grammar today. Sketch:

```psl
// schema.psl
extension supabase from "@prisma-next/extension-supabase"

model Profile {
  id      String @id @default(uuid())
  userId  String @references(supabase.AuthUser.id)
  // …
}
```

The `extension <name> from "<pkg>"` directive binds a name to the imported contract space at PSL parse time. `supabase.AuthUser.id` is then resolvable. The PSL extension grammar piece is the one new bit of syntax we'd need. **This is an open design question; the TS path is the source of truth and PSL can follow in a later increment if scope tightens.**

### IR shape

The FK reference carrier in the IR gains a `source` discriminator:

```ts
type TargetFieldRef =
  | { readonly source: 'local'; readonly modelName: string; readonly fieldName: string }
  | {
      readonly source: 'space';
      readonly spaceId: string;
      readonly namespace: NamespaceCoordinate;
      readonly tableName: string;
      readonly columnName: string;
    };
```

- `source: 'local'` is what TML-2459's M5b produces for within-space cross-namespace FKs.
- `source: 'space'` adds the explicit `spaceId` + namespace coordinate so the reference is fully qualified independent of lexical context.

The `spaceId` is the same identifier the contract aggregate already uses to load contract spaces (via TML-2397). When the verifier or planner sees a `source: 'space'` carrier, it walks to that space in the loaded aggregate to resolve the target.

### Resolution

Resolution happens at the lowering boundary (Contract IR → Schema IR), against the **loaded contract aggregate**, not against any single contract. The aggregate is the same one TML-2397 already constructs.

The lowering pass:

1. For each `source: 'local'` FK ref: resolve within the current contract (existing behaviour).
2. For each `source: 'space'` FK ref: look up the named space in the aggregate, then look up the model, then look up the field. Materialise the resolved namespace + table + column coordinates into the Schema IR FK constraint.
3. If the named space isn't in the aggregate, or the model/field doesn't exist there, lowering errors out with a clear diagnostic — "FK references space `supabase` model `AuthUser`, but no such contract space is loaded; did you add `supabase()` to `extensionPacks`?"

### Verifier behaviour

The verifier walks the loaded aggregate and compares against the introspected schema. For cross-space FKs:
- The FK constraint itself is verified against `pg_constraint` exactly the same way local FKs are.
- The *target* table is verified by its own posture (externally-managed for `auth.users`, so it's verified to exist with compatible shape but no DDL is emitted for it).
- These are two independent checks that happen to chain through the same FK.

### Planner / DDL emission

The planner emits a fully qualified `REFERENCES` clause:

```sql
ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_user_id_fkey"
  FOREIGN KEY ("user_id")
  REFERENCES "auth"."users"("id");
```

Postgres FK syntax already supports cross-schema references natively; we just need to render the qualified target.

The planner does *not* emit any DDL for the target table itself (it's externally-managed in the Supabase contract). The combination "FK is `modeled` (we own this FK), target table is `externally-managed` (we don't own that table)" is the normal case for cross-contract refs and works without special-casing.

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
- **PSL surface for extension imports.** TS is clear; PSL needs new syntax. We could either (a) design `extension <name> from "<pkg>"` carefully, (b) ship TS-only `refIn` for v0.1 and add PSL later, (c) make `refIn` work in PSL via a magic-comment escape hatch. Working assumption: **(b) ship TS-only `refIn` for v0.1, design PSL later.** The Supabase example app is TS-first; PSL users have a smaller subset of v0.1 capability.
- **Cascading actions across spaces.** PostgreSQL supports `ON DELETE CASCADE` etc. across schemas. Do we permit them across contract spaces? Probably yes — the DDL is fine, it's just the verifier that needs to be a little more careful (a cross-space `ON DELETE CASCADE` from a `modeled` table to an `externally-managed` table makes the externally-managed table's lifecycle leak into our planner's awareness). Working assumption: **permit, document the implication.**
- **What's the typed handle returned by `supabase.contract<SupabaseContract>(json)`?** Is it the same shape as `validateContract`'s replacement (the SPI-based `target.contractSerializer.deserializeContract`)? Probably yes — same machinery, with the extension package providing a thin convenience wrapper that ties the contract type to its `spaceId`. Specifics to settle when implementing.
