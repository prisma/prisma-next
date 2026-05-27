# Project Plan: mongo-driver-version-support

**Spec:** [`projects/mongo-driver-version-support/spec.md`](./spec.md)
**Design notes:** [`projects/mongo-driver-version-support/design-notes.md`](./design-notes.md)
**Surface-area recon:** [`projects/mongo-driver-version-support/research/mongo-surface-area.md`](./research/mongo-surface-area.md)
**Open-questions research:** [`projects/mongo-driver-version-support/research/open-questions.md`](./research/open-questions.md)
**Slice plan:** [`projects/mongo-driver-version-support/slices/mongo-peer-dep-migration/plan.md`](./slices/mongo-peer-dep-migration/plan.md) (one dispatch; slice-DoD inherits PDoD8–PDoD12)
**Linear Project:** [PN] EA Release (existing; no new Linear Project for this drive-project)
**Purpose** _(from spec)_: Unblock users from upgrading the `mongodb` driver in their own application — and free Prisma Next to track new mongo majors on its own cadence — by making the runtime driver an honest, user-controlled peer dependency rather than a hidden bundle pinned to a major (currently `^6`) that we no longer want to support.

## At a glance

One slice — `mongo-peer-dep-migration` — delivers the entire body of work in a single PR: peer-dep migration on the three runtime-consumer packages, stale-dep removal on two packages, catalog bump to `mongodb ^7`, the `collection.drop()` v7-semantic audit, and lockfile-coherence verification. Examples and the CLI E2E test fixture continue to declare `mongodb: catalog:`, so they inherit the catalog bump automatically — no example/fixture changes are required beyond verifying they build + test green.

## Composition

### Stack (deliver in order)

1. **Slice `mongo-peer-dep-migration`** — Migrate the workspace from `mongodb@^6` (bundled as a regular `dependencies` entry) to `mongodb@^7` as a user-supplied peer dependency on the three runtime-consumer packages; drop the stale `mongodb` declarations from the two non-consumer packages; bump the workspace catalog; audit the v7 `collection.drop()` semantic change at the single affected call site; publish a user-facing migration note covering the BSON v7 `new ObjectId(numericTimestamp)` removal; verify the install graph resolves a single mongodb major. Scope: the eight in-scope items from the spec (FR1–FR8). Concretely touches:
   - `pnpm-workspace.yaml` (catalog entry).
   - `packages/3-mongo-target/3-mongo-driver/package.json` — `mongodb` → `peerDependencies: ^7.0.0`.
   - `packages/3-mongo-target/2-mongo-adapter/package.json` — same move.
   - `packages/3-extensions/mongo/package.json` — same move.
   - `packages/3-mongo-target/1-mongo-target/package.json` — remove `mongodb` declaration entirely.
   - `packages/2-mongo-family/9-family/package.json` — remove `mongodb` declaration entirely.
   - `packages/3-mongo-target/2-mongo-adapter/src/core/command-executor.ts:58` — audit + (if needed) explicit-guard adjustment for the v7 `collection.drop()` no-throw-on-`NamespaceNotFound` semantic change.
   - `pnpm-lock.yaml` — regenerated via `pnpm install`; expected to collapse to a single mongodb major.
   - Verification-only (no expected edits): `examples/mongo-demo/package.json`, `examples/retail-store/package.json`, `examples/mongo-blog-leaderboard/package.json`, `test/integration/test/fixtures/cli/cli-e2e-test-app/package.json` — all continue to declare `mongodb: catalog:` and inherit the catalog bump.
   Linear: **TML-2663** (already exists; do not duplicate). Depends on: none.

_(No further slices. Single-slice project per operator confirmation.)_

## Dependencies (external)

None expected. The work is self-contained within the workspace. Codebase research did not surface any external blocker (no other repo / package / infra change must land first; no decision is pending outside the project's own four open questions, all of which are working-position resolved in the spec).

## Project-DoD coverage map

| Project-DoD | Delivered by |
|---|---|
| **PDoD1.** Single slice delivered (one PR landed) or explicitly deferred. | Slice `mongo-peer-dep-migration`. |
| **PDoD2.** Manual-QA coverage across user-observable surfaces; no unresolved 🛑 Blocker findings (fresh-worktree install, example apps build + test green, `collection.drop()` audit landing in code). | Slice `mongo-peer-dep-migration` (delivers the artifacts) + close-out (verifies + confirms no blockers remain). |
| **PDoD3.** Mandatory final retro complete; output landed in canonical / project-context / ADR. | Close-out. |
| **PDoD4.** Long-lived docs migrated into `docs/` if any durable policy / version-bump-cycle ADR is authored. | Close-out. |
| **PDoD5.** Repo-wide references to `projects/mongo-driver-version-support/**` removed or replaced with `docs/` links. | Close-out. |
| **PDoD6.** `projects/mongo-driver-version-support/` deleted. | Close-out. |
| **PDoD7.** Linear ticket TML-2663 marked Completed. | Close-out. |
| **PDoD8.** Workspace catalog and all five workspace mongo packages reflect the settled posture (catalog at `^7.x.y`; peer-dep on 3 runtime consumers; declaration absent on 2 non-consumers). | Slice `mongo-peer-dep-migration`. |
| **PDoD9.** `pnpm-lock.yaml` resolves a single `mongodb` major (driver-7). | Slice `mongo-peer-dep-migration`. |
| **PDoD10.** All three example apps and the `cli-e2e-test-app` fixture continue to declare `mongodb: catalog:` and continue to build + test green against the catalog-resolved v7 driver. | Slice `mongo-peer-dep-migration`. |
| **PDoD11.** The `collection.drop()` audit at `adapter-mongo/src/core/command-executor.ts:58` is documented in the PR description. | Slice `mongo-peer-dep-migration`. |
| **PDoD12.** PR description includes a user-facing migration-note section naming the `new ObjectId(numericTimestamp)` removal and pointing users at `ObjectId.createFromTime()`. | Slice `mongo-peer-dep-migration`. |

No PDoD condition is uncovered.

## Risks + open questions

> **Status (2026-05-26): all four spec-level open questions researched and resolved before delivery.** Research artifact: [`./research/open-questions.md`](./research/open-questions.md). Risk surface below has been re-anchored against the findings.

1. **BSON v7 class-shape changes propagating through `@prisma-next/mongo/bson`.** **Resolved — confirms benign.** Only relevant change is `new ObjectId(numericTimestamp)` removed; zero numeric ObjectId calls in our source. Plan impact: a one-line user-migration-note deliverable (FR8 / PDoD12) is now in scope within the single slice; no second slice needed.
2. **`collection.drop()` no-throw-on-`NamespaceNotFound` (v7 B6).** **Resolved — confirms benign.** No caller and no test depends on the throw; the migration-runner's idempotency check already short-circuits drops on missing collections. The audit-and-document-finding deliverable (FR7 / PDoD11) is the only artefact required; no code change.
3. **Cursor `batchSize` default removal (v7 B11) — defer is correct.** **Framing corrected:** v7 *reduces* round-trips, not increases them (the driver's removed 1000-doc cap lets the server pack up to 16 MB per `getMore`). The user-facing aggregate path is more likely to see a perf improvement than a regression. Residual risk: a perf regression surfaces in test / integration after the bump — would still require a separate follow-up ticket, not in scope here.
4. **`MongoClient.connect()` fail-fast handshake (v7 B13).** **Resolved — confirms defer.** Every `client.connect()` site connects to credential-free `mongodb-memory-server`; zero tests exercise lazy-error patterns. Our control-driver wrapper already structures the error. No action.

Plan-level sequencing risk is nil — single slice, no inter-unit ordering to misjudge. The principal load-bearing planning assumption — that the slice fits in one PR — is reinforced by the research: every "what if Q resolves badly" branch that could have grown the slice has been retired.

## Close-out (required)

- [ ] Verify all acceptance criteria in [`./spec.md`](./spec.md) (PDoD1, PDoD8, PDoD9, PDoD10, PDoD11, PDoD12 by slice; PDoD2 jointly).
- [ ] Mandatory final retro complete; output landed in canonical / project-context / ADR (PDoD3).
- [ ] Migrate long-lived docs into `docs/` — only if a durable policy / version-bump-cycle ADR is authored (PDoD4).
- [ ] Strip repo-wide references to `projects/mongo-driver-version-support/**` (replace with canonical `docs/` links or remove) (PDoD5).
- [ ] Delete `projects/mongo-driver-version-support/` (PDoD6).
- [ ] Linear ticket TML-2663 marked Completed (PDoD7).
