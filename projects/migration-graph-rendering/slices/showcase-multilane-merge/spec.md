# Slice: Extend the `showcase` fixture to demo the multi-lane-merge edge case

## Problem

The multi-lane-merge landing (a branch contract node with a **second forward
child**, so two lanes converge on it in a non-trunk lane) and the connector
**pass-through crossing** it induces are real renderer edge cases that were
previously unrepresented in any committed fixture. They were only found because a
migration was planned ad-hoc into the `showcase` fixture. We want `showcase` to
permanently exercise this shape so the renderer behaviour is demoable and any
future regression shows up immediately.

The ad-hoc `migration plan` left the worktree in a messy state that must be
cleaned into a proper, convention-conforming fixture addition.

## Current (untracked / modified) state to reconcile

- **Modified** `examples/prisma-next-demo/prisma-next.config.ts` — temporarily
  repointed `migrations.dir` at `./fixtures/showcase/migrations`. REVERT to its
  committed state (`git checkout -- examples/prisma-next-demo/prisma-next.config.ts`).
- **Untracked** `examples/prisma-next-demo/fixtures/showcase/migrations/app/20260602T1233_migration/`
  — the new edge `935a023 → f660984`. Contains the correct artifacts PLUS spurious
  `start-contract.json` / `start-contract.d.ts` that are NOT part of the fixture
  convention.
- **Untracked** `examples/prisma-next-demo/fixtures/showcase/migrations/pgvector/`
  — a spurious extension-space package emitted because the *main* config lists
  `extensions: [pgvector]`. The `showcase` config has no extensions; DELETE this dir
  entirely.

## Fixture artifact convention (match the siblings EXACTLY)

Every existing app node (e.g. `20260601T0726_merge_bob`) contains exactly:
`migration.json`, `ops.json`, `end-contract.json`, `end-contract.d.ts`,
`migration.ts` — and NOTHING else (no `start-contract.*`).

## Design of record

Turn the ad-hoc plan output into a committed, convention-conforming node on the
`showcase` fixture:

1. Revert the main `examples/prisma-next-demo/prisma-next.config.ts` edit.
2. Delete `examples/prisma-next-demo/fixtures/showcase/migrations/pgvector/`.
3. In the new app node, delete `start-contract.json` and `start-contract.d.ts`,
   leaving exactly the 5-file convention set.
4. Rename the node dir from `20260602T1233_migration` to a chronological,
   descriptive name consistent with siblings — suggested
   `20260601T0728_promote_bob` (it carries `935a023` = bob's branch contract up to
   `f660984` = prod; sits after the `0727_*` nodes and before `0729_reapply_noop`).
   Dir name is cosmetic (node identity is content-hash based), so renaming is safe.
   Update `createdAt` in `migration.json` to match the new timestamp ONLY IF that
   does not change `migrationHash` / break `migration check`; if it would, leave
   `createdAt` as-is (the dir name is what matters for the demo).
5. Update the `showcase` config header comment
   (`examples/prisma-next-demo/fixtures/showcase/prisma-next.config.ts`) to mention
   the new scenario: a branch node with a second forward child producing a
   multi-lane merge landing on a non-trunk lane (and the connector crossing it
   creates).

The edge to add: `935a023 → f660984`. `f660984` is the existing `prod` ref; this
gives `935a023` (currently only producing `merge_bob → 83a1ded`) a SECOND forward
child, and gives `f660984` a second producer (alongside `hotfix`).

## Scope

**In:**
- `examples/prisma-next-demo/prisma-next.config.ts` — revert to committed state.
- `examples/prisma-next-demo/fixtures/showcase/migrations/app/20260601T0728_promote_bob/`
  (renamed from `20260602T1233_migration`) — slim to the 5-file convention.
- Delete `examples/prisma-next-demo/fixtures/showcase/migrations/pgvector/`.
- `examples/prisma-next-demo/fixtures/showcase/prisma-next.config.ts` — header comment.

**Out:**
- Any CLI source/test (the renderer fixes are separate slices —
  `node-merge-landing-marker`, `connector-crossing-glyph`).
- Other fixtures; the main demo's real migrations under `src/`.
- Do not regenerate the rest of the showcase fixture; only add this one node.

## Done when

- `git status` shows only the intended fixture changes: the reverted main config,
  the new committed app node, the showcase config comment — no `pgvector/`, no
  `start-contract.*`, no stray files.
- From `examples/prisma-next-demo`:
  `prisma-next migration check --config ./fixtures/showcase/prisma-next.config.ts`
  passes (every `end-contract.json` storageHash matches its `migration.json` `to`,
  and the new node's `from`/`to` chain is consistent).
- `prisma-next migration graph --tree --config ./fixtures/showcase/prisma-next.config.ts`
  renders 11 nodes / 17 edges including the new `935a023 → f660984` edge, with the
  multi-lane merge landing on `935a023` showing its `○` marker (verifies the
  `node-merge-landing-marker` fix) and the `83a1ded` convergence fan showing a
  crossing where the new lane passes through (verifies `connector-crossing-glyph`,
  once that lands).
- The new node matches the sibling 5-file convention exactly.

## Notes

- This depends on (and demonstrates) the two renderer fixes. If
  `connector-crossing-glyph` has not yet landed on the branch when you run the
  graph, the crossing will still render as a tee — that is expected and not this
  slice's concern; just confirm `migration check` passes and the edge/topology is
  correct.
- Branch off `tml-2773-migration-graph-lane-colors-legend`. Commit `-s` (sign-off);
  do not push. Stage ONLY the intended fixture paths by explicit path. Never run
  `git add -A`, `git stash`, `git restore .`, `git checkout -- .` (except the
  single intended `git checkout -- prisma-next.config.ts` revert), or `git clean`.
- The CLI may need the package built to run (`prisma-next`); use the same
  invocation the repo uses (`pnpm exec prisma-next …` / `pnpm prisma-next …`).
