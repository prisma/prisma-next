# Brief: D9 — Close the end-to-end test gap on the `lowerToExecuteRequest` query branch

## Why this exists (read first)

Commit `00e7190bf` made the control adapters' `lowerToExecuteRequest` query branch codec-encode its literal params (was: raw passthrough), and routed Postgres `dataTransform` through it. An independent review confirmed the encoding is correct but found a **test gap**: the only test that proves encoding actually happens calls the *helper* `encodeControlQueryParams(lowered, ast, testRegistry)` with an explicitly-handed registry. **No test proves that `adapter.lowerToExecuteRequest(queryAst)` end-to-end encodes** — i.e. that the adapter method wires the right registry into the helper. (The DDL branch *does* have this end-to-end proof; the query branch doesn't.)

Close that gap. This is a **test-only** dispatch — do not change the production encoding behaviour.

## Scope decision you are implementing (do not widen)

We are NOT making the query branch honor extension/custom codecs in this dispatch. That is a separate, prospective follow-up (the query branch uses the builtin `CONTROL_CODECS`; an extension-codec param in a `dataTransform` throws `CODEC_DESCRIPTOR_MISSING` — fail-loud, strictly better than the pre-PR silent raw passthrough, and symmetric with the SQLite control adapter being builtin-only even for its DDL branch). The end-to-end proof here uses a **builtin** codec that observably transforms its input, which is sufficient to prove the method-level wiring.

## The test to add (both targets)

In each `lower-to-execute-request.test.ts` query-branch describe block, add an **end-to-end** test that calls `adapter.lowerToExecuteRequest(queryAst)` (NOT the helper directly) where the bound literal sits on a column whose **builtin** codec observably transforms the raw JS value, and assert the encoded wire value is what lands in `params` — not the raw JS value.

**SQLite** — use the builtin `jsonText` codec (`SQLITE_JSON_CODEC_ID`), whose `encode` is `JSON.stringify` (it's already in `CONTROL_CODECS`; marker-ledger relies on it):
```ts
const t = sqliteTable('things', { meta: jsonText(), name: text() });
const ast = t.select(t.name).where(t.meta.eq({ key: 'val' })).build();
const result = await adapter.lowerToExecuteRequest(ast, ctx); // real adapter, no injected registry
expect(result.params).toContain('{"key":"val"}');   // encoded
expect(result.params).not.toContainEqual({ key: 'val' }); // raw object absent
```
(Confirm the param actually reaches the query branch as a column-bound literal so `deriveParamMetadata` resolves the jsonText codecRef. If `eq({...})` doesn't bind it as expected, use a `where`/`update` shape that does — mirror how marker-ledger builds its encoded INSERT.)

**Postgres** — pick an analogous **builtin** codec whose `encode` observably changes the value or its JS type (inspect `packages/3-targets/3-targets/postgres/src/core/codecs.ts` + `codec-helpers.ts`). If a clean object→string builtin isn't reachable, use a timestamp column and a JS `Date` literal and assert the encoded param is **not** a `Date` instance (proving the codec ran):
```ts
expect(result.params[0]).not.toBeInstanceOf(Date);
expect(typeof result.params[0]).toBe('string'); // or number — whatever the pg timestamp codec emits
```
The point is a method-level assertion that the raw JS value did NOT pass through untouched.

Keep the existing helper-level transforming-codec test (it proves the synthetic-codec path) AND keep the existing no-codec smoke test. You are ADDING the end-to-end assertion, not replacing the others.

## Optional tidy (only if trivial)

The shared bind-slot throw in `control-codecs.ts` lost the Postgres `dataTransform`-specific wording. No test depends on it. If you can keep the generic message AND have `data-transform`'s caller add context cheaply, fine; otherwise leave it — not worth churn.

## Gates (all must pass)

`pnpm build` · `pnpm typecheck` · `pnpm test:packages` (the two new end-to-end tests must genuinely fail if the production query branch is reverted to raw passthrough — sanity-check by eye that the assertion can't pass without encoding) · `pnpm fixtures:check` (clean) · `pnpm lint:deps` (standalone) · `pnpm lint:casts` (delta 0; tests are cast-exempt but don't add needless ones) · `pnpm test:integration` · `pnpm test:e2e`. Known ignorable: PG `portal "C_n" does not exist` flake (passes in isolation); `init-journey.e2e.test.ts` "Failed to load config" (pre-existing, environmental).

## Commit

One commit, explicit staging, DCO `-s`, `--no-verify` (lint:deps OOMs in hook — run standalone first), do NOT set `GIT_AUTHOR_*`, do NOT push. Message:

```
TML-2867: prove lowerToExecuteRequest query branch encodes end-to-end

The query-branch encode was only proven at the helper level. Add an end-to-end
test per target that calls adapter.lowerToExecuteRequest on a query binding a
literal whose builtin codec observably transforms the value, asserting the
encoded wire value lands in params and the raw JS value does not.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```

## Report back

Per-gate pass/fail; the commit SHA; the exact codec/column you used for each target's end-to-end assertion and why it's a genuine (revert-would-fail) proof; confirmation you did NOT change production encoding.
