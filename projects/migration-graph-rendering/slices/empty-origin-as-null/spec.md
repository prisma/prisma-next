# Slice: stop spelling the empty-contract origin as a fake hash

_Parent project `projects/migration-graph-rendering/`. Outcome this slice contributes to: the "no origin" state (the very first migration, from ∅) is modelled inconsistently. The read boundary models it honestly as `null` (`LedgerEntryRecord.from: string | null`), but the storage/graph layer spells it `sha256:empty` — a string that is **not a valid sha256 hash** masquerading as one. A coercion helper (`ledgerOriginFromStored`) exists only to bridge the two. This slice removes the typology lie so ∅ has one honest representation._

## At a glance

The same "no origin" fact, spelled three ways:

```ts
// read boundary — honest: null means "no origin"
interface LedgerEntryRecord {
  readonly from: string | null;   // ∅ ⇒ null
  // …
}

// storage / graph — a fake hash used as an in-band node key
const EMPTY_CONTRACT_HASH = 'sha256:empty';   // not a real sha256

// the bridge that only exists because of the divergence
ledgerOriginFromStored(stored);   // '' | 'sha256:empty' | null → null
```

The question this slice answers: _if `from` permits `null`, why does `sha256:empty` exist at all?_

## Chosen design

Deferred — the **shape** of the fix is settled, the exact cut is chosen at pickup because the blast radius reaches the graph layer. Two candidate cuts:

1. **Model ∅ as `null` end-to-end.** Graph nodes keyed by `string | null`, edge `from` nullable, no sentinel anywhere. Honest, but the largest blast radius: `migration-graph` (the node map keys nodes by string hash), `graph-walk`, `check-integrity`, and the renderer all assume a non-null string key today.
2. **Keep a sentinel but drop the misleading `sha256:` prefix** (e.g. a bare `∅` / `empty` token). Smaller than (1), but still touches every site that compares against or emits the constant, and a sentinel string is still a weaker model than `null`.

The operator has ruled that the **constant's value is owned by the graph/storage layer** ("not our fight" — TML-2769 review): this slice is about the **typology honesty at the boundary**, not about unilaterally reformatting a value the graph layer depends on. So the realistic scope is: pick the cut with the graph layer's owner, then land it.

Cheap immediate win, independent of the cut (can land first):

- **One-line doc note on `LedgerEntryRecord.from`** explaining `null` = ∅, and that the storage/graph spelling (`sha256:empty`) is normalised to `null` on read by `ledgerOriginFromStored`. Stops the next reader asking the same question.

Already done in TML-2769 / PR #665 (not re-litigated here): the constant was **deduplicated** — Mongo no longer redefines its own `EMPTY_ORIGIN_HASH`; it imports the shared one.

## Scope

**In:**

- The doc note on `LedgerEntryRecord.from` (immediate).
- Whichever ∅-spelling cut is agreed with the graph-layer owner: either ∅ = `null` end-to-end, or a de-prefixed sentinel.
- Collapse `ledgerOriginFromStored` accordingly (it disappears entirely under cut 1; it simplifies under cut 2).

**Out:**

- The ledger journal structure (TML-2769) and the per-edge breakdown (`edges-on-plan` slice) — orthogonal.
- Unilaterally changing the constant's value without the graph layer's owner — explicitly not in scope.

## Open Questions

1. **Which cut — `null` end-to-end or a de-prefixed sentinel?** Settle with whoever owns `migration-graph`'s node-keying. (1) is the honest model; (2) is the smaller change. The decision turns on how much the graph node map and renderer rely on a non-null string key.
2. **Does the graph node map tolerate a `null` key?** If yes, cut (1) is much cheaper than it looks. Investigate at pickup.

## References

- Parent project: `projects/migration-graph-rendering/spec.md`.
- Predecessor: `slices/ledger-foundation/spec.md` (TML-2769) — introduced `LedgerEntryRecord.from: string | null` and the `ledgerOriginFromStored` bridge; deduped the constant.
- Surfaced by the TML-2769 / PR #665 review (the `sha256:empty`-is-not-a-hash comment and the `from`-permits-null-but-we-use-the-constant comment).
- Linear issue: _to be filed at pickup (standalone, related to TML-2769 / TML-2774)._
