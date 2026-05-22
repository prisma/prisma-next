# Slice: `ref set` / `ref delete` — snapshot integration

_Parent project: [`projects/dev-to-ship-migration-handoff/`](../../). This slice satisfies **FR4** and **FR9 (enforcement on `ref set`)** from [the project spec](../../spec.md). It is the **Parallel A** branch from [`../../plan.md`](../../plan.md) — independent of Stacks 2–4 and ships any time after the foundation slice._

## At a glance

After this slice ships, the user-driven `ref set <name> <contract>` and `ref delete <name>` commands write/delete refs **with their paired contract snapshots**, using the Slice 1 primitives `writeRefPaired` and `deleteRefPaired`. `ref set` also enforces the universal "from must be a graph node" invariant: the resolved hash must be a node in the on-disk migration graph, or the command refuses cleanly. `ref list` is unchanged behaviourally; it gets a regression test that paired `*.contract.json` files don't appear as phantom refs (already validated structurally by Slice 3 D3's `readRefs` filter fix, but pinned here at the command boundary).

Three observable changes:

1. **`ref set <name> <contract>` graph-node enforcement.** The resolved hash must be a node in the app migration graph. If not, refuse with a structured `MIGRATION.HASH_NOT_IN_GRAPH` diagnostic naming both the supplied hash and the graph's reachable hashes (mirrors Slice 3's planner-side refuse wording).
2. **`ref set <name> <contract>` paired snapshot synthesis.** On accept, locate the migration bundle whose `metadata.to === resolvedHash`, read its `end-contract.{json,d.ts}`, and write the paired snapshot atomically via `writeRefPaired`. The atomic-write rollback semantics from Slice 1's foundation apply.
3. **`ref delete <name>` cascade delete.** Switch from `deleteRef` to `deleteRefPaired`. The paired `*.contract.json` and `*.contract.d.ts` files are removed alongside the pointer file. Slice 1's orphan-tolerant `deleteRefPaired` handles partial states (pointer missing + snapshot present) cleanly.

## Scope

### In scope

- **`packages/1-framework/3-tooling/cli/src/commands/ref.ts`** — three changes:
  - `executeRefSetCommand`:
    - After `parseContractRef` resolves the input → hash, run a graph-node membership check. Use `isGraphNode(resolvedHash, graph)` from `@prisma-next/migration-tools/migration-graph`. If `false`, refuse with `errorRefSetHashNotInGraph(resolvedHash, reachableHashes, graphTipHash?)` — a new CLI factory mirroring the Slice 3 plan-time refuse shape.
    - **Special-case the `EMPTY_CONTRACT_HASH` sentinel**: per Slice 1's `isGraphNode` short-circuit, the empty hash is technically a "graph node" (the `null` sentinel). For `ref set`, accept-or-refuse decision: **refuse** with a clear "the empty-database sentinel isn't a valid ref target" error. No user workflow needs `ref set <name> EMPTY_CONTRACT_HASH`. (Final disposition at dispatch time per spec § Open Questions.)
    - On accept, locate the bundle whose `metadata.to === resolvedHash` (i.e., the bundle that produces that contract as its destination). Read its `end-contract.{json,d.ts}` via the existing helper `readContractIR` from `cli/src/utils/ref-advancement.ts` (Slice 2 D2).
    - Call `writeRefPaired(refsDir, name, entry, contractIR)` instead of `writeRef(refsDir, name, entry)`.
    - Preserve the existing `RefSetResult` envelope (`ok`, `ref`, `hash`, `invariants`). The paired-snapshot write doesn't surface in the result envelope; it's an implementation detail of the convention.
  - `executeRefDeleteCommand`:
    - Switch from `deleteRef(refsDir, name)` to `deleteRefPaired(refsDir, name)`.
    - Preserve the existing `RefDeleteResult` envelope.
  - `executeRefListCommand`: no source change. Regression test added (see below) to pin that paired `*.contract.json` files don't surface as phantom refs.
