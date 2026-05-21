# Dispatch 5 — Framework-side test layering fix (PR #552 review pushback)

**Branch:** `tml-2584-s1a-substrate` (already checked out)
**Model tier:** `composer-2.5-fast` (Composer-2.5)
**Sizing:** **S** — subtractive + small additive moves; all changes are mechanical once the prescription is clear.
**Source of the pushback:** Three unresolved threads from @wmadden on PR #552:

- `packages/1-framework/1-core/framework-components/tsconfig.json` — "This is a layering violation. Remove it"
- `packages/1-framework/1-core/framework-components/turbo.json` — "This is also a layering violation. Remove it."
- `packages/1-framework/1-core/framework-components/vitest.config.ts` — "LAyering violation"

---

## Intent

The framework-components D4 test (`test/element-coordinates.test.ts`) imports `SqlStorage` and `MongoStorage` from sibling family packages. That import direction (framework → family) is a layering violation. It compiles today only because we papered over the natural Turbo build cycle with **dist-path aliases** in `tsconfig.json` + `vitest.config.ts` and an **explicit `dependsOn`** in a new `turbo.json`. The operator has explicitly rejected that workaround.

**Correct shape:**

1. The framework-side test exercises `elementCoordinates` against a **synthetic `Storage`-shaped literal** built with no pack imports. The function under test is purely structural — it walks `Object.entries(storage.namespaces[ns])` — so a literal that conforms to the interface is sufficient (and is actually a stronger test, because it pins the structural contract, not a particular family concretion).
2. Family-side verification that `SqlStorage` / `MongoStorage` actually conform to the structural promise (so `elementCoordinates` yields the right tuples) lives in **each family's own test package**, which legitimately depends on `@prisma-next/framework-components`. The Postgres analogue already lives at `packages/3-targets/3-targets/postgres/test/element-coordinates.test.ts` (landed in D4-R2). This dispatch adds the SQL and Mongo analogues.
3. The dist-path aliases and `turbo.json` are deleted entirely.

---

## Files

**Modify:**
- `packages/1-framework/1-core/framework-components/test/element-coordinates.test.ts` — rewrite to use a synthetic `Storage` literal. No `@prisma-next/sql-contract` / `@prisma-next/mongo-contract` imports. Keep the existing `assertStoragePlaneCoordinates` helper and the existing assertion shape; just feed it a literal `Storage` (cast through the `Storage` interface, or constructed via a tiny test-local class that extends nothing — pick whichever satisfies `Storage extends IRNode` without pulling in a family). The literal MUST cover:
  - at least two namespaces,
  - a namespace with two entity-kind "slot" maps (e.g. `tables` and `enums`, or arbitrary names like `widgets` and `gadgets` — the framework test is structural, the names are not load-bearing),
  - at least one slot with multiple entries,
  - the `id` field (which must be skipped by the walk).
  Assert: `plane === 'storage'` on every tuple, every `(namespaceId, entityKind, entityName)` triple is produced exactly once, the `id` field is never yielded, and (NEW coverage) a namespace where one slot has `null` and one slot has a scalar value — both must be skipped.

- `packages/1-framework/1-core/framework-components/tsconfig.json` — remove the `compilerOptions.paths` block and the surrounding comment. Restore to the state before D4-R2 introduced the aliases (i.e. no `paths`, no `baseUrl` if it was only there to anchor `paths`). Keep `rootDir: "."`, `include`, `exclude`, and the `extends` line.

- `packages/1-framework/1-core/framework-components/vitest.config.ts` — remove the `resolve.alias` block, the `fileURLToPath` import, and the `dist` helper. Restore to the state before D4-R2 introduced the aliases.

**Delete:**
- `packages/1-framework/1-core/framework-components/turbo.json` — this file was created in the prior CI fix attempt to declare the Turbo build-order dependency. With the aliases gone, the framework-components package no longer imports anything from sibling families, so the implicit build-order edge disappears with them. The file is deleted, not edited.

**Create (family-side coverage):**
- `packages/2-sql/1-core/contract/test/element-coordinates.test.ts` — minimal coverage that constructs a real `SqlStorage` and asserts `elementCoordinates(storage)` yields the expected tuples with `plane === 'storage'`. Mirror the shape of `packages/3-targets/3-targets/postgres/test/element-coordinates.test.ts` (read it first to match style). Import `elementCoordinates` from `@prisma-next/framework-components` (this is the **correct** direction: family → framework). Use one namespace with at least one `tables` entry.
- `packages/2-mongo-family/1-foundation/mongo-contract/test/element-coordinates.test.ts` — same shape, against `MongoStorage` with one namespace + one `collections` entry.

