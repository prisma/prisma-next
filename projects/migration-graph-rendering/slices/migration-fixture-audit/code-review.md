# Code review — migration-fixture audit

**Commit:** `835edccad72ef95bb63d168a28afcf8ad51226a0` on `regenerate-diamond-migration-fixture`
**Verdict:** **SATISFIED** — the ten redundant topology-only fixtures are deleted, the seven-fixture set is exactly as specified, the five regenerated survivors each render (tree + default) and pass `migration check`, topologies match the intended shapes, and the load-bearing multi-branch case is genuinely four distinct migration packages sharing `from`/`to` with distinct `migrationHash` (rendered as four parallel edges, no collision). `showcase`, `diamond`, the main config, CLI/packages, and `test-graphs.ts` are untouched.

## Scoreboard

| AC | Result | Evidence |
|---|---|---|
| 1. Deletions | **PASS** | All 10 dirs gone from the commit tree (`linear`, `single-branch`, `sub-branches`, `rollback`, `rollback-continue`, `multi-rollback-branch`, `diamond-sub-branch`, `complex`, `kitchen-sink`, `sequential-diamonds`) — confirmed via `git ls-tree -d 835edccad`. Remaining `migration-fixtures/` on disk = exactly {`converging-branches`, `diamond`, `long-spine`, `multi-branch`, `showcase`, `skip-rollback`, `wide-fan`} (7). `multi-branch` shows D entries only because it is a *regenerated survivor* (old topology-only files removed, full packages added) — the directory persists. |
| 2. Untouched | **PASS** | `git show --name-only 835edccad` matches none of: `prisma-next.config.ts`, `migration-fixtures/showcase`, `migration-fixtures/diamond/`, `test-graphs`, `packages/`, `cli/`. |
| 3. Renders + checks | **PASS** | All 5 `migration check` → `{ ok: true, failures: [], "All checks passed" }`. All 5 `--tree --format pretty` and default `--format pretty` render with no errors (trees below). |
| 4. Topology fidelity | **PASS** | wide-fan: init + 5 siblings off C1 (7 nodes/6 edges). converging-branches: 3 siblings off C1, 3 merges → union `042e80c`, `prod`→`042e80c` (6/7). skip-rollback: spine init→phone→bio→posts; `rollback_to_phone` `7e951c7→93be6c2` (existing add_phone node), `rollback_to_init` `827997c→789dd79` (existing init node) — crossing back-edges, no new leaves (5/6). long-spine: 7-node spine + 2 children off `add_tags` (`99de8c2`); `staging`→`6c66c89`, `prod`→`2636edd` (10/9). multi-branch: 3-way fork off C1 + `add_bio` off add_phone + 4 parallel edges; `feature`/`prod`/`staging` refs (7/9). |
| 5. Internal consistency | **PASS** | Spot-confirmed long-spine: every node's `end-contract.json` storageHash == its `migration.json` `to` (init `789dd79` … add_everything `2636edd`, all 9 match). The `migration check` pass covers this for all 5. |
| 6. multi-branch parallel edges | **PASS** (load-bearing) | The 4 packages `parallel_a..d` all carry `from sha256:827997c…` and `to sha256:d11106e…` (identical) but distinct `migrationHash` (`4cd497e…`, `c2d8545…`, `fdce4b9…`, `0e0ac47…`). The renderer draws 4 parallel edges into `d11106e`; `migration check` passes with no collision/dup-identity error. |
| 7. No remnants | **PASS** | No `pgvector`/`"vector"` refs in any survivor; all `extensionPacks` are `{}` (69×); all op target schemas are `__unbound__` (43×, app-space). No `_emit_scratch`/scratch/`.tmp`/emit-out files in the commit or untracked in the demo worktree. Survivors regenerated offline, so no old synthetic-hash mismatches (check pass corroborates). |

## Per-fixture configs (all mirror the showcase/diamond pattern)

| Fixture | contract source | migrations.dir |
|---|---|---|
| wide-fan | `./wide-fan-contract/settings.prisma` | `./migration-fixtures/wide-fan` |
| converging-branches | `./converging-branches-contract/union.prisma` | `./migration-fixtures/converging-branches` |
| skip-rollback | `./skip-rollback-contract/c1.prisma` | `./migration-fixtures/skip-rollback` |
| long-spine | `./long-spine-contract/everything.prisma` | `./migration-fixtures/long-spine` |
| multi-branch | `./multi-branch-contract/target.prisma` | `./migration-fixtures/multi-branch` |

## `--tree` renders

