# Brief: D5 adapter-consume-transaction-join

## Task

Complete the adapter's advanced surface: (1) **native `consumeOne`** implemented on `Collection.delete()` — the atomic find-first + identity-narrowed `DELETE … RETURNING` inside one transaction — **such that** two concurrent `consumeOne` calls for the same matching row can never both receive it (the loser gets `null`); (2) **`transaction` config** wired onto the prisma-next runtime's transaction API **such that** BetterAuth's multi-operation flows roll back atomically when a later operation throws (no fake flag — the config's transaction executes the callback's adapter operations inside one database transaction); (3) **native `join` support** on `findOne`/`findMany` translating BetterAuth's join parameter onto `Collection.include()` over the space's navigable relations — **such that** a join the contract can express runs as the ORM's parent-anchored relation read (never BetterAuth's separate-queries fallback), and a join target with no contract relation fails fast with a typed error. Re-verify the installed v1.6 types for the exact `consumeOne` / `transaction` / join signatures (they are authoritative; you already noted `CustomAdapter.consumeOne` is optional with a factory fallback).

## Scope

**In:** `packages/3-extensions/better-auth/src/adapter/**` (extend), `src/exports/adapter.ts` (surface additions), package tests (`test/adapter-*.test.ts`): concurrency test for `consumeOne` (parallel calls over real PGlite; exactly one winner), rollback test for `transaction` (operation sequence with an induced failure → no partial writes observable), join tests (session-with-user through `include()`; typed error for non-relation join target; verify the factory receives natively-joined rows rather than issuing follow-up queries — assert at whatever seam makes that discriminating, e.g. a query-counting middleware or driver spy if the runtime exposes one cheaply).

**Out:** `test/integration/**` (D6); `BetterAuthDb` surface redesign beyond adding the members these features need (e.g. `transaction`, `include` on the structural collection); contract/space changes; framework packages.

## Completed when

- [ ] `consumeOne` ships natively; the parallel-consumption test proves single-winner semantics over PGlite ("fails iff" — removing the atomicity, e.g. naive find-then-delete without the transactional narrowing, would flunk it).
- [ ] `transaction` config is real: the rollback test proves an aborted flow leaves no partial writes; config no longer declares `transaction: false`.
- [ ] `join` on `findOne`/`findMany` runs through `include()` with typed failure for unmapped join targets; the discriminating assertion shows native joining (not fallback).
- [ ] Gates: package build + test + typecheck (incl. test project) + lint; workspace `pnpm typecheck`; `pnpm lint:deps`.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes with a one-line note; drift halts and surfaces.

## References

(Resumed — new context only.)

- Slice plan § D5; project spec § Settled decisions (`consumeOne` mechanism verified against `sql-orm-client` source — `Collection.delete()` is the atomic primitive; `include()` is the join primitive).
- Your own D4 § 3(c) notes: v1.6.23 optional `CustomAdapter.consumeOne`, factory fallback semantics, `transaction` config slot.
- `sql-orm-client`: `Collection.delete()` (find-first + narrowed DELETE RETURNING in `withMutationScope`), `Collection.include()` (parent-anchored single-query relation reads), runtime `transaction()` exposure (grep the runtime facade / `withMutationScope` for how an outer transaction scopes collection calls — the supabase `RoleBoundDb.transaction` is a precedent for exposing it).
- Calibration: F5, F14, F17 (properties over mechanics — the three "such that" clauses are the win), F13/test-overlay (each new test must discriminate; describe your deliberate-red for all three features), no-bare-casts.

## Operational metadata

- **Model tier:** orchestrator — concurrency + transaction semantics are judgment-heavy.
- **Time-box:** 2 h. Overrun → halt with snapshot.
- **Halt conditions:** the runtime cannot scope adapter collection calls inside a caller-provided transaction without framework changes (surface — do not fork the runtime); better-auth's transaction contract is incompatible with the runtime's (falsified assumption); `include()` cannot express the join shapes the factory emits (surface with the concrete shape); diff exceeds ~15 files.
- **Progress notes:** heartbeats at phase transitions.
