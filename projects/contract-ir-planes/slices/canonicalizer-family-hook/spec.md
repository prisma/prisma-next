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

## Slice-specific done conditions

- [ ] `pnpm fixtures:check` shows zero diff (byte-stability is the slice's defining invariant) and the framework canonicalizer no longer references SQL/Mongo storage path shapes (grep gate over the moved guards / sort).

## Open Questions

1. Hook granularity — one combined "family canonicalization contribution" object vs two independent optional hooks. Working position: two optional hooks (`preserve-empty predicate`, `storage sort`) on `CanonicalizeContractOptions`, since they're independent and a target may want one without the other. Implementer may consolidate if the wiring reads cleaner.

## References

- Parent project: [`projects/contract-ir-planes/spec.md`](../../spec.md) — PDoD6
- Linear: [TML-2727](https://linear.app/prisma-company/issue/TML-2727) (closes [TML-2579](https://linear.app/prisma-company/issue/TML-2579))
- Pattern: family-contribution mechanism established in S1.A
