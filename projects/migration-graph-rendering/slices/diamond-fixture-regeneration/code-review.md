# Code review — regenerated `diamond` migration fixture

**Commit:** `7a4d3100043edb57e0f7c20e64c6346cbdb6d502` on `regenerate-diamond-migration-fixture`
**Verdict:** **SATISFIED** — the diamond fixture is a complete, internally-consistent, extension-free 5-node diamond that converges at C5; `migration check` passes and both graph renders show a clean 5-node/5-edge diamond. Scope is confined to the three intended path globs and the main `prisma-next.config.ts` is untouched.

## Hash legend

| Label | storageHash (short) |
|---|---|
| C1 (init) | `789dd79` |
| C2 (alice_add_phone) | `93be6c2` |
| C3 (bob_add_avatar) | `7e3fa7f` |
| C5 (merge_alice / merge_bob converge) | `f9a41d7` |

## Scoreboard

| AC | Result | Evidence |
|---|---|---|
| 1. Full artifact set per node | **PASS** | All 5 nodes present. Each carries the same artifact kinds `showcase` uses: `migration.json`, `ops.json`, `end-contract.json`, `end-contract.d.ts`, `migration.ts`. Branched/merge nodes (alice, bob, merge_alice, merge_bob) additionally carry `start-contract.{json,d.ts}`; `init` does not. This matches `showcase` exactly — its `init` has the same 5-file set, while its branched/merge nodes (`alice_phone`, `merge_alice`, `merge_bob`) carry `start-contract.*`. Legitimate planner output for non-root edges; does not break the read path (check + graph both succeed). |
| 2. Diamond topology + convergence | **PASS** | `∅→C1`; `C1(789dd79)→C2(93be6c2)` (alice), `C1(789dd79)→C3(7e3fa7f)` (bob); `C2→C5(f9a41d7)` (merge_alice), `C3→C5(f9a41d7)` (merge_bob). `merge_alice.to == merge_bob.to == refs/prod.json.hash == f9a41d7`. C1 has two distinct children (`93be6c2` ≠ `7e3fa7f`). |
| 3. Internal consistency | **PASS** | Every `end-contract.json` storageHash == its `migration.json` `to` (init 789dd79, alice 93be6c2, bob 7e3fa7f, merge_alice/merge_bob f9a41d7). Bonus: each `start-contract.json` storageHash == its `from`. `pnpm exec prisma-next migration check --config ./prisma-next.diamond.config.ts` → `{ "ok": true, "failures": [], "summary": "All checks passed" }`. |
| 4. Renders | **PASS** | Both `--tree --format pretty` and default `--format pretty` render a 5-node/5-edge diamond with no errors (outputs below). |
| 5. No extensions / no synthetic remnants | **PASS** | No `vector`/`pgvector`/extension-space packages anywhere in the fixture; the only "extension" hits are `extensionPacks: {}` (empty) — genuine no-extension planner output. Ops are app-space only (`target.id: "postgres"`, schema `__unbound__`, operating on the `user` table/columns). Old synthetic hashes gone: pre-commit `prod.json` was `3b2d98d…` and `init.to` was `ef9de27…`; both replaced by real planned hashes. |
| 6. Scope | **PASS** | `git show --stat` touches only `diamond-contract/**`, `prisma-next.diamond.config.ts`, and `migration-fixtures/diamond/**`. `prisma-next.config.ts` is touched 0 times. New config mirrors `prisma-next.showcase.config.ts`: working contract `./diamond-contract/c5.prisma` (C5 source: `user` with id/email/phone/avatar), `migrations.dir → ./migration-fixtures/diamond`. |
| 7. `migration.ts` validity | **PASS** | `merge_alice/migration.ts` is a genuine generated artifact: shebang, `import … from '@prisma-next/postgres/migration'`, `class M extends Migration` with `describe()` (from `93be6c2` → to `f9a41d7`, matching migration.json) and `operations()` returning a real `addColumn('__unbound__', 'user', { name: 'avatar', … })`, then `MigrationCLI.run(...)`. `end-contract.d.ts` carries the `GENERATED FILE` header, real imports, and `StorageHash` brand `f9a41d7…` matching `migration.to`. Not stubs. |

## `migration check` result

```
{
  "ok": true,
  "failures": [],
  "summary": "All checks passed"
}
```

## Graph render — `--tree --format pretty`

```
prisma-next migration graph → Show the migration graph topology
│
│ config:               prisma-next.diamond.config.ts
│ migrations:           migration-fixtures/diamond/app
└

*   f9a41d7                        (prod, contract)
+-\
|^|   20260303T1000_merge_alice      93be6c2 -> f9a41d7
| |^  20260303T1100_merge_bob        7e3fa7f -> f9a41d7
* |   93be6c2
|^|   20260302T1000_alice_add_phone  789dd79 -> 93be6c2
| *   7e3fa7f
| |^  20260302T1100_bob_add_avatar   789dd79 -> 7e3fa7f
+-/
*   789dd79
|^  20260301T1000_init             -       -> 789dd79
-

5 node(s), 5 edge(s)
```

## Graph render — default `--format pretty`

```
prisma-next migration graph → Show the migration graph topology
│
│ config:               prisma-next.diamond.config.ts
│ migrations:           migration-fixtures/diamond/app
└

│
│                                         ○ ∅
│                                         │
│                                         │ 20260301T1000_init
│                                         │
│                                         ▾
│                               ┌─────────○ 789dd79─┐
│                               │                   │
│  20260302T1100_bob_add_avatar │                   │ 20260302T1000_alice_add_phone
│                               │                   │
│                               ▾                   ▾
│                               ○ 7e3fa7f           ○ 93be6c2
│                               │                   │
│       20260303T1100_merge_bob │                   │ 20260303T1000_merge_alice
│                               │                   │
│                               └─────────▾─────────┘
│                                         ○ f9a41d7 prod ◆ contract
│
│
│  5 node(s), 5 edge(s)
```

## Findings

- No blocking issues. No source/fixture files were modified during this review.
- Minor observation (out of scope, not introduced by this commit): the worktree's main `examples/prisma-next-demo/prisma-next.config.ts` currently has `migrations.dir: 'migration-fixtures/diamond'` and a `pgvector` extension while pointing `contract` at `./src/prisma/contract.prisma`. That is an uncommitted working-tree state unrelated to this commit (the commit does not touch that file). The dedicated `prisma-next.diamond.config.ts` is the correct, self-contained entry point for the diamond fixture and is what AC4/AC3 were validated against.
