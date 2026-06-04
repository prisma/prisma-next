# Control Policy — Plan

**Spec:** [`projects/control-policy/spec.md`](spec.md)
**Linear Project:** [Control Policy](https://linear.app/prisma-company/project/control-policy-056d5d6b37c8) — umbrella issue TML-2493

## At a glance

One substrate slice followed by a parallel fan of consumers. The IR field + serialization lands first (changing no behaviour), then verifier dispatch, planner dispatch, and the TS authoring surface proceed in parallel on top of it. Once those three merge, an end-to-end demonstration slice proves all four policies work together through the public runtime, with the PSL surface as a deferrable follow-on.

## Composition

### Stack (deliver in order)

1. **Slice `ir-primitive`** — Linear: TML-2775
   - **Outcome:** Every storage-plane node can carry `control`; the contract carries `defaultControl`; one shared resolver computes effective control; contracts round-trip the field across Postgres, SQLite, and Mongo. Absent `control`, behaviour and contract hashes are unchanged.
   - **Builds on:** None. (TML-2459 is Done.)
   - **Hands to:** The `ControlPolicy` type, the `control`/`defaultControl` fields, the validators, and the effective-control resolver — the substrate every other slice reads.
   - **Focus:** In scope — the IR field, its serialization/validation (omit-when-default to preserve hashes), and the resolver. Out of scope — all dispatch and authoring behaviour, handled by the slices below.

### Parallel group (each builds only on Slice 1; mutually independent)

2. **Slice `verifier-dispatch`** — Linear: TML-2776
   - **Outcome:** The verifier applies the four comparison strategies per node, with the compatible-shape relation supplied by the target; external-mode tolerated divergence surfaces as its own issue kind.
   - **Builds on:** Slice 1's field + resolver.
   - **Hands to:** Verifier behaviour for all four policies and the compatible-shape hook — consumed by Supabase's `auth.users` verification.
   - **Focus:** In scope — the family-level dispatch, the target compatible-shape hook, and the issue taxonomy for tolerated divergence. Out of scope — planner behaviour (Slice 3) and authoring (Slice 4).

3. **Slice `planner-dispatch`** — Linear: TML-2777
   - **Outcome:** The planner gates DDL per policy (full / create-if-missing / none) and refuses to emit into an `external` namespace even when a `managed` object is mis-declared there, surfacing a diagnostic.
   - **Builds on:** Slice 1's field + resolver.
   - **Hands to:** Planner behaviour for all four policies and the external-namespace safety guard — consumed by Supabase delivery.
   - **Focus:** In scope — the per-node DDL gate and the namespace-level safety guard + diagnostic. Out of scope — verifier comparison strategies (Slice 2).

4. **Slice `ts-authoring`** — Linear: TML-2778
   - **Outcome:** The TS surface lets authors set the contract default and per-object overrides, lowering to the Slice 1 IR shape, exercised by an integration test.
   - **Builds on:** Slice 1's field shape.
   - **Hands to:** The ergonomic TS surface extension authors and power-users write against.
   - **Focus:** In scope — the contract-level default option, the per-object override option, and their lowering. Out of scope — the PSL surface (Slice 5).

### Integration (after the parallel group merges)

5. **Slice `e2e-demonstration`** — Linear: TML-2796
   - **Outcome:** One end-to-end test (and, where it reads naturally, an example-app touchpoint) authors a contract with mixed control policies via the TS builder, runs migrate + verify against PGlite, and asserts the observable behaviour of all four policies together: a `managed` table is created/altered, a `tolerated` table is created-if-missing but never altered, an `external` table receives zero DDL yet still verifies on declared shape, and the external-namespace floor's `warn` diagnostic surfaces for a mis-declared `managed` object.
   - **Builds on:** Slices 2 (verifier), 3 (planner), 4 (TS authoring) — all three must be merged first; this is the only place their behaviours meet.
   - **Hands to:** The project-DoD's "all four policies behave end-to-end (verify + plan)" condition and the visible proof that the primitive works for a real user.
   - **Focus:** In scope — the cross-slice e2e test through the public runtime against PGlite, authored via the TS builder (so it does not depend on the PSL slice). Out of scope — re-testing any single layer in isolation (covered by 2–4) and the PSL surface (slice 6).
   - **Note:** this slice is the consumer that makes the slice-3 control-policy diagnostic observable; if that diagnostic is wired through the framework planner result during slice 3's rework, this slice asserts it end-to-end rather than re-deriving it.

### Deferrable follow-on

6. **Slice `psl-authoring`** — Linear: TML-2779
   - **Outcome:** The PSL surface expresses the same per-object override and contract default, lowering to the same IR as the TS path and round-tripping.
   - **Builds on:** Slice 1's field; mirrors Slice 4's lowering target.
   - **Hands to:** PSL/TS authoring parity.
   - **Focus:** In scope — settling the PSL spelling (an open question in the spec) and wiring the interpreter lowering. Out of scope — re-litigating the IR shape, fixed by Slice 1.
   - **Deferrable:** if the spelling proves load-bearing, this leaves the project as a tracked follow-up (per the spec's PSL open question), keeping the delivered core at four slices.

## Cross-cutting language renames

Ubiquitous-language cleanups surfaced during delivery: the policy-bearing identifiers read more clearly as `…ControlPolicy` than bare `…Control`. Each lands as a small, mechanical, **substrate-first PR to `main`** that changes no behaviour, so in-flight slice branches adopt it on their next rebase instead of colliding on the rename across multiple open PRs. (The slice descriptions above still spell the pre-rename field names — they describe the field each rename targets.)

- [x] **TML-2797 — `effectiveControl` → `effectiveControlPolicy`** — Done (merged via #699). Renamed the shared effective-policy resolver and its exports/tests; the open slice branches rebased onto it.
- [x] **TML-2800 — `defaultControl` → `defaultControlPolicy`** — Done (merged via #707). Renamed the contract-level default field across the IR, serialization, validators, the TS authoring option, and every reader (verifier, planner). The e2e demonstration slice (TML-2796) and the deferred PSL slice (TML-2779) pick up the new name on rebase.

## Dependencies (external)

- [x] **TML-2459 — Target-Extensible IR** — Done (2026-05-14). Provides the `SchemaVerifier` / `ContractSerializer` SPIs and family abstract bases the dispatch plugs into.

## Sequencing rationale

- **Standalone substrate slice:** its hand-off feeds four downstream slices, so folding it into any one would serialize the other three behind that merge. Isolating it also lets the no-regression and no-hash-churn guarantees be verified before any behaviour changes — the cheapest place to catch a contract-hash surprise.
- **Why 2/3/4 parallelize:** they touch different layers (family verifier, target planner, TS authoring) and share no seam beyond the Slice 1 field each reads independently; neither dispatch consumes the other's output at code level.
- **Why the e2e demonstration is its own slice:** the project-DoD's "all four policies behave end-to-end (verify + plan)" can only be proven where authoring, planner, and verifier meet — which is *after* 2/3/4 merge. No single parallel slice can host it (each owns one layer), so it is a distinct slice that depends on all three. It authors via the TS builder, so it does not block on (or wait for) the PSL slice.
- **Slice count:** four core slices plus a cross-slice e2e demonstration; PSL is the negotiable last slice per the spec's open question and defers cleanly without affecting the demonstration.
- **Docs/ADR:** drafted alongside the dispatch slices and promoted at close-out (a project-DoD condition), not a standalone slice.
