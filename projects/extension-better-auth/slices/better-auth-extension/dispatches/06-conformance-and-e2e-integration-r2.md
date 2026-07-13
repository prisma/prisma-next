# Brief: D6 R2 (resumed) — cascade authorized; narrow the conformance gate

Operator decisions on your three findings (recorded in `code-review.md § Orchestrator notes`):

1. **Cascade authorized (1a).** The slice spec now pins `onDelete: Cascade` on `Session.userId` / `Account.userId` (falsified transcription of BetterAuth's canonical schema). Implement in the contract space: PSL `onDelete: Cascade`, re-emit space artifacts (contract.json/d.ts), regenerate the baseline migration + `refs/head.json` (storage hash changes — this is the authorized exception to "space frozen"), update descriptor/handle/consistency tests as needed, and the D2 lifecycle test's FK assertions (they assert whole-shape `pg_constraint` — cascade will surface there).
2. **Include-decode fix is on its own branch/PR (TML-3015, pending push/merge).** On THIS branch, narrow the conformance gating: run the conformance file always-on with ONLY the decode-dependent join tests disabled via `disableTests`, each reason pointing at TML-3015; remove the `BETTER_AUTH_CONFORMANCE=1` env gate. The upstream transaction-wrapper tests stay disabled with the documented upstream-bug reason (our own rollback tests cover the property).
3. **`generateId`-leak test** stays disabled with its reason (harness bug precedent: the shipped joins suite omits it too).

## Completed when

- [ ] Space ships cascade FKs; fresh-DB lifecycle test green with cascade visible in the `pg_constraint` whole-shape assertion; `db update` no-op at head against the regenerated baseline; `pnpm fixtures:check` clean.
- [ ] Conformance file runs always-on in `pnpm test:integration`; the only disabled tests are: decode-dependent joins (TML-3015 reasons), transaction-wrapper tests (upstream-bug reason), `generateId` leak (harness-bug reason), and the documented non-goal categories. Everything else green — report the pass count.
- [ ] Gates: package tests + typecheck + lint (better-auth pkg), integration package targeted files (lifecycle + conformance + e2e) green, workspace `pnpm typecheck`, `pnpm lint:deps`, `pnpm fixtures:check`.

Halt conditions: any newly-failing conformance test outside the four documented disable categories; storage-hash regen breaking the D2 test in a way cascade doesn't explain. Time-box 75 min.
