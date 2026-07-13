# Slice 5: rls-ts-authoring

**Linear:** [TML-2883](https://linear.app/prisma-company/issue/TML-2883) · builds on slice 4 ([#950](https://github.com/prisma/prisma-next/pull/950), merged).

A developer authors the same RLS policies in TypeScript that PSL ships today, with identical results. The walking-skeleton contract, authored in TS:

```ts
import { anon, authenticated } from '@prisma-next/supabase/contract';
import {
  defineContract, field, model,
  policySelect, policyUpdate, rlsEnabled,
} from '@prisma-next/postgres/contract-builder';

const Profile = model('Profile', { namespace: 'public', fields: { /* … */ } }).sql({ table: 'profile' });

export default defineContract({
  models: { Profile },
  entities: [
    rlsEnabled(Profile),
    policySelect(Profile, { name: 'profile_owner_read', roles: [authenticated], using: '"userId"::uuid = auth.uid()' }),
    policySelect(Profile, { name: 'profile_public_read', roles: [anon], using: 'true' }),
    policyUpdate(Profile, {
      name: 'profile_owner_write', roles: [authenticated],
      using: '"userId"::uuid = auth.uid()', withCheck: '"userId"::uuid = auth.uid()',
    }),
  ],
});
```

This lowers to `PostgresRlsPolicy` / `PostgresRlsEnablement` entities structurally identical to what `examples/supabase/src/contract.prisma` produces — same content-hash wire names, same `entries` keys — pinned by a TS/PSL parity test. The helpers are exported only from `@prisma-next/postgres/contract-builder`, so SQLite/Mongo authors never see them.

## What already exists (do not rebuild)

- **The entities, hashing, and lifecycle are done.** `PostgresRlsPolicy`, `PostgresRole`, `PostgresRlsEnablement` are registered entity kinds (`postgresAuthoringEntityTypes`, discriminators `policy`/`role`/`rls`); `computeContentHash` + `formatRlsPolicyWireName` compute wire names; differ/planner/verify consume `entries` and are untouched by this slice.
- **The generic attachment channel exists** (TML-2965): `packEntities: { [namespace]: { [kind]: { [name]: entity } } }` on the contract input, validated against bound packs' `entityTypes`, folded into `entries` at build, managed-kind rejection, per-namespace collision guards (`packages/2-sql/2-authoring/contract-ts/src/build-contract.ts`).
- **Target-gated static exports are the precedent**: `nativeEnum`/`pg` on `@prisma-next/postgres/contract-builder`; the postgres `defineContract` wrapper delegates to the generic `buildBoundContract`.
- **Cross-space handles as TS exports are the precedent**: the supabase pack exports `AuthUser` etc. (`extensionModel(…)` branded `spaceId: 'supabase'`, `packages/3-extensions/supabase/src/contract/handles.ts`).
- **PSL entries keying** (the parity target): `entries.policy[prefix]` (block name), `entries.rls[tableName]`, `entries.role[name]`.

## Decisions

### D1 — Per-operation helpers returning handles; no side effects

`policySelect` / `policyInsert` / `policyUpdate` / `policyDelete` / `policyAll` (mirroring the five PSL keywords 1:1) plus `rlsEnabled(model)`, all top-level functions taking the model handle, exported from `@prisma-next/postgres/contract-builder`. Each returns an inert **handle** capturing its inputs — no registration side effects; a handle not passed to `defineContract` contributes nothing. Per-operation predicate typing mirrors Postgres statically: `policySelect`/`policyDelete` accept `using` only, `policyInsert` accepts `withCheck` only, `policyUpdate`/`policyAll` accept both. `permissive` is not authorable (fixed `true`), matching PSL, which has no such parameter today.

### D2 — One generic `entities` list; ref conversion is the lowering's job *(amended in operator review, 2026-07-13)*

`entities?: readonly …[]` is a **generic** channel, not an RLS one. A pack-entity handle is `{ entityKind: string, refs?: { [name]: model handle }, … }`; the kind-agnostic walk lives in the generic `contract-ts` build, which (1) groups handles by the bound pack that registered each `entityKind` (the same `entityTypes` discriminator index the PSL interpreter uses; unclaimed kind → error), (2) **converts each declared model ref to a storage table coordinate using the same model→table maps the relation lowering already uses** — the exact representation `buildSqlContractFromDefinition` uses for FKs; no name-based lookup is exposed to any pack code — and (3) invokes the owning pack's batch lowering hook (a SQL-family contributions extension, batch so cross-entity diagnostics can see siblings) with resolved coordinates. Returned `{ namespaceId, entityKind, key, entity }` rows fold into `packEntities`, where the existing collision guards stay authoritative.

The RLS lowering itself (hashing, diagnostics, PSL-matching keys `policy` → prefix / `rls` → tableName / `role` → name) is postgres-target code living in target-postgres **beside `lowerRlsPolicyFromBlock`**, sharing one body of predicate-matrix, hash-assembly, and diagnostic-wording code between the two entry points. The postgres `defineContract` carries zero entity-kind knowledge. `contract-ts` never names a kind; the wrapper never lowers anything.

The mirror-image PSL rule: the interpreter resolves the descriptor-declared `target` ref (`{ kind: 'ref', refKind: 'model' }`) to a storage coordinate as a lowering step and hands the factory a **resolved ref**; an unresolved ref is the interpreter's diagnostic. No storage-name resolver appears on any authoring context, framework or family — that representation was operator-rejected (a "storage name" oracle in the authoring context is the wrong representation; the lowering converts model → table).

### D3 — Roles are handles; cross-space roles are imported pack exports

A postgres-owned `role(name)` constructor produces a role handle. Two uses:

- **Reference**: `roles: [handle]` on a policy — lowering extracts the sorted, deduped names into `PostgresRlsPolicy.roles`, byte-identical to PSL's bare-identifier pass-through. No declaration requirement, matching PSL's deliberate cross-space no-op (parity pressure cuts both ways).
- **Declaration**: a role handle in the `entities` list lowers to a `PostgresRole` entity in `entries.role` — the declared-roles set slice 4's existence verify reads. This makes the slice-4 verify reachable from a real authoring surface for the first time (PSL has no role block; that asymmetry is accepted and noted, not fixed here).

The supabase pack exports `anon` / `authenticated` role handles from `@prisma-next/supabase/contract`, beside `AuthUser` — Will's "import the other contract as a TS export" ergonomics. The constructor lives target-side (exact package home settled in the plan against `lint:deps`); the supabase exports are the only supabase-side addition.

### D4 — Predicates are opaque strings *(amended: `ref()` operator-vetoed, 2026-07-13)*

`using`/`withCheck` accept `string` only. Predicate SQL is a black box end to end — never parsed, validated, or interpolated — matching PSL, where `${…}` interpolation is a deferred project non-goal (OC3). There is **no function-form predicate and no `ref()` helper** (vetoed in operator review; the original DoD item requiring it is struck). Consequence, accepted: renaming a table referenced *inside* predicate SQL does not update the predicate on either surface — raw SQL's normal contract.

### D5 — Load-time diagnostics match PSL

Thrown from the wrapper lowering, naming the user's prefix only (never the hash): duplicate policy prefix per namespace (PSL keys `entries.policy` by prefix, namespace-wide); policy targeting a model not in `models`; policy on a model with no `rlsEnabled` entry (PSL: `requiresModelAttribute`); duplicate role-name declaration; prefix over the 54-char cap (reuse the existing lowering error). The per-operation predicate matrix is compile-time in TS (D1) with the same runtime rejection PSL has as backstop.

### D6 — Fix PSL's policy table-name resolution (in-slice, operator-approved)

`lowerRlsPolicyFromBlock` derives `tableName` by lowercasing the model name's first character (`authoring.ts:139`) — it ignores the model's declared storage name, while the sibling `@@rls` lowering already resolves correctly via `ctx.storageName` (`authoring.ts:483`). A model with `@@map` gets its enablement keyed to the real table but its policies keyed to a non-existent one. Fix: the policy lowering resolves the target model's storage name the same way `@@rls` does. The parity fixtures include an `@@map`'d model to pin both surfaces agreeing.

## Behaviour contract

- **Deliberate (new):** the at-a-glance contract builds and emits; TS/PSL parity pinned (identical IR, identical wire names, identical `entries` keys, `@@map` covered); the slice-1 scenario authored in TS behaves identically on live PGlite (filtered rows under `SET ROLE`, create/edit/rename/drop lifecycle, drift fails verify); D5 diagnostics fire; PSL `@@map`'d-model policies key to the real table.
- **Unchanged (hard):** every existing PSL contract's emitted bytes (the D6 fix changes output only for `@@map`'d models with policies — previously broken, none exist in-tree); differ/planner/verify code untouched; SQLite + Mongo surfaces and suites untouched; layering invariant holds (no RLS vocabulary in `1-framework`/`2-sql`; vocabulary ratchet unchanged); `packEntities` semantics unchanged for existing users.

