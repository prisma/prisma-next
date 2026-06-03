# Control Policy — Plan

**Spec:** [`projects/control-policy/spec.md`](spec.md)
**Linear Project:** [Control Policy](https://linear.app/prisma-company/project/control-policy-056d5d6b37c8) — umbrella issue TML-2493

## At a glance

One substrate slice followed by a parallel fan of consumers. The IR field + serialization lands first (changing no behaviour), then verifier dispatch, planner dispatch, and the TS authoring surface proceed in parallel on top of it, with the PSL surface as a deferrable follow-on.

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

### Deferrable follow-on

5. **Slice `psl-authoring`** — Linear: TML-2779
   - **Outcome:** The PSL surface expresses the per-object override (`@@control(<policy>)`) lowering to Slice 1's `controlPolicy` IR slot; and PSL/TS authoring parity for the contract default lands at the contract-specifier boundary in `prisma-next.config.ts` (`prismaContract` / `typescriptContract` / `typescriptContractFromPath` / `emptyContract` accept `defaultControlPolicy`, with source-wins precedence). PSL gains no new top-level grammar.
   - **Builds on:** Slice 1's IR field; Slice 4's TS authoring surface (which the specifier-arg path mirrors); TML-2800's contract-level `defaultControlPolicy` field.
   - **Hands to:** PSL/TS authoring parity for both per-object and contract-default control policy.
   - **Focus:** In scope — the new `@@control` interpreter branch in `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts` with five validation diagnostics; PSL → IR → JSON → IR round-trip parity test; `defaultControlPolicy?` added to all four contract specifiers (PSL + SQL TS + Mongo TS) with source-wins precedence applied at load time. Out of scope — per-namespace inheritance (project non-goal); a new top-level PSL block; re-litigating the IR shape.
   - **Slice scaffolded:** spec + plan + reviews under [`slices/psl-authoring/`](slices/psl-authoring/spec.md). Spelling decisions (`@@control(<policy>)`, lowercase argument; specifier-arg with source-wins precedence) settled in design discussion.

## Dependencies (external)

- [x] **TML-2459 — Target-Extensible IR** — Done (2026-05-14). Provides the `SchemaVerifier` / `ContractSerializer` SPIs and family abstract bases the dispatch plugs into.

## Sequencing rationale

- **Standalone substrate slice:** its hand-off feeds four downstream slices, so folding it into any one would serialize the other three behind that merge. Isolating it also lets the no-regression and no-hash-churn guarantees be verified before any behaviour changes — the cheapest place to catch a contract-hash surprise.
- **Why 2/3/4 parallelize:** they touch different layers (family verifier, target planner, TS authoring) and share no seam beyond the Slice 1 field each reads independently; neither dispatch consumes the other's output at code level.
- **Slice count:** the core is four slices; PSL is the negotiable fifth per the spec's open question, which keeps the delivered shape within the repo's 1–4 sweet spot if it defers.
- **Docs/ADR:** drafted alongside the dispatch slices and promoted at close-out (a project-DoD condition), not a standalone slice.
