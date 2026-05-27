# Slice plan: mongo-peer-dep-migration

**Project:** [`../../`](../../) (mongo-driver-version-support)
**Project spec:** [`../../spec.md`](../../spec.md)
**Project plan:** [`../../plan.md`](../../plan.md)
**Design notes:** [`../../design-notes.md`](../../design-notes.md)
**Surface-area recon:** [`../../research/mongo-surface-area.md`](../../research/mongo-surface-area.md)
**Open-questions research:** [`../../research/open-questions.md`](../../research/open-questions.md)
**Linear ticket:** [TML-2663](https://linear.app/prisma-company/issue/TML-2663/mongo-driver-is-pinned-to-version-6-cant-support-7-or-8)

## Slice intent

Migrate the workspace from `mongodb@^6` (bundled as a regular `dependencies` entry) to `mongodb@^7` as a user-supplied peer dependency on the three runtime-consumer packages; drop the stale `mongodb` declarations from the two non-consumer packages; bump the workspace catalog; audit the v7 `collection.drop()` semantic change at the single affected call site; publish a user-facing migration note covering the BSON v7 `new ObjectId(numericTimestamp)` removal; verify the install graph resolves a single mongodb major.

Land FR1–FR8 in **one PR**.

## Slice DoD

Inherits the project's PDoD8–PDoD12 (the slice-scoped conditions; PDoD1–PDoD7 are project-close conditions handled at close-out, not by this slice). Concretely:

- [ ] **PDoD8.** Workspace catalog and all five mongo packages reflect the settled posture (catalog at `mongodb: ^7.x.y`; peer-dep on 3 consumers; declaration absent on 2 non-consumers).
- [ ] **PDoD9.** `pnpm-lock.yaml` resolves a single `mongodb` major (driver-7).
- [ ] **PDoD10.** Three example apps + `cli-e2e-test-app` continue to declare `mongodb: catalog:` and continue to build + test green.
- [ ] **PDoD11.** `collection.drop()` audit at `adapter-mongo/src/core/command-executor.ts:57-59` documented in the PR description.
- [ ] **PDoD12.** PR description includes a user-facing migration note naming the `new ObjectId(numericTimestamp)` removal + `ObjectId.createFromTime()` replacement.

## Validation gate (slice-level)

The full set of harness commands that must all pass before review and before PR-open. Per `drive-build-workflow § Validation gates`, this includes a workspace-wide test command because the slice changes a public peer-dependency surface that consumer packages and example apps depend on.

```bash
pnpm typecheck         # workspace-wide
pnpm lint:deps         # layering / import-rule validation
pnpm build             # catch tsdown / type-emission regressions
pnpm test:packages     # cheapest healthy-workspace signal
pnpm test:integration  # mongodb-memory-server end-to-end exercises driver-7 in real
```

Plus three structural-coherence checks the implementer runs as part of the gate:

```bash
# 1. Lockfile resolves a single mongodb major (no transitive v6 stragglers).
rg '^\s*/mongodb@6\.' pnpm-lock.yaml || echo "OK: no mongodb@6 entries"

# 2. Catalog declares ^7.x.y.
rg '^\s+mongodb: \^7\.' pnpm-workspace.yaml

# 3. Peer-dep posture: declared on the three consumers, absent on the two non-consumers.
for pkg in packages/3-mongo-target/3-mongo-driver packages/3-mongo-target/2-mongo-adapter packages/3-extensions/mongo; do
  rg '"mongodb":' "$pkg/package.json" | rg -q peer || echo "FAIL: $pkg missing peerDependencies entry"
done
for pkg in packages/3-mongo-target/1-mongo-target packages/2-mongo-family/9-family; do
  rg -q '"mongodb":' "$pkg/package.json" && echo "FAIL: $pkg still declares mongodb" || echo "OK: $pkg has no mongodb declaration"
done
```

## Dispatches

### Dispatch 1 — peer-dep migration + catalog bump + audit + migration note

**Predicted size:** **M** (~45–90 min of implementer wallclock: 5 `package.json` edits + 1 catalog bump + lockfile regen + 1 source audit + verification across examples + PR-description authoring).

**Single-dispatch rationale.** The work is mechanically tightly-coupled — the catalog bump and the peer-dep moves must land together, and the lockfile regen verifies coherence across both. Splitting into "bump catalog" / "move peer deps" / "audit drop()" / "write migration note" sub-dispatches would introduce intermediate broken states (e.g. peer-dep moved but catalog still on v6) without any review benefit. The whole slice is one PR; one dispatch produces it.

#### Intent

Land the peer-dep migration as a single coherent change. Three runtime-consumer packages declare `mongodb` in `peerDependencies` only; two non-consumer packages stop declaring `mongodb` entirely; catalog moves to v7; lockfile regenerates and resolves to a single major. `collection.drop()` is audited at its single call site (no code change expected per resolved Q2). PR description carries the audit finding and the user-facing `ObjectId(numericTimestamp)` migration note.

#### Files in play

**Edited:**

- `pnpm-workspace.yaml` — catalog: `mongodb: ^6.16.0` → `mongodb: ^7.x.y` (latest 7.x at land time; check `pnpm view mongodb dist-tags.latest`).
- `packages/3-mongo-target/3-mongo-driver/package.json` — move `mongodb` from `dependencies` → `peerDependencies` (range `^7.0.0`).
- `packages/3-mongo-target/2-mongo-adapter/package.json` — same move.
- `packages/3-extensions/mongo/package.json` — same move.
- `packages/3-mongo-target/1-mongo-target/package.json` — remove `mongodb` declaration entirely.
- `packages/2-mongo-family/9-family/package.json` — remove `mongodb` declaration entirely.
- `pnpm-lock.yaml` — regenerated via `pnpm install` (per `.cursor/rules/no-direct-lockfile-edits.mdc`, never edit by hand).

**Audited (no change expected):**

- `packages/3-mongo-target/2-mongo-adapter/src/core/command-executor.ts:57-59` — `collection.drop()` call. Per resolved Q2, no code change is expected; the audit finding lands in the PR description. If (against research expectation) a caller chain surfaces reliance on the v6 throw, add an explicit guard and document.

**Verification-only (must continue to build + test green; no edits expected):**

- `examples/mongo-demo/package.json`
- `examples/retail-store/package.json`
- `examples/mongo-blog-leaderboard/package.json`
- `test/integration/test/fixtures/cli/cli-e2e-test-app/package.json`

**Authored (PR-shaping artefact):**

- PR description body — must include the drop() audit finding (PDoD11) and the user-facing migration note for `new ObjectId(numericTimestamp)` removal (PDoD12 / FR8).

#### Per-dispatch DoR (pre-flight checklist)

- [x] Intent statement clear (above).
- [x] Files-in-play named with concrete paths (above).
- [x] "Done when" gates explicit (below + slice-level validation gate).
- [x] Predicted size **M** — within the per-dispatch M-cap; no L/XL refusal trigger.
- [x] Failure modes from `drive/plan/README.md` considered (below).
- [x] Edge cases from project spec covered (below; all four open questions resolved with research-grounded dispositions).
- [x] No silent design decisions assumed — every fork has a settled answer in the spec / design-notes / research artefacts.

#### "Done when" gates

1. **Slice-level validation gate passes** (typecheck + lint:deps + build + test:packages + test:integration; see § Validation gate above).
2. **Structural-coherence checks pass** (three commands listed in § Validation gate above).
3. **drop() audit conclusion documented** in the PR description (expected text: "audited per project spec FR7; no caller relied on the v6 throw — research artefact at `projects/mongo-driver-version-support/research/open-questions.md` § Q2 — and the migration-runner's idempotency check at `mongo-runner.ts:121-128` already short-circuits drops on missing collections, so no code change is required").
4. **Migration-note section in the PR description** names the `new ObjectId(numericTimestamp)` removal and points users at `ObjectId.createFromTime()` as the replacement.
5. **Intent-validation** (orchestrator-side, post-flight): diff is bounded by the files-in-play list; no scope creep into BSON shape changes, multi-major scaffolding, or unrelated cleanups.

#### Edge cases (from spec § Open Questions; all resolved 2026-05-26)

- **Q1 — BSON v7 `ObjectId(number)` removal.** Disposition: document in migration note (FR8 / PDoD12). Verification: `rg "new ObjectId\(\s*\d" packages/ examples/ test/` should return zero hits. If a hit surfaces unexpectedly, **halt and route to design discussion** per invariant I12 (load-bearing assumption A1 falsified).
- **Q2 — `collection.drop()` no-throw.** Disposition: audit + document. Expected outcome: no code change. Path: read `command-executor.ts:57-59` and the call chain through `mongo-runner.ts:121-128`; confirm the idempotency check covers the path. If a caller chain unexpectedly relies on the throw, add an explicit guard at `command-executor.ts:57-59` and document.
- **Q3 — cursor `batchSize` default removal.** Disposition: defer. Take no action. If a perf regression surfaces in `pnpm test:integration`, surface it; otherwise no work.
- **Q4 — `MongoClient.connect()` fail-fast handshake.** Disposition: defer. Take no action. If a test breaks at a `connect()` site, surface it; otherwise no work.

#### Failure modes to avoid

- **Editing `pnpm-lock.yaml` by hand** — forbidden by `.cursor/rules/no-direct-lockfile-edits.mdc`. Always regenerate via `pnpm install`.
- **Pinning the catalog to an exact `^7.0.0` if a newer 7.x exists** — pin to the latest 7.x at land time. Check `pnpm view mongodb dist-tags.latest` before bumping.
- **Touching example apps' `mongodb` declarations** — examples should continue to say `mongodb: catalog:` and inherit the bump automatically. Editing them is scope creep.
- **Adding `mongodb` to `devDependencies`** as a workaround — peer-dep alone is the posture; if a package needs `mongodb` for its own tests, it goes in `devDependencies` *in addition to* `peerDependencies` (this applies to packages that import from `'mongodb'` in test code; verify per package).
- **Branching on driver version** in source — forbidden; we support exactly one major at a time. Any conditional on `mongodb`'s version is a sign the dispatch has drifted.
- **Adding file extensions to TypeScript imports** — forbidden by repo conventions.
- **Bundling unrelated cleanups** — keep the diff bounded by the files-in-play list. Side-quests (e.g. tidying nearby code) are out-of-scope for this PR; surface as a separate ticket.

#### Out of scope (this dispatch / slice / project)

- Multi-major support, peer-range unions (`^7 || ^8`), version-detection branches.
- Wrapping BSON value classes (`Binary`, `Decimal128`, `Long`, `ObjectId`, `Timestamp`) with PN type identities.
- Configuring explicit `batchSize` on cursors (deferred per Q3 disposition).
- Pre-emptive `connect()` fail-fast hardening (deferred per Q4 disposition).
- Authoring a public mongo-major upgrade-policy ADR — deferred to project close-out (PDoD4: only land if a durable policy emerges).

## Risks + open questions

All four spec-level open questions have been research-resolved (see [`../../research/open-questions.md`](../../research/open-questions.md)); risks below are residuals.

- **Lockfile resolution surprise.** Possible: pnpm resolves an unexpected transitive mongodb. Mitigation: structural-coherence check #1 (`rg '^\s*/mongodb@6\.' pnpm-lock.yaml`).
- **Memory-server compatibility surprise.** `mongodb-memory-server@11.1.0` already bundles driver-7 internally per recon, but if `pnpm test:integration` reveals a runtime mismatch, surface it as a stop-condition (load-bearing assumption A2 falsified) and route to design discussion.
- **Q1 escapee.** Per the resolution, zero numeric `ObjectId` calls exist in the source/tests grep. If the implementer's wider grep (including `node_modules/`, build output, etc. — not normally in scope) reveals a hit we missed, halt and discuss.

Plan-level sequencing risk is nil — single dispatch.
