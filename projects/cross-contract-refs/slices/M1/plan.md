# M1 — Foundation: dispatch decomposition

Slice goal: declare the cross-contract FK carrier shape at the contract-IR layer and add the cross-contract-specific checks to contract-aggregate loading. No authoring surface (that's M2). One PR.

Branch: `tml-2500-cross-contract-space-fk-references` from latest `origin/main`.
Model tiers: implementer = sonnet-4.6-mid; reviewer = opus-4.8-high. TDD mandatory.
Validation gate (inferred — confirm): `pnpm --filter @prisma-next/sql-contract build && pnpm typecheck` + the contract package's test command + `pnpm lint:deps`. (Exact filter names to be confirmed at dispatch 1 against the workspace.)

ACs owned by M1: **AC6** (collision + cycle rejection), **AC8** (round-trip property test), **AC10** (`lint:deps`), plus **AC9** as a regression guard (existing local-FK tests stay green).

## Dispatch M1.1 — FK carrier `source` discriminator + round-trip

- **Outcome:** `ForeignKey` / `ForeignKeyReference` carry a `source: 'local' | 'space'` discriminator. The `'space'` variant adds `spaceId`, a namespace coordinate that admits `UNBOUND_NAMESPACE_ID` (`'__unbound__'`), `tableName`, `columnName`. The `'local'` variant keeps today's flat `{ namespaceId, tableName, columns }` shape. ArkType FK validator extended; `StorageTable → ForeignKey → ForeignKeyReference` deserialization handles both variants; round-trip property tests over a mix of `local`/`space` carriers pass (AC8).
- **Builds-on:** nothing (first dispatch).
- **Hands-to:** M1.2/M1.3 (independent code areas; lands first so the carrier type exists).
- **Focus:** `packages/2-sql/1-core/contract/src/ir/foreign-key.ts`, `foreign-key-reference.ts`, `validators.ts`; round-trip tests in that package. Mongo: one-line no-op note (no FK concept).
- **dispatch-INVEST:** Small (one package, one concept), Testable (round-trip property test), Valuable (the carrier all later work needs).

## Dispatch M1.2 — Aggregate dependency graph + cycle rejection

- **Outcome:** the contract-aggregate loader builds a directional graph from `extensionPacks` and rejects cycles at load time with a diagnostic naming the cycle members (FR12/FR13).
- **FR12 scope pin (2026-06-05, orchestrator decision — round 2):** the graph + cycle detection run over the **provided descriptor set**, with edges derived from each pack's own declared `extensionPacks`. A pack that declares a dependency on a space **absent from the set fails load** with a clear "missing dependency — add it to `extensionPacks`" diagnostic (NOT a silent skip — that was the F3 bug). **Deferred:** true transitive *auto-loading* of packs the app did not list (discovering them via an extension's bundled `extensionPacks`). That needs a `spaceId → descriptor` resolution mechanism that does not exist today and is out of M1 scope; it is additive later (consistent with ADR 212's "conflation acceptable for v0.1"). The canonical `Profile → auth.User` case lists `[supabasePack]` directly and never exercises auto-loading. Recorded as an Open item below.
- **Builds-on:** M1.1 (sequential; same slice).
- **Hands-to:** M1.3 (same aggregate-load surface).
- **Focus:** `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts` (or a new file in that package) + the aggregate loader; synthetic multi-contract fixtures + cycle tests.
- **dispatch-INVEST:** Small, Testable (synthetic cycle fixtures), Valuable (load-ordering correctness).

## Dispatch M1.3 — Namespace-ownership collisions + reverse-reference rejection

- **Outcome:** every primitive `(namespace.id, name)` is owned by exactly one contributing contract; a duplicate across contracts fails load with a diagnostic naming both contributors (FR15/FR16/AC6). An extension contract referencing an app model (reverse reference) fails load with a clear diagnostic (FR14).
- **Builds-on:** M1.2 (extends the aggregate-load checks).
- **Hands-to:** slice DoD.
- **Focus:** aggregate loader; synthetic fixtures for (extension+extension same-namespace collision, app+extension collision, reverse reference).
- **Placement resolved (2026-06-05, round 3 re-pin):** the two checks land in different layers because they need different data:
  - **Reverse-reference (B)** — `assertNoCrossSpaceFkReverseReferences` in the SQL family (`packages/2-sql/9-family/src/core/control-instance.ts`, called from `createSqlFamilyInstance`). Correct: it only inspects each *extension's* cross-space (`origin:'space'`) FKs, which are SQL-specific and available extensions-only.
  - **Namespace-ownership collision (A)** — must include the **app contract**, which is NOT present at `createSqlFamilyInstance` (the `ControlStack` carries extension descriptors only). App + extensions first meet at the migration-tools **aggregate** (`packages/1-framework/3-tooling/migration/src/aggregate/loader.ts` `loadContractSpaceAggregate`), whose integrity gate `computeIntegrityViolations` (`check-integrity.ts`) already hosts cross-space checks. Wire `assertNoNamespaceOwnershipCollisions` there as a new `IntegrityViolation` kind, over `[app, ...extensions]`. This matches the plan's original "on the loaded aggregate" wording; the round-1 placement in `control-stack.ts`/SQL-family was wrong. Layering: the check *logic* stays in `framework-components` (1-core); 3-tooling calling it is allowed (no new layering, NFR4 holds).
- **dispatch-INVEST:** Small, Testable, Valuable (the ownership guarantees AC6 + FR14 require).

## Dispatch M1.4 — simplify FK carrier (operator decision A)

- **Outcome:** drop the redundant `origin: 'local' | 'space'` discriminator from `ForeignKeyReference`; discriminate cross-space purely on **`spaceId` presence** (absent → local, present → cross-space). `origin` carried no information `spaceId`'s presence didn't already carry, and forced a `spaceId?: never` + discriminated-union just to keep the two fields in sync.
- **Decision (2026-06-05, operator-approved):** **A** — keep `spaceId` optional (absent = local), preserving **NFR2** (local FKs still serialize byte-identically; dropping `origin` doesn't change local JSON, since local never carried it). The non-optional/uniform alternative (B) was rejected because it would re-hash every existing local-FK contract and churn fixtures.
- **Touches:** `foreign-key-reference.ts` (remove `origin`, collapse the local/space input union to a single `{ namespaceId, tableName, columns, spaceId?: string }` shape), `validators.ts` (collapse the two ref schemas into one with `'spaceId?': 'string'`, keep the `satisfies Type<…>` guards), and **every reader of `origin`** — at least `validateSqlStorageConsistency`'s target-existence skip and the SQL-family `assertNoCrossSpaceFkReverseReferences` check, both of which switch from `origin === 'space'` to `spaceId !== undefined`. Plus the affected tests.
- **Why now:** M1 is in review (PR #745), before M2's authoring surface produces these carriers — the right moment to fix the shape.

## Slice DoD

- AC6 + AC8 demonstrated by tests; AC10 (`lint:deps`) green; AC9 regression (existing local-FK tests pass).
- No authoring surface touched; no M2 / domain-plane relation work.
- Reviewer SATISFIED across all three dispatches; trace backstop passes; PR opened against `main`.

## Open items (deferred from M1)

- **Transitive auto-loading of unlisted contract spaces.** M1.2 builds the dependency graph + cycle detection over the descriptor set the app lists in `extensionPacks`, with edges from each pack's declared `extensionPacks`, and errors on a declared-but-absent dependency. Auto-discovering and loading a pack the app did **not** list (via an extension's bundled `extensionPacks`) is deferred — it requires a `spaceId → descriptor` resolution mechanism not present today. Additive when needed.

## Amendment dispatches (2026-06-06) — reconciliation + walking skeleton

Added after merging `main` (PR#746 walking skeleton + #719). See `spec.md` § Amendment / Decision D-recon.

### Dispatch M1.5 — Reconcile cross-space ownership checks

- **Outcome:** make `main`'s `disjointness` check **namespace-aware** and **remove our duplicate `namespaceOwnershipCollision`** entirely. After this, one correct cross-space ownership check exists.
- **Fix `disjointness`** (`packages/1-framework/3-tooling/migration/src/aggregate/check-integrity.ts` ~`contractViolations`, lines ~230–246): key `elementClaimedBy` on the full `(namespaceId, entityKind, entityName)` coordinate (all already yielded by `elementCoordinates`), not bare `entityName`. The `disjointness` violation's `element` becomes the qualified coordinate string (`claimedBy` shape unchanged). Update consumers' display strings (`contract-space-aggregate-loader.ts`, cli `integrity-violation-to-check-failure.ts`) and the assertion in `loader.test.ts` (~:366, `'user'` → qualified form).
- **Remove `namespaceOwnershipCollision`:** the IntegrityViolation kind (`integrity-violation.ts:67–73` + JSDoc); `findNamespaceOwnershipCollisions` + `NamespaceCollision*` types (`control-stack.ts:382–459`) + their `exports/control.ts` re-exports; the call + helper in `check-integrity.ts` (line 118 + `namespaceOwnershipCollisionViolations` 261–286 + import); the cli case `PN-MIG-CHECK-017` (`integrity-violation-to-check-failure.ts:138–145`); the `migration-check.ts:384` filter entry; and the tests (`control-stack.test.ts:730–784`, `check-integrity.test.ts:78–118`).
- **Migrate test coverage to `disjointness`:** add tests proving (a) same name in **different** namespaces across spaces → **no** collision (the `auth.users` vs `public.users` case — the false-positive we're fixing); (b) same `(namespace, kind, name)` across two spaces → collision naming both contributors; through the real load path.
- **Validation gate (expanded — closes the babysit gaps):** the touched packages' tests + `pnpm typecheck` + `pnpm lint:deps` + `pnpm lint:casts` AND **full `pnpm lint`** (`biome check --error-on-warnings`) AND **`pnpm fixtures:check`** AND the **`examples/supabase` skeleton test** — the last three were the gaps CI caught during babysit. Rebuild dependent `dist` before downstream tests.
- **dispatch-INVEST:** one logical change (make the check correct, drop the duplicate); Small-ish (mostly deletions + one keying fix + test migration).

### Dispatch M1.6 — Walking-skeleton verification + FK-deferral record

> **Resolution (2026-06-06): no code dispatch needed.** M1.5's review confirmed the skeleton requires **no M1 change** (the cross-contract FK genuinely needs M2 authoring + M3 planner/verifier), and `examples/supabase/test/skeleton.integration.test.ts`'s JSDoc already frames "later constituents extend in place." So M1.6 is satisfied by: (a) the **PR #745 description** recording that the `Profile.userId → auth.User.id` FK + cascade DoD is deferred to M2/M3, and (b) **CI** verifying the skeleton stays green against M1's reconciled checks (it couldn't be run locally — `examples/supabase` deps aren't installed in this worktree subtree). No implementer dispatch was spawned.

- **Outcome:** confirm the `examples/supabase` skeleton integration test is green against M1 (post-M1.5), and **record that the cross-contract FK + cascade-delete DoD is deferred to M2 (authoring) + M3 (planner/verifier)** — not achievable in M1 (no authoring surface). No change to the skeleton's app contract / migration artefacts.
- **Where the record lands:** the skeleton test's JSDoc (already frames "later constituents extend in place" — make the M1-vs-M2/M3 boundary explicit) and the PR #745 walking-skeleton note.
- **Validation gate:** `examples/supabase` test green; `pnpm fixtures:check` clean (the skeleton emits `migrations/supabase/*`).
- **dispatch-INVEST:** verification + docs; no production code change.

## Revised slice DoD (supersedes the above for the amended scope)

- AC6 delivered via the **namespace-aware `disjointness`** (cycle + reverse-ref + collision); `namespaceOwnershipCollision` removed; AC8/AC10 green; AC9 regression.
- `examples/supabase` skeleton green against M1; FK-step deferral to M2/M3 recorded.
- Full `pnpm lint` + `pnpm fixtures:check` + skeleton test added to the slice's standing gate (babysit lesson).
- Reviewer SATISFIED; CI green on PR #745.