## Contract impact

No new IR, no serializer change. TS-authored contracts emit the same `contract.json` shape PSL does today. Not breaking for any existing contract.

## Non-goals (hold the line)

- Runtime role binding (ADR 230); Supabase policy packs (extension-supabase); role provisioning/attributes; PSL `${…}` interpolation (OC3); `policyGroup` (OC2); function IR; out-of-band tamper detection.
- **No differ/planner/verify changes** — authoring + lowering + parity only.
- **No predicate interpolation of any kind** — the `ref()` helper and function-form predicates are operator-vetoed (2026-07-13), joining PSL's deferred `${…}` interpolation (OC3).
- A PSL `role` block (PSL still cannot declare roles; noted asymmetry).
- `permissive`/`RESTRICTIVE` authoring (neither surface has it).
- Native enums riding the `entities` list (natural follow-on, not here).
- Predicate parsing/validation of any kind (D4).

## Pre-investigated edge cases

- **Model table name never guessed** (the D6 class): a TS model using `.sql()` factory form or default naming must lower policies with the build-resolved table name; an explicit test pins a non-lowercase-convention table.
- **Same prefix, different tables, one namespace** — PSL structurally collides (prefix-keyed entries); TS errors identically, not silently last-wins.
- **A role handle used in `roles:` but never declared** — allowed (matches PSL pass-through); the walking skeleton depends on it (`anon`/`authenticated` are undeclared).
- **`ref()` of a same-contract model** — works identically to cross-space handles (qualified name from namespace + resolved table).
- **Helper output reused across two contracts** — handles are inert values; each `defineContract` lowers independently; no shared mutable state.

