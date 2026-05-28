# Slice plan: Foundation — refs + paired contract snapshots

**Spec:** [`./spec.md`](./spec.md)
**Parent project:** [`projects/dev-to-ship-migration-handoff/`](../../)
**Parent plan position:** Stack 1 (see [project plan](../../plan.md))

## Validation gate (slice-level, inherited by every dispatch)

```bash
pnpm typecheck                                          # always
pnpm test:packages --filter @prisma-next/migration      # package-scoped tests
pnpm lint:deps                                          # new files, package boundaries
pnpm build --filter @prisma-next/migration              # refreshes dist/*.d.mts since new public exports
pnpm fixtures:check                                     # verify no fixture drift (none expected)
```

Per-commit gate (during the dispatch): `pnpm typecheck` and grep gates from § Grep gates below.
End-of-dispatch gate: the full block above.

### Grep gates

Run after every dispatch:

```bash
# No file-extension imports anywhere in new code:
rg "from '[^']+\.(ts|tsx|js|jsx)'" packages/1-framework/3-tooling/migration/src/refs/ packages/1-framework/3-tooling/migration/src/graph-membership.ts 2>/dev/null

# No `any` in new code:
rg ': any\b|\bany\[\]' packages/1-framework/3-tooling/migration/src/refs/snapshot.ts packages/1-framework/3-tooling/migration/src/graph-membership.ts 2>/dev/null

# No @ts-expect-error in non-negative-type-test code:
rg '@ts-expect-error' packages/1-framework/3-tooling/migration/src/refs/snapshot.ts packages/1-framework/3-tooling/migration/src/graph-membership.ts 2>/dev/null

# No @ts-nocheck:
rg '@ts-nocheck' packages/1-framework/3-tooling/migration/src/ 2>/dev/null

# No transient project-artefact references in source (per doc-maintenance rule):
rg 'projects/dev-to-ship-migration-handoff' packages/1-framework/3-tooling/migration/src/ 2>/dev/null
```

Each grep gate expects **zero matches** to pass.

## Dispatch plan

### Dispatch 1: Snapshot file I/O primitives

**Intent.** Add three additive functions — `writeRefSnapshot`, `readRefSnapshot`, `deleteRefSnapshot` — that handle the `<name>.contract.json` + `<name>.contract.d.ts` pair next to existing refs. The functions are isolated file-system primitives; **nothing else changes**. No existing `writeRef`/`deleteRef` callers are touched; no CLI surface is touched; no new convention is enforced yet.

**Files in play.**

- New: `packages/1-framework/3-tooling/migration/src/refs/snapshot.ts` — primitives (~150 LoC).
- New: `packages/1-framework/3-tooling/migration/test/refs/snapshot.test.ts` — round-trip + malformed-input + slashed-name tests (~200 LoC).
- Likely touched: the package's export barrel (whichever `index.ts` or `src/exports/` surface the package uses; identify at dispatch start).
- Reference: existing emitter pattern for `<bundle>/end-contract.d.ts` — implementer must locate this at dispatch start; the new `.d.ts` follows the same shape so consumers see one consistent typed-handle convention.

**"Done when":**

- [ ] `pnpm typecheck` clean.
- [ ] `pnpm test:packages --filter @prisma-next/migration` clean, including new `snapshot.test.ts`.
- [ ] `pnpm lint:deps` clean.
- [ ] `pnpm build --filter @prisma-next/migration` clean; new exports surface in `dist/*.d.mts`.
- [ ] Tests cover: write→read round-trip; `readRefSnapshot` returns `null` when no snapshot file exists; malformed `<name>.contract.json` throws via `errorInvalidRefFile`-shaped diagnostic; slashed ref names (`refs/staging/v1`) handled correctly.
- [ ] Intent-validation: diff matches above intent. **Nothing under `src/refs.ts` is modified.** **No existing test files are modified.** **No CLI files touched.**
- [ ] Grep gates from § Grep gates above pass with zero matches.

