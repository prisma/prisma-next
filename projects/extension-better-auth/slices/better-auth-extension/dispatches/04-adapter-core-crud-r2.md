# Brief: D4 R2 (resumed) — address F2

Findings from R1:

- **F2 (low / process):** the re-export block in `src/adapter/index.ts:30-40` violates the golden rule "no reexports outside `exports/` folders" — move the aggregation into `src/exports/adapter.ts` (supabase's `exports/runtime.ts` is the compliant precedent). Mechanical; no behaviour change.

Gates (restated): package build + test + typecheck + lint; workspace typecheck if export surfaces moved.
