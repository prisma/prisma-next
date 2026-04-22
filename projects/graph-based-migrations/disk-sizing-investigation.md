# Migration disk-sizing investigation

Answers the third concern of [April milestone VP3](../../docs/planning/april-milestone.md) ("the graph scales with large contracts") — migration history size on disk — that the graph-layer and planner bench memos explicitly deferred.

Companion to [`docs/planning/benchmarks/migration-graph-baseline.md`](../../docs/planning/benchmarks/migration-graph-baseline.md) and [`docs/planning/benchmarks/migration-planner-baseline.md`](../../docs/planning/benchmarks/migration-planner-baseline.md).

## What's measured

Emitted `contract.json` for three real-world Prisma ORM schemas (dropped into `examples/prisma-next-demo/` temporarily, the demo's `prisma-next.config.ts` pointing at each schema in turn). Ranged from small to large so we could check whether per-model cost stays linear at scale.

The schemas needed mechanical sanitisation first because the prisma-next PSL interpreter rejects some Prisma-ORM-only constructs (`@db.*`, `@updatedAt`, `@@ignore`, `map: "…"` constraint-naming args, multi-line `@@index(…)`, etc). A sanitiser + orchestrator that runs emit with error-line blanking and measures the resulting `contract.json` is kept alongside the optional benchmark harness (not committed in this PR; see the PR body for how to obtain the branch that carries it).

## Results

| Schema | Models | `contract.json` | gzip (`-9`) | `contract.d.ts` | Bytes/model (JSON) |
|---|---:|---:|---:|---:|---:|
| `schema (1).prisma` | 215 | 1.29 MiB | 51 KiB | 1.58 MiB | 6,301 |
| `schema.prisma` | 893 | 6.33 MiB | 257 KiB | 7.75 MiB | 7,429 |
| `schema (2).prisma` | 880 | 9.41 MiB | 480 KiB | 9.21 MiB¹ | 11,218 |

¹ Unformatted; see *Emitter bug uncovered* below.

Per-model cost is roughly linear but varies with column density. Schema (2) is a dense MSSQL-migrated schema with much wider tables than the other two, hence the ~50% higher bytes/model. A better predictor of on-disk cost than "models" is likely "columns", but the ballpark is ~6–11 KiB per model for the `contract.json`.

**Gzipped ratios are ~4% across the board.** JSON repetition (codec IDs, type names, structural keys) compresses heavily.

## What a single migration costs

A `migration.json` embeds both `fromContract` and `toContract` in full — there's no dedup, no compression, no delta encoding. From the types definition at [`packages/1-framework/3-tooling/migration/src/types.ts (L18–L19)`](../../packages/1-framework/3-tooling/migration/src/types.ts:18-19):

```ts
readonly fromContract: Contract | null;
readonly toContract: Contract;
```

So at the `schema (2)` scale: every migration is **~18.8 MiB minimum** (9.4 MiB × 2) for the manifest alone, plus `ops.json`.

Extrapolating to a realistic history (100 migrations of an 880-model schema):

| Scheme | Total on disk |
|---|---:|
| Current layout (raw JSON, no dedup) | **1.88 GiB** |
| Gzip per file (drop-in change) | ~48 MiB |
| Content-addressed store + gzip per contract | ~47 MiB |
| Content-addressed store + zstd pool (see below) | **plausibly ~1 MiB** — see caveats |

## Compression options — what I tested

### Gzip (current assumption)

Compresses each file independently. Ratio ~4% on a single contract. Pooling many contracts into one gzip stream **does not help** because gzip's sliding window is only 32 KiB — tiny compared to a 9 MiB contract, so the window never spans a document boundary. Empirically:

| Input | gzip -9 |
|---|---:|
| 1 × 6.3 MiB contract | 250 KiB |
| 10 × near-identical copies (63 MiB) concatenated, gzipped | 2.50 MiB |

The 10-copy result is exactly 10× the single-copy result. Gzip-pooled ≈ gzip-per-file.

### Zstd (large window, optionally with a trained dictionary)

Zstd's default window is effectively >100 MiB at level 19. It sees across document boundaries. Same input:

| Input | zstd -19 | zstd -19 --long |
|---|---:|---:|
| 1 × 6.3 MiB contract | 171 KiB | — |
| 10 × near-identical copies | **176 KiB** | 175 KiB |

Essentially all of the cross-document redundancy is squashed. 10 copies compress to ~1× the single-copy size.

### Caveat on that experiment

The "10 copies" were made by taking one contract and globally replacing a couple of identifier strings per variant. That's **not** a realistic migration pattern — real migrations change things at one or two localised spots per step, not with global renames. My experiment is an upper bound on similarity.

I also extrapolated 10 copies → 100 migrations without actually testing 100. The "~1 MiB for 100 migrations" headline figure assumes the per-step redundancy pattern holds across a 10× larger history. Plausible, not measured.

**Qualitative robustness:** the finding that *gzip cannot exploit cross-contract redundancy at this scale* is about compressor mechanics (sliding-window size) and holds independently of content. The finding that *zstd with a large window or trained dictionary can* is equally robust. The exact multiplier (50×, 100×, 500×) depends on what real migrations look like, and we haven't characterised that with production data.

**What would sharpen the numbers:** re-emit the same schema several times with actual small changes between runs (add one column, add one model, rename one field), then compare pooled-zstd output to per-file gzip across that realistic history. A ~30-minute experiment.

## Architectural options

In order of increasing engineering cost:

### 1. Gzip the existing files (drop-in)

Zero structural change. Writers emit `migration.json.gz`; readers decompress. `reconstructGraph` is unaffected.

- Pro: smallest PR, reversible, ~20× smaller disk footprint.
- Con: leaves the cross-contract redundancy unclaimed. Still linear-in-migration-count.

### 2. Content-addressed contract store

```
.prisma-next/
  contracts/
    sha256-ab/cd1234.json    ← one file per distinct contract
  migrations/
    <dirname>/
      migration.json         ← fromHash, toHash, labels, ops only
      ops.json
```

- Pro: each distinct contract stored exactly once. In a linear history (every migration introduces a new state), this saves a 2× factor over today because every distinct contract is currently serialised twice (once as migration N's `toContract`, again as migration N+1's `fromContract`).
- Pro: the migration graph already works off hashes; this matches its natural shape.
- Pro: changes `migration.json` into a thin metadata file — status and graph operations stop needing to parse contracts.
- Con: writer needs atomic multi-file write (contract + manifest). Need GC for orphaned contracts.
- Con: a stand-alone migration directory stops being self-contained — needs the store.

### 3. Content-addressed store **+ zstd trained dictionary**

Same store shape as (2), but each `.json` file is zstd-compressed against a shared dictionary checked into the repo at `.prisma-next/contracts/dict.zst`.

- Pro: random access to any contract (just decompress with the dict).
- Pro: ratio close to pooled compression because the dict captures the shared JSON vocabulary.
- Pro: the canonical zstd use case — Yann Collet's docs call out "many similar JSON documents" explicitly.
- Con: one more moving part (the dict). One-time training step. Periodic retraining if the schema vocabulary shifts materially.

**This is the architecturally right answer if disk footprint actually becomes a concern.** Option (1) buys most of the wins with the least work.

### 4. Delta encoding (`zstd --patch-from`)

Each contract compressed with its parent as prefix context.

- Pro: theoretical maximum compression for linear histories.
- Con: reads need to walk the chain. Break in the middle = downstream unreadable.
- Honestly, probably overkill given the option-3 numbers.

## Recommendation

1. **Today:** ship gzip-per-file (option 1) if anyone notices disk footprint in practice. ~100-line PR, no structural change.
2. **If it becomes a real concern:** option 3. Probably a week of focused work including dict training tooling, store layout migration, and `io.ts` adapter. The payoff is that disk cost stops scaling meaningfully with migration count.
3. **Skip option 2 standalone.** It's 2× over gzip-per-file and doesn't exploit the real win (cross-document redundancy). Dedup-only shines when the same contract appears many times — which happens with data migrations (from/toContract identical) but is rare in pure structural histories.

## Emitter bug uncovered

Noted for follow-up: the emitter produced invalid TypeScript for `schema (2).prisma`. Prettier's TS parser rejected the generated `.d.ts` with `Property or signature expected. (50:457193)`. The `ContractBase = ContractType<…>` type is on a single 450k-char line; something deep inside it parses as invalid TS.

Location: [`packages/1-framework/3-tooling/emitter/src/emit.ts (L54–L59)`](../../packages/1-framework/3-tooling/emitter/src/emit.ts:54-59). Reproducible on any wide MSSQL-origin schema. I measured schema (2) via a one-off fallback that skipped prettier formatting, then reverted.

Worth filing as a dedicated bug. Likely cause is an identifier/string-escape edge case in `generateContractDts`.

## Takeaways

- Disk cost is **linear in model count × migration count** today, with no compression or dedup. At `schema (2)` scale that's ~20 MiB per migration and ~2 GiB per 100 migrations.
- Gzip alone is a **20× win** and a tiny PR.
- Zstd-with-dictionary is an **additional order of magnitude or two** and the right long-term architecture if the concern grows.
- The 2000× headline from my synthetic test should be read as "an order of magnitude in that direction", not a hard number — needs a realistic multi-version-contract test to nail down.

## Reproducing the measurement

The sanitiser + orchestrator used to produce the numbers above lives on a separate branch alongside the optional benchmark harness. Run against any set of `.prisma` files after applying the sanitiser and letting the orchestrator drive the demo emit loop.
