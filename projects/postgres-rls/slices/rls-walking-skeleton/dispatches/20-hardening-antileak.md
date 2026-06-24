# Dispatch D20 — F03 + F07 hardening + structural anti-leak test (slice `select-policies-dependable`)

Slice 1, TML-2868. Implementer tier: sonnet. The **final slice-1 dispatch**: two small review-finding fixes + the layering-invariant guard the architect pass made mandatory. Findings detail: `projects/postgres-rls/slices/rls-walking-skeleton/reviews/pr-771/code-review.md` (F03, F07) + `system-design-review.md` (the anti-leak test). Commit your own work; the three items are independent — commit incrementally if budget runs low.

## F03 — role-name rendering is injection-fragile

`renderCreatePolicySql` (Postgres migrations, the `CREATE POLICY ... TO <roles>` rendering) emits roles via a quote-then-strip shim `quoteIdentifier(r).replace(/^"|"$/g, '')` — strips the quotes back off, so a role name containing `"`, whitespace, or `;` would break out into raw DDL. Benign today (roles come from PSL identifiers) but unconstrained at the type level. **Fix (minimal — full role handling is slice 4):** validate role names are plain SQL identifiers at the lowering/rendering boundary and **throw a clear error** on anything that isn't (e.g. `^[A-Za-z_][A-Za-z0-9_$]*$`), instead of the quote-strip hack. Don't build real role escaping/quoting (slice 4) — just close the injection surface by rejecting non-identifier role names with a useful message. Add a unit test: a role name with a quote/space/`;` is rejected; a normal identifier renders correctly.

## F07 — `rlsEnabledByTable` keyed by bare table name (cross-schema collision)

Introspection (`6-adapters/postgres/src/core/control-adapter.ts`) populates `rlsEnabledByTable[row.relname]` (bare table name), but the planner (`planner.ts buildRlsDiffCalls`) reads/dedups with a `${schemaName}.${tableName}` key — and two tables of the same name in different schemas collide. **Fix:** key `rlsEnabledByTable` consistently by the schema-qualified name (`${schema}.${table}`) at the introspection write site and the planner read site. Add/extend a test proving two same-named tables in different schemas don't collide on RLS-enabled state (unit-level is fine).

## Anti-leak structural test (architect-pass; mandatory — lint:deps can't catch this class)

The headline invariant — **no RLS symbol in `packages/1-framework` or `packages/2-sql`** — is currently only review-enforced. Add a structural test that fails on regression. Put it where repo-structure/invariant tests live (or a new test in framework-components / a repo-level test). It should scan the source of `packages/1-framework/**` and `packages/2-sql/**` (production `src`, excluding tests + excluding prose in comments/markdown if feasible — at minimum exclude `.test.ts`) and assert no RLS identifiers appear: e.g. `RlsPolicy`, `RlsMode`, `rowsecurity`, `pg_policies`, `policy_select`, `\bRLS\b`, `prismaManaged`. Allow legitimate generic tokens (the differ, `extensionEntities`, `extensionIssues` — those are generic). If pre-existing **doc-comments** mention RLS (the architect pass noted some), either scope the scan to code (not comments) or curate a tiny explicit allowlist of those comment lines with a note — do NOT weaken the test to uselessness. The test must genuinely fail if someone adds an RLS type/field/value to a shared layer.

## Completed when

- [ ] F03: non-identifier role names rejected with a clear error (test proves it); normal identifiers still render.
- [ ] F07: `rlsEnabledByTable` schema-qualified end-to-end; collision test passes.
- [ ] Anti-leak test present and genuinely failing on a planted RLS symbol in a shared layer (sanity-check it by temporarily adding one locally, confirm red, remove).
- [ ] Gates (run once): `pnpm build`; workspace `pnpm typecheck`; the new/affected tests + the RLS suites (planner/lifecycle/verify) still green; `pnpm lint:deps`.

## Constraints

Explicit-staging — never stage `test/integration/.../cipherstash-encrypted-*` or `trace.jsonl`. `tml-2868:` prefix, no amend, **no push**. No `any`/bare casts. Transient-ID scan. Heartbeats to `wip/heartbeats/implementer.txt`.

## Return shape

Each of the three items (what changed + the test); the anti-leak test's planted-symbol sanity check result; gate results; `git show --stat HEAD` (no cruft); commit SHA(s); anything surprising. Begin.