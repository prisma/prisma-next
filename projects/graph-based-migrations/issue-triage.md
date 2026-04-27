# Issue Triage

Issues discovered during project work, captured for later investigation and potential Linear ticket creation.

---

## Marker SQL definition duplicated across domains and inlined in tests

**Discovered:** 2026-04-27 | **Severity:** medium

**Observed:** The Postgres marker table's SQL (DDL, read SELECT, write input shape) is restated in at least four places that don't import each other. The marker-row parser has the same problem in two places. Future schema changes have to land in every copy in lockstep; missing one causes runtime errors against tables created by another copy. This bit M1 ([TML-2328](https://linear.app/prisma-company/issue/TML-2328)) — adding the `invariants` column to the migration-side definitions broke 24 integration tests because the runtime-side and inline test DDLs still used the 7-column shape.

**Location:**

Marker SQL definitions (DDL + read + write):

- `packages/3-targets/3-targets/postgres/src/core/migrations/statement-builders.ts` — migration-side, used by `target-postgres` runner during `migration apply` / `db update` / `db init`
- `packages/2-sql/5-runtime/src/sql-marker.ts` — runtime-side, used by `@prisma-next/sql-runtime` when an app's runtime verifies/signs the marker
- `packages/3-mongo-target/1-mongo-target/src/core/marker-ledger.ts` — Mongo equivalent, parallel definition in the Mongo domain
- Inline `CREATE TABLE prisma_contract.marker (...)` blocks in `test/integration/test/cli.db-init.e2e.test.ts`, `test/integration/test/cli.db-init.e2e.errors.test.ts`, `test/integration/test/cli.db-sign.e2e.test.ts`

Marker-row parser (arktype schema + camelCase mapping):

- `packages/2-sql/9-family/src/core/verify.ts` — migration-side parser
- `packages/1-framework/4-runtime/runtime-executor/src/marker.ts` — runtime-side parser, parallel arktype schema

**Impact:** Schema changes to the marker silently break consumers in domains the author forgot to update. The breakage looks like a Postgres "column does not exist" error at runtime, surfaced through whichever domain reads first. Tests catch it only if they exercise the cross-domain path; pure-domain unit tests pass against their own (incomplete) DDL. The likelihood of this recurring scales with the number of marker schema changes — and invariant-aware routing has more coming (M2/M3/M4 may add provenance fields, signed columns, etc.).

The duplication is structural, not accidental: `architecture.config.json` says framework can't import from sql, sql can't import from runtime, etc. Each domain that touches the marker re-states the schema rather than crossing the layering boundary.

**Suggested fix:**

The right architectural answer is to move the marker SQL into a shared package both the migration and runtime domains may import. Candidates:

- Extend `@prisma-next/contract` (framework foundation) — already houses `ContractMarkerRecord`, the camelCase TS shape. Adding the SQL DDL/SELECT/INSERT/UPDATE statement builders + the arktype row schema + the parser would centralise everything. Caveat: framework foundation is target-agnostic; pulling SQL-shaped artifacts in is a layering smell of a different kind.
- New package `@prisma-next/sql-marker-shared` (under `2-sql/0-core/` or similar) that both `target-postgres` and `sql-runtime` depend on. Keeps the SQL knowledge in the SQL domain; framework consumers (e.g., `runtime-executor`'s parser) would still need a separate path.
- Mongo equivalent (`@prisma-next/mongo-marker-shared` or similar) to remove the third copy.
- Sweep the inline test DDLs to use the shared module's `ensureTableStatement` instead of hand-rolled SQL.

Mid-term mitigation that doesn't require the refactor: a cross-domain contract test (parameterised over Postgres + Mongo behind a common harness) that exercises the read/write path of both runners against real DBs. Sketched in chat during M1 review; would have caught the M1 gap before merge.

Short-term reviewer rule: any PR that changes the marker schema must touch all four+ files, and reviewers explicitly check both migration and runtime sides plus any inline DDL in tests.

**Context:**

- Discovered while running the CI test suite for `feat/marker-invariants` (M1 of invariant-aware-routing). Initial test:integration run had 24 failures clustered in marker-related tests; root cause was the parallel definitions still being on the 7-column shape.
- Related: [TML-2328](https://linear.app/prisma-company/issue/TML-2328) (M1 marker storage), [TML-2297](https://linear.app/prisma-company/issue/TML-2297) (umbrella for invariant-aware routing).
- The same layering pattern produced the parallel parser duplication noted earlier in M1 review (chat discussion of `verify.ts` vs `runtime-executor/marker.ts`).
- See `architecture.config.json` `crossDomainRules` for why the duplication exists.

---
