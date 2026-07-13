# Brief: D1 scaffold-and-contract-space

## Task

Create the new workspace package `@prisma-next/extension-better-auth` at `packages/3-extensions/better-auth/` shipping subpath-only exports `/pack` and `/contract`, whose pack descriptor carries a **managed** contract space (`spaceId: 'better-auth'`, `familyId: 'sql'`, `targetId: 'postgres'`) defining the four BetterAuth core models — `User`, `Session`, `Account`, `Verification` — with a baseline migration package, **such that** a consuming app that adds the pack to `extensionPacks` gets the four models in its aggregate contract as typed ORM collections with navigable relations, and the framework (not the app, not an external system) owns the tables' DDL lifecycle (`db init` walks the space's migration to head; verification is clean at head). Follow `packages/3-extensions/supabase/` for package shape/config and `packages/3-extensions/pgvector/` for a space that ships migrations (`contractSpaceFromJson`, on-disk `migrations/` + `refs/head.json`, emitted via `prisma-next contract emit` / the package's `build:contract-space` script).

Model content (from BetterAuth core schema, https://www.better-auth.com/docs/concepts/database#core-schema — re-verify field lists there):
- Tables: singular `user`, `session`, `account`, `verification` in the `public` namespace; all ids `text`; `createdAt`/`updatedAt` timestamps on all four.
- `User`: id, name, email (unique), emailVerified (boolean), image (nullable text).
- `Session`: id, userId → User.id (navigable relation), token (unique), expiresAt, ipAddress (nullable), userAgent (nullable).
- `Account`: id, userId → User.id (navigable relation), accountId, providerId, accessToken/refreshToken/idToken (nullable), accessTokenExpiresAt/refreshTokenExpiresAt (nullable), scope (nullable), password (nullable).
- `Verification`: id, identifier, value, expiresAt.

Control policy: `managed` (the contract default — do NOT set `defaultControlPolicy: 'external'`; that's the supabase space's posture, not this one).

## Scope

**In:** `packages/3-extensions/better-auth/**` (new: package.json, tsconfig*, tsdown.config.ts, biome.jsonc, vitest.config.ts, prisma-next.config.ts if the emit pipeline needs it, `src/contract/**`, `src/pack/**`, `src/exports/{pack,contract}.ts`, `migrations/**`, minimal package test asserting the pack descriptor's self-consistency); `architecture.config.json` (register the package in the same layer/domain slot as the supabase extension); `pnpm-workspace.yaml`/lockfile only if pnpm requires it (globs may already cover `packages/3-extensions/*`).

**Out:** `/adapter` subpath and any `better-auth` npm dependency (D4); branded handles beyond what the contract emit pipeline generates (`handles.ts` is D3); `test/integration/**` (D2); `examples/**` (D7); any change under `packages/1-framework/**` or `packages/3-targets/**` — if the managed-space path turns out to need framework changes, HALT and surface (stop-condition, project spec § Place in the larger world).

## Completed when

- [ ] `pnpm --filter @prisma-next/extension-better-auth build` and `pnpm --filter @prisma-next/extension-better-auth test` pass; the pack descriptor satisfies `SqlControlExtensionDescriptor<'postgres'>` with a non-empty `contractSpace.migrations` whose head matches `refs/head.json`.
- [ ] `contract.d.ts` exposes the four models with the relations/uniques above (spot-assert via the package test or a type-level test).
- [ ] Workspace gates: `pnpm typecheck`, `pnpm --filter @prisma-next/extension-better-auth lint`, `pnpm lint:deps`, `pnpm fixtures:check` all green.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you off the goal — even if it looks useful — halts and surfaces.

## References

- Slice spec: `projects/extension-better-auth/slices/better-auth-extension/spec.md` — chosen design (package layout, contract-space content) + edge cases.
- Slice plan entry: `projects/extension-better-auth/slices/better-auth-extension/plan.md` § D1 — outcome / hands-to / gates.
- Project spec: `projects/extension-better-auth/spec.md` — system-level intent; § Settled decisions.
- Precedent packages: `packages/3-extensions/supabase/` (package.json exports/config/tsconfig/tsdown shape, `src/contract/` + `src/pack/` + `src/exports/` layout), `packages/3-extensions/pgvector/` (`src/exports/control.ts` — space with migrations; `migrations/` layout; `contractSpaceFromJson` from `@prisma-next/migration-tools/spaces`).
- Calibration: failure-modes F5 (destructive git ops forbidden — no rebase/reset/force-push/stash; commit on the current branch `tml-2994-better-auth-extension` only), F14 (gates mirror CI: run `lint` per touched package — biome `--error-on-warnings`; typecheck must cover the package's `test/` project too), F16 (no layering violations — `pnpm lint:deps` is a hard gate, never bypass), F17 (the win is the property stated in Task, not the mechanics; if the property can't hold, halt), F24 (if a gate looks broken-on-base, rebuild stale `dist` before claiming pre-existing failure).
- Edge-case dispositions (from slice spec): `user` table name relies on adapter identifier quoting — keep the name, don't rename; ids are text (no numeric-id support); PSL-vs-hand-authored contract source is your call at execution time against the precedents (slice plan § Open items) — either is acceptable, note which you chose and why in the wrap-up.

## Operational metadata

- **Model tier:** orchestrator — design-bearing dispatch (first managed extension space shipping table DDL; no exact precedent).
- **Time-box:** 90 min wall-clock. Overrun → halt and surface with a progress snapshot; do not extend.
- **Halt conditions:** an out-of-scope surface (esp. `packages/1-framework/**`) needs touching to make the managed-space path work; the emit pipeline cannot produce a managed space with relations/uniques as specified (falsified spec assumption, I12); diff exceeds ~25 files excluding lockfile/emitted artifacts; any gate failure you cannot attribute to your own diff.
- **Progress notes:** append one-line progress notes (phase + ts) to `wip/heartbeats/implementer.txt` at each phase transition (create the directory if absent).
