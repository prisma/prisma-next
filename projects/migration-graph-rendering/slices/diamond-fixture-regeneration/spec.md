# Slice: Regenerate the `diamond` migration fixture as a complete, renderable set

## Problem

`examples/prisma-next-demo/migration-fixtures/diamond` is a hand-authored,
topology-only fixture: each node has only `migration.json` + `ops.json` with
**synthetic** hashes, no `end-contract.json` / `end-contract.d.ts` / `migration.ts`.
The live read/graph path (`readGraphNodeEndContract` in
`packages/1-framework/3-tooling/migration/src/aggregate/aggregate.ts`) requires
each node's `end-contract.json` + `.d.ts` to exist and deserialize, so pointing
the CLI at `diamond` fails with "missing destination contract snapshot". Because
the hashes are synthetic with no backing contract content, you cannot just "add"
end-contracts — the whole fixture must be regenerated so all artifacts agree.

Nothing reads this fixture by path except a (deliberately not-committed) demo
config edit; the `describe('diamond')` unit test uses an in-memory graph. So the
fixture can be regenerated freely.

## Design of record

Regenerate the diamond **offline** with `prisma-next migration plan` (the command
is explicitly "fully offline — no database connection is needed"), driving a
branching/merging DAG via `--from <ref> --to <contract>`.

Topology (preserve node dir names + timestamps so the diamond stays meaningful):

```
            ∅ → C1            (20260301T1000_init)
           /        \
   C1 → C2          C1 → C3   (alice_add_phone / bob_add_avatar)
           \        /
   C2 → C5          C3 → C5   (merge_alice / merge_bob)   refs/prod.json → C5
```

Contract states (simple Prisma-style sources, mirror `showcase-contract/showcase.prisma`;
**no extensions** — keep it app-space only, drop the old `vector` extension to avoid
cross-space migration packages):

- **C1** (`init`): `model user { id String @id @default(uuid()); email String }`
- **C2** (`alice_add_phone`): C1 + `phone String?`
- **C3** (`bob_add_avatar`): C1 + `avatar String?`
- **C5** (merge target): C1 + `phone String?` + `avatar String?`

`merge_alice` (C2→C5 adds avatar) and `merge_bob` (C3→C5 adds phone) both land on
the same end contract C5, so they share a `to` hash — that is the convergence.

Add `examples/prisma-next-demo/prisma-next.diamond.config.ts` mirroring
`prisma-next.showcase.config.ts` (contract → the C5 source, `migrations.dir` →
`./migration-fixtures/diamond`) so the fixture is renderable via `--config`
without touching the main `prisma-next.config.ts`.

## Scope

**In:**
- `examples/prisma-next-demo/migration-fixtures/diamond/app/**` — regenerate all 5
  packages with the full showcase artifact set (`migration.json`, `ops.json`,
  `end-contract.json`, `end-contract.d.ts`, `migration.ts`), canonical dir names.
- `examples/prisma-next-demo/migration-fixtures/diamond/app/refs/prod.json` → C5 hash.
- New `examples/prisma-next-demo/diamond-contract/*` source(s).
- New `examples/prisma-next-demo/prisma-next.diamond.config.ts`.

**Out:** main `prisma-next.config.ts`, `showcase` fixture, the lane-colors PR
(#674), any CLI source, anything outside the demo example.

## Done when

- `pnpm exec prisma-next migration graph --config ./prisma-next.diamond.config.ts`
  (run from `examples/prisma-next-demo`) renders the diamond — 5 nodes, C1 fork to
  two branches converging at C5 — with no errors, in both `--tree` and default modes.
- `prisma-next migration check --config ./prisma-next.diamond.config.ts` passes
  (every `end-contract.json` storageHash matches its `migration.json` `to`).
- `migration.json`/`ops.json`/`end-contract.*` are mutually consistent and the
  `from`/`to` chain forms the diamond; `refs/prod.json` resolves to C5.
- No change to the main demo config; `merge_bob` present; no extension-space packages.

## Notes

- Generated package dirs get a "now" timestamp prefix + `--name` slug; rename each
  to the canonical `YYYYMMDDT…_slug` (identity is content-hash based, so renaming
  is safe). Regenerated hashes will differ from the old synthetic ones — expected.
- This is a separate work item from the lane-colors slice; own branch
  (`regenerate-diamond-migration-fixture`) off `main`, own PR.
