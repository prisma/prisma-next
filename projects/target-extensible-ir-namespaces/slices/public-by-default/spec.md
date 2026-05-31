# Slice: public-by-default

_Parent project `projects/target-extensible-ir-namespaces/`. Outcome: un-namespaced Postgres models become genuine members of a real `public` namespace, so the next slice can render honest `"public"."user"` qualification instead of a faked string prefix._

## At a glance

Flip the Postgres PSL interpreter so an un-namespaced model resolves to the `public` namespace id (today it resolves to nothing and falls back to the `__unbound__` sentinel). Make `__unbound__` reachable only through the already-existing explicit `namespace unbound { … }` PSL block. Replace the two hardcoded `'public'` DDL-schema fakes with values derived from the now-real namespace, and regenerate the ~53 Postgres contract fixtures. SQLite and Mongo are untouched.

## Chosen design

**1. Interpreter default (the one decision point).** In `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts`, `resolveNamespaceIdForSqlTarget` currently returns `undefined` for an un-namespaced Postgres model (`bucketName === UNSPECIFIED_PSL_NAMESPACE_NAME`), which downstream collapses to `__unbound__`. Change that branch to return `'public'`. The explicit-opt-in branch (`bucketName === 'unbound'` → `'__unbound__'`, already present at lines ~242–244) is unchanged — `namespace unbound { … }` remains the way to land in `__unbound__` on Postgres.

```text
                          before                         after
un-namespaced PG model →  undefined → __unbound__        'public'
`namespace unbound {}`  →  '__unbound__'                  '__unbound__'  (unchanged)
`namespace auth {}`     →  'auth'                         'auth'         (unchanged)
non-postgres target     →  undefined                      undefined      (unchanged)
```

**2. TS builder parity.** `ts-psl-parity.test.ts` pins that the PSL interpreter and the TS contract builder (`build-contract.ts` ~line 316) agree. The TS builder's un-namespaced-Postgres default must move to `'public'` in lockstep, or the parity test fails. Both surfaces change together.

**3. Delete the two `'public'` DDL-schema fakes.** With `public` now a real namespace id, the two sites that string-fake a schema name should derive it from the namespace instead of hardcoding:
- `planner.ts:47` — `defaultSchema: 'public'`
- `postgres-schema.ts:176` — `ddlSchemaName` projection

The introspection/runtime fallbacks in `control-adapter.ts` (~94/266/328) and `enum-control-hooks.ts:123` are legitimate defaults for reading an existing database and are **not** in scope to delete.

**4. Regenerate fixtures.** ~53 Postgres `contract.json`/`.d.ts` fixtures move their default models from `__unbound__` to `public`. Regenerate via the fixtures machinery; `pnpm fixtures:check` clean.

**5. Upgrade instructions (folded-in, both transitions).** This branch authors the `0.11-to-0.12` upgrade entries in **both** clusters, covering two breaking changes that land in 0.12:
- **public-by-default (this slice):** un-namespaced Postgres models re-emit under `public`; consumers re-emit; `__unbound__` is now opt-in via `namespace unbound {}`.
- **domain-plane backfill (the merged TML-2751 slice, which shipped no entry):** `contract.models` / `contract.valueObjects` moved under `contract.domain.namespaces.<ns>` — user cluster re-emits; extension-author cluster also covers the removed `@prisma-next/contract/testing` subpath (factories now live in `@prisma-next/test-utils`).

## Coherence rationale

One theme: "make `public` a real Postgres namespace." The interpreter flip, the TS-parity change, the two DDL-fake deletions, and the fixture regen are inseparable — flipping the default without regenerating fixtures (or without the parity change) leaves the tree red, and the DDL fakes are only safe to remove once the namespace is genuinely `public`. The upgrade entries ride along because they describe exactly the contract-shape changes this branch (and the un-recorded predecessor) produce in the same `0.11 → 0.12` minor.

## Scope

**In:**
- `interpreter.ts` `resolveNamespaceIdForSqlTarget` Postgres default → `'public'`.
- TS builder parity (`build-contract.ts`).
- `planner.ts` / `postgres-schema.ts` DDL-schema-name derivation (delete the two `'public'` fakes).
- Postgres fixture regeneration (~53) + tests pinning old `__unbound__`-for-Postgres / parity behaviour.
- `0.11-to-0.12` upgrade entries (public-default + domain-plane backfill), both clusters.

**Out:**
- **Runtime SQL query qualification** (rendering `"public"."user"` on the query path) — that is `runtime-qualification` (TML-2605, PDoD5). This slice makes `public` real and honest at authoring/DDL; it does not add the per-family query-time façade.
- **SQLite / Mongo default namespaces** — they keep `__unbound__`; the interpreter's `targetId !== 'postgres'` guard isolates them.
- **Transitional projection helpers** (`contractModels` / `resolveSingleDomainNamespaceId` / `ContractModelsMap`) — owned by `runtime-qualification`.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| Deleting the two DDL `'public'` fakes leaves Postgres migration/DDL emission unqualified before `runtime-qualification` lands | **Investigate at dispatch** | The fakes are DDL-schema-naming, not query-path. Working assumption: they derive cleanly from the real `public` namespace and migrations stay schema-qualified. If removing them can't stay green without reaching into query-path qualification (PDoD5), that's the slice boundary — STOP and report rather than pulling runtime-qualification work forward. |
| `ts-psl-parity.test.ts` fails if only PSL changes | **Known** | TS builder default must change in lockstep (design item 2). |
| domain-plane shipped no upgrade entry; CI passed because the `0.11-to-0.12/` dir already existed | **Known (this slice backfills it)** | `check:upgrade-coverage` only asserts directory existence, not per-PR entry presence. |

## Slice-specific done conditions

- [ ] Un-namespaced Postgres model emits under `public`; `namespace unbound { … }` round-trips to `__unbound__`; SQLite/Mongo fixtures unchanged (grep gate).
- [ ] `pnpm fixtures:check` clean after regeneration; no fixture still shows a Postgres default model under `__unbound__`.
- [ ] `0.11-to-0.12` upgrade entries present in **both** clusters covering public-default **and** the domain-plane namespace reshape (+ removed `testing` subpath in the extension cluster).

## Open Questions

1. Do the two DDL `'public'` fakes derive cleanly from the real namespace, or does removing them require partial query-path qualification (PDoD5 scope)? Working position: **clean derivation; if not, report at the slice boundary rather than pulling runtime-qualification forward.**
2. Should `__unbound__` on Postgres now warn/error at interpret time (since it's an unusual explicit choice), or stay silent? Working position: **stay silent** — `namespace unbound {}` is a deliberate, self-documenting opt-in (per the explicit-opt-in-over-diagnostics rule).

## References

- Parent project: `projects/target-extensible-ir-namespaces/spec.md` (PDoD4, FR4)
- Linear issue: [TML-2760](https://linear.app/prisma-company/issue/TML-2760) (blocks [TML-2605](https://linear.app/prisma-company/issue/TML-2605))
- Predecessor (merged, no upgrade entry): [TML-2751](https://linear.app/prisma-company/issue/TML-2751) — domain-plane
- ADR 221 — Contract IR two planes
- `record-upgrade-instructions` skill — authoring workflow for the `0.11-to-0.12` entries
