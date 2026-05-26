# Plan

One PR, two commits.

Rationale for the two-commit shape: the convenience wrappers in `packages/3-extensions/` import `RuntimeVerifyOptions` from the SQL runtime SPI. Splitting "SPI + impl + tests" and "wrappers" into separate commits would leave the workspace in a non-typechecking state between them, which violates the per-commit DoR the plan would otherwise pin. All code changes therefore land in one commit; docs / changelog / ADR land in a follow-up commit so the PR's history is still legible.

## Commit 1 — All code changes (SPI + impl + wrappers + tests)

### Runtime SPI

- `packages/2-sql/5-runtime/src/runtime-spi.ts` — remove `RuntimeVerifyOptions`; add `export type VerifyMarkerOption = 'onFirstUse' | false`.
- `packages/2-sql/5-runtime/src/exports/index.ts` — re-export `VerifyMarkerOption`; drop the `RuntimeVerifyOptions` re-export.

### Runtime impl

- `packages/2-sql/5-runtime/src/sql-runtime.ts` — rename `verify` field on `RuntimeOptions` / `CreateRuntimeOptions` to `verifyMarker?: VerifyMarkerOption`; default to `'onFirstUse'` when absent; rewrite `verifyMarker()` body to log via `this.log.warn(...)` instead of throwing; collapse mode branching in the constructor and `streamRows` (only one fire path remains).

### Convenience wrappers

- `packages/3-extensions/sqlite/src/runtime/sqlite.ts` — replace the `verify?: RuntimeVerifyOptions` field on `SqliteOptionsBase` with `verifyMarker?: VerifyMarkerOption`; remove the `?? { mode: 'onFirstUse', requireMarker: false }` default literal (let `createRuntime`'s own default apply when the caller omits the option).
- `packages/3-extensions/postgres/src/runtime/postgres.ts` — same shape change.
- `packages/3-extensions/postgres/src/runtime/postgres-serverless.ts` — same shape change.

### Tests

- `packages/2-sql/5-runtime/test/marker-verification.test.ts` — rewrite assertions: every "throws" expectation becomes a "log.warn called with structured payload" expectation. Add two new test cases:
  - `verifyMarker: false` ⇒ marker reader is never called (spy assertion).
  - Mismatch ⇒ runtime emits exactly one log line for N queries (one-shot semantics).
- `packages/2-sql/5-runtime/test/marker-vs-intercept-ordering.test.ts` — storage-hash-mismatch case flips from throw-assertion to log-assertion. The intercept-ordering invariant (verification fires before middleware intercepts) is preserved and re-asserted.
- `packages/2-sql/5-runtime/test/sql-runtime.test.ts`, `sql-runtime-abort.test.ts`, `intercept-decoding.test.ts`, `scope-plumbing.test.ts`, `async-iterable-result.test.ts`, `prepared.test.ts`, `runtime-ctx-passthrough.test.ts` — replace `verify: { mode: 'onFirstUse', requireMarker: false }` literals. Most callers can omit the field entirely (the default does the right thing); keep `verifyMarker: false` only where the test explicitly relies on skipping the marker read.
- `packages/3-extensions/postgres/test/postgres-serverless.test.ts` — replace literal.

### Not in this commit

- _Framework errors module_: no edits. The `'CONTRACT.MARKER_*'` strings are inline `runtimeError` arguments only, not central enum entries. The CLI's separate `VERIFY_CODE_MARKER_MISSING = 'PN-RUN-3001'` is unrelated and stays as-is.
- _Docs / changelog / ADR_: see Commit 2.

### DoD

- `pnpm --filter @prisma-next/sql-runtime test typecheck` green.
- `pnpm --filter @prisma-next/sqlite-extension typecheck` green.
- `pnpm --filter @prisma-next/postgres-extension test typecheck` green.
- `pnpm test:packages` green (broader workspace not broken).
- New test cases (skip-when-false, one-shot semantics) passing.
- `pnpm lint:deps` clean (no new layering violations).

## Commit 2 — Docs + changelog

Files:

- `packages/2-sql/5-runtime/README.md` — update the example snippet currently showing `verify: { mode: 'onFirstUse', requireMarker: false }`. The replacement omits the option entirely (default is `'onFirstUse'`); a second snippet shows `verifyMarker: false` for the opt-out case. Update the "RuntimeVerifyOptions" reference in the symbol table to `VerifyMarkerOption`.
- Per-package CHANGELOGs for `@prisma-next/sql-runtime`, `@prisma-next/sqlite-extension`, `@prisma-next/postgres-extension` — call out the breaking change with the migration snippet:

  ```
  Before: verify: { mode: 'onFirstUse', requireMarker: false }
  After:  verifyMarker: 'onFirstUse'   // or omit entirely (this is the default)

  Before: verify: { mode: 'always', requireMarker: true }
  After:  verifyMarker: 'onFirstUse'   // 'always' is dropped; throw-on-mismatch
                                       // is no longer supported (drift now logs
                                       // a warning and queries proceed).
  ```

- Possibly: an addendum / amendment to ADR 021 (Contract Marker Storage) and/or ADR 042 (Contract Marker Evolution) noting the runtime-side behaviour change. The marker write path is unchanged; only the read-side response shifts. Likely a short Decisions section addition rather than a new ADR.

### DoD (Commit 2)

- README example compiles (`pnpm fixtures:check`).
- Changelogs updated.
- ADR amendment (or new entry) merged with the code change.

## Whole-slice DoD

- `pnpm test:packages typecheck lint:deps` green at the slice tip.
- Manual smoke: run the sqlite example with `verifyMarker: false` ⇒ no marker read; run with default + intentionally divergent contract ⇒ one `warn`-level log line, queries proceed normally.
- PR description is the slice spec (`projects/tml-2680/spec.md`) plus a Linear back-link.
