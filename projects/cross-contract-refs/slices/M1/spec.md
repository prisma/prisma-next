# M1 — Foundation (slice spec)

Slice of project [cross-contract-refs](../../spec.md) (TML-2500), PR #745. Delivers the IR carrier + aggregate-load checks; **no authoring surface** (that's M2), **no planner/verifier e2e** (M3).

Owns project ACs: **AC6** (collision + cycle rejection at aggregate load), **AC8** (round-trip), **AC10** (`lint:deps` + cast ratchet), and **AC9** regression.

## Delivered (dispatches M1.1–M1.4)

- **FK reference carrier** — `ForeignKeyReference` carries an optional `spaceId`; its presence discriminates a cross-space target from a local one (absent = local). Local FKs serialize byte-identically (NFR2). (M1.1, simplified in M1.4 — `origin` discriminator dropped per operator decision.)
- **Cross-space dependency graph + cycle rejection** — `buildExtensionLoadOrder` (framework-components), edges from each pack's declared `extensionPacks`, errors on an unlisted declared dependency, rejects cycles (FR12/FR13). The computed order is applied when assembling the control stack (review fix A-001).
- **Reverse-reference rejection** — `assertNoCrossSpaceFkReverseReferences` (SQL family) rejects an extension FK pointing against the dependency arrows (FR14).
- **Namespace-ownership collision detection** — *(superseded — see amendment below)*.

## Amendment (2026-06-06): reconcile with main's `disjointness`; update the merged walking skeleton

Merging latest `main` brought in two relevant landings (#719 Mongo marker/ledger — orthogonal; and PR#746 — the `@prisma-next/supabase` extension + the `examples/supabase` **walking skeleton**) and surfaced a redundancy + latent bug in how cross-space primitive ownership is checked.

### Decision D-recon — fix `disjointness`, remove our `namespaceOwnershipCollision`

`main` already has a `disjointness` integrity check (`PN-MIG-CHECK-014`, in `packages/1-framework/3-tooling/migration/src/aggregate/check-integrity.ts`) that detects "a storage element claimed by multiple contract spaces" using the canonical `elementCoordinates(storage)` walker — **but it keys on bare `entityName`**, discarding namespace + kind. That is namespace-blind: it would **falsely flag `auth.users` (supabase space) and `public.users` (app space)** — same name, different namespaces — as a collision. That multi-namespace same-name scenario is exactly what this project enables, so our feature turns a latent `disjointness` bug into a live one.

Our M1.3 `namespaceOwnershipCollision` (`PN-MIG-CHECK-017`) is the namespace-aware version (keys on `namespace:kind:name`), but it **duplicates the concern** with a bespoke walk in a different package — the very "hand-walk an untyped structure instead of the typed/canonical path" pattern that #719 spent a PR eliminating elsewhere.

**Resolution:** make `disjointness` namespace-aware (key on the full `(namespaceId, entityKind, entityName)` coordinate that `elementCoordinates` already yields) and **remove our `namespaceOwnershipCollision` entirely** — after the fix the two are exact duplicates, and `disjointness` is the incumbent broadly consumed by `db-init` / `db-run` / `db-verify` / `migration-check`. AC6's collision half is then delivered by the fixed `disjointness`, not a separate new check. This is preferred over removing `disjointness` (which would mean re-threading the refusal chain through many consumers).

### Walking-skeleton obligation (revised for M1's level)

`examples/supabase` (landed on `main`) composes the app space (`public.Profile`) + the `@prisma-next/supabase` extension space (`auth.*`, `storage.*`, external) via `extensionPacks`, and its integration test runs `db init` / `db verify` — which now execute our aggregate-integrity checks. The project's full walking-skeleton DoD (add `Profile.userId → auth.User.id` cross-contract FK + cascade test, planner emits qualified `REFERENCES "auth"."users"`) **requires M2 (authoring surface) + M3 (planner/verifier) and is NOT achievable in M1** (no way to author the cross-space FK yet). M1's obligation is narrower: **the skeleton stays green against M1's checks** (including the reconciled `disjointness`), and the deferral of the FK step to M2/M3 is recorded.

## Slice DoD (updated)

- AC6 (cycle + reverse-ref + namespace-aware collision via fixed `disjointness`), AC8, AC10 green; AC9 regression.
- `disjointness` is namespace-aware; no `namespaceOwnershipCollision` remains; the duplicate is gone.
- `examples/supabase` skeleton test green against M1; FK-step deferral to M2/M3 documented.
- Reviewer SATISFIED; CI green; PR #745 updated.
