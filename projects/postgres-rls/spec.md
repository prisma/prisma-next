# postgres-rls

## Purpose

Make Postgres Row-Level Security policies and roles **first-class elements of the contract** — authored in TypeScript and PSL, represented in the IR, planned into migrations, and verified against the live database — so that the security boundary teams pick Supabase for is no longer a raw-SQL escape hatch the framework can't see. RLS is also a generic Postgres feature any tenant-isolation, role-based-read, or audit-immutability use case needs; this project models it as a Postgres-target concern, not a Supabase one.

## At a glance

A user declares policies next to the model they protect. The framework owns the wire name: the user types a prefix, the framework appends an 8-hex content hash so the verifier compares names, never reparsed predicate bodies.

TypeScript — RLS authoring is a **top-level, target-contributed helper** taking the model handle (gated to Postgres by the same mechanism that surfaces `helpers.enum(…)`), mirroring the PSL surface where policies are top-level declarations referencing the model — **not** a chained model-builder method. There is no target identity on the shared model-builder type to gate a method on, and the established Postgres-only authoring affordance (`enum`) is a helper; full rationale in [design-rls-authoring-surface.md](specs/design-rls-authoring-surface.md). Exact helper signature settled at slice-2 planning (leaning per-operation for PSL symmetry):

```ts
const Profile = model('Profile', { namespace: 'public', fields: { /* … */ } })
  .sql(({ cols }) => ({ table: 'profile' }));

// These helpers exist only when the Postgres pack is bound (invisible to SQLite / Mongo authors).
policySelect(Profile, { name: 'profiles_anon_and_authed', roles: [anon, authenticated], using: 'true' });
policyUpdate(Profile, {
  name: 'profiles_update_own', roles: [authenticated],
  using: 'user_id = (auth.uid())::uuid', withCheck: 'user_id = (auth.uid())::uuid',
});
```

PSL — **per-operation block keywords** (`policy_select`, `policy_insert`, `policy_update`, `policy_delete`, `policy_all`), contributed by the Postgres target through the landed declarative PSL-block substrate. Each keyword has a fixed, unconditional parameter set — there is no single `policy { operation = … }` block (the substrate deliberately rejects conditional-body blocks):

```prisma
namespace public {
  model Profile { id String @id @default(uuid()); userId String @unique; username String }

  policy_select profiles_anon_and_authed { target = Profile; roles = [anon, authenticated]; using = "true" }
  policy_update profiles_update_own {
    target = Profile; roles = [authenticated]
    using = "user_id = (auth.uid())::uuid"; withCheck = "user_id = (auth.uid())::uuid"
  }
}
```

Both surfaces lower to the same `contract.json`. The planner emits `ENABLE ROW LEVEL SECURITY` + `CREATE POLICY "<prefix>_<hash>" …`; the verifier introspects `pg_policies` / `pg_roles` / `pg_class.relrowsecurity` and diffs by wire name.

The content-addressed naming is the load-bearing trick: Postgres reparses and reformats predicate bodies at `CREATE POLICY` time (`auth.uid()::uuid` ↔ `(auth.uid())::uuid`, parens, casing), so any byte-comparison verifier would surface false drift on nearly every contract. Moving equivalence into the wire-name suffix eliminates that noise and makes renames structurally free (matching hash, different prefix → `ALTER POLICY … RENAME TO`). Full design: [content-addressed-naming ADR](specs/adr-content-addressed-policy-names.md).

## Non-goals

