# Slice: Audit & consolidate the demo migration fixtures

## Problem

`examples/prisma-next-demo/migration-fixtures/` holds 17 fixtures. They are
manual QA scenarios for the `migration graph` renderer (no test wires them).
Two issues:

1. **15 of them are topology-only** (`migration.json` + `ops.json`, synthetic
   hashes, no `end-contract.*`), so they are **unrenderable** — pointing the CLI
   at them throws "missing destination contract snapshot" (the state `diamond`
   was in before it was regenerated). Only `showcase` and `diamond` are complete.
2. **Heavy scenario overlap.** Now that the renderer + the comprehensive
   `showcase` fixture exist, most single-shape fixtures are redundant: trivial
   ones are strict subsets of larger ones (`linear ⊂ long-spine`,
   `single-branch ⊂ multi-branch`, `rollback ⊂ skip-rollback`), and the
   "combination" fixtures (`complex`, `kitchen-sink`, `diamond-sub-branch`,
   `multi-rollback-branch`, `sequential-diamonds`) are subsumed by `showcase`.

## Decision

Keep a minimal set where each fixture isolates **one** distinct renderer
challenge, and make every kept fixture **renderable** (regenerated offline like
`diamond`). Delete the redundant ones.

### Keep — already complete, leave as-is
- `showcase` — the all-in-one (only fixture with forward cross-link, self-edge, disjoint cycle).
- `diamond` — clean diamond divergence/convergence (regenerated in the prior commit).

### Keep — regenerate to be renderable (offline `migration plan`, no DB; full showcase-style artifacts + per-fixture `prisma-next.<name>.config.ts`)
- `wide-fan` — one node → 5 children (fan-out width).
- `converging-branches` — 3 branches fan **in** to one node (N-way convergence).
- `skip-rollback` — node-**skipping** rollbacks ⇒ crossing back-arcs.
- `long-spine` — long vertical spine + late branch (height).
- `multi-branch` — 3-way fork + parallel edges (same `from`→`to`). **Caveat below.**

### Delete (10)
`linear`, `single-branch`, `sub-branches`, `rollback`, `rollback-continue`,
`multi-rollback-branch`, `diamond-sub-branch`, `complex`, `kitchen-sink`,
`sequential-diamonds`.

## Target topologies for the regenerated survivors

Reproduce these **shapes** (node dir names + the `from→to` edge structure +
refs). Hashes will be freshly generated and differ from the old synthetic ones —
expected. Use a simple accreting schema (one `user` table; each `add_<x>` adds a
nullable column `<x>`; rollbacks remove columns; convergence = the union),
mirroring the `diamond` approach. No extensions.

- **wide-fan**: `init`→C1; then 5 siblings off C1: `add_phone`, `add_posts`,
  `add_avatar`, `add_category`, `add_settings` (each C1 + one column). refs: none.
- **converging-branches**: `init`→C1; 3 siblings off C1 (`add_phone`,
  `add_posts`, `add_avatar`); then `merge_phone`/`merge_posts`/`merge_avatar`
  each → the **same** union contract (C1+phone+posts+avatar). refs: `prod`.
- **skip-rollback**: spine `init→add_phone→add_bio→add_posts`; then
  `rollback_to_phone` (`add_posts`→ the `add_phone` contract) and
  `rollback_to_init` (`add_bio`→ the `init` contract) — both land on existing
  node hashes, producing skip/crossing back-arcs. refs: none.
- **long-spine**: spine `init→add_phone→add_bio→add_posts→add_avatar→
  add_comments→add_tags`; then two children off `add_tags`: `late_branch` and
  `add_everything`. refs: `prod`, `staging`.
- **multi-branch**: `init`→C1; 3 siblings off C1 (`add_phone`, `add_posts`,
  `add_avatar`); `add_bio` off `add_phone`; then parallel edges off `add_bio`
  (the original had 4 edges with identical `from`/`to` and duplicate names).
  refs: `feature`, `prod`, `staging`.

## Caveat — `multi-branch` parallel edges

The offline planner produces a package keyed by its content; **four migrations
with identical `from`/`to` and identical ops would collide** (same migration
hash), so the real pipeline likely cannot reproduce genuine parallel edges. The
implementer must **attempt** it and, if the pipeline cannot create distinct
parallel edges between the same two nodes, **STOP and report** rather than
fabricate invalid packages. Options to decide then: hand-author the parallel
packages, approximate, or drop `multi-branch` (the in-memory `parallelEdges`
graph in `test-graphs.ts` already covers parallel-edge rendering for tests).

## Done when

- The 10 listed fixtures are deleted.
- Each regenerated survivor renders via its config
  (`prisma-next migration graph --config ./prisma-next.<name>.config.ts`, default
  + `--tree`) with no errors, and `migration check` passes for it (every
  `end-contract` storageHash matches its `migration.json` `to`).
- `showcase` and `diamond` untouched; main `prisma-next.config.ts` untouched.
- No extension-space packages; no synthetic remnants in survivors.

## Scope

**In:** `examples/prisma-next-demo/migration-fixtures/**` (delete + regenerate),
new `examples/prisma-next-demo/<name>-contract/**` sources, new
`examples/prisma-next-demo/prisma-next.<name>.config.ts` files.
**Out:** CLI/package source, `showcase`, `diamond`, main demo config, the
lane-colors PR (#674), `test-graphs.ts`.

## Notes

- Branch: continue on `regenerate-diamond-migration-fixture` (PR #677 broadens
  from "regenerate diamond" to "audit & consolidate fixtures").
- Generated dirs get a "now" timestamp prefix; rename to the canonical
  `YYYYMMDDT…_slug` (identity is content-hash based, safe to rename).
