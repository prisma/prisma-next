# Typecheck baseline (M0.3)

Captured pre-M4 to support the [AC-7](../spec.md#ac-7-build-performance-acceptable)
"build performance acceptable (within ±20%)" gate. Commands timed via `time -p
pnpm --filter <pkg> typecheck`; reported as `real` wall-clock; three runs each;
median is the comparison datum.

| Package | Run 1 | Run 2 | Run 3 | Median |
|---|---|---|---|---|
| `@prisma-next/sql-relational-core` | 1.325s | 1.232s | 1.256s | **1.256s** |
| `@prisma-next/sql-contract-ts` | 1.965s | 1.944s | 1.829s | **1.944s** |

## Environment

- Node v24.15.0, pnpm 10.27.0
- Branch tip at capture: `4d5ca532f` (M3 R2 close)
- Captured at the start of M4 R1, before any M4 code lands.

## Re-measure protocol (post-M4)

Run the same command three times for each package, record the median, and
compare against the table above. Acceptable variance per AC-7 is ±20% — i.e.
the post-M4 median for `sql-relational-core` should be ≤ 1.51s, and the
post-M4 median for `sql-contract-ts` should be ≤ 2.33s.