- **Runtime session-var injection** (`SET LOCAL role`, `SET LOCAL request.jwt.claims`). This is what makes `auth.uid()` resolve per-query. Owned by [runtime-target-layer](../runtime-target-layer/spec.md) + [extension-supabase](../extension-supabase/spec.md). This project ships the **static** contract side of RLS only; policy correctness is proven in tests by setting the role with manual `SET ROLE` until the runtime lands.
- **Supabase-specific role declarations and pre-canned policy packs** (`anon`/`authenticated`/`service_role`, "profile-on-signup" patterns). Owned by [extension-supabase](../extension-supabase/spec.md). This project builds the substrate; that project ships the Supabase content.
- **Functions as first-class IR.** `auth.uid()`, `auth.jwt()` stay opaque references inside predicate strings (umbrella decision C4). No `pg_proc` verification, no function DDL.
- **Role attribute management.** `LOGIN`/`INHERIT`/`REPLICATION`, password hashes, membership graphs, `CREATE ROLE`/`DROP ROLE`. `PostgresRole` v0.1 carries name + namespace coordinate only; v0.1 verifies declared roles exist in `pg_roles`, nothing more.
- **PSL `${…}` predicate interpolation** (the PSL analogue of TS's `ref()` helper). Umbrella offcut OC3; deferred.
- **`policyGroup` shared-target hoisting** (offcut OC2) and **content-addressing backport** to indexes/functions/views/checks (offcut OC4). Deferred; the ADR notes forward applicability so future projects reach for the pattern instead of reinventing it.

## Place in the larger world

A constituent of the [Supabase Integration umbrella](../supabase-integration/README.md); RLS is the umbrella's longest/riskiest pole. The umbrella README's status table is stale — verified ground truth (2026-06-08) lives in [`specs/reconciliation-2026-06-08.md`](specs/reconciliation-2026-06-08.md). Hard dependencies have **landed**:

- **target-extensible-ir (TML-2459) — done & closed.** Supplies `IRNodeBase`/`SqlNode`, `freezeNode`, the `ContractSerializer` / `SchemaVerifier` SPI seams (`PostgresSchemaVerifier.verifyTargetExtensions()` is the empty stub this project fills), the `AuthoringContributions.entityTypes` extension point, and the `UNBOUND_NAMESPACE_ID = '__unbound__'` namespace sentinel.
- **control-policy (TML-2493) — done & closed; design in [ADR 224](../../docs/architecture%20docs/adrs/ADR%20224%20-%20Control%20Policy%20—%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md).** Supplies the `ControlPolicy` enum and the two-layer verifier/planner dispatch (`classifySqlVerifierIssueKind` → `dispositionForCategory` → `fail|warn|suppress`; planner pre-filters via `partitionIssuesByControlPolicy`). This project's verifier severity dispatches through it; it does not reinvent it.
- **target-contributed-psl-blocks — substrate (slices 1–3) landed; usable now.** Supplies the declarative `AuthoringPslBlockDescriptor` SPI (`ref`/`value`/`option`/`list` params, generic parser/printer, `extensionBlocks` slot, `entries[kind][name]` storage). The Postgres target contributes the per-operation `policy_*` keywords through it.

Composes with **cross-contract-refs (TML-2500, M1+M2+M3a merged)** on two fronts. (1) Consumer-side, no integration: the TS `ref()` predicate helper reads the `{ namespaceId, tableName }` already baked into `extensionModel(…)` handles (e.g. `AuthUser`), so a predicate referencing another contract space's table tracks renames. (2) **Integration work this project owns: cross-space role-ref resolution.** A policy's `roles = [anon, …]` are static refs to declared `role` entities; when those roles come from another contract space (the Supabase pack), the refs are `scope: 'cross-space'`, and the PSL-block substrate's cross-space ref validation is a no-op pass-through deferred to its first consumer — this project. Resolution is wired through the `(spaceId, namespaceId, 'role', name)` coordinate, reusing cross-contract-refs' aggregate machinery. (Same-space role refs resolve without it.) PSL cross-contract `target` is forbidden (Postgres won't `CREATE POLICY` on a table you don't own); cross-space *role* refs are allowed (you reference roles you don't own all the time).

[extension-supabase](../extension-supabase/spec.md) consumes this project's deliverables. Migration ops follow [ADR 195](../../docs/architecture%20docs/adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md) (`OpFactoryCall`); IR nodes are JSON-canonical per [ADR 192](../../docs/architecture%20docs/adrs/ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md).

## Contract-impact

Touches the contract surface; the affected entities and the new/changed kinds:

- **New target-only IR kinds**, registered via `postgresAuthoringEntityTypes` (`entityTypes` contribution, following the `PostgresEnumType` precedent) and stored as **new slots on `PostgresSchema.entries`** (`packages/3-targets/3-targets/postgres/src/core/postgres-schema.ts`) — **not** on a table class (there is no `PostgresTable`):
  - `PostgresRlsPolicy` (`extends IRNodeBase`/`SqlNode`): full wire `name`, user `prefix`, `tableName` cross-reference, `operation`, `roles`, `using?`, `withCheck?`, `permissive`.
  - `PostgresRole`: `name` + namespace coordinate (typically `__unbound__` — roles are cluster-scoped). Must register as a **`role` entity kind** (populating `entries['role']`), since PSL `roles = […]` are `ref`s with `refKind: 'role'` that resolve by `entries[refKind][name]` — with no `role` kind there is nothing to bind to.
- **`StorageTable` gains `rls: 'auto' | 'enabled' | 'disabled'`** (default `'auto'`) — the family-shared table node (`packages/2-sql/1-core/contract/src/ir/storage-table.ts`), which already carries `control?: ControlPolicy`. Policies live at the schema level, keyed to their table by name.
- **Serializer**: `PostgresContractSerializer.serializePostgresNamespace()` + `hydrateSqlNamespaceEntry()` extended to round-trip the new slots (preserving both `prefix` and full `name`).
- **Framework `SchemaIssue` union widened** with `rls_policy_renamed | rls_policy_tampered | rls_not_enabled` (decision D1 below). New SQL-family issue kinds `missing_rls_policy`/`extra_rls_policy`/`missing_role` are classified in `classifySqlVerifierIssueKind` (→ `declaredMissing`/`extraAuxiliary`/`declaredMissing`).
- **PSL**: the Postgres pack contributes `policy_*` block descriptors; cross-contract `target` is a load-time error.

## Adapter-impact

**Postgres only.** SQLite and Mongo are untouched and must not gain any RLS-shaped types in their family/framework IR layers. RLS-aware code lives entirely in the Postgres target package; `pnpm lint:deps` enforces that the framework and SQL-family layers carry no reference to `PostgresRlsPolicy`/`PostgresRole`.

## Cross-cutting requirements

- **Layering holds across every slice.** No framework or SQL-family visitor sees RLS. Only Postgres-target visitors (verifier, planner, serializer) do. `pnpm lint:deps` clean after every slice.
- **Content-addressed naming is the single equivalence relation** wherever policies are compared — authoring, diff, verifier. No code path compares reparsed predicate bodies for equivalence; the one body-level inspection is the tamper check (recompute hash, compare to the wire-name suffix). The canonical normalizer's output never leaks past the hash input. Diagnostics name the user's prefix only — never the hash suffix.
- **Round-trip fidelity.** `deserialize(serialize(contract))` preserves every `PostgresRlsPolicy`/`PostgresRole` field including the prefix/full-name asymmetry.
- **Control-policy composition, not reinvention.** `missing_rls_policy`/`extra_rls_policy`/`missing_role` severity comes from the table's or role's `ControlPolicy` via the landed two-layer dispatch. The structural issues (`rls_policy_tampered`/`rls_policy_renamed`/`rls_not_enabled`) always surface; their planner response is dispatch-driven.
- **No regression in non-Postgres targets** at any slice boundary (`pnpm test:packages` + integration suites green).

## Transitional-shape constraints

- **Slice order is IR-first.** The IR kinds + content-addressed naming + serializer round-trip land before any authoring surface; authoring lands before migration/verifier. A later slice never depends on a surface an earlier slice hasn't shipped.
- **Every slice keeps CI green on `main`** — including the `SchemaIssue` union widening (D1), which must not break existing exhaustive `kind` switches over the union (the widening follows the additive `EnumValuesChangedIssue` precedent; existing consumers compile).
- **The PSL surface slice may land after the TS surface** without blocking it; the substrate is already in place, so PSL is not gated on external work.

## Project Definition of Done

Inherits the team-DoD floor ([`drive/calibration/dod.md`](../../drive/calibration/dod.md)) — not restated. Project-specific close conditions:

- [ ] A TS contract (top-level Postgres-contributed policy helpers) and a PSL contract (`policy_*` blocks) declaring the same policies lower to **structurally identical** `PostgresRlsPolicy` IR (modulo prefix), each carrying the content-hash wire name; round-trip through `contract.json` is lossless. The TS helpers are absent from a SQLite/Mongo author's surface.
- [ ] A TS `using: ({ ref }) => …${ref(AuthUser)}…` predicate lowers `ref()` to the qualified identifier (`"auth"."users"`) read from the handle; renaming a local model's table updates the predicate and recomputes the hash.
- [ ] Against a live Postgres (PGlite integration): declared-and-present → zero issues; missing → `missing_rls_policy`; extra → `extra_rls_policy` (severities per control policy); matching-hash-different-prefix → `rls_policy_renamed` + planner `ALTER POLICY … RENAME TO`; hash-recompute-mismatch → `rls_policy_tampered`; declared policies with RLS off → `rls_not_enabled` + planner `ENABLE`. A manual `ALTER POLICY … USING (reformatted)` is classified `rls_policy_tampered`, **not** false drift (proves the content-addressing trick against the real expression printer).
- [ ] A declared `PostgresRole` absent from `pg_roles` surfaces `missing_role` (a `fail` even under `control: 'external'`, since `external` suppresses extras but not declared-missing).
- [ ] **Walking-skeleton wired** (umbrella decisions C13/C14): `examples/supabase` `Profile` gains `anon` SELECT + `authenticated` UPDATE-own policies; `bootstrapSupabaseShim` is extended with the Postgres roles + `auth.uid()`/`auth.jwt()`/`auth.role()` SQL functions reading session GUCs; a hermetic PGlite test proves RLS filters rows under a manual `SET ROLE`, and the verifier diffs clean against `pg_policies`.
- [ ] `pnpm lint:deps` confirms no RLS reference in framework / SQL-family layers; SQLite + Mongo suites green.
- [ ] The [content-addressed-naming ADR](specs/adr-content-addressed-policy-names.md) is promoted into `docs/architecture docs/adrs/` (with its "forward applicability"/OC4 section); the Postgres adapter subsystem doc gains an RLS section.

## Open Questions

1. **RLS authoring surface shape (D3) — RESOLVED.** Decided **Option C** (operator, 2026-06-08): a top-level, target-contributed helper taking the model handle (the `enum` mechanism), gated to Postgres for free — **not** a chained model-builder method (target identity isn't on the builder type). See [design-rls-authoring-surface.md](specs/design-rls-authoring-surface.md). Residual slice-2 detail: per-operation helpers vs a single array helper, and how model-level enable/disable rides.
2. **Canonical normalizer home.** Working position: `packages/3-targets/3-targets/postgres/src/core/rls/canonicalize.ts` (target-internal, YAGNI) — written so `computeContentHash`/`normalizePredicate` lift cleanly into a shared module when OC4's next consumer arrives.
3. **`PostgresRole` `loginRole` flag.** Working position: omit; treat all declared roles as opaque names. Add under `attributes?: { login?: boolean }` only when a real consumer needs `pg_roles.rolcanlogin` validation.
4. **`ALTER POLICY` vs drop+create boundary.** Working position: mirror Postgres's documented `ALTER POLICY` matrix exactly (rename, role change, supported predicate changes in place; `permissive↔restrictive` and operation changes fall back to drop+create).
5. **Two-body-form ADR (old OC1).** The original plan committed a "`field Type @attrs` vs `key = value`" ADR. The landed PSL-block substrate already established the `key = value` param model and owns its own ADR, so this is likely **subsumed** — drop as a deliverable unless the substrate's ADR doesn't cover the observation. Confirm at PSL-surface slice planning.

## References

- Linear: [TML-2501](https://linear.app/prisma-company/issue/TML-2501) (Backlog → starting). Umbrella project: [Supabase Integration](https://linear.app/prisma-company/issue/TML-2503).
- Reconciliation (stale-spec → landed-code map): [`specs/reconciliation-2026-06-08.md`](specs/reconciliation-2026-06-08.md).
- Project ADR: [`specs/adr-content-addressed-policy-names.md`](specs/adr-content-addressed-policy-names.md) (promote at close-out).
- Umbrella decisions consumed: A1–A5/A8 (TS surface), B1–B6 (PSL surface), C3/C4/C5/C9–C11, offcuts OC1–OC4 — [`../supabase-integration/decisions.md`](../supabase-integration/decisions.md).
- Sibling specs: [control-policy concepts in ADR 224], [cross-contract-refs](../cross-contract-refs/spec.md), [runtime-target-layer](../runtime-target-layer/spec.md), [extension-supabase](../extension-supabase/spec.md), [target-contributed-psl-blocks](../target-contributed-psl-blocks/spec.md).
- Architecture: [ADR 195 — Planner IR](../../docs/architecture%20docs/adrs/ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md), [ADR 192 — ops.json](../../docs/architecture%20docs/adrs/ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md), [ADR 224 — Control Policy](../../docs/architecture%20docs/adrs/ADR%20224%20-%20Control%20Policy%20—%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md).
