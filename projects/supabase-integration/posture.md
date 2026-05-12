# Posture — modeled / tolerated / externally-managed / drift

## Problem

The framework needs to know its relationship to each database-persisted object's lifecycle. Today the implicit assumption is "I own this; I create it, I migrate it, I verify it." That assumption is fine for greenfield apps but breaks the moment we ship an extension that *describes* objects the framework isn't responsible for migrating — Supabase's `auth.users` table is the motivating example.

"Externally managed" sounds like one binary toggle, but it isn't. There are at least four positions the framework can take towards a given object, each with different verifier and planner behaviour. We want to name them explicitly so every IR node carries an unambiguous posture.

## Design intent

**Posture is a generic, target-agnostic property** that lives in the framework domain. It applies to any IR node that represents a database-persisted object **declared in the contract** (tables, columns, indexes, constraints, RLS policies, …). Targets can extend the set of postures if they need to, but the four below are framework-level. Functions are not contract elements in v0.1 (see § "Functions are not contract elements in v0.1" below).

| Posture | Verifier behaviour | Planner / migration behaviour |
|---|---|---|
| `modeled` | Must exist and match exactly. Any drift is an error. | Full lifecycle: create, alter, drop. |
| `tolerated` | Must exist; columns we declare must match; **extra columns are allowed**. | Create if missing on initial migration. Don't alter to remove undeclared columns. Don't drop. |
| `externally-managed` | Must exist and have the columns we declare with compatible shape; **extra columns and additional constraints/indexes/triggers are allowed and ignored**. | Never emit any DDL for it. |
| `drift` | Allowed to exist or not exist; allowed to mismatch. Verifier emits warnings, not errors. | Never emit any DDL for it. |

The four postures form a spectrum from "we own it completely" (`modeled`) to "we don't care about it but want it on the IR for documentation/typing purposes" (`drift`).

### Posture defaults

- Application contracts default to `modeled` for all declared objects. A user can override per-object.
- Extension contracts can declare a contract-level default and per-object overrides. The Supabase extension's contract declares everything as `externally-managed` at the contract level; the user doesn't see this knob.

### Where posture lives in the IR

A property on the relevant IR node declaration, e.g.:

```ts
interface TableDeclaration {
  readonly name: string;
  readonly namespace: Namespace;
  readonly columns: readonly ColumnDeclaration[];
  readonly posture: Posture;
  // ...
}
```

Same for indexes, constraints, RLS policies, etc. — posture is per-object, not per-contract, because a single contract might mix postures (rare for v0.1, but the IR shouldn't forbid it).

### Functions are not contract elements in v0.1

Posture is a property of **declared contract elements**. Functions (`auth.uid()`, `auth.jwt()`, `gen_random_uuid()`, etc.) are deliberately not contract elements in v0.1:

- **Within RLS predicates** they are opaque substrings of opaque strings — see [`rls.md`](rls.md) "Predicate language" and [`decisions.md` A5 / B5](decisions.md). The framework never parses what's inside a predicate; Postgres errors at migration time if the predicate is invalid.
- **As column-default invocations** they go through the existing framework `DefaultFunctionRegistry` (`packages/1-framework/1-core/framework-components/src/shared/mutation-default-types.ts`) — a control-plane registry of named default-value generators with lowering handlers. Registry entries are not contract elements and are not verified against `pg_proc`.

This means the Supabase extension contract declares **no functions** in v0.1. The Supabase pack may extend `DefaultFunctionRegistry` with `auth.uid()` / `auth.jwt()` / `auth.role()` *if* we decide to support them as column defaults (open; not blocking — flows that need it can fall back to the raw escape hatch). Either way, the IR is unchanged.

Promoting functions to first-class IR (with posture, verifier introspection of `pg_proc`, planner DDL) is captured as a stretch alongside the trigger work — see [`overview.md`](overview.md) "Stretch goals." It's not on the v0.1 critical path because none of the four typical Supabase flows actually need it (FKs to `auth.users`, UUID generation, RLS predicates, server-defaulted columns all work through existing mechanisms).

### Authoring surface

For an extension author writing a `contract.json` by hand:

```jsonc
{
  "namespaces": ["auth"],
  "models": {
    "AuthUser": {
      "namespace": "auth",
      "posture": "externally-managed",
      "tableName": "users",
      "fields": { /* … */ }
    }
  }
}
```

For an app author who *wants* to declare an externally-managed object inline (rare, but possible), the DSL surface looks something like:

```ts
m.model('LegacyAuditLog', {
  posture: 'externally-managed',
  namespace: 'public',
  fields: { /* … */ },
});
```

This is mostly a power-user feature. The 80% case is "extensions ship externally-managed contracts; apps ship modeled contracts." We don't expect typical app authors to touch posture.

### Verifier dispatch

The verifier already walks the loaded contract aggregate and compares against the introspected schema. It learns one new behaviour: per node, consult the node's posture, then apply the matching comparison strategy. The four strategies are short:

- `modeled`: exact-match comparison; any difference is a violation.
- `tolerated`: declared properties must match; extra properties on the introspected side are allowed.
- `externally-managed`: declared properties must match with compatible shape (e.g., column types are *assignment-compatible* not necessarily identical); everything else is ignored.
- `drift`: log only, never fail.

This is a small dispatch table inside the verifier's compare loop. No structural change to the verifier; just a per-node policy lookup.

### Planner dispatch

The migration planner also consults posture per node:

- `modeled`: full lifecycle ops (`CREATE TABLE`, `ALTER TABLE ADD COLUMN`, `DROP TABLE`, …).
- `tolerated`: emit creation ops only when the object is missing; never emit ALTER/DROP.
- `externally-managed`: never emit any ops for this node.
- `drift`: never emit any ops.

Cross-cutting safety check: the planner refuses to emit ops that *target* an externally-managed namespace, even if the user appears to have declared a `modeled` object there. This prevents an app from accidentally trying to migrate Supabase's `auth` schema by mis-declaring a model.

## Open questions

- **Is `drift` worth shipping in v0.1?** It's the most permissive posture and arguably exists only for documentation/typing in the IR. Could be deferred without losing the Supabase use case. Working assumption: ship the four together because the dispatch table is the same shape regardless.
- **Do columns within a table inherit their parent table's posture, or is per-column posture distinct?** Probably inherit by default with optional per-column override. Per-column posture matters if (e.g.) an extension's table has some columns the framework verifies strictly and some it tolerates. Not pressing for Supabase v0.1 — the working assumption is "inherit, no per-column override yet."
- **Is "compatible shape" defined target-by-target?** For Postgres an `int4` column declared as `int8` is incompatible; for some types the compatibility relation is asymmetric. The verifier needs a target-supplied shape-compatibility check. TML-2459's family abstract bases are the right place for this.
- **How does posture interact with introspection-based emit (future)?** When we eventually grow a "describe an existing database" tool, what posture do introspected objects get by default? Likely `externally-managed` if introspecting an extension's schemas, `tolerated` if introspecting an app's own schema for an "adopt existing migrations" workflow. Future concern.