- **Tests**:
  - Unit tests for `executeRefSetCommand`:
    - Accept: hash is a graph node + snapshot is written (read both `<name>.json` + `<name>.contract.json` + `<name>.contract.d.ts` after the call).
    - Refuse: hash is not a graph node (free-floating hash) → `MIGRATION.HASH_NOT_IN_GRAPH`.
    - Refuse: `EMPTY_CONTRACT_HASH` sentinel → clean refusal (whatever code is settled at dispatch time).
    - Accept via ref-name resolution: `ref set staging production` (where `production` is another ref pointing to a graph-node hash) → snapshot synthesized from the matching bundle.
    - Atomic-write rollback: simulate `writeRefPaired` failure → both files absent (already tested at the primitive layer in Slice 1, but pin at the command boundary for cascade-confidence).
  - Unit tests for `executeRefDeleteCommand`:
    - Delete: both pointer + snapshot files removed.
    - Orphan tolerance: pre-existing snapshot without pointer → delete succeeds (orphan healed). Pre-existing pointer without snapshot → delete succeeds (no-op on snapshot side). (Already tested at the primitive layer in Slice 1; pin at the command boundary.)
  - Regression test for `executeRefListCommand`:
    - Set up refsDir with `db.json`, `db.contract.json`, `db.contract.d.ts`, `staging.json`, `staging.contract.json`, `staging.contract.d.ts` — `ref list` returns exactly `{ db, staging }`. No phantom entries.
  - Integration test (e2e):
    - End-to-end `ref set` then `ref list` then `ref delete` flow against a real fixture with a non-trivial migration graph. Asserts the on-disk file layout after each step.

### Out of scope (this slice)

- **`ref set` accepting paths or relative file references.** Existing behaviour via `parseContractRef`'s `./path` support is preserved; if `parseContractRef` already resolves paths to hashes, the new graph-node check still applies to the resolved hash. No new path-resolution behaviour.
- **`ref invariants` add/remove/list subcommands.** Out of this project entirely.
- **Skill/doc updates for the new behaviour.** Stack 5.
- **`ref show <name>` subcommand surfacing the snapshot's contract.** Future work; not part of this project.
- **Performance optimizations for the bundle lookup.** A linear `find` over `appPackages.bundles` is fine; the bundle list is small and bounded by user authoring rate.
- **Removing the legacy `writeRef`/`deleteRef` exports.** Slice 1 kept them for backwards compat; this slice does NOT remove them. Stack 5's ADR can recommend removal as future work.

## Approach

### `ref set` (Dispatch 1)

```typescript
// Illustrative — final shape at dispatch time.
export async function executeRefSetCommand(
  name: string,
  contractInput: string,
  options: { config?: string },
): Promise<Result<RefSetResult, CliStructuredError>> {
  if (!validateRefName(name)) {
    return notOk(cliErrorInvalidRefName(name));
  }

  try {
    const config = await loadConfig(options.config);
    const { appMigrationsDir, refsDir } = resolveMigrationPaths(options.config, config);
    const { graph, bundles } = await loadMigrationPackages(appMigrationsDir);
    const refs = await readRefs(refsDir);

    let resolvedHash: string;
    if (validateRefValue(contractInput)) {
      resolvedHash = contractInput;
    } else {
      const refResult = parseContractRef(contractInput, { graph, refs });
      if (!refResult.ok) {
        return notOk(mapRefResolutionError(refResult.failure));
      }
      resolvedHash = refResult.value.hash;
    }

    // Universal invariant: from must be a graph node.
    if (resolvedHash === EMPTY_CONTRACT_HASH) {
      return notOk(errorRefSetEmptySentinel(resolvedHash));
    }
    if (!isGraphNode(resolvedHash, graph)) {
      const graphTip = findLatestMigration(graph)?.to ?? null;
      return notOk(errorRefSetHashNotInGraph(resolvedHash, [...graph.nodes].sort(), graphTip));
    }

    // Locate bundle whose end matches the hash, read its end-contract.
    const matchingBundle = bundles.find((b) => b.metadata.to === resolvedHash);
    if (!matchingBundle) {
      // Defence-in-depth: isGraphNode passed but bundle lookup failed.
      // Should be unreachable; throw rather than refuse silently.
      throw new Error(
        `ref set: graph-node hash ${resolvedHash} has no matching bundle by metadata.to`,
      );
    }
    const contractJsonPath = path.join(matchingBundle.dir, 'end-contract.json');
    const contractIR = await readContractIR(contractJsonPath);

    const entry: RefEntry = { hash: resolvedHash, invariants: [] };
    await writeRefPaired(refsDir, name, entry, contractIR);

    return ok({ ok: true as const, ref: name, hash: resolvedHash, invariants: [] });
  } catch (error) {
    if (error instanceof CliStructuredError) return notOk(error);
    return notOk(mapError(error));
  }
}
```

### `ref delete` (Dispatch 1)