### wide-fan (7 nodes / 6 edges)
```
*   93be6c2
|^  20260302T1000_add_phone     789dd79 -> 93be6c2
| *   afdcd8e
| |^  20260302T1100_add_posts     789dd79 -> afdcd8e
| | *   7e3fa7f
| | |^  20260302T1200_add_avatar    789dd79 -> 7e3fa7f
| | | *   2796854
| | | |^  20260302T1300_add_category  789dd79 -> 2796854
| | | | *   f224748                     (contract)
| | | | |^  20260302T1400_add_settings  789dd79 -> f224748
+-+-+-+-/
*   789dd79
|^  20260301T1000_init          -       -> 789dd79
-
7 node(s), 6 edge(s)
```

### converging-branches (6 nodes / 7 edges)
```
*   042e80c                     (prod, contract)
+-+-\
|^| |   20260303T1000_merge_phone   93be6c2 -> 042e80c
| |^|   20260303T1100_merge_posts   afdcd8e -> 042e80c
| | |^  20260303T1200_merge_avatar  7e3fa7f -> 042e80c
* | |   93be6c2
|^| |   20260302T1000_add_phone     789dd79 -> 93be6c2
| * |   afdcd8e
| |^|   20260302T1100_add_posts     789dd79 -> afdcd8e
| | *   7e3fa7f
| | |^  20260302T1200_add_avatar    789dd79 -> 7e3fa7f
+-+-/
*   789dd79
|^  20260301T1000_init          -       -> 789dd79
-
6 node(s), 7 edge(s)
```

### skip-rollback (5 nodes / 6 edges)
```
*-\       7e951c7
| |v      20260305T1000_rollback_to_phone   7e951c7 -> 93be6c2
|^|       20260304T1000_add_posts           827997c -> 7e951c7
*-+-\     827997c
| | |v    20260306T1000_rollback_to_init    827997c -> 789dd79
|^| |     20260303T1000_add_bio             93be6c2 -> 827997c
*</ |     93be6c2
|^  |     20260302T1000_add_phone           789dd79 -> 93be6c2
*<--/     789dd79                           (contract)
|^        20260301T1000_init                -       -> 789dd79
-
5 node(s), 6 edge(s)
```

### long-spine (10 nodes / 9 edges)
```
*   6c66c89                       (staging)
|^  20260307T1100_late_branch     99de8c2 -> 6c66c89
| *   2636edd                       (prod, contract)
| |^  20260308T1000_add_everything  99de8c2 -> 2636edd
+-/
*   99de8c2
|^  20260307T1000_add_tags        b34dc91 -> 99de8c2
*     b34dc91
|^  20260306T1000_add_comments    47f4a4f -> b34dc91
*     47f4a4f
|^  20260305T1000_add_avatar      7e951c7 -> 47f4a4f
*     7e951c7
|^  20260304T1000_add_posts       827997c -> 7e951c7
*     827997c
|^  20260303T1000_add_bio         93be6c2 -> 827997c
*     93be6c2
|^  20260302T1000_add_phone       789dd79 -> 93be6c2
*     789dd79
|^  20260301T1000_init            -       -> 789dd79
-
10 node(s), 9 edge(s)
```

### multi-branch (7 nodes / 9 edges)
```
*   d11106e                   (contract)
|^  20260304T1000_parallel_d  827997c -> d11106e
|^  20260304T1000_parallel_c  827997c -> d11106e
|^  20260304T1000_parallel_b  827997c -> d11106e
|^  20260304T1000_parallel_a  827997c -> d11106e
*   827997c                   (feature)
|^  20260303T1000_add_bio     93be6c2 -> 827997c
*   93be6c2                   (prod)
|^  20260302T1000_add_phone   789dd79 -> 93be6c2
| *   afdcd8e                   (staging)
| |^  20260302T1100_add_posts   789dd79 -> afdcd8e
| | *   7e3fa7f
| | |^  20260302T1200_add_avatar  789dd79 -> 7e3fa7f
+-+-/
*   789dd79
|^  20260301T1000_init        -       -> 789dd79
-
7 node(s), 9 edge(s)
```

## multi-branch parallel-edge analysis (the load-bearing risk)

| Package | from | to | migrationHash |
|---|---|---|---|
| parallel_a | `827997c…` | `d11106e…` | `4cd497ed…` |
| parallel_b | `827997c…` | `d11106e…` | `c2d85458…` |
| parallel_c | `827997c…` | `d11106e…` | `fdce4b93…` |
| parallel_d | `827997c…` | `d11106e…` | `0e0ac470…` |

Identical `from`/`to` contract endpoints, four distinct `migrationHash` values → four distinct migration packages along the same contract transition. The renderer materialises this as four parallel edges into `d11106e`, and `migration check` reports `ok: true` — the read/check path tolerates same-endpoint multiplicity without a dup-identity collision. Risk cleared.

## Findings

- No blocking issues. No fixtures/source modified during review (only this `code-review.md` written).
- `multi-branch` legitimately appears with both deletions and additions in `git show --stat`: it is a regenerated survivor (old topology-only `migration.json`/`ops.json` removed, full packages + `start-contract`/`end-contract` added), not one of the 10 removed fixtures. Directory still present on disk.
