# postgres-rls

Row-Level Security is the central reason teams pick Supabase, but it's also a generic Postgres feature that any app authoring against Postgres can benefit from. This project introduces RLS policies and Postgres roles as **first-class target-only IR kinds**, with an authoring surface in both TypeScript (a fourth `.rls(...)` staged-builder method on the model) and PSL (top-level `policy <name> { … }` blocks scoped by namespace). Wire-level policy names are **content-addressed** — the user types a prefix, the framework appends an 8-hex SHA-256 suffix over a canonical normalization of the policy body — so the verifier never has to compare reparsed predicate strings, and policy renames are structurally free. Migration ops follow ADR 195's `OpFactoryCall` recipe. The verifier introspects `pg_policies` + `pg_roles` + `pg_class.relrowsecurity`; drift surfaces through the generic differ as `{coordinate, outcome}` issues (no framework RLS issue kinds). The IR is Postgres-only; the framework and SQL family layers stay unaware of RLS. Runtime role binding (session-coupled connection setup — `set_config(role/claims)` on the query's connection, `RESET ALL` on release) is out of scope and handled by the parallel [runtime-target-layer](../../docs/architecture%20docs/adrs/ADR%20230%20-%20Runtime%20target%20layer%20session-coupled%20connections.md) project (ADR 230).

## Purpose

Make Postgres Row-Level Security (RLS) **policies** and **roles** first-class elements of the contract — authored in TypeScript and PSL, represented in the IR, planned into migrations, and verified against the live database. Today RLS is a raw-SQL escape hatch the framework can't see; this project brings it under the same author → contract → migrate → verify loop as tables and columns. RLS is a generic Postgres capability (tenant isolation, role-based reads, audit immutability), so it is modeled as a **Postgres-target concern, not a Supabase one**; Supabase is just the first consumer.

---

## Design

The design is five decisions. Each is stated concretely, then names the requirement it satisfies. Authoritative detail for the largest (naming, authoring surface, the generic differ) lives in the linked docs and `plan.md § Architecture decisions`; everything an implementer needs to build is here.

### D1. Policies and roles are Postgres-target-only IR entities on `PostgresSchema.entries`

Two new IR node kinds, registered as Postgres **entity kinds** via `postgresAuthoringEntityTypes` (the same `AuthoringContributions.entityTypes` mechanism `PostgresEnumType` already uses), so they populate new slots on `PostgresSchema.entries`. There is **no `PostgresTable`** class — policies are stored at the schema level and keyed to their table by name.

```ts
// packages/3-targets/3-targets/postgres/src/core/ — Postgres-target-only IR.

class PostgresRlsPolicy {            // stored at entries['policy'][name]
  kind: 'postgres-rls-policy';
  name: string;          // FULL wire name: `${prefix}_${hash}` (see D2)
  prefix: string;        // what the user typed (the human-readable identity)
  tableName: string;     // the StorageTable it attaches to, by name, same namespace
  operation: 'select' | 'insert' | 'update' | 'delete' | 'all';
  roles: readonly string[];  // resolved role names, sorted + deduped (authored as refs — see D4)
  using?: string;        // USING predicate body, opaque SQL text (empty/absent ⇒ no USING)
  withCheck?: string;    // WITH CHECK predicate body, opaque SQL text
  permissive: boolean;   // true ⇒ AS PERMISSIVE (the default); false ⇒ AS RESTRICTIVE
}

class PostgresRole {                 // stored at entries['role'][name]
  kind: 'postgres-role';
  name: string;
  namespaceId: string;   // typically '__unbound__' (UNBOUND_NAMESPACE_ID) — roles are cluster-scoped
}
```

The table-level **RLS-enabled state** is Postgres-owned and is **not** a field on the family-shared `StorageTable` (that would leak a Postgres concept into SQL core — the layering violation the first foundation attempt made). For the common case the planner *derives* it: RLS is enabled on a table iff it has ≥1 declared policy, so it needs no authoring. An explicit per-table force-enable/disable, if a consumer ever needs it, lives in the Postgres target's own IR — not on the shared table node, and not in slice 1.

Both node classes extend the SQL IR base (`SqlNode`/`IRNodeBase`), call `freezeNode(this)`, and are JSON-canonical (per ADR 192).

> **Satisfies:** *RLS is a first-class, representable contract element* · *Postgres-only layering* (these types exist only in the Postgres target package; the framework and SQL-family layers never reference them — enforced by `pnpm lint:deps`).

### D2. Wire names are content-addressed: `<prefix>_<8-hex-hash>`

The user types a **prefix**; the framework appends a hash and stores the **full** name in `contract.json` and the database catalog. Equivalence between a declared policy and an introspected one is an **exact wire-name match — never a predicate-body comparison.**

The hash is the first 8 hex chars of SHA-256 over the canonical tuple:

```
( normalize(using), normalize(withCheck), sorted+deduped roles, operation, permissive )
```

`normalize` collapses internal whitespace and trims the authored predicate — minimal, authored-input stabilization only. It does **not** lowercase, strip parens, or strip comments; the hash is never recomputed from an introspected body so there is no reprinted form to match, and minimal normalization also protects the no-collision property. Schema and table identity are excluded (the catalog carries them separately). Full rationale, the exact tuple, and the stability commitment: [content-addressed-naming ADR](specs/adr-content-addressed-policy-names.md).

One consequence the planner and verifier rely on:
- **Rename is free.** Same hash + different prefix ⇒ a rename ⇒ `ALTER POLICY … RENAME TO`. No body diff.

> **Satisfies:** *No false drift.* Comparing reparsed or reprinted predicate bodies is fragile and unnecessary — Postgres rewrites predicate text at storage time, so any body-based comparison fires on nearly every real predicate. Content addressing makes the wire name the single equivalence relation; the verifier never compares bodies at all.

### D3. Two authoring surfaces lower to the identical IR

A TypeScript surface and a PSL surface both produce the same `PostgresRlsPolicy` (modulo `prefix`), verified by a parity test.

**TypeScript — a top-level, target-contributed helper taking the model handle**, surfaced by the same mechanism that exposes `helpers.enum(…)`. It is **not** a chained `.rls(…)` model-builder method (see Alternatives A1). The helper exists only when the Postgres pack is bound, so it is invisible to SQLite/Mongo authors.

```ts
const Profile = model('Profile', { namespace: 'public', fields: { /* … */ } })
  .sql(() => ({ table: 'profile' }));

// `appUser` is a role declared in the SAME contract space (see D4).
policySelect(Profile, { name: 'profiles_read_all', roles: [appUser], using: 'true' });
policyUpdate(Profile, {
  name: 'profiles_update_own', roles: [appUser],
  using: 'user_id = current_setting(\'app.user_id\')', withCheck: 'user_id = current_setting(\'app.user_id\')',
});
```

**PSL — per-operation block keywords** (`policy_select`, `policy_insert`, `policy_update`, `policy_delete`, `policy_all`), contributed by the Postgres target through the landed declarative PSL-block substrate. The keyword *is* the operation. Each keyword has a fixed parameter set — there is deliberately **no** single `policy { operation = … }` block (see Alternatives A2).

```prisma
namespace public {
  model Profile { id String @id @default(uuid()); userId String @unique; username String }
  role appUser

  policy_select profiles_read_all { target = Profile; roles = [appUser]; using = "true" }
  policy_update profiles_update_own {
    target = Profile; roles = [appUser]
    using = "user_id = current_setting('app.user_id')"; withCheck = "user_id = current_setting('app.user_id')"
  }
}
```

Field mapping (both surfaces): the keyword/helper name → `operation`; `name` → `prefix` (the full `name` is computed at lowering); `target` → `tableName`; `roles` → resolved role names; `using`/`withCheck` → predicate bodies; `permissive` defaults `true` (authored explicitly only to set `RESTRICTIVE`). PSL `target` must be in the same contract space — a cross-contract `target` is a load-time error (Postgres won't `CREATE POLICY` on a table you don't own).

> **Satisfies:** *Author RLS in either surface with identical results* · *Postgres-only surface* (the TS helper and PSL keywords appear only under the Postgres pack).

### D4. Roles are static references, not strings

`roles = [...]` entries are references to declared `PostgresRole` entities (`refKind: 'role'`), resolved by `entries['role'][name]` — which is why `PostgresRole` must register as the `role` *entity kind* (D1), not merely exist as a class. Resolution has two cases:

- **Same-space** (a role declared in the same contract, e.g. `appUser` above): resolves directly against `entries['role']`. This is what the base project ships and tests.
- **Cross-space** (a role owned by another contract space — e.g. the Supabase pack's `anon`/`authenticated`): a `scope: 'cross-space'` ref. The PSL-block substrate's cross-space ref validation is a deliberate no-op pass-through deferred to its first consumer — **this project** (`psl-extension-block-validator.ts:276-284`). Resolution is wired through the `(spaceId, namespaceId, 'role', name)` coordinate, reusing the cross-contract-refs aggregate machinery. Cross-space *role* refs are allowed (you reference roles you don't own all the time).

> **Satisfies:** *Role references track declarations* (a renamed role declaration updates referring policies) · *cross-space composition* with extension packs.

### D5. Verify and plan via a generic schema differ — no target-specific issue kinds

The verifier does **not** enumerate RLS issue kinds anywhere in the framework or SQL family (that was the layering violation in the first attempt). Instead:

- **Derive + introspect to one shape.** The contract lowers to a `SchemaIR` (the *expected* schema); the live DB introspects to a `SchemaIR` (the *actual* schema). Both sides are the same hierarchy, so comparison is homogeneous.
- **Generic diff.** A framework differ walks the two trees, aligning nodes by `identity()` and comparing matched pairs by `isEqualTo(other)` — both virtual methods on the IR node hierarchy. It emits only `{ coordinate, outcome: missing | extra | mismatch, expected?, actual? }`. There is **no `kind` vocabulary**; the framework references nothing about RLS.
- **Per-node planning.** Each node type defines `create / delete / update(from,to) → OpFactoryCall[]` (ADR 195) — methods on target-only nodes (policy/role); target-contributed strategies for family-shared nodes (SQLite/Postgres DDL diverge). `missing → create`, `extra → delete`, `mismatch → update`/drop+create. Coarse-bucket ordering sequences roles → tables → policies + `ENABLE ROW LEVEL SECURITY`.

RLS is the clean consumer: a policy's `identity()` *is* its content-addressed wire name (D2), so identity already settles equality. Introspection reads `pg_policies.policyname` verbatim (the catalog name is the wire name; Postgres never rewrites it). **Rename** (matching hash, different prefix → `ALTER POLICY … RENAME TO`) falls out of the generic extra/missing diff — no dedicated issue kinds, and no body inspection. The table RLS-enabled state and a missing role (`pg_roles` existence) are ordinary `mismatch`/`missing` outcomes. Severity for the control-policy-governed outcomes flows through the **landed** `ControlPolicy` disposition (`dispositionForCategory`), reused, not reinvented.

The generic differ ships scoped to the **top-level-entity layer** RLS needs; porting the relational kinds onto it is a separate project (`plan.md` follow-on A). Until then the legacy per-kind verifier runs **side-by-side**, untouched; the new path emits only `{coordinate, outcome}` into its own channel and never produces a framework `SchemaIssue`. Design detail: `plan.md § Architecture decisions`.

> **Satisfies:** *RLS is migrated and verified with zero framework/SQL-family knowledge of it* (the layering invariant the first attempt broke) · *no false drift* (content-addressed identity) · *control-policy composition, not reinvention.*

---

## Non-goals

- **Runtime role binding.** The session-coupled connection mechanism (`set_config(role/claims)` on the query's connection + `RESET ALL` on release, per ADR 230) that makes `auth.uid()` resolve correctly inside policies at query time belongs to the parallel [runtime-target-layer](../../docs/architecture%20docs/adrs/ADR%20230%20-%20Runtime%20target%20layer%20session-coupled%20connections.md) project. This project ships the static contract side of RLS; the dynamic per-query side is separate.
- **Supabase-specific role declarations and predefined policy patterns.** The Supabase extension's `roles.anon` / `roles.authenticated` / `roles.service_role` declarations, plus any "policy pack" of pre-canned Supabase policies, belong to the [extension-supabase](../extension-supabase/spec.md) project. This project builds the substrate; that project ships the Supabase content.
- **Functions as first-class IR.** `auth.uid()`, `auth.jwt()`, and friends are opaque references inside policy predicate strings. The framework's existing `DefaultFunctionRegistry` covers the "function-as-column-default" case (per umbrella decision **C4**); promoting functions to a fully introspected IR kind (with `pg_proc` verification, planner DDL, body content-addressing under **OC4**) is deferred entirely.
- **Role attribute management.** `LOGIN`, `INHERIT`, `REPLICATION`, password hashes, role membership graphs, ownership transfer — none of these are in `PostgresRole` v0.1. The IR carries just the name. Role provisioning (`CREATE ROLE` / `DROP ROLE` / `ALTER ROLE`) for `managed` roles is deferred; v0.1 only verifies that declared roles exist in `pg_roles`.
- **PSL `${...}` string interpolation.** The PSL equivalent of TS's `ref()` helper. Captured as umbrella offcut **OC3**; deferred until a real authoring-pain signal arrives.
- **`policyGroup` for shared-target policies.** A `policyGroup UserPolicies { target = User; policy ... { ... }; }` form that hoists shared properties was sketched during shaping. Captured as umbrella offcut **OC2**; deferred from v0.1.
- **Backport of content-addressed naming to other Postgres objects** (indexes, functions, views, check constraints). The naming pattern is generalizable, but each per-kind backport carries its own normalizer design + DBA-UX trade-offs. Captured as umbrella offcut **OC4**; deferred. Future projects can reach for the pattern instead of reinventing it.
- **Detecting out-of-band tampering of hashed policies.** A manual `ALTER POLICY` run outside the framework on a content-addressed policy is unsupported. The wire name is the equivalence relation and the framework never compares predicate bodies, so a hand-altered policy body is not detected. The result is the same as any other unrecognized catalog policy on a managed table (extra → drop on next migrate).

## Dependencies and seams (all landed)

This project fills existing extension points; nothing it needs is unbuilt. The seams an implementer touches:

- **target-extensible-ir (TML-2459):** the `SqlNode`/`IRNodeBase` base + `freezeNode`; the `entityTypes` contribution point (D1); the `ContractSerializer` seam; the `UNBOUND_NAMESPACE_ID = '__unbound__'` sentinel. **Note:** its `verifyTargetExtensions()` hook returns the *closed* framework `SchemaIssue[]`; the generic differ (D5) **supersedes** that channel rather than extending it (returning RLS kinds through it is what forced the original union-widening leak).
- **control-policy (TML-2493, [ADR 224](../../docs/architecture%20docs/adrs/ADR%20224%20-%20Control%20Policy%20—%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md)):** the `ControlPolicy` enum + the two-layer verifier/planner dispatch this project's severity flows through (D5).
- **target-contributed-psl-blocks:** the declarative `AuthoringPslBlockDescriptor` SPI (`ref`/`value`/`option`/`list` params, generic parser/printer, `entries[kind][name]` storage) through which the Postgres pack contributes the `policy_*` keywords (D3).
- **cross-contract-refs (TML-2500):** `extensionModel(…)` handles carrying `{ namespaceId, tableName }` (consumed for the TS `ref()` predicate helper, no integration needed) + the aggregate/coordinate machinery reused for cross-space role resolution (D4).

Ground-truth mapping of these landed seams to real file paths: [`specs/reconciliation-2026-06-08.md`](specs/reconciliation-2026-06-08.md). IR nodes are JSON-canonical (ADR 192); migration ops use `OpFactoryCall` (ADR 195). Consumed by [extension-supabase](../extension-supabase/spec.md). Sequencing across slices lives in [`plan.md`](plan.md), not here.

This project can run in parallel with [cross-contract-refs](../cross-contract-refs/spec.md) and [runtime-target-layer](../../docs/architecture%20docs/adrs/ADR%20230%20-%20Runtime%20target%20layer%20session-coupled%20connections.md) once TML-2459 + control-policy have landed. Composition with cross-contract-refs is purely consumer-side (the TS `ref()` helper accepts cross-contract handles transparently); composition with runtime-target-layer is "this project ships the static contract, that one ships the dynamic per-query session-var injection."

## Requirements the design must satisfy

Invariants every slice upholds (the design above is built to satisfy them; they are the acceptance bar, not a puzzle to infer the design from):

- **Postgres-only layering — no exceptions.** No framework or SQL-family file references RLS: not a visitor, not a type, not an issue kind, not a field. After every slice, `pnpm lint:deps` is clean **and** no RLS string/identifier appears in any framework or SQL-family/core file. RLS verifier findings are generic `{coordinate, outcome}` issues (D5), never framework `SchemaIssue` members — widening that union is exactly the violation the first foundation attempt made, and is forbidden.
- **Content-addressed naming is the only equivalence relation** wherever policies are compared (authoring, diff, verify). No code path compares predicate bodies at all. The normalizer's output never leaks past the hash input. Diagnostics name the user's **prefix** only, never the hash suffix.
- **Round-trip fidelity.** `deserialize(serialize(contract))` preserves every `PostgresRlsPolicy`/`PostgresRole` field, including the prefix-vs-full-name asymmetry.
- **No non-Postgres regression** at any slice boundary (`pnpm test:packages` + integration suites green; SQLite + Mongo untouched).
- **CI-green increments, legacy untouched.** Every slice keeps `main` green and SQLite/Mongo untouched. The new generic differ runs **side-by-side** with the legacy per-kind verifier (which this project does not modify) and emits only new-native structures; the legacy verifier is retired later by the relational-port project, not here.

## Definition of Done

Inherits the team-DoD floor ([`drive/calibration/dod.md`](../../drive/calibration/dod.md)). Project-specific close conditions (each verifies a design decision above):

- [ ] A TS contract and a PSL contract declaring the same policies lower to **structurally identical** `PostgresRlsPolicy` IR (modulo prefix), each carrying the content-hash wire name; round-trip through `contract.json` is lossless. The TS helpers are absent from a SQLite/Mongo author's surface. *(D1, D3)*
- [ ] A TS `using: ({ ref }) => …${ref(AuthUser)}…` predicate lowers `ref()` to the qualified identifier read from the handle; renaming a referenced local model's table updates the predicate and recomputes the hash. *(D2, D4)*
- [ ] Against live Postgres (PGlite), through the generic differ (`{coordinate, outcome}` issues, no framework RLS kinds): present-and-declared → clean; declared-not-present → create; present-not-declared → drop (severity per control policy); matching-hash-different-prefix → `ALTER POLICY … RENAME TO`; policies declared with RLS off → `ENABLE`. *(D2, D5)*
- [ ] A declared `PostgresRole` absent from `pg_roles` surfaces `missing_role` (a `fail` even under `control: 'external'`). *(D4, D5)*
- [ ] **Walking skeleton:** `examples/supabase` `Profile` gains `anon` SELECT + `authenticated` UPDATE-own policies; `bootstrapSupabaseShim` is extended with the Postgres roles + `auth.uid()`/`auth.jwt()`/`auth.role()` SQL functions reading session GUCs; a hermetic PGlite test proves RLS filters rows under a manual `SET ROLE`, and the verifier diffs clean. *(D3, D4, D5 end-to-end)*
- [ ] `pnpm lint:deps` confirms no RLS reference in framework/SQL-family layers; SQLite + Mongo suites green. *(layering)*
- [ ] The [content-addressed-naming ADR](specs/adr-content-addressed-policy-names.md) is promoted into `docs/architecture docs/adrs/`; the Postgres adapter subsystem doc gains an RLS section.
- [ ] An ADR is written for the two authoring SPIs slice 3 introduced — `AuthoringContributions.modelAttributes` (target-contributed `@@` model attributes) and `AuthoringPslBlockDescriptor.requiresModelAttribute` (declarative "target model must carry attribute X"). Both are durable public framework surface with a single consumer today (`@@rls`); the ADR records the shape, the framework-declares/family-enforces/target-names split, and the deliberate one-pair expressiveness of `requiresModelAttribute`. *(raised in the PR #945 architect review; deferred to close-out per the ADRs-at-close-out convention.)*

## Alternatives considered

### Authoring surface (D3)

- **A1 — a chained `.rls(…)` model-builder method.** Rejected: there is no target identity on the shared model-builder type to gate a Postgres-only method on, so it would leak into SQLite/Mongo author surfaces. The established Postgres-only authoring affordance (`enum`) is a top-level helper, not a builder method — D3 follows that precedent. Full comparison: [design-rls-authoring-surface.md](specs/design-rls-authoring-surface.md).
- **A2 — a single PSL `policy { operation = … }` block.** Rejected: the declarative PSL-block substrate deliberately rejects conditional-body blocks (a block's parameter set must be fixed). Per-operation keywords (`policy_select`, …) give each a fixed, unconditional parameter set.

### Verifier architecture (D5)

- **Widen the framework `SchemaIssue` union target-side (rejected).** The interim pattern the codebase documents and that `EnumValuesChangedIssue` already follows — it puts a Postgres concept in the framework. That's the layering violation the first foundation attempt made. The generic differ removes the need: issues are `{coordinate, outcome}`, so the framework enumerates nothing. (Enum is prior art for the same bug, not a precedent.)
- **Diff the contract IR directly against the introspected schema IR (rejected).** They are two non-isomorphic hierarchies (different field names/shapes). Instead derive *both* sides to one canonical `SchemaIR` and diff homogeneously, so node `identity()`/`isEqualTo()` are well-typed and per-kind canonicalization (type/default normalization, FK-backing-index + unique↔index synthesis) concentrates in the derivation, leaving the diff a pure walk.
- **Reseat all 25 relational kinds onto the differ in this project (rejected).** Off RLS's critical path; deferred to its own project (`plan.md` follow-on A). The differ ships scoped to the top-level layer RLS needs, side-by-side with the untouched legacy verifier.

### Equivalence / naming (D2)

Four designs preceded content-addressing; all rejected (detail + analysis in the [ADR](specs/adr-content-addressed-policy-names.md)):
- **Verbatim body match** — false positives on nearly every predicate (Postgres reparses on store).
- **Verbatim + cheap normalizer** — still false-positives on cast forms and non-outer paren grouping.
- **Canonicalize-at-CREATE read-back** — robust, but couples the planner to a post-`CREATE` query and adds a second IR body field.
- **JS-side Postgres-grammar parser** — heaviest dependency, must track Postgres versions.

### Settled defaults (previously tracked as open questions)

- **Normalizer home:** target-internal `packages/3-targets/3-targets/postgres/src/core/rls/canonicalize.ts`, written to lift cleanly into a shared module if a second content-addressing consumer arrives. *(Landed in the foundation slice.)*
- **Role attributes:** omitted; roles are opaque names. Add `attributes?: { login?: boolean }` only when a real consumer needs `pg_roles.rolcanlogin` validation.
- **`ALTER POLICY` vs drop+create boundary:** mirror Postgres's documented `ALTER POLICY` matrix — rename, role change, and supported predicate changes in place; operation change and `permissive`↔`restrictive` fall back to drop+create.

### Still open

- **TS helper signature: per-operation (`policySelect(…)`, `policyUpdate(…)`) vs a single array helper**, and how model-level enable/disable rides. Decided at authoring-breadth slice planning (the tracer ships `policy_select` only and sidesteps it).
- **Two-body-form ADR** (an old `field Type @attrs` vs `key = value` deliverable): likely subsumed by the PSL-block substrate's own ADR. Confirm at authoring-breadth planning; drop if covered.

## References

- Linear project: [Postgres RLS](https://linear.app/prisma-company/project/postgres-rls-b7329340dbb2) — holds the project issue [TML-2501](https://linear.app/prisma-company/issue/TML-2501) and the five slice issues (TML-2868, 2869, 2870, 2871, 2876). Decomposed from the parent umbrella [Supabase Integration](https://linear.app/prisma-company/project/supabase-integration-08e7667f5de4).
- Plan + slice sequencing: [`plan.md`](plan.md).
- Project ADR (promote at close-out): [`specs/adr-content-addressed-policy-names.md`](specs/adr-content-addressed-policy-names.md).
- Authoring-surface decision detail: [`specs/design-rls-authoring-surface.md`](specs/design-rls-authoring-surface.md).
- Landed-seam → file-path map: [`specs/reconciliation-2026-06-08.md`](specs/reconciliation-2026-06-08.md).
- Architecture: [ADR 192 — ops.json](../../docs/architecture%20docs/adrs/ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md), [ADR 195 — Planner IR](../../docs/architecture%20docs/adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md), [ADR 224 — Control Policy](../../docs/architecture%20docs/adrs/ADR%20224%20-%20Control%20Policy%20—%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md).
- Sibling specs: [cross-contract-refs](../cross-contract-refs/spec.md), [runtime-target-layer](../runtime-target-layer/spec.md), [extension-supabase](../extension-supabase/spec.md), [target-contributed-psl-blocks](../target-contributed-psl-blocks/spec.md).
- [Umbrella project — Supabase integration](../supabase-integration/README.md) — context for why this project exists.
- [TML-2459 — Target-Extensible IR spec](../target-extensible-ir/spec.md) — dependency for the target-only IR kind shape, the `SchemaVerifier` / `ContractSerializer` SPI seams.
- [control-policy project spec](../control-policy/spec.md) — the parallel project owning the `managed` / `tolerated` / `external` / `observed` enum that this project's verifier dispatches against.
- [cross-contract-refs project spec](../cross-contract-refs/spec.md) — the parallel project whose model-handle brands the TS `ref()` helper consumes transparently.
- [runtime-target-layer project / ADR 230](../../docs/architecture%20docs/adrs/ADR%20230%20-%20Runtime%20target%20layer%20session-coupled%20connections.md) — the parallel project shipping runtime role binding.
- [extension-supabase project spec](../extension-supabase/spec.md) — the parallel project consuming this one to declare Supabase roles + serve as the canonical demo.

## Open Questions

- **Where does the canonical normalizer live in the package layout?** Three plausible homes: (a) inside the Postgres target's `core/rls/` directory, scoped to RLS use only; (b) a shared `core/canonicalize-sql/` module reusable for future content-addressed objects (indexes, functions, views per **OC4**); (c) a Postgres-target-internal `core/content-addressing/` module that knows about all currently-content-addressed object kinds. Path (b) is the most architecturally clean; path (a) is the most YAGNI. Recommend (a) for v0.1 with a deliberate refactor when the next content-addressed object lands.
- **Should `PostgresRole` v0.1 carry the `loginRole: boolean` distinction?** Postgres roles split into login and non-login (the historical `USER` vs `GROUP` distinction). Some Supabase flows reference both kinds. v0.1 working assumption: omit; treat all declared roles as opaque names. If a user needs `loginRole: true` to validate `LOGIN` attribute via `pg_roles.rolcanlogin`, add it under an `attributes?: { login?: boolean }` shape rather than promoting it to top-level.
- **`ALTER POLICY` ALTER vs DROP+CREATE fallback policy.** Postgres supports `ALTER POLICY ... RENAME TO`, `ALTER POLICY ... TO <roles>`, and a limited form of `ALTER POLICY ... USING (...) WITH CHECK (...)`. Other shapes (e.g. changing `permissive ↔ restrictive`, changing the operation) require DROP + CREATE. The decision boundary between in-place ALTER and drop-then-create is mechanical but tedious; the implementer should mirror Postgres's documented `ALTER POLICY` capability matrix exactly, with the fallback being drop + create.
