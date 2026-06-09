# postgres-rls

## Purpose

Make Postgres Row-Level Security (RLS) **policies** and **roles** first-class elements of the contract — authored in TypeScript and PSL, represented in the IR, planned into migrations, and verified against the live database. Today RLS is a raw-SQL escape hatch the framework can't see; this project brings it under the same author → contract → migrate → verify loop as tables and columns. RLS is a generic Postgres capability (tenant isolation, role-based reads, audit immutability), so it is modeled as a **Postgres-target concern, not a Supabase one**; Supabase is just the first consumer.

---

## Design

The design is six decisions. Each is stated concretely, then names the requirement it satisfies. Authoritative detail for the two largest (naming, authoring surface) lives in the linked docs; everything an implementer needs to build is here.

### D1. Policies and roles are Postgres-target-only IR entities on `PostgresSchema.entries`

Two new IR node kinds, registered as Postgres **entity kinds** via `postgresAuthoringEntityTypes` (the same `AuthoringContributions.entityTypes` mechanism `PostgresEnumType` already uses), so they populate new slots on `PostgresSchema.entries`. There is **no `PostgresTable`** class — policies are stored at the schema level and keyed to their table by name.

```ts
// packages/3-targets/3-targets/postgres/src/core/ — Postgres-target-only IR.

class PostgresRlsPolicy {            // stored at entries['rlsPolicy'][name]
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

The family-shared table node gains one field:

```ts
// packages/2-sql/1-core/contract/src/ir/storage-table.ts (already carries control?: ControlPolicy)
StorageTable.rls?: 'auto' | 'enabled' | 'disabled';   // default 'auto'; omitted from JSON when 'auto'
```

`rls` semantics: **`'auto'`** ⇒ the planner enables RLS on the table iff it has ≥1 declared policy (the common case, so it needs no authoring). **`'enabled'`** / **`'disabled'`** force the state regardless of policy count.

Both node classes extend the SQL IR base (`SqlNode`/`IRNodeBase`), call `freezeNode(this)`, and are JSON-canonical (per ADR 192).

> **Satisfies:** *RLS is a first-class, representable contract element* · *Postgres-only layering* (these types exist only in the Postgres target package; the framework and SQL-family layers never reference them — enforced by `pnpm lint:deps`).

### D2. Wire names are content-addressed: `<prefix>_<8-hex-hash>`

The user types a **prefix**; the framework appends a hash and stores the **full** name in `contract.json` and the database catalog. Equivalence between a declared policy and an introspected one is an **exact wire-name match — never a predicate-body comparison.**

The hash is the first 8 hex chars of SHA-256 over the canonical tuple:

```
( normalize(using), normalize(withCheck), sorted+deduped roles, operation, permissive )
```

`normalize` collapses whitespace, trims fully-enclosing outer parens, and lowercases SQL keywords **outside** string literals (literal contents are preserved — case-sensitive data). Schema and table identity are excluded (the catalog carries them separately). Full rationale, the exact tuple, and the stability commitment: [content-addressed-naming ADR](specs/adr-content-addressed-policy-names.md).

Two consequences the planner and verifier rely on:
- **Rename is free.** Same hash + different prefix ⇒ a rename ⇒ `ALTER POLICY … RENAME TO`. No body diff.
- **Tamper detection is cheap.** Recompute the hash from an introspected row and compare to the suffix in its name; a mismatch means someone ran `ALTER POLICY` outside the framework.

> **Satisfies:** *No false drift.* Postgres reparses and reprints predicate bodies at `CREATE POLICY` time (`auth.uid()::uuid` ↔ `(auth.uid())::uuid`, paren grouping, keyword casing), so a byte-comparing verifier would fire on nearly every real predicate. Content addressing makes the wire name the single equivalence relation, eliminating that noise.

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

### D5. The planner emits RLS DDL; the verifier diffs by wire name

**Planner** (migration ops follow ADR 195's `OpFactoryCall` pattern): per table with declared policies and `rls` ∈ {`auto`, `enabled`} → `ENABLE ROW LEVEL SECURITY`; per policy, diff declared vs introspected by full wire name → `CREATE` / `DROP` / `ALTER POLICY`; matching-hash-different-prefix → `ALTER POLICY … RENAME TO`; changes Postgres can't `ALTER` in place (operation change, `permissive`↔`restrictive`) → drop + create.

**Verifier** fills the empty `PostgresSchemaVerifier.verifyTargetExtensions()` stub: introspect `pg_policies`, `pg_roles`, `pg_class.relrowsecurity`; diff by wire name and emit:

| Condition | Issue kind | Severity source |
| --- | --- | --- |
| declared, not present | `missing_rls_policy` | table's `ControlPolicy` |
| present, not declared | `extra_rls_policy` | table's `ControlPolicy` |
| matching hash, different prefix | `rls_policy_renamed` | always surfaces |
| introspected hash ≠ name suffix | `rls_policy_tampered` | always surfaces |
| policies declared, RLS off | `rls_not_enabled` | always surfaces |
| declared role absent from `pg_roles` | `missing_role` | always a `fail` |

Severity for the control-policy-governed kinds comes from the **landed** two-layer dispatch (`classifySqlVerifierIssueKind` → `dispositionForCategory` → `fail | warn | suppress`); this project classifies the new kinds and **does not reinvent** the dispatch. The structural kinds (`renamed`/`tampered`/`not_enabled`) always surface; their planner response is dispatch-driven.

> **Satisfies:** *RLS is migrated and verified like any other contract element* · *control-policy composition, not reinvention.*

---

## Non-goals

- **Runtime session-variable injection** (`SET LOCAL role`, `SET LOCAL request.jwt.claims`) — what makes `auth.uid()` resolve per request. Owned by [runtime-target-layer](../runtime-target-layer/spec.md) + [extension-supabase](../extension-supabase/spec.md). This project ships the **static** contract side only; policy correctness is proven in tests by setting the role manually (`SET ROLE`) until the runtime lands.
- **Supabase-specific role declarations and policy packs** (`anon`/`authenticated`/`service_role`, "profile-on-signup"). Owned by [extension-supabase](../extension-supabase/spec.md). This project builds the substrate; that project ships the content. (The base project's own tests use a same-space `appUser`-style role; the Supabase roles arrive as the cross-space case in the final slice.)
- **Functions as first-class IR.** `auth.uid()`, `auth.jwt()` stay opaque text inside predicate strings. No `pg_proc` verification, no function DDL.
- **Role attribute management.** No `LOGIN`/`INHERIT`/`REPLICATION`, passwords, membership graphs, or `CREATE/DROP ROLE`. `PostgresRole` carries name + namespace only; the verifier checks declared roles exist in `pg_roles`, nothing more.
- **PSL `${…}` predicate interpolation** (the PSL analogue of TS's `ref()` predicate helper) — deferred.
- **`policyGroup` shared-target hoisting** and **content-addressing for indexes/views/checks/functions** — deferred; the ADR records forward applicability so a future project reaches for the pattern rather than reinventing it.

## Dependencies and seams (all landed)

This project fills existing extension points; nothing it needs is unbuilt. The seams an implementer touches:

- **target-extensible-ir (TML-2459):** the `SqlNode`/`IRNodeBase` base + `freezeNode`; the `entityTypes` contribution point (D1); the `ContractSerializer` seam; and **the empty `PostgresSchemaVerifier.verifyTargetExtensions()` stub this project fills** (D5); the `UNBOUND_NAMESPACE_ID = '__unbound__'` sentinel.
- **control-policy (TML-2493, [ADR 224](../../docs/architecture%20docs/adrs/ADR%20224%20-%20Control%20Policy%20—%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md)):** the `ControlPolicy` enum + the two-layer verifier/planner dispatch this project's severity flows through (D5).
- **target-contributed-psl-blocks:** the declarative `AuthoringPslBlockDescriptor` SPI (`ref`/`value`/`option`/`list` params, generic parser/printer, `entries[kind][name]` storage) through which the Postgres pack contributes the `policy_*` keywords (D3).
- **cross-contract-refs (TML-2500):** `extensionModel(…)` handles carrying `{ namespaceId, tableName }` (consumed for the TS `ref()` predicate helper, no integration needed) + the aggregate/coordinate machinery reused for cross-space role resolution (D4).

Ground-truth mapping of these landed seams to real file paths: [`specs/reconciliation-2026-06-08.md`](specs/reconciliation-2026-06-08.md). IR nodes are JSON-canonical (ADR 192); migration ops use `OpFactoryCall` (ADR 195). Consumed by [extension-supabase](../extension-supabase/spec.md). Sequencing across slices lives in [`plan.md`](plan.md), not here.

## Requirements the design must satisfy

Invariants every slice upholds (the design above is built to satisfy them; they are the acceptance bar, not a puzzle to infer the design from):

- **Postgres-only layering.** No framework or SQL-family visitor (serializer, planner, verifier) sees RLS; only Postgres-target code does. `pnpm lint:deps` is clean after every slice. The one framework-level change — widening the `SchemaIssue` union with `rls_policy_renamed | rls_policy_tampered | rls_not_enabled` — is an additive **type-only** change (following the `EnumValuesChangedIssue` precedent), carrying no Postgres import.
- **Content-addressed naming is the only equivalence relation** wherever policies are compared (authoring, diff, verify). No code path compares reparsed predicate bodies for equivalence; the lone body-level inspection is the tamper check (recompute hash, compare to suffix). The normalizer's output never leaks past the hash input. Diagnostics name the user's **prefix** only, never the hash suffix.
- **Round-trip fidelity.** `deserialize(serialize(contract))` preserves every `PostgresRlsPolicy`/`PostgresRole` field, including the prefix-vs-full-name asymmetry.
- **No non-Postgres regression** at any slice boundary (`pnpm test:packages` + integration suites green; SQLite + Mongo untouched).
- **IR-first, CI-green increments.** The IR + naming + serializer land before any authoring surface, and every slice keeps `main` green — including the union widening, which must not break existing exhaustive `kind` switches.

## Definition of Done

Inherits the team-DoD floor ([`drive/calibration/dod.md`](../../drive/calibration/dod.md)). Project-specific close conditions (each verifies a design decision above):

- [ ] A TS contract and a PSL contract declaring the same policies lower to **structurally identical** `PostgresRlsPolicy` IR (modulo prefix), each carrying the content-hash wire name; round-trip through `contract.json` is lossless. The TS helpers are absent from a SQLite/Mongo author's surface. *(D1, D3)*
- [ ] A TS `using: ({ ref }) => …${ref(AuthUser)}…` predicate lowers `ref()` to the qualified identifier read from the handle; renaming a referenced local model's table updates the predicate and recomputes the hash. *(D2, D4)*
- [ ] Against live Postgres (PGlite): present-and-declared → zero issues; missing → `missing_rls_policy`; extra → `extra_rls_policy` (severities per control policy); matching-hash-different-prefix → `rls_policy_renamed` + planner `ALTER POLICY … RENAME TO`; hash-recompute-mismatch → `rls_policy_tampered`; declared policies with RLS off → `rls_not_enabled` + planner `ENABLE`. A manual `ALTER POLICY … USING (reformatted)` is classified `rls_policy_tampered`, **not** false drift — proving the content-addressing trick against the real expression printer. *(D2, D5)*
- [ ] A declared `PostgresRole` absent from `pg_roles` surfaces `missing_role` (a `fail` even under `control: 'external'`). *(D4, D5)*
- [ ] **Walking skeleton:** `examples/supabase` `Profile` gains `anon` SELECT + `authenticated` UPDATE-own policies; `bootstrapSupabaseShim` is extended with the Postgres roles + `auth.uid()`/`auth.jwt()`/`auth.role()` SQL functions reading session GUCs; a hermetic PGlite test proves RLS filters rows under a manual `SET ROLE`, and the verifier diffs clean. *(D3, D4, D5 end-to-end)*
- [ ] `pnpm lint:deps` confirms no RLS reference in framework/SQL-family layers; SQLite + Mongo suites green. *(layering)*
- [ ] The [content-addressed-naming ADR](specs/adr-content-addressed-policy-names.md) is promoted into `docs/architecture docs/adrs/`; the Postgres adapter subsystem doc gains an RLS section.

## Alternatives considered

### Authoring surface (D3)

- **A1 — a chained `.rls(…)` model-builder method.** Rejected: there is no target identity on the shared model-builder type to gate a Postgres-only method on, so it would leak into SQLite/Mongo author surfaces. The established Postgres-only authoring affordance (`enum`) is a top-level helper, not a builder method — D3 follows that precedent. Full comparison: [design-rls-authoring-surface.md](specs/design-rls-authoring-surface.md).
- **A2 — a single PSL `policy { operation = … }` block.** Rejected: the declarative PSL-block substrate deliberately rejects conditional-body blocks (a block's parameter set must be fixed). Per-operation keywords (`policy_select`, …) give each a fixed, unconditional parameter set.

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
