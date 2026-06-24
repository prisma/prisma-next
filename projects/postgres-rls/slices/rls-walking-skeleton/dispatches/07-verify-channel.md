# Dispatch D7 — verify extension channel (rls-walking-skeleton)

Slice `rls-walking-skeleton` (TML-2868), dispatch 7 of 8. Implementer tier: sonnet. Builds on D2 (`diffNodes`), D3 (introspection). **This is the architectural crux** — read § Halt conditions first. Commit your own work; if low on budget, commit what compiles + report remaining.

## Task

Surface RLS drift through verification as **generic** `SchemaDiffIssue`s in a **separate channel**, with the RLS-specific work living only in the Postgres target — the framework and SQL-family must stay RLS-agnostic. Authoritative detail: **slice spec §6-H**.

1. **Generic channel (framework, RLS-agnostic).** Add `extensionIssues: readonly SchemaDiffIssue[]` to the verify result `schema` object (`VerifyDatabaseSchemaResult.schema` in `framework-components/src/control/control-result-types.ts`, ~162-171). `SchemaDiffIssue` is the generic type from D2 — **no RLS knowledge**. Default it to `[]` so existing callers are unaffected.
2. **Generic target hook.** The Postgres verify path must contribute RLS diff issues into `extensionIssues` **without** putting RLS into the SQL-family `verifySqlSchema`. Preferred shape: the Postgres adapter's verify wrapper (the thing the cross-namespace test reaches via `familyInstance.verifySchema(...)` — confirm the exact seam from the seam research) calls the family `verifySqlSchema` for the relational part, then runs the **RLS diff** — `diffNodes(expectedFromContract, actualFromAnnotations)` over policies (reuse the D6 `buildRlsDiffCalls` reader / `readPostgresSchemaIrAnnotations`) — and merges the resulting `SchemaDiffIssue[]` into `extensionIssues`. If `verifySqlSchema` itself must take a generic target-issue callback to make this clean, that callback's type is `SchemaDiffIssue[]`-returning and RLS-agnostic (the framework/SQL-family never name RLS).
3. **`missing`/`extra` both surface here** (verify reports drift both ways); `mismatch`/rename/tamper severity is slice 3 — for this slice, emitting `missing`/`extra` `SchemaDiffIssue`s is enough.

## Scope

**In:** the generic `extensionIssues` field + the Postgres-side hook that fills it via `diffNodes` + a PGlite verify test. **Out:** the end-to-end walking-skeleton spine (D8); control-policy severity for RLS (slice 3); SQLite/Mongo untouched.

## Completed when

- [ ] `VerifyDatabaseSchemaResult.schema.extensionIssues: readonly SchemaDiffIssue[]` exists, defaults `[]`, is **generic** (grep: no RLS symbol in the framework/SQL-family change).
- [ ] PGlite verify test: declare a policy in the contract + apply it (or `CREATE POLICY` manually), `introspect()`, verify → `extensionIssues` empty (clean); then declare-but-don't-apply → exactly one `missing` `SchemaDiffIssue` at the policy's coordinate; (optional) apply-an-extra → one `extra`.
- [ ] The Postgres verify path produces these via `diffNodes` (generic), not a framework `SchemaIssue`.
- [ ] Gates (run once): typecheck (framework + postgres adapter; `pnpm build` first if dist needed); the new verify test; `pnpm lint:deps`; **no RLS symbol** in any `packages/1-framework`/`packages/2-sql` file (grep).

## Standing instruction

Tests-first. The differ + the issue type are generic; ALL RLS-specific glue (introspection read, expected read, diffNodes call) lives in the Postgres target. The framework only gains a generic `SchemaDiffIssue[]` field + (if needed) a generic callback type.

## Halt conditions (THE crux — surface, do not improvise)

- **If the only way to run the Postgres RLS verify step is to put RLS knowledge into a framework or SQL-family file (`verifySqlSchema`, the SPI, the result type beyond a generic `SchemaDiffIssue[]` field), STOP and surface.** This is the architecture's load-bearing seam; re-introducing the leak is the exact failure we rebuilt to avoid. If the generic `extensionIssues` channel + a generic target hook is insufficient, that's an escalation, not a workaround.
- The verify seam can't carry a generic target callback / the Postgres adapter can't post-process the family result — surface.

## Commit hygiene

Explicit staging; `tml-2868:` prefix; no amend, no push. Commit your own work.

## References

- **Authoritative:** slice spec §6-H + §8 (halt). Seam: the verify pipeline (`verifySqlSchema` is the production verifier; `familyInstance.verifySchema(...)` is the entry the cross-namespace test uses — find where the Postgres adapter participates). Reuse the D6 reader + `readPostgresSchemaIrAnnotations` (D3) + framework `diffNodes` (D2).
- Heartbeat: `wip/heartbeats/implementer.txt`.

## Operational metadata

- **Model tier:** sonnet — one generic field + a target hook + a PGlite verify test. The risk is the seam, not the volume.
- **Time-box:** ~75 min. Overrun → halt and surface.