**Edge cases (this dispatch's portion):**

| Edge case | Disposition |
|---|---|
| Snapshot file already exists; `writeRefSnapshot` called again with same contract | Handle (idempotent rewrite). |
| Snapshot file already exists; `writeRefSnapshot` called with different contract | Handle (overwrite atomically). |
| Ref pointer with no paired snapshot | Handle (`readRefSnapshot` returns `null`). |
| `readRefSnapshot` on malformed `.contract.json` | Handle (throws via existing IR-schema validation). |
| Slashed ref name | Handle (mirror existing `writeRef` hierarchical layout). |

**Failure modes to avoid (from `drive/calibration/failure-modes.md`):**

- **F3 (discovery via test suite instead of grep)** — before writing primitives, run `rg 'end-contract\.d\.ts' packages/` to find the existing `.d.ts` emission pattern; don't guess the shape.
- **F5 (destructive git operations)** — destructive git operations forbidden without orchestrator approval.

**Out of scope (this dispatch):**

- Paired wrappers (`writeRefPaired` / `deleteRefPaired`) — Dispatch 2.
- Failure-injection tests for partial-write rollback — Dispatch 2.
- Graph-membership helpers — Dispatch 3.
- Any modification to existing `writeRef` / `deleteRef` callers.

**Size.** M. Single new source file + single new test file; ~350 LoC total; existing emitter pattern needs locating (one grep + read).

**Tier.** `composer-2.5-fast` (mechanical-shaped — one new file + one new test file following existing patterns; not judgment-heavy).

**DoR confirmed:** [✓]

---

### Dispatch 2: Paired wrappers + atomic failure handling

**Intent.** Build atomic pair-write / cascade-delete wrappers on top of Dispatch 1's primitives: `writeRefPaired(refsDir, name, entry, contract)` and `deleteRefPaired(refsDir, name)`. The wrappers ensure on-disk state never advertises a ref without its snapshot or vice versa, with rollback on partial-write failure. Tests use fs failure injection.

**Files in play.**

- Modified: `packages/1-framework/3-tooling/migration/src/refs/snapshot.ts` — add `writeRefPaired` + `deleteRefPaired` (~100 LoC added).
- Modified: `packages/1-framework/3-tooling/migration/test/refs/snapshot.test.ts` — add ~6 failure-injection tests (~200 LoC added).
- Likely touched: the package's export barrel (if not already updated in Dispatch 1).

**"Done when":**

- [ ] Full validation gate from § Validation gate passes.
- [ ] Tests cover: snapshot write fails before pointer → no pointer written, no orphan snapshot files; pointer write fails after snapshot → snapshot rolled back; `deleteRefPaired` idempotent (re-runnable on partial state); `deleteRefPaired` throws on truly-missing ref (preserves existing `deleteRef` semantics); concurrent writes acknowledged out-of-scope (no test, but documented).
- [ ] Intent-validation: diff matches above intent. **No production code outside `src/refs/snapshot.ts` is modified.** Existing tests still pass unmodified.
- [ ] Grep gates from § Grep gates pass.
- [ ] WIP inspection at ~30 min wall-clock — confirm failure-injection harness compiles and at least one failure test passes; if not, course-correct on harness shape before continuing.

**Edge cases (this dispatch's portion):**

| Edge case | Disposition |
|---|---|
| `writeRefSnapshot` fails mid-write | Handle (no `.contract.json` / `.contract.d.ts` left; pointer not written). |
| `writeRef` fails after snapshot wrote | Handle (rollback via `deleteRefSnapshot`). |
| `.contract.d.ts` writes but `.contract.json` fails (or vice versa) — intra-pair partial write at the snapshot boundary | **Already covered by Dispatch 1's `snapshot-failure.test.ts`** (the implementer delivered these tests in Dispatch 1; verify still passing in Dispatch 2 but don't duplicate). |
| `readRefSnapshot` when `.contract.json` exists but `.contract.d.ts` is missing | **Handle (added in Dispatch 2 per orchestrator fold-in from R1 review).** `readRefSnapshot` throws `errorInvalidRefFile` (already implemented at `snapshot.ts` L126–134; add the missing test assertion in `snapshot.test.ts`). |
| `deleteRefPaired` on a ref with no paired snapshot | Handle (idempotent; tolerates ENOENT on snapshot). |
| `deleteRefPaired` — pointer missing, json-orphan present | **Handle (R2 fold-in).** Self-healing: presence probe sees json; delete orphan, return success. |
| `deleteRefPaired` — pointer missing, dts-only orphan present | **Handle (R3 fold-in from Dispatch 2 R2 review).** Self-healing: presence probe must check BOTH `.contract.json` AND `.contract.d.ts`; delete the dts orphan, return success. Closes a gap where the json-only probe false-negatived on dts-only orphan states (which could arise from a failed cascade inside `deleteRefSnapshot` where json unlink succeeded but dts unlink failed). |
| `deleteRefPaired` — pointer missing, no snapshot files at all (genuine non-existent ref) | Handle (throws `MIGRATION.UNKNOWN_REF`). |
| Disk full (`ENOSPC`) mid-write | Handle (rollback path same as other write failures). |
| Concurrent `writeRefPaired` on same ref | Explicitly out (no file locking; tested-as-undefined). |

**Failure modes to avoid:**

- **F3 (discovery via test suite)** — locate the test harness's fs mocking convention before writing failure-injection tests; `rg 'vi\.mock.*fs|vi\.mock.*node:fs' packages/1-framework/3-tooling/migration/test/` to find prior art.
- **F4 (no inspection cadence)** — explicit mid-dispatch WIP inspection at ~30 min wallclock (see "Done when").
- **F5** — destructive git operations forbidden without orchestrator approval.

**Out of scope (this dispatch):**

- Wiring `writeRefPaired` into existing callers (`db init`, `db update`, `ref set`, `ref delete`, `migrate`) — Slices 2–5 of project plan.
- Graph-membership helpers — Dispatch 3.

**Size.** M. Atomic-wrapper logic + failure-injection test scaffolding; the failure-injection harness is the load-bearing piece.

**Tier.** `composer-2.5-fast` (mechanical; the harness pattern is already established in the test suite).

**DoR confirmed:** [✓]

---

### Dispatch 3: Graph-membership primitives

**Intent.** Add `isGraphNode(hash, graph)` predicate and `assertHashIsGraphNode(hash, graph)` assertion to give Slices 2–5 a single stable export for the universal "from must be a graph node" invariant. New error code `MIGRATION.HASH_NOT_IN_GRAPH`.

**Files in play.**

- New: `packages/1-framework/3-tooling/migration/src/graph-membership.ts` — predicate + assertion (~50 LoC).
- New: `packages/1-framework/3-tooling/migration/test/graph-membership.test.ts` — predicate + assertion + diagnostic-shape tests (~80 LoC).
- Modified: `packages/1-framework/3-tooling/migration/src/errors.ts` — add `MIGRATION.HASH_NOT_IN_GRAPH` error code factory (~15 LoC).
- Likely touched: package export barrel.

**"Done when":**

- [ ] Full validation gate passes.
- [ ] Tests cover: `isGraphNode(EMPTY_CONTRACT_HASH, graph)` is `true` on both empty and non-empty graphs; `isGraphNode(<unknown-hash>, <empty-graph>)` is `false`; `assertHashIsGraphNode` throws `MIGRATION.HASH_NOT_IN_GRAPH` with diagnostic naming the `reachableHashes` list (sorted) and `fix` text suggesting `migration plan` or graph-node-only `--from` values.
- [ ] Intent-validation: diff matches intent. **No changes outside the three files-in-play.** Existing `migration-graph.ts` not modified (the predicate operates on the existing `MigrationGraph.nodes` set, no schema change).
- [ ] Grep gates pass.

**Edge cases (this dispatch's portion):**

| Edge case | Disposition |
|---|---|
| `EMPTY_CONTRACT_HASH` on any graph | Handle (always a node per `reconstructGraph`). |
| Malformed (non-`sha256:...`) input string | Handle (throws; diagnostic doesn't try to interpret malformed input — `validateRefValue` is the caller's job). |
| Empty graph (zero migration bundles) | Handle (`graph.nodes` contains `EMPTY_CONTRACT_HASH`; non-empty `graph.nodes`). |

**Failure modes to avoid:**

- **F3** — `rg 'EMPTY_CONTRACT_HASH' packages/1-framework/3-tooling/migration/src` to confirm the sentinel's role before assuming the empty-graph behaviour. Also `rg 'graph\.nodes' packages/1-framework/3-tooling/migration/src` to confirm the public-API shape.
- **F5** — destructive git operations forbidden.

**Out of scope (this dispatch):**

- Wiring `assertHashIsGraphNode` into `migration plan --from`, `migrate --to`, `ref set` — Slices 2–5.
- Re-exporting via a `from-graph-node` typed brand or similar — keep the predicate + assertion shape; Slices 2–5 can choose to use the assertion's narrowing.

**Size.** S. Trivial wrapper + one new error code + tests.

**Tier.** `composer-2.5-fast` (S, mechanical).

**DoR confirmed:** [✓]

---

## Dispatch sequence

```
Dispatch 1 (M, snapshot I/O)
       ↓
Dispatch 2 (M, paired wrappers + failure injection)
       ↓ (parallel-safe with Dispatch 3, but we sequence for simpler WIP inspection)
Dispatch 3 (S, graph-membership)
```

Total: 2× M + 1× S, all under the M-cap.

## Slice-DoD coverage map

| Slice-DoD | Delivered by |
|---|---|
| **SDoD1.** Validation gates pass | All three dispatches; final gate at slice close |
| **SDoD2.** Edge cases handled per disposition | Each dispatch's "Done when" enumerates its slice-spec edge cases |
| **SDoD3.** Reviewer SATISFIED on `code-review.md` | Per drive-build-workflow loop after Dispatch 3 |
| **SDoD4.** Manual-QA N/A (library primitives) | Recorded explicitly; no QA script authored |
| **SDoD5.** No out-of-scope surfaces touched | Each dispatch's "Out of scope" + intent-validation |
| **SDoD6.** Existing tests pass unmodified | Validation gate + Dispatches 1–3's "Out of scope" lists |
| **SDoD7.** No public-export drift | `pnpm lint:deps` clean; new exports surfaced cleanly via barrel |

## Open items

None at slice-plan time. The four open questions in [`./spec.md § Open Questions`](./spec.md) are dispatch-time decisions:

- OQ1 (`.contract.d.ts` shape) — Dispatch 1 settles.
- OQ2 (self-consistency check) — defer to slice DoD; reviewer to push back if they want one.
- OQ3 (error code naming) — Dispatch 3 settles.
- OQ4 (module paths) — Dispatch 1 settles `snapshot.ts` location; Dispatch 3 settles `graph-membership.ts` location.
