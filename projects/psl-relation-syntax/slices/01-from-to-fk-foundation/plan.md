# Slice 1 — from/to FK foundation — Dispatch plan

**Slice spec:** `projects/psl-relation-syntax/slices/01-from-to-fk-foundation/spec.md`
**Linear:** [TML-2940](https://linear.app/prisma-company/issue/TML-2940)

Three sequential dispatches — the read / format / print faces of the `from`/`to` FK vocabulary. Test-first spine: M1 proves the backward-compat invariant at the contract level; M2 and M3 make the two emit surfaces canonical.

## M1 — Resolver reads `from`/`to` (legacy as input alias) + backward-compat equivalence

- **Outcome:** the PSL resolver lowers `@relation(from:, to:)` for FK relations identically to `@relation(fields:, references:)`; a schema authored each way emits byte-identical `contract.json`.
- **Builds on:** none (the `@relation` attribute grammar is already generic — args scanned by string).
- **Hands to:** a resolver that speaks `from`/`to`, with legacy `fields`/`references` aliasing to the same `{ fields, references }` result. The equivalence test harness M3's grep gate complements.
- **Focus:** `packages/2-sql/2-authoring/contract-psl/src/psl-relation-resolution.ts` `parseRelation` (~L192–237): read `from`/`to`; alias legacy keys; inference — omit `to:` ⇒ target `@id`, bare single field vs bracketed composite (brackets required when composite), tolerate + carry a redundant `Model.` qualifier on `to:`. Preserve the existing both-or-neither diagnostic (a `from:` with no inferable `to:`). FK relations only.
- **Completed when:**
  - [ ] `pnpm --filter @prisma-next/sql-contract-psl test` green with a new test asserting a legacy-spelled and a canonical-spelled relation lower to the **same** resolved relation.
  - [ ] A fixture authored both ways emits **byte-identical** `contract.json` (equality assertion, not two snapshots).
  - [ ] `cd packages/2-sql/2-authoring/contract-psl && pnpm typecheck` clean.
- **Halt conditions:**
  - Reading `from`/`to` turns out to need a parser/grammar change (the generic-grammar assumption is false) → **I12 halt**: surface; do not silently add grammar.
  - The contract-emit path can't produce byte-identical output for the two spellings (a non-arg difference leaks) → surface the divergence before forcing equality.

## M2 — CST `format` canonicalises the keyword (trivia-preserving, idempotent)

- **Outcome:** `prisma-next format` rewrites `@relation` argument keys `fields`→`from` and `references`→`to` in place, keyword-token only, preserving values, brackets, qualifiers, comments, and alignment; running it twice is a fixpoint.
- **Builds on:** M1's resolver (so the canonicalised output still lowers correctly — though M2 is a pure syntactic transform).
- **Hands to:** `format` as a single-dialect emitter for the keyword.
- **Focus:** `packages/1-framework/2-authoring/psl-parser/src/format/` (`emit.ts` token-streamer; `format.ts` = `parse → emitDocument`). The mechanism is the judgment: a streaming substitution that rewrites the key token when emitting a `@relation` argument key, **vs** a green-tree pre-pass producing a renamed document (`greenToken`/`greenNode` exist; no in-place rewrite helper). Choose the smallest change that keeps `emitDocument` generic and provably trivia-preserving.
- **Completed when:**
  - [ ] `pnpm --filter @prisma-next/psl-parser test` green with tests covering: legacy→canonical key rename; a `@relation` line with a trailing comment survives unchanged but for the key; composite bracketed args unchanged; an already-canonical relation is untouched.
  - [ ] Idempotence test: `format(format(x)) === format(x)` for a schema with legacy + canonical + commented relations.
- **Halt conditions:**
  - The chosen rename mechanism cannot preserve a comment/alignment on the relation line → surface; reconsider mechanism (do not ship a formatter that drops trivia).

## M3 — `contract infer` AST printer emits canonical + single-dialect gate

- **Outcome:** PSL generated from an inferred SQL schema emits `from:`/`to:` (never `fields:`/`references:`); a grep gate proves no legacy relation keys survive any toolchain emit (`format` or `contract infer`); `fixtures:check` clean.
- **Builds on:** M1 (the canonical vocabulary) + M2 (format already canonical).
- **Hands to:** the whole-toolchain single-dialect-output guarantee — the slice's spine completed.
- **Focus:** `packages/2-sql/9-family/src/core/psl-contract-infer/sql-schema-ir-to-psl-ast.ts` `buildRelationField` (~L372–410): `namedArg('fields', …)`→`namedArg('from', …)`, `namedArg('references', …)`→`namedArg('to', …)`; keep bracketed/explicit form (no aggressive inference — D3); **leave `namedArg('name', …)` alone** (name retirement is S3). Wire a grep gate asserting emitted/printed PSL carries no `fields:`/`references:` relation keys.
- **Completed when:**
  - [ ] `pnpm --filter @prisma-next/sql-family test` (and psl-printer if touched) green; `contract infer` round-trip emits `from:`/`to:`.
  - [ ] Grep gate: emitted/printed PSL across the `format` + `infer` test outputs contains no `@relation(...fields:` / `references:` keys.
  - [ ] `pnpm fixtures:check` clean (rebuild dist before any integration/e2e check — stale dist masks resolver/printer edits).
- **Halt conditions:**
  - A fixture's emitted contract changes shape (not just the PSL spelling) → investigate; the contract is supposed to be unchanged (D1).

## Hand-off completeness

M3's hand-off (toolchain emits canonical; legacy never survives a round-trip) + M1's hand-off (legacy ≡ canonical contract) compose to the slice-DoD: backward-compat invariant, single-dialect output, formatter idempotence. No slice-DoD condition is unreachable from the sequence.