**Pre-flight checks for the new family-side test files:**
- Confirm the destination package's `vitest.config.ts` will pick up `test/element-coordinates.test.ts` (most do by glob; if not, mirror the surrounding file naming exactly).
- Confirm `@prisma-next/framework-components` is already a dep of each destination package (it is — but verify in `package.json` and report if missing rather than silently adding).

**Do NOT:**
- Add `@prisma-next/sql-contract` or `@prisma-next/mongo-contract` as a devDep of `framework-components` (that's the original Turbo cycle this dispatch is meant to eliminate).
- Restructure the `elementCoordinates` function itself or `Storage` interface in `src/ir/storage.ts`. Surface is settled.
- Touch any other package, any other test, any planning artifact, any unrelated config.

---

## Done-when gates (run these locally, all must pass)

Run from worktree root:

```bash
# 1. Module resolution / typecheck (turbo path — what CI runs)
pnpm typecheck

# 2. Framework-components tests (vitest)
pnpm --filter @prisma-next/framework-components test

# 3. SQL contract tests (new file landed)
pnpm --filter @prisma-next/sql-contract test

# 4. Mongo contract tests (new file landed)
pnpm --filter @prisma-next/mongo-contract test

# 5. Postgres tests (existing element-coordinates.test.ts must still pass)
pnpm --filter @prisma-next/target-postgres test

# 6. Layering enforcement (must show no framework → family edge from framework-components)
pnpm lint:deps

# 7. Contract fixtures unchanged
pnpm fixtures:check
```

**All seven must PASS.** If `pnpm typecheck` fails specifically on the new family-side test files, debug their wiring; do NOT reintroduce dist-path aliases in framework-components.

**Bonus verification (do this and report the result):** simulate the CI fresh-checkout scenario:

```bash
# From worktree root, blow away sibling dist/ that would mask a cycle
rm -rf packages/2-sql/1-core/contract/dist
rm -rf packages/2-mongo-family/1-foundation/mongo-contract/dist

# Re-run typecheck — must PASS without rebuilding those siblings first
pnpm typecheck
```

This is the scenario that broke previously. It MUST pass after this dispatch (because the framework-side test no longer imports from sibling families, the build-order dependency disappears entirely).

---

## Commit + push

Single commit, on `tml-2584-s1a-substrate`. Signed-off (DCO required).

Suggested message (adjust if you find a tighter framing):

```
fix(framework-components): replace cross-family test imports with synthetic Storage literal

The D4-R2 test reached into SqlStorage and MongoStorage to exercise
elementCoordinates against real namespace concretions. That import
direction (framework → family) is a layering violation; we previously
papered over it with dist-path aliases and a turbo.json build-order
declaration. Both rejected on review.

Rewrites the framework-side test to feed elementCoordinates a synthetic
Storage literal — which is actually a stronger test, because it pins
the structural contract rather than a particular family concretion.
Family conformance moves to the family's own test package (mirroring the
Postgres test that already lives in @prisma-next/target-postgres). Deletes
the dist-path aliases and turbo.json that existed only to mask the cycle.

Resolves three layering-violation comments on PR #552.
```

After committing, push to `origin/tml-2584-s1a-substrate` and post the SHA.

---

## Reply to each of the three operator threads on PR #552

After the push succeeds, post **one** brief reply per thread (use `gh api` POST to `/repos/prisma/prisma-next/pulls/comments/{comment_id}/replies` — get the comment IDs from the unresolved review threads via `gh api graphql`). Each reply should be ~2 sentences max, pointing at the new SHA. Suggested text:

> Done in `<sha>`. The framework-side test now uses a synthetic Storage literal (no pack imports); family conformance moved to `@prisma-next/sql-contract` / `@prisma-next/mongo-contract` test packages, mirroring the existing Postgres analogue. Aliases + `turbo.json` deleted.

Then **resolve** each of the three threads.

---

## Refusal triggers (HALT and report, do not proceed)

- Any of the seven gates fails after restructuring.
- The fresh-checkout simulation still fails (would mean the framework-side test is still importing across families somehow).
- The destination family packages do NOT have `@prisma-next/framework-components` as a dep (would mean you'd need to add it — report instead, don't add silently; might be a package.json fix that needs operator review).
- The synthetic Storage literal can't be made to satisfy `extends IRNode` without importing a family helper. Report and I'll redirect.
- You discover the `elementCoordinates` walk needs more than purely structural assertions (e.g. needs to test against `kind` being non-enumerable on namespace concretions specifically). Report — that coverage might still need to live family-side.

---

## Out of scope (do not touch in this dispatch)

- The three substantive CodeRabbit findings on the slice (Mongo namespace `kind` required, fragment-vs-builtin validator precedence, serializer guard scope). Those are handled by a separate `/github-review-iteration` dispatch.
- Any planning artifact, retro entry, or skill text. The orchestrator will log this rework cycle as a retro finding after the dispatch completes.
- PR description on #552. Orchestrator updates it after this dispatch lands.
