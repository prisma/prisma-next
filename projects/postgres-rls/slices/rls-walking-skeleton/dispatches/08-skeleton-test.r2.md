# Dispatch D8 — Round 2 (fix F1 + F2: normalizer over-normalization)

Resume of D8. The walking-skeleton integration test is correct and committed (`253bb680f`); two must-fix findings on the normalizer change it introduced.

## F1 (must-fix) — `stripRedundantCastParens` over-normalizes multi-operand cast operands

`packages/3-targets/3-targets/postgres/src/core/rls/canonicalize.ts` `stripRedundantCastParens` (~114-153). It strips grouping parens before any `(...)::type`. But `::` binds tighter than every binary operator, so the parens are **meaningful** when the operand is not atomic:
- `(a OR b)::text` ≠ `a OR b::text` (the latter is `a OR (b::text)`).
- Confirmed collision: `(amount + tax)::int = total` and `amount + tax::int = total` currently both hash to `46acc051` — two semantically different predicates → one wire name. This is a content-addressing correctness bug (two distinct RLS policies would alias).

Postgres **keeps** the parens when it reprints a multi-operand cast operand (verified: `(a OR b)::text = c` → `(((a OR b))::text = c)`), so the broad strip is not needed to absorb drift.

**Fix:** restrict the paren-strip to **atomic operands only** — strip `(X)::type` → `X::type` only when `X` contains no top-level binary operator (i.e. `X` is a single identifier, literal, or `func(args)` call whose own parens are balanced and belong to the call). When `X` has a top-level operator, **keep the parens**. Confirm against the PGlite-reprinted forms that the kept-paren cases still round-trip clean (no false drift).

## F2 (must-fix) — add a unit corpus for the three new normalizer passes

`packages/3-targets/3-targets/postgres/test/rls-canonicalize.test.ts` has **no** tests for the D8 passes (`::text` strip, cast-paren strip, type-alias normalize). Add a corpus covering, for each pass:
- **Equivalences it must collapse** (same hash): `'x'::text` ≡ `'x'` (literal annotation); `(current_setting('k'))::int` ≡ `current_setting('k')::int` (atomic operand); `::integer` ≡ `::int`, `::boolean` ≡ `::bool`, `::bigint` ≡ `::int8`, `character varying` ≡ `varchar`, `double precision` ≡ `float8`.
- **Counter-cases it must NOT collapse** (different hash) — these lock in F1: `(a OR b)::text` vs `a OR b::text`; `(amount + tax)::int = total` vs `amount + tax::int = total`; `x::text` vs `x::varchar` (distinct types); a string literal whose content contains `::text` or `)` (e.g. `'a::text'`, `'a)'`) must be preserved verbatim.

## Completed when

- [ ] F1 fixed (atomic-only paren strip); the `(amount + tax)::int = total` vs `amount + tax::int = total` pair now hashes **differently**.
- [ ] F2 corpus added (equivalences + counter-cases above), all green.
- [ ] Gates (run once): `rls-canonicalize.test.ts`; the D8 walking-skeleton integration test still passes (the atomic skeleton predicate still normalizes/round-trips clean); target-postgres typecheck; `pnpm lint:deps`.

## Decisions standing (do not relitigate)

The `::text`-strip and `normalizeCastAliases` passes are sound (reviewer-confirmed) — keep them; only `stripRedundantCastParens` is wrong. Do not weaken the other two.

## Constraints

Explicit-staging commit, `tml-2868:` prefix, no amend, **no push**. No `any`/bare casts. Heartbeats to `wip/heartbeats/implementer.txt`. Commit your own work.
