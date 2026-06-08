# M3b — Walking-skeleton cross-contract FK + cascade test + `BuiltStorageTables.spaceId` cleanup: slice spec

_In-project slice. Parent: `projects/cross-contract-refs/`. Outcome: closes the project's walking-skeleton end of AC7 + the live-DDL end of AC4 by wiring the cross-contract FK through `examples/supabase`'s normal generate flow, proves the cascade action works against a live DB, and drops the M2.3-era record cast that masked the type-surface gap._

## At a glance

`examples/supabase/src/contract.prisma` gains `Profile.userId String @unique` + `Profile.user supabase:auth.AuthUser @relation(fields:[userId], references:[id], onDelete: Cascade)`; the standard CLI emit flow regenerates `contract.json` + `contract.d.ts`; a new hermetic `it` in `skeleton.integration.test.ts` proves the cross-schema FK + `ON DELETE CASCADE` works end-to-end against PGlite; and `BuiltStorageTables<Definition>`'s FK target type gains `readonly spaceId?: string` so the M2.3 `as unknown as Record<string, unknown>` cast can drop.

**Model name note (amended 2026-06-08, M3b.2 R1 falsified assumption):** the cross-space reference uses model name `AuthUser`, not `User`. The supabase extension contract (`packages/3-extensions/supabase/src/contract/contract.prisma:9`) declares `model AuthUser { ... @@map("users") }`. The model name in PSL/IR is `AuthUser`; the SQL table name is `users`. The project spec's PSL examples (`supabase:auth.User`) were authored before M2.3 pinned the extension's model naming convention and were never reconciled — TS form already uses `AuthUser` correctly. M3b uses `AuthUser` everywhere; project-spec reconciliation defers to M4 close-out.

This is the first time the M2 PSL grammar + M3a planner/verifier substrate gets exercised through the example app's normal user-facing flow — every prior cross-space FK in the repo lived inside a synthetic two-contract test fixture.

## Chosen design

### Piece 1 — Walking-skeleton FK wiring (`examples/supabase`)

The PSL diff is two lines + the `@@map` retained:

```prisma
types {
  Uuid = String @db.Uuid
}

namespace public {
  model Profile {
    id       String @id @default(uuid())
    username String
    userId   Uuid   @unique
    user     supabase:auth.AuthUser @relation(fields: [userId], references: [id], onDelete: Cascade)
    @@map("profile")
  }
}
```

After `pnpm --filter @prisma-next/example-supabase emit`:

- `examples/supabase/src/contract.json` carries the new `userId` column on `public.profile`, the new unique constraint, and a `source: 'space'` FK target with `spaceId: 'supabase'`, `namespaceId: 'auth'`, `tableName: 'users'`, `columns: ['id']`. The `domain.relations` slot for `Profile.user` is present but non-navigable (per project Option B).
- `examples/supabase/src/contract.d.ts` reflects the new column + FK on the TS surface; `Profile.user` is typed `never` for ORM traversal (Option B compile-error rule).
- **No committed migration files change** — `examples/supabase/migrations/` is not on disk; the integration test runs `dbInit` against a temp dir per test. M3b commits only contract.json + contract.d.ts (alongside the .prisma source).

The lowered DDL the planner emits (verified in M3a; surfaces here through the live test):

```sql
ALTER TABLE "public"."profile"
  ADD CONSTRAINT "<planner-chosen-name>"
  FOREIGN KEY ("userId")
  REFERENCES "auth"."users"("id")
  ON DELETE CASCADE;
```

### Piece 2 — Cascade-delete hermetic test (`skeleton.integration.test.ts`)

A second `it(...)` block alongside the existing M1 walking-skeleton test. Different DB state, different assertion scope — extending the M1 block would muddle two distinct claims. Reuses `beforeEach` / `afterEach` (already at suite scope: temp dir + `createDevDatabase`).

Shape:

```ts
it(
  'cross-schema FK from public.profile.userId to auth.users.id cascades on auth.users delete',
  async () => {
    const { connectionString } = database;

    // Seed external schemas + tables (auth.users etc.)
    await withClient(connectionString, async (client) => {
      await bootstrapSupabaseShim(client);
    });

    // Materialise the supabase extension space on disk so dbInit can read it.
    const space = supabasePack.contractSpace;
    if (!space) throw new Error('supabasePack must declare a contractSpace');
    await emitContractSpaceArtefacts(migrationsDir, 'supabase', {
      contract: space.contractJson,
      contractDts: '// supabase extension contract space\n',
      headRef: { hash: space.headRef.hash, invariants: [...space.headRef.invariants] },
    });

    // dbInit apply — creates public.profile with the cross-schema FK.
    const client = createControlClient({
      family: sql, target: postgres, adapter: postgresAdapter, driver: postgresDriver,
      extensionPacks: [supabasePack],
    });
    try {
      await client.connect(connectionString);
      const applyResult = await client.dbInit({
        contract: contractJson, mode: 'apply', migrationsDir,
      });
      if (!applyResult.ok) throw new Error(`dbInit apply failed: ${applyResult.failure.summary}`);
    } finally {
      await client.close();
    }

    // Exercise the cascade.
    await withClient(connectionString, async (pg) => {
      const userId = crypto.randomUUID();
      const now = new Date().toISOString();

      await pg.query(
        `INSERT INTO auth.users (id, email, created_at, updated_at)
         VALUES ($1, $2, $3, $3)`,
        [userId, 'alice@example.com', now],
      );
      await pg.query(
        `INSERT INTO public.profile (id, username, "userId")
         VALUES ($1, $2, $3)`,
        [crypto.randomUUID(), 'alice', userId],
      );

      const beforeDelete = await pg.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public.profile WHERE "userId" = $1`,
        [userId],
      );
      expect(beforeDelete.rows[0]?.count).toBe('1');

      await pg.query(`DELETE FROM auth.users WHERE id = $1`, [userId]);

      const afterDelete = await pg.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM public.profile WHERE "userId" = $1`,
        [userId],
      );
      expect(afterDelete.rows[0]?.count).toBe('0');
    });
  },
  timeouts.spinUpPpgDev * 4,
);
```

Notes:
- `crypto.randomUUID()` is Node-native; no Postgres-side extension required.
- `auth.users` columns from `bootstrapSupabaseShim`: `id uuid`, `email text`, `created_at timestamptz`, `updated_at timestamptz` — all `NOT NULL`. The INSERT names all four.
- `public.profile.id` keeps the existing PSL shape (`String @id @default(uuid())`). The lowered storage type is `char(36)` per the current contract.json. Insert UUID strings unmodified — they fit.
- The test does NOT re-prove M1's verify path (already covered by the existing `it`); it asserts only the FK constraint behaviour.

### Piece 3 — `BuiltStorageTables.spaceId` type-surface addition

At `packages/2-sql/2-authoring/contract-ts/src/contract-types.ts:535-539`, the FK target object becomes:

```ts
readonly target: {
  readonly spaceId?: string;            // ← new, optional (local FKs omit it)
  readonly namespaceId: NamespaceId;
  readonly tableName: string;
  readonly columns: readonly string[];
};
```

Pure type-level. The runtime carrier `ForeignKeyReference` already carries `spaceId` (M1) and the serializer already emits it (M2). The type just hadn't caught up.

After the addition, `packages/2-sql/2-authoring/contract-ts/test/cross-space-relation.test.ts:300` (`const fkTarget = fks[0]!.target as unknown as Record<string, unknown>;`) becomes a typed read — drop the cast. **`pnpm lint:casts` must show delta ≤ 0** (specifically: delta = `-1` from this slice).

### Piece 4 — `typeParams` empty-state equivalence (substrate fix; scope-shift authorized 2026-06-08)

**Discovered:** M3b.2 R4 stop-condition. The walking-skeleton example app's runtime client (`postgres<Contract>(...)`) refuses to load any contract that carries `typeParams: {}` on a non-parameterized codec — but the PSL interpreter writes `typeParams: {}` for every `@db.X` named type whose body has no params. Three M1/M2-shipped surfaces disagree on what "no params" means on disk and at the API boundary:

1. **PSL interpreter** (`packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:571-577`) writes `typeParams: descriptor.typeParams ?? {}` — empty object, not undefined.
2. **StorageTypeInstance IR** (`packages/2-sql/1-core/contract/src/ir/storage-type-instance.ts:24,35`) declares `typeParams: Record<string, unknown>` as required (no `?`).
3. **StorageColumn IR** (`packages/2-sql/1-core/contract/src/ir/storage-column.ts:19,43`) declares `typeParams?: Record<string, unknown>` as optional.
4. **Runtime validator** (`packages/2-sql/5-runtime/src/sql-context.ts:483-495`, `assertColumnCodecIntegrity`) rejects any column whose `CodecRef.typeParams !== undefined` against a non-parameterized codec.

The result: `Uuid = String @db.Uuid` produces a `StorageTypeInstance` with `typeParams: {}`, which propagates through `codecRefForStorageColumn` to a `CodecRef`, which the runtime validator rejects at module-load time. The Supabase extension's own `contract.json` has been shipping the same `typeParams: {}` shape for months, but never trips the validator because the extension is loaded only for migration planning, never handed to the runtime client.

**Design principle (operator-authorized):** an object-typed field's empty state should be canonical, and `{}` and missing-field should be treated as equivalent at every boundary that compares them. The codec receives a canonical empty form (either always `{}` or always `undefined` — implementer chooses the form that minimizes blast radius against the existing IR shapes); the validator accepts both as equivalent empty; the on-disk JSON serializer omits `typeParams` when empty (smaller wire form, cleaner diffs).

**Concrete fix surfaces** (implementer scopes within these — substrate fix is intentionally narrow):