## Acceptance criteria

- **AC-1 (parity):** a TS contract and the PSL equivalent (walking-skeleton policies + an `@@map`'d model + all five operations) lower to structurally identical `entries.policy`/`entries.rls` with identical wire names; round-trip through `contract.json` lossless. Test beside `test/integration/test/authoring/parity/` (native-enum pair is the template).
- **AC-2 (TS walking skeleton, live PGlite):** the slice-1 scenario authored in TS: rows filtered under `SET ROLE`, policy create/edit-replaces/rename/drop lifecycle, drift → verify fails — identical observable behaviour to the PSL-authored run.
- **AC-3 — struck (operator veto, 2026-07-13):** the `ref()` predicate helper does not exist; predicates are opaque strings (D4). The corresponding project-DoD item is struck with it.
- **AC-4 (roles):** pack-exported `anon`/`authenticated` handles flow into `PostgresRlsPolicy.roles` as sorted bare names; a `role(…)` handle in `entities` lands in `entries.role` and a missing live role fails verify (slice-4 semantics, now TS-reachable).
- **AC-5 (diagnostics):** each D5 case throws at `defineContract` time naming the prefix; wrong-predicate-for-operation is a compile-time type error and a runtime error.
- **AC-6 (D6):** a PSL policy on an `@@map`'d model keys to the declared storage name; enablement and policy agree; parity holds for it.
- **AC-7 (invisibility + layering):** no policy/role/rls helper reachable from SQLite/Mongo contract-builder exports; `pnpm lint:deps` + `lint:framework-vocabulary` ratchet clean.
- **AC-8 (gate):** build, forced typecheck, whole Lint job, `fixtures:check`, all three test suites, multi-space guards, `check:upgrade-coverage --mode pr`.

## Slice Definition of Done

Inherits the team floor ([`drive/calibration/dod.md`](../../../../drive/calibration/dod.md)). Slice-specific: AC-1 + AC-2 green — the parity pin and the TS-authored walking skeleton running against live PGlite. Closes project-DoD item 1 (TS+PSL identical lowering, helpers invisible off-Postgres); project-DoD item 2 (`ref()`) is struck by operator veto (see D4).

## Grounding for the plan step

The plan must ground: where the wrapper lowering hooks into `defineContract`/`buildBoundContract` (and which existing model-node resolution it reuses or exports); the handle shapes (policy/role/rls) and their public types; the exact `packEntities` fold + how PSL's prefix/tableName/name keys are reproduced; the role-constructor's package home (`lint:deps`-clean, importable by the supabase pack); the D6 fix site (`lowerRlsPolicyFromBlock` storage-name resolution — how `ctx` reaches the model's storage name, cf. the `@@rls` attribute's `ctx.storageName`) and its regression fixture; the parity-test fixture pair layout; and where the TS walking-skeleton scenario lives beside the slice-1/4 PGlite journeys.
