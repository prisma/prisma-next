# Dispatch D14 — `DropPostgresRlsPolicyCall` op (slice `select-policies-dependable`)

Slice 1, TML-2868. Implementer tier: sonnet. The op half of the edit-replace lifecycle (D15 wires it into the planner). Mirror the existing `CreatePostgresRlsPolicyCall` / `createRlsPolicy` exactly. Commit your own work.

## Task (tests-first)

Add a `DROP POLICY` migration op + factory call, mirroring the create path:
1. **Op** in `packages/3-targets/3-targets/postgres/src/core/migrations/operations/rls.ts`: a `dropRlsPolicy` op alongside `createRlsPolicy`/`enableRowLevelSecurity`. It renders `DROP POLICY <quoted wirename> ON <schema>.<table>` (study `createRlsPolicy`'s renderer for quoting + the precheck/execute/postcheck shape). Minimal inputs: schema, table, policy wire name. A precheck that the policy exists (or `DROP POLICY IF EXISTS` — match how create handles existence; pick the idempotent-safe option consistent with the create op and note which).
2. **Factory call** in `op-factory-call.ts`: `DropPostgresRlsPolicyCall` implementing the two renderers (`toOp()` + `renderTypeScript()`) like `CreatePostgresRlsPolicyCall`; register it in the `PostgresOpFactoryCall` union.
3. **Operation class:** give the drop call the operation class that lets `db update`'s **default** policy emit it — a policy *replacement* is a security-config change, not data loss, so it must NOT be suppressed by the default policy (unlike drop-column). Read how existing calls declare their operation class + how `allowedOperationClasses`/the default `db update` policy work, and pick (or, if no fitting class exists, surface the gap rather than forcing `'data'`). Record the class you chose + why.

## Tests (in `postgres/test/migrations/rls-ops.test.ts` or a sibling)

- `dropRlsPolicy` renders the expected `DROP POLICY` SQL (quoting correct, schema-qualified).
- `DropPostgresRlsPolicyCall.toOp()` and `.renderTypeScript()` both produce the right shapes (mirror the create-call tests).
- The call's operation class is the one chosen (assert it).

## Scope

**In:** the drop op + call + class + unit tests. **Out:** planner wiring (D15), any e2e. Do NOT change `buildRlsDiffCalls` yet.

## Gates (run once, foreground)

`pnpm build` → workspace `pnpm typecheck` (green) → the new op tests + existing `rls-ops.test.ts` → `pnpm lint:deps`.

## Constraints

Explicit-staging, `tml-2868:` prefix, no amend, no push. No `any`/bare casts. Transient-ID scan. Heartbeats to `wip/heartbeats/implementer.txt`. Low budget → commit what compiles + report.
