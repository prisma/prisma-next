# Slice: symbol-table-owns-duplicate-diagnostics

_Parent project: `projects/psl-cst-symbol-table/`. Outcome: `buildSymbolTable` is the **sole owner** of duplicate-declaration detection, and the downstream artifacts that existed only because that ownership wasn't trusted are removed — the interpreter's defensive duplicate-model `throw`, and the per-interpreter diagnostic dedupe (if it collapses nothing real)._

## At a glance

`buildSymbolTable` already emits `PSL_DUPLICATE_DECLARATION` (first-wins) and is the **only** emitter of it. But two downstream artifacts remain from before that ownership was clean:

1. **A defensive `throw`** in the SQL interpreter — `throw new Error('duplicate model "..." during PSL interpretation')` (`interpreter.ts:2019`) — guarding against two models at the same `(namespaceId, modelName)` coordinate. With the symbol table resolving duplicates first-wins, a duplicate name yields **one** model symbol, so this is unreachable on the PSL path.
2. **A diagnostic `dedupe`** (`dedupeDiagnostics`/`diagnosticDedupKey`, copy-pasted in **both** SQL and Mongo `interpreter.ts`) — introduced with the slice-3 combined-set seeding to collapse a seeded diagnostic against a re-emission. Its main job was the `PSL_DUPLICATE_DECLARATION` overlap; since nothing re-emits that code, the overlap it was built for doesn't exist.

This slice establishes the symbol table's sole ownership explicitly and removes both artifacts — **provided** investigation confirms the dedupe collapses nothing real.

## Chosen design

1. **Symbol table is the documented sole owner of duplicate-declaration detection.** It already emits `PSL_DUPLICATE_DECLARATION`; no production code elsewhere emits it (verified). Add/keep a one-line doc note at the emission site that this is the single owner.
2. **Replace the interpreter `throw` with a documented invariant.** The duplicate-model `throw` at `interpreter.ts:2019` is unreachable given first-wins symbol-table resolution (a duplicate name never produces two same-coordinate models on the PSL path). Replace the bare `throw new Error(...)` with the repo's `invariant(...)` helper (or equivalent assert) carrying a message that names the symbol-table guarantee — so it documents "symbol table guarantees coordinate uniqueness" rather than reading as a live error path. (Do NOT silently delete the guard — convert it to an invariant so a future regression still trips loudly.)
3. **Investigate dedupe necessity, then remove if it collapses nothing real.** Before removing `dedupeDiagnostics`: determine empirically what it actually collapses. Two cases:
   - **It only collapses the seeded `PSL_DUPLICATE_DECLARATION` (or other seed-vs-walk overlaps that no longer occur)** → remove it from both interpreters; the provider seeds + interpreter appends with no overlap, so the raw concatenation is already duplicate-free.
   - **It collapses a real interpreter-internal double** (the same interpreter diagnostic produced on two passes — e.g. a relation/field diagnostic emitted twice) → that's a separate latent bug; keep dedupe but **de-duplicate the helper itself** (it's copy-pasted in both packages — lift to one shared location, e.g. `@prisma-next/psl-parser` or a shared util) and record the real-double as a follow-up. **STOP and surface** which case holds before deleting, so removal is evidence-based, not assumed.

## Coherence rationale

One PR, one outcome: "the symbol table solely owns duplicate detection; the downstream distrust artifacts (throw + dedupe) are gone or justified." Small, focused; the third in the clean-ownership series (after field resolution in slice 4, block resolution in slice 5).

## Scope

**In:**
- `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts` — the `throw` → invariant; remove `dedupeDiagnostics`/`diagnosticDedupKey` if investigation clears it.
- `packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts` — remove its copy-pasted `dedupeDiagnostics`/`diagnosticDedupKey` if cleared.
- `packages/1-framework/2-authoring/psl-parser/src/symbol-table.ts` — the sole-owner doc note.
- Tests covering the duplicate-declaration path (already exist: provider tests + the corrected `interpreter.enum.test.ts`); add one asserting the invariant message if the helper makes it cheap.

**Out:**
- The combined-set seeding mechanism itself (that's the right design per E1; this slice only removes the dedupe that rode in with it, if unnecessary).
- The `PslExtensionBlock` leaner-shape question (separate recorded follow-up).
- Any change to *which* duplicates are flagged or how (first-wins, collide-regardless-of-kind — unchanged; this is about ownership + downstream cleanup, not detection semantics).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| dedupe collapses a real interpreter-internal double | STOP + keep dedupe (lifted to one shared copy) + file the real-double as a follow-up | The investigation gate — removal must be evidence-based. |
| the duplicate-model `throw` is actually reachable via some non-PSL path | Keep as invariant (not deleted) — the invariant still trips loudly on a true regression | Converting to invariant (not deletion) preserves the safety net. |

## Slice-specific done conditions

- [ ] `rg 'throw new Error\(.duplicate model' packages/2-sql/2-authoring/contract-psl/src` empty (the bare throw is gone; an invariant with a symbol-table-guarantee message is in its place).
- [ ] dedupe either removed from both interpreters (investigation cleared it) OR lifted to a single shared location with the real-double recorded as a follow-up — `rg 'function dedupeDiagnostics' packages/` shows at most one definition.
- [ ] Workspace gate green (`pnpm build` + `pnpm typecheck` + `pnpm test:packages` + `pnpm lint:deps`), all diagnostic codes preserved; duplicate-declaration behaviour unchanged (provider + interpreter.enum tests green).

## Open Questions

1. Resolved at dispatch time by the investigation: does dedupe collapse anything besides the (now-nonexistent) seed-vs-walk `PSL_DUPLICATE_DECLARATION` overlap? Working position: no → remove it. If yes → keep one shared copy + follow-up.

## References

- The dedupe origin: slice-3 dispatch 5c (combined-set diagnostics, E1).
- Sole emitter today: `packages/1-framework/2-authoring/psl-parser/src/symbol-table.ts` (`PSL_DUPLICATE_DECLARATION`).
- The throw: `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:2019`.
- The copy-pasted dedupe: SQL `interpreter.ts:171-190`, Mongo `interpreter.ts:69-90`.
