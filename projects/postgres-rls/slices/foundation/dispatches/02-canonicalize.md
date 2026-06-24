# Dispatch D2 — canonical predicate normalizer + content-hash

Slice `foundation` (TML-2868), dispatch 2 of 4. Implementer tier: sonnet. Independent of D1 (no IR-class dependency) — a pure target-internal module + its edge-case test corpus.

## Task

Create `packages/3-targets/3-targets/postgres/src/core/rls/canonicalize.ts` exporting two pure functions: `normalizePredicate(sql: string): string` and `computeContentHash(parts): string`. `normalizePredicate` canonicalizes a SQL predicate body across Postgres's reformatting equivalence classes (whitespace collapse, outer-paren trim, keyword lowercase). `computeContentHash` returns the first 8 hex chars of SHA-256 over the canonical content tuple `(normalizePredicate(using), normalizePredicate(withCheck), sortedRoles, operation, permissive)`. This is the content-addressed-naming machinery the ADR specifies; its output (the 8-hex suffix) becomes the policy wire-name suffix in later slices. Write it so it lifts cleanly into a shared module when a second consumer (indexes, check constraints) arrives, but keep it under the Postgres target for now.

## Scope

**In:**
- New file `packages/3-targets/3-targets/postgres/src/core/rls/canonicalize.ts` — the two exported functions only.
- New test file colocated per the package's test convention (grep a sibling `*.test.ts` to confirm location/naming) — the edge-case corpus.
- Whatever the package needs to export the module internally if other slices will import it (do **not** add it to the public package entrypoint unless the package convention requires it for tests; prefer source-relative test imports).

**Out:**
- The IR classes (`PostgresRlsPolicy`/`PostgresRole`) — D1, already landed. Do **not** import or modify them; `computeContentHash` takes a plain `parts` object, not an IR instance.
- The serializer (D3), the `SchemaIssue` union (D4), any authoring/planner/verifier code, any DDL.
- Wiring the hash into the IR `name` field — that is lowering (slice 2). Here the functions are standalone and reachable only from the test.

## Field/signature shapes

- `normalizePredicate(sql: string): string` — collapse runs of whitespace to a single space; trim a fully-enclosing outer paren pair (only when it wraps the entire expression — not `(a) AND (b)`); lowercase SQL keywords. Target-internal: the exact output string is never persisted or compared outside the hash input, so you have latitude on the precise canonical form **as long as it is deterministic and collapses the equivalence classes the tests assert**.
- `computeContentHash(parts: { using?: string; withCheck?: string; roles: readonly string[]; operation: 'select'|'insert'|'update'|'delete'|'all'; permissive: boolean }): string` — 8 lowercase hex chars. Tuple order and content per the ADR: `canonical(using)` (empty string if absent), `canonical(withCheck)` (empty if absent), `sort(dedupe(roles))`, `operation`, `permissive` rendered as `permissive`|`restrictive` (or a stable boolean encoding). Use `node:crypto` `createHash('sha256')`. Schema and table identity are **excluded** from the tuple (ADR § Hash inputs).

## Completed when

- [ ] `canonicalize.ts` exports `normalizePredicate` and `computeContentHash` with the signatures above; uses `node:crypto`; no dependency on D1's IR classes.
- [ ] Edge-case test corpus passes, asserting **hash determinism across reformatting-equivalent predicates** and **distinctness for semantically different bodies**. Cover, at minimum: nested parens; mixed-case keywords; line (`--`) and block (`/* */`) comments; string literals containing parens/keywords (these must **not** be normalized away — a keyword inside `'...'` is data, not syntax); outer-paren trim vs non-outer parens; whitespace variants (newlines, tabs, multiple spaces); role-order independence (`[a,b]` vs `[b,a]` same hash); role dedupe; `using`-only vs `using`+`withCheck`; operation/permissive distinctness.
- [ ] Gates green (run once at end): `cd packages/3-targets/3-targets/postgres && pnpm typecheck`; the new test file via the package's test runner; `pnpm lint:deps`.

## Decision to make (surface in your report)

The ADR names the normalizer a **stability commitment** (changing it re-suffixes every wire name). Comment-stripping and string-literal-awareness push toward a small tokenizer rather than naive regex. **Pick the simplest implementation that makes the required equivalence-class tests pass deterministically**, and state in your report how far the normalizer goes (e.g. "regex whitespace/paren/keyword + a minimal string/comment-aware scan") so the reviewer can judge the stability surface. If full correctness for a listed edge case would require a real SQL grammar parser, that is the halt signal below — do not pull in a Postgres-grammar dependency.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in this dispatch with a one-line note. Anything that pulls you off the goal halts and surfaces.

## Halt conditions (surface, do not improvise)

- Making a listed edge case pass would require a real SQL-grammar parser / heavy dependency — **stop and surface**. The ADR explicitly rejects a JS-side Postgres parser; the normalizer is intentionally cheap. Surface which edge case forces it and propose narrowing the equivalence class instead.
- The package's test setup forces you to touch the public entrypoint or any D1/serializer surface to make the test import resolve — note it and stop (prefer source-relative test imports; if the package genuinely can't, that is a real signal).
- You discover a sibling/shared canonicalization module already exists that this should extend rather than duplicate — surface it.

## Commit hygiene

Explicit staging; `tml-2868:` prefixed message. Side-quests get their own commit with a scope note.

## References

- Slice spec: `projects/postgres-rls/slices/foundation/spec.md` (§ Chosen design → Content-addressed naming; § Pre-investigated edge cases row 2).
- Content-hash ADR (the canonical tuple + normalizer axes + stability commitment): `projects/postgres-rls/specs/adr-content-addressed-policy-names.md` (§ Hash inputs, § Normalizer stability).
- Reconciliation (real file paths): `projects/postgres-rls/specs/reconciliation-2026-06-08.md`.
- D1 landed code for package layout/test conventions: the Postgres target package (`packages/3-targets/3-targets/postgres/`); D1 commit `935d8a534`.
- Heartbeat: `wip/heartbeats/implementer.txt` per the implementer persona contract.

## Operational metadata

- **Model tier:** sonnet — bounded, well-specified pure-function module with a test corpus; no cross-package design.
- **Time-box:** ~45 min wall-clock. Overrun → halt and surface.
