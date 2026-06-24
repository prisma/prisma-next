# Dispatch D2 — Round 2 re-brief (resume)

Resume of D2. You retain your prior transcript (commits `d02131f45`, `9dc939eaa`). One must-fix finding from review; everything else in D2 was accepted.

## Finding to address

**F1 (must-fix) — `normalizePredicate` lowercases string-literal contents, widening the equivalence class.**

`normalizePredicate` strips comments and preserves literal *structure*, but the trailing blanket `.toLowerCase()` (canonicalize.ts:98) also lowercases the *contents* of single-quoted literals. So `role = 'Admin'` and `role = 'admin'` normalize identically and produce the same content hash. Postgres string comparison is case-sensitive — these are semantically different predicates, hence different policies. The content hash is the policy equivalence relation; collapsing literal case lets two distinct policies collide on one wire-name suffix (breaks tamper-detection + the duplicate-prefix rule). The brief was explicit: data inside `'...'` "must not be normalized away — a keyword inside `'...'` is data, not syntax." Lowercasing literal data is the same class of error as stripping a paren inside a literal. The normalizer is a stability commitment (ADR § Normalizer stability) — it must be correct before any wire name ships.

**Resolution required:**
- Lowercase only the syntactic portions, not literal contents. Fold case-normalization into the existing char scanner (it already tracks literal boundaries in `stripComments`): lowercase bytes outside literals, copy literal bytes verbatim. Drop the blanket `.toLowerCase()`.
- Invert the test at `test/rls-canonicalize.test.ts:250-254` to assert `'AND'` and `'and'` (and `'Admin'`/`'admin'`) hash **differently**.
- Add a `normalizePredicate` unit assertion that literal contents keep their original case while surrounding keywords are lowercased (e.g. `WHERE x = 'Admin'` → `where x = 'Admin'`).

## Decisions standing (do not relitigate)

- Tuple, 8-hex, `node:crypto`, schema/table exclusion, comment-stripping, outer-paren trim, using-only vs using+withCheck positions — all accepted as-is. Do not change them.
- Normalizer depth stays cheap (whitespace, keyword case *outside literals*, outer parens, comments). No cast normalization, no SQL-grammar parser.

## Validation gates (run once at end)

- `cd packages/3-targets/3-targets/postgres && pnpm typecheck` (node_modules + dist are now present after a fresh install/build).
- The test file: `node_modules/.bin/vitest run test/rls-canonicalize.test.ts`.
- `pnpm lint:deps`.

## Constraints

Explicit-staging commit, `tml-2868:` prefix, no amend, no push. Read-only on review/spec/plan. Heartbeats to `wip/heartbeats/implementer.txt`. Re-run the transient-ID scan on the new diff. Return shape per persona.
