# Slice: canonicalizer-family-hook (S1.D-2)

_In-project slice. Parent project `projects/contract-ir-planes/`. Outcome: the framework canonicalizer stops hardcoding SQL-shaped storage knowledge — the last SQL-specific framework path becomes a family contribution, completing the PDoD6 consumer migration. Closes [TML-2579](https://linear.app/prisma-company/issue/TML-2579)._

## At a glance

The framework's family-agnostic canonicalizer currently carries SQL/Mongo-shaped path knowledge inline: a cluster of `storage.namespaces.*.tables.*` preserve-empty guards and a storage table/index/unique sort. Move that family-specific knowledge behind a family-contributed hook so the framework canonicalizer only knows family-agnostic rules. **This is a move-don't-change refactor: canonical output must be byte-identical before and after.**

## Chosen design

The framework canonicalizer keeps the family-agnostic rules (required top-level slots, `noAction` omission, `_generated` stripping, key sort, top-level order). The SQL/Mongo-shaped rules become two optional hooks the caller (the family serializer) provides through `CanonicalizeContractOptions`:

- a **preserve-empty predicate** — "at this path/key, keep an empty object/array rather than omitting it" (today: the `tables`/`uniques`/`indexes`/`foreignKeys`/`typeParams` guards in `omitDefaults`).
- a **storage sort** — the family's deterministic ordering of storage entities (today: `sortIndexesAndUniques` + `sortTableArrays`).

The framework calls the hooks if present; a target whose storage needs no special handling supplies neither. The hooks are passed *in* by the family code, so the framework never imports family code — no dependency cycle.

## Coherence rationale

One reviewable unit: a single inversion of one dependency direction (framework-knows-SQL → family-contributes-hook) with one invariant the reviewer checks — the canonical bytes don't move.

## Scope

**In:** the framework canonicalizer's family-agnostic core and its `CanonicalizeContractOptions` hook surface; the SQL-family and Mongo-family serializers that now contribute the hooks; the emitter wiring that passes them.

**Out:** the family-agnostic omission/ordering rules (unchanged); any change to canonical output (explicitly forbidden); the other S1.D slices and the deferred items.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| Framework→family import to reach the hook | Refusal trigger | If the hook design forces framework-components (or `0-foundation/contract`) to import family code, the inversion doesn't hold. **HALT and report** — do not introduce a cycle; the slice is abandoned and TML-2579 stays open. |
| Mongo empty-collection preservation | Load-bearing | Mongo collections legitimately serialize empty; SQL tables never do. The hook must preserve the current asymmetry exactly — the Mongo family keeps empty per-table payloads. |
| Fixture / canonical-byte drift | Refusal trigger | Any movement in emitted `contract.json` or canonical hashes means the move changed behaviour. **HALT and report** — fixtures must not move. |

## Round 2 — review actions (PR #631)

The hooks landed as hand-rolled imperative logic: `shouldPreserveEmpty` is a `path[i] === X && len === N` ladder and `sortStorage` is a deeply-nested manual record-walker with per-level `as Record<string, unknown>` casts. That logic now exists in three drifting copies — the production SQL hook, the emitter test's local `sqlPreserveEmpty` / `sqlSortStorage` (already drifted: the test copy is missing the `len === 7 foreignKeys → constraint/index` clause production carries), and the Mongo production hook's predicate idiom. Review asked for shared, readable utilities. All actions stay within this slice's hook surface.

| # | Action |
|---|---|
| R1 | Extract a **framework-foundation path matcher** that takes path patterns as *data* (wildcard + tail marker), so a preserve-empty rule reads as a pattern list rather than an index/length ladder. It must NOT hardcode SQL/Mongo tokens (`'tables'`, `'indexes'`, …) — the family hooks supply those as data. |
| R2 | Extract a **framework-foundation storage-sort helper** ("sort named arrays at these sub-paths") that the SQL hook and the Mongo hook both compose. Removes the bespoke nested walker. |
| R3 | The per-level `as Record<string, unknown>` casts disappear once the walk goes through the typed helper — no bare casts remain (and none re-introduced; `lint:casts` clean). |
| R4 | Kill the test's duplicated `sqlPreserveEmpty` / `sqlSortStorage`. **Prefer** importing the real `sqlContractCanonicalizationHooks`; if `lint:deps` forbids a framework-tooling test depending on the SQL-family package, build the test predicate from the shared framework util so the *mechanism* cannot drift (only pattern data could differ). |

**Ecosystem note (R1):** a full path library (JSONPath, `lodash.get`/`_.matches`) is the wrong tool — query semantics we don't need + a foundation-layer dependency, and it still wouldn't express "preserve empty at these path shapes" cleanly. A tiny in-house pattern matcher is the right size and keeps the foundation dependency-free.

**Refusal triggers (in addition to the byte/fixture trigger above):**
- If the generic matcher cannot reproduce the production predicate without re-introducing SQL/Mongo path literals into the foundation layer, HALT and report — do not smear family path knowledge back into the framework (the "framework canonicalizer has no SQL/Mongo storage path knowledge" guard test must stay green).
- If neither importing the real hook nor building the test predicate from the shared util is layering-clean (R4), HALT and report rather than leaving a third drift-prone copy.

## Round 3 — review actions (PR #631, follow-on)

Review found the same hand-rolled `sqlPreserveEmpty` / `sqlSortStorage` logic the R1–R4 utilities replaced still living in two more test-helper sites. Apply the shared `@prisma-next/contract/hashing-utils` mechanism there too.

| # | Site | Action |
|---|---|---|
| R5 | `packages/1-framework/3-tooling/emitter/test/utils.ts` (the `sqlPreserveEmpty` + `sqlSortStorage` block) | Replace both hand-rolled functions with `createPreserveEmptyPredicate` / `createStorageSort` composed from SQL pattern data (same approach R4 used for the emitter canonicalization test). |
| R6 | `packages/1-framework/3-tooling/migration/test/assert-descriptor-self-consistency.test.ts` (the `sqlPreserveEmpty` predicate) | Replace with `createPreserveEmptyPredicate` over the SQL preserve-empty pattern data. |

**Layering:** these framework-tooling test files may import `@prisma-next/contract/hashing-utils` (foundation) but NOT the SQL-family `sqlContractCanonicalizationHooks` (`lint:deps` forbids framework/tooling → sql domain). Build the predicate/sort from the shared util + local pattern data, exactly as R4 did. The shared comparator (still `localeCompare`, deferred to TML-2732) is inherited unchanged — no behaviour change, fixtures stay zero-diff.

## Slice-specific done conditions

- [ ] `pnpm fixtures:check` shows zero diff (byte-stability is the slice's defining invariant) and the framework canonicalizer no longer references SQL/Mongo storage path shapes (grep gate over the moved guards / sort).
- [ ] Review actions R1–R4 addressed (or a refusal trigger reported): preserve-empty + storage-sort logic expressed via shared framework utilities, no bare casts, and no duplicated SQL hook logic in the emitter test.

## Open Questions

1. Hook granularity — one combined "family canonicalization contribution" object vs two independent optional hooks. Working position: two optional hooks (`preserve-empty predicate`, `storage sort`) on `CanonicalizeContractOptions`, since they're independent and a target may want one without the other. Implementer may consolidate if the wiring reads cleaner.

## References

- Parent project: [`projects/contract-ir-planes/spec.md`](../../spec.md) — PDoD6
- Linear: [TML-2727](https://linear.app/prisma-company/issue/TML-2727) (closes [TML-2579](https://linear.app/prisma-company/issue/TML-2579))
- Pattern: family-contribution mechanism established in S1.A