- `packages/2-sql/5-runtime/src/sql-context.ts:483-495` (`assertColumnCodecIntegrity`): change the check to "reject only when `typeParams` has actual keys against a non-parameterized codec." Empty `{}` and missing both pass.
- `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:571-577`: omit `typeParams` when the descriptor has no params (or whatever the resolved canonical empty is per the implementer's IR-shape choice).
- IR shape reconciliation: either flip `StorageTypeInstance.typeParams` to optional (`typeParams?: Record<string, unknown>`) to match `StorageColumn`, OR flip `StorageColumn.typeParams` to required with `{}`-default. The implementer picks the smaller diff; both express the principle.
- Re-emit any in-repo contract.json fixtures whose `typeParams: {}` representation flips under the new serializer convention (the supabase extension's own contract.json is the obvious one; `pnpm fixtures:check` will reveal others if any).

**What this doesn't touch:** codec descriptor registration (no new `pg/uuid` codec), the PSL grammar surface, the FK carrier shape, the planner, the verifier. The fix is purely about the equivalence of two ways of saying "empty" at the typeParams slot.

**Why this lives in M3b** (rather than its own slice): the substrate gap surfaced as a direct consequence of the walking-skeleton being the first consumer to drive the supabase extension's `Uuid` type through the runtime path. Splitting would mean two sequential PRs (substrate fix merges, then rebase M3b's branch, then complete walking-skeleton + cascade test) — operator chose to bundle. The PR description will call out the substrate fix as a separable concern that the slice surfaced.

## Coherence rationale

Four pieces, one PR. Splitting them produces partial-value PRs:

- Piece 1 alone: the example app declares a cross-space FK but no test proves the constraint exists in a real DB — the walking-skeleton claim is unproven.
- Piece 2 alone: nothing to test against — the PSL doesn't declare the FK yet.
- Piece 3 alone: a type-only change with no consumer demonstrating it matters (the M2.3 cast is the only consumer that benefits).
- Piece 4 alone (the substrate fix): touches surfaces that look unrelated to cross-contract-refs without the walking-skeleton context that explains why the fix matters now.

Bundled: Piece 3 closes the type-surface gap; Piece 4 closes the typeParams empty-state gap that the walking-skeleton's runtime path uncovered; Piece 1 declares the FK; Piece 2 proves it works against live Postgres with the cascade firing. One reviewer holds the narrative "we discovered the substrate gap by attempting the walking-skeleton; the fix is small and well-scoped; the result is the walking-skeleton works end-to-end" in one sitting.

## Scope

**In:**
- `examples/supabase/src/contract.prisma` — declare local `types { Uuid = String @db.Uuid }` + add `Profile.userId` + `Profile.user` lines.
- `examples/supabase/src/contract.json` — CLI-regenerated.
- `examples/supabase/src/contract.d.ts` — CLI-regenerated.
- `examples/supabase/src/handlers.ts` — `insertAndReadProfile` gains a `userId` parameter (since the new FK makes that column NOT NULL).
- `examples/supabase/test/skeleton.integration.test.ts` — the existing M1 `it` is updated to INSERT an `auth.users` row + pass its id into `insertAndReadProfile`; a new cascade-delete `it` block is added (M3b.4's work).
- `packages/2-sql/2-authoring/contract-ts/src/contract-types.ts` — add `readonly spaceId?: string` to the FK target object (line ~536).
- `packages/2-sql/2-authoring/contract-ts/test/cross-space-relation.test.ts:300` — drop the `as unknown as Record<string, unknown>` cast on `fkTarget`.
- `packages/2-sql/2-authoring/contract-ts/test/cross-space-relation.test.ts` adjacent file — also drop the sibling cast at `contract-handles.test.ts:139-142` (F1 from M3b.1 R1).
- `packages/2-sql/5-runtime/src/sql-context.ts` (`assertColumnCodecIntegrity` ~`:483-495`) — Piece 4 validator change.
- `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts` (~`:571-577`) — Piece 4 emitter change.
- `packages/2-sql/1-core/contract/src/ir/storage-type-instance.ts` OR `storage-column.ts` — Piece 4 IR shape reconciliation (implementer picks the smaller diff).
- Any in-repo `contract.json` fixtures whose typeParams representation flips under the new convention — re-emit (the supabase extension's own contract.json is the obvious one).

**Out (HARD — stop and report if a fix touches these):**
- Substrate, **except for the `typeParams` empty-state equivalence fix authorized 2026-06-08 by operator** (see § Chosen design — Piece 4 below). M1–M3a's FK carrier, brands, planner, verifier, PSL grammar, aggregate resolution are otherwise out-of-scope.
- Runtime cross-space query / `include` traversal (project Non-goal — Option B non-navigable).
- Mongo cross-space relationships (deferred).
- ~~`examples/supabase/src/handlers.ts` — amended 2026-06-08 (M3b.3 R1): IN SCOPE for M3b.3 because the existing M1 walking-skeleton `it` calls `insertAndReadProfile(runtime, 'alice')` which inserts a profile WITHOUT a userId, but the new FK makes `userId` NOT NULL. The handler + its M1 caller must both adjust to provide a real userId (which means seeding an `auth.users` row in the M1 test first). The cascade-delete test in M3b.4 still does its own raw SQL — no further handlers.ts touch in M3b.4.~~
- The runtime `db.public.Profile.find({ include: { user: true } })` path (compile error by design).
- Adjacent `as Record<string, unknown>` casts in `cross-space-relation.test.ts` that aren't reading the FK target — they read relation `to`/`on` shapes, a separate surface gap not in M3b scope.

## Contract-impact

Touches the contract-authoring TS type surface (`packages/2-sql/2-authoring/contract-ts/`):

- `BuiltStorageTables<Definition>['…']['foreignKeys'][number]['target']` gains optional `spaceId?: string`. Pure additive. Local-FK consumers see no change (the field is absent on local FK targets). Cross-space FK consumers can now type-safely read `target.spaceId` instead of casting.
- No change to `packages/2-sql/1-core/contract/` (the runtime IR carrier already has `spaceId`; this slice only catches the contract-ts type surface up to it).
- No change to `packages/0-shared/contract/` or `packages/1-framework-core/`.
- No serializer change (M2 already emits `spaceId` in `contract.json` for cross-space FKs).

## Adapter-impact

None. M3b consumes the postgres adapter's existing M3a-shipped DDL emission for cross-space FKs (`renderForeignKeySql`). No adapter code changes. No sqlite/mongo touch.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|-----------|-------------|-------|
| `examples/supabase` has no committed migration files | Adjust the scope claim | The user brief mentioned "regenerate migration files" but the example doesn't commit them — `prisma-next.config.ts` declares `migrations: { dir: 'migrations' }` but the skeleton test creates `mkdtemp` migrations per run. M3b commits only `contract.prisma` + `contract.json` + `contract.d.ts`. If the implementer finds a committed `migrations/` dir on `main` (race with another PR), regenerate; otherwise leave alone. |
| `auth.users.id` is `uuid` but `Profile.userId` PSL declares `String` | Declare a local `types { Uuid = String @db.Uuid }` block and write `userId Uuid @unique` | **Amended twice 2026-06-08 (M3b.2 R2 + R3 falsified-assumption).** Two layered errors here: (a) M2.3's brand does NOT auto-propagate target column storage type — it only carries `spaceId` for resolution; PSL author is responsible for native-type matching. (b) `@db.X` native-type attributes are NOT valid field-level attributes in this PSL flavor — they work only inside a `types { Name = T @db.X }` block (see `packages/2-sql/2-authoring/contract-psl/src/psl-field-resolution.ts:63-69` for the field-attribute allowlist + `psl-column-resolution.ts:553` for the type-constructor descriptor). Canonical pattern is the one used by the supabase extension itself: declare a `types {}` block, then use the alias as the field type. PSL `String` lowers to `text`; Postgres rejects `FK text → uuid` at apply time (`sqlState 42804`). Local FKs hit the same constraint if the local target isn't `text`; this isn't cross-space-specific. M4 close-out should add a paragraph to the authoring guide covering both (a) "cross-space FK source columns need native-type matching" and (b) "PSL `@db.X` is type-constructor syntax, not field-attribute syntax". |
| `pgcrypto` extension not present in PGlite | None — `crypto.randomUUID()` is Node-native | Avoid `gen_random_uuid()` in the test. Pre-generate UUIDs in Node and pass as parameters. |
| `auth.users.email` and timestamps are `NOT NULL` | INSERT must name all four columns | `bootstrapSupabaseShim` defines `id`, `email`, `created_at`, `updated_at`, all `NOT NULL`, no DEFAULTs. The cascade test's INSERT passes `now()` for both timestamps and a fake email. |
| The current `it` already exercises `dbInit` apply + a `public.profile` round-trip | Add a second `it`, do not extend the first | Different DB state (the first inserts via `db.connect` runtime; the second uses raw pg + cascade DELETE). Cleaner test design = separate `it`. |
| `lint:casts` ratchet expects delta ≤ 0 | Piece 3's cast drops are verifiable in commit diff; the ratchet metric does not move | **Amended 2026-06-08 M3b.1 R1.** The original spec claimed Piece 3 would produce `lint:casts` delta = `-1`. False: `no-bare-cast.grit` plugin excludes test files (`not $filename <: r".*\.test\.ts"` + `not $filename <: r".*/test/.*\.ts"`), so dropping the M2.3 record casts at `cross-space-relation.test.ts:300` + `contract-handles.test.ts:139-142` does not move the ratchet. The drops are verifiable in commits `cf2cd490f` + `df0753207`. M3b.1 done condition is "casts dropped per commit diff", not "ratchet delta -1". |

## Slice-specific done conditions

- [ ] `examples/supabase/src/contract.prisma` carries the local `types { Uuid = String @db.Uuid }` block + new `Profile.userId Uuid @unique` + `Profile.user supabase:auth.AuthUser @relation(...)` lines.
- [ ] `examples/supabase/src/contract.json` is CLI-regenerated (NOT hand-edited) and shows: new `userId` column on `public.profile`, new unique constraint, FK with `target.spaceId === 'supabase'` + `namespaceId === 'auth'` + `tableName === 'users'`, `onDelete === 'cascade'`.
- [ ] `examples/supabase/src/contract.d.ts` is CLI-regenerated and matches the JSON.
- [ ] The cascade-delete `it` passes against PGlite via `pnpm --filter @prisma-next/example-supabase test`.
- [ ] Piece 4 substrate fix: the runtime validator accepts `typeParams: {}` and missing as equivalent empty; the PSL emitter omits `typeParams` when empty; IR shape consistent across `StorageTypeInstance` + `StorageColumn`; the supabase extension's contract.json is re-emitted to reflect the new convention.
- [ ] The M2.3 record-cast drop at `cross-space-relation.test.ts:300` is in the commit diff (the cast IS dropped — verifiable in diff; `pnpm lint:casts` does NOT measure test-file casts per the `no-bare-cast.grit` plugin's `not $filename <: r".*\.test\.ts"` rule, so the ratchet metric does not move).
- [ ] No change to `examples/supabase/src/handlers.ts` (or, if changed, the diff is justified in the dispatch report).

(All other DoD — CI-green, reviewer-accept, project § Walking-skeleton both checklist items, AC4 + AC7 closure — is inherited from the project-DoD floor and the standing dispatch gate.)

## Standing dispatch gate (inherited from M3a slice spec § "Standing validation gate")

Per dispatch, before reviewer engagement:

1. `pnpm --filter <pkg> build` AND rebuild dependent `dist` before downstream tests.
2. Full `pnpm typecheck` (not package-scoped — M3a closed 138/138).
3. Touched packages' `pnpm test` + re-run any integration test modified/added.
4. `pnpm lint:deps` + `pnpm lint:casts` (delta ≤ 0; expected `-1` for this slice) + full `pnpm lint`.
5. `pnpm fixtures:check` — this slice WILL change `examples/supabase` contract artefacts; regenerate, confirm churn matches the expected new FK + new column + new unique constraint, report deltas.
6. `pnpm check:upgrade-coverage --mode pr` — substrate change lands under `examples/` + `packages/2-sql/2-authoring/contract-ts/` (a consumer-surface type addition); the type addition is additive (optional field) so the `record-upgrade-instructions` skill likely does not fire, but the implementer must run the check and report the result.
7. Worktree caveat: if any `dist/` is missing, run a full `pnpm build` once before `fixtures:check`.

Trace events emit **live** per dispatch/round.

## Acceptance criteria closure (within the project)

This slice closes:

- **AC7 (walking-skeleton end)** — the example app, not just a synthetic two-contract fixture, drives the cross-schema FK through the live planner/verifier into a real PGlite DB. (M3a closed AC7 via the synthetic fixture under `packages/3-extensions/supabase/test/`.)
- **AC4 (live-DDL end)** — `ON DELETE CASCADE` is present in the emitted DDL and the cascade actually fires when `auth.users` rows are deleted. (M2 closed the "no diagnostic emitted at cross-contract cascade" half.)
- **Project § Walking-skeleton integration** — both checklist items (FK wired + hermetic cascade-delete test).

This slice does NOT close AC1, AC2, AC3, AC5, AC6, AC8, AC9, AC10 — already closed in M1/M2/M3a.

After M3b lands, **only M4 (docs + close-out) remains** for the project.

## Open Questions

1. **Cast drop scope at `cross-space-relation.test.ts:300`.** Working position: drop only the `fkTarget` cast at `:300` (that's the one Piece 3 enables). Other `Record<string, unknown>` casts in the file read relation `to`/`on` shapes (lines 92/94/119/120/169/170/174/254/256/337/339) — those would need separate type-surface additions to `BuiltDomain` relation types, out of scope for M3b. Implementer confirms by attempting the drop at `:300` first; if compiler accepts, ship; if it complains, investigate.

2. **`prisma-next.config.ts` migrations dir on disk.** Working position: `examples/supabase/migrations/` does not exist on `main` at slice start; leave it alone. If a parallel PR has materialized it before M3b merges, regenerate per the standard flow.

## References

- Parent project spec: [`projects/cross-contract-refs/spec.md`](../../spec.md) (AC1–AC10, FR1–FR21)
- Parent project plan: [`projects/cross-contract-refs/plan.md`](../../plan.md) (§ Walking-skeleton integration; § Status / next-up — 2026-06-07)
- M3a slice spec: [`projects/cross-contract-refs/slices/M3a/spec.md`](../M3a/spec.md) (standing validation gate; M3a → M3b boundary)
- M3a slice plan § "Open items (deferred from M3a — recorded for M3b)": [`projects/cross-contract-refs/slices/M3a/plan.md`](../M3a/plan.md) (canonical M3b scope statement)
- M2.3 record cast site: `packages/2-sql/2-authoring/contract-ts/test/cross-space-relation.test.ts:300`
- BuiltStorageTables target type: `packages/2-sql/2-authoring/contract-ts/src/contract-types.ts:521-557` (FK target at `:535-539`)
- Bootstrap shim (auth.users schema): `packages/3-extensions/supabase/test/supabase-bootstrap.ts:53-98`
- Skeleton test current state: `examples/supabase/test/skeleton.integration.test.ts`
- Example app generate command: `pnpm --filter @prisma-next/example-supabase emit` (runs `prisma-next contract emit`)
- Linear: see umbrella tracker in [`projects/supabase-integration/README.md`](../../../supabase-integration/README.md)