```typescript
// Illustrative — final shape at dispatch time.
export async function executeRefDeleteCommand(
  name: string,
  options: { config?: string },
): Promise<Result<RefDeleteResult, CliStructuredError>> {
  try {
    const config = await loadConfig(options.config);
    const { refsDir } = resolveMigrationPaths(options.config, config);
    await deleteRefPaired(refsDir, name);
    return ok({ ok: true as const, ref: name, deleted: true as const });
  } catch (error) {
    if (error instanceof CliStructuredError) return notOk(error);
    return notOk(mapError(error));
  }
}
```

### Reused primitives

- `writeRefPaired` from `@prisma-next/migration-tools/refs` (Slice 1).
- `deleteRefPaired` from `@prisma-next/migration-tools/refs` (Slice 1).
- `isGraphNode` from `@prisma-next/migration-tools/migration-graph` (Slice 1).
- `readContractIR` from `cli/src/utils/ref-advancement.ts` (Slice 2 D2).
- `findLatestMigration` from `@prisma-next/migration-tools/...` (existing) for the graph-tip hint in the refuse diagnostic.
- New CLI factories in `cli/src/utils/cli-errors.ts`: `errorRefSetHashNotInGraph` (mirrors Slice 3's `errorPlanForgotTheFlag`) and `errorRefSetEmptySentinel`. May be able to reuse Slice 3's existing `errorPlanForgotTheFlag` if its name + meta-code generalize cleanly; decide at dispatch time.

## Edge cases (Example-Mapping)

| Edge case | Disposition | Notes |
|---|---|---|
| `ref set staging <hash>` where hash IS a graph node | **Accept** | Paired snapshot synthesized from matching bundle. Test covers. |
| `ref set staging <hash>` where hash is NOT a graph node, graph non-empty | **Refuse** | `MIGRATION.HASH_NOT_IN_GRAPH`; diagnostic enumerates reachable hashes + graph tip. Test covers. |
| `ref set staging <hash>` where hash is NOT a graph node, graph EMPTY | **Refuse** | Same refuse; reachable list is empty; diagnostic reads "graph is empty — no hashes reachable. Run `migration plan` first." Test covers. |
| `ref set staging EMPTY_CONTRACT_HASH` | **Refuse** | Clean "empty-DB sentinel isn't a valid ref target" diagnostic. Final code at dispatch time. Test covers. |
| `ref set staging production` (input is another ref name) | **Accept** | `parseContractRef` resolves `production`'s hash; standard graph-node check applies on the resolved hash. Test covers. |
| `ref set staging <bundle-dir>` | **Accept** | `parseContractRef` resolves the `migration-to` provenance; the resolved hash IS a graph node by definition. Test covers. |
| `ref set staging <bundle-dir>^` | **Accept** | `parseContractRef` resolves the `migration-from` provenance; the resolved hash IS a graph node (it's a bundle's `from` hash, which is by definition a graph node — see Slice 1's `isGraphNode` definition). Test covers. |
| `ref set staging <prefix>` (short hash prefix) | **Accept (or refuse if ambiguous)** | Standard `parseContractRef` prefix-resolution behaviour preserved. Graph-node check on resolved hash. Test covers (regression). |
| `ref set staging ./path/to/contract.json` (path resolution) | **Accept if resolved hash IS a graph node** | If `parseContractRef` supports path resolution today (verify at dispatch time), the resolved hash must still pass the graph-node check. If a user wants to set a ref to a free-floating contract, the answer is "no, not from `ref set`." Test covers. |
| `ref set <invalid-name>` (slash, dots, spaces) | **Refuse** | Existing `validateRefName` check unchanged. Test covers (regression). |
| `ref set staging <hash>` overwriting an existing ref | **Accept** | `writeRefPaired` overwrites both pointer + snapshot atomically. Idempotent. Test covers. |
| `ref set staging <hash>` where the matching bundle's `end-contract.json` is missing | **Refuse / throw** | This is a corrupt-on-disk state. Map to `errorFileNotFound` with a `fix` suggesting `pnpm fixtures:check` or re-emitting. Test covers. |
| `ref set staging <hash>` where `writeRefPaired` fails mid-write | **Refuse + atomic rollback** | Per Slice 1's `writeRefPaired` semantics — partial state is cleaned up; original `writeRef` error preserved. Test covers (or accept Slice 1's existing unit-test coverage). |
| `ref delete db` (the special `db` ref) | **Accept** | Cascade delete; no special-case behaviour vs other refs. Test covers. |
| `ref delete <name>` where pointer + snapshot both exist | **Accept (clean delete)** | Test covers. |
| `ref delete <name>` where pointer exists, snapshot absent | **Accept (no-op on snapshot side)** | Per Slice 1's tolerant `deleteRefPaired`. Test covers. |
| `ref delete <name>` where snapshot exists (orphan), pointer absent | **Accept (orphan healed)** | Per Slice 1's tolerant `deleteRefPaired`. Test covers. |
| `ref delete <name>` where neither exists | **Refuse OR no-op** | Existing `deleteRef` behaviour: refuses with `MIGRATION.REF_NOT_FOUND`. Slice 1's `deleteRefPaired` preserves this. Test covers (regression). |
| `ref delete <invalid-name>` | **Refuse** | Existing `validateRefName` check unchanged. Test covers (regression). |
| `ref list` with refsDir containing paired `*.contract.json` files | **Lists only pointer refs** | Regression on Slice 3 D3's `readRefs` filter. Test covers. |
| `ref list --json` | **Same content, JSON-formatted** | No change. Test covers (regression). |
| `ref set` then `ref list` then `ref delete` round-trip | **All steady states match** | End-to-end integration test. |
| `ref set` with `--config <path>` pointing to a non-default config | **Honoured** | Existing behaviour unchanged. Test covers (regression). |

## Slice Definition of Done

- [ ] **SDoD1.** Validation gates: `pnpm typecheck`, `pnpm vitest run` direct in `@prisma-next/cli`, `pnpm vitest run` direct in `test/integration/`, `pnpm lint:deps`, `pnpm build`, `pnpm fixtures:check`.
- [ ] **SDoD2.** Every edge case row from § Edge cases handled per disposition.
- [ ] **SDoD3.** Reviewer SATISFIED on `projects/dev-to-ship-migration-handoff/reviews/code-review.md`.
- [ ] **SDoD4.** Manual-QA — light (the user-facing surface is small). Either extend an existing slice's `manual-qa.md` with a `ref set` / `ref delete` scenario, or skip if the e2e coverage is sufficient. Final decision at slice close.
- [ ] **SDoD5.** No edits outside `ref.ts`, `cli-errors.ts` (for new factories), `ref.test.ts`, and the new e2e file.
- [ ] **SDoD6.** Existing `ref.ts` tests still pass — `writeRef`/`deleteRef` legacy paths are no longer called, so any test asserting "the file written" should still pass (the pointer file format is unchanged; what's new is the pairing).
- [ ] **SDoD7.** `pnpm lint:deps` clean. No new public exports outside `@prisma-next/cli`.

## Open Questions

1. **`EMPTY_CONTRACT_HASH` ref-set disposition.** Refuse (working position) vs. accept-with-no-snapshot vs. accept-with-synthetic-snapshot. Refuse keeps the convention clean ("every ref has a contract"); the empty sentinel is a planner internal, not a user-facing concept. Settle at dispatch time.
2. **Error factory reuse between Slice 3 and Parallel A.** `errorPlanForgotTheFlag` and `errorRefSetHashNotInGraph` have similar shapes (hash + reachable list + graph tip). Settle whether they share a factory or stay separate.
3. **`ref set --no-snapshot` opt-out flag.** Not in scope, but if there's a user-facing reason to set a ref to a graph-node hash WITHOUT writing the snapshot (e.g., during repo cleanup), that's an open question for future work. Default: no opt-out; the snapshot is the convention.
4. **Sizing: 1 or 2 dispatches?** Working position: **1 dispatch** (the surface is small; `ref set` is the meatier piece but `ref delete` is one-line). If the implementer's reconnaissance shows more complexity than expected (e.g., bundle-lookup edge cases, test fixture churn), the plan permits a follow-up dispatch.

## References

- Parent project: [`projects/dev-to-ship-migration-handoff/spec.md`](../../spec.md) §§ FR4, FR9 (`ref set` enforcement)
- Project plan: [`projects/dev-to-ship-migration-handoff/plan.md`](../../plan.md) § Parallel group A
- Foundation slice: [`../foundation-refs-paired-snapshots/spec.md`](../foundation-refs-paired-snapshots/spec.md) — consumes `writeRefPaired`, `deleteRefPaired`, `isGraphNode`
- Slice 3 (refuse-path source): [`../plan-ref-aware-and-auto-baseline/spec.md`](../plan-ref-aware-and-auto-baseline/spec.md) — `errorPlanForgotTheFlag` factory
- Existing `ref` command: [`packages/1-framework/3-tooling/cli/src/commands/ref.ts`](../../../../packages/1-framework/3-tooling/cli/src/commands/ref.ts)
- Linear issue: _not created (operator declined Linear sync)_
