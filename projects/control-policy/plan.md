# Project Plan

## Summary

_Drafted via drive-create-plan. Replace this placeholder._

**Spec:** [`projects/control-policy/spec.md`](spec.md)

## Cross-project dependencies

This project lands **after** [TML-2459 — Target-Extensible IR](../target-extensible-ir/spec.md) because the dispatch tables for verifier and planner are most naturally wired into TML-2459's `SchemaVerifier` SPI and family abstract bases. Plugging `control` into pre-TML-2459 flat-data IR is possible but the dispatch would be reshaped when TML-2459 lands, so the cheaper sequencing is TML-2459 → this project.

Independent / non-blocking: TML-2459 can ship without this project (today's behaviour is the default `managed`). The Supabase integration project is blocked until both land — but Supabase's design has been shaped against this policy vocabulary, so it picks up immediately once this lands.

## Milestones

### Milestone 1: Framework primitive

**Tasks:**

- [ ] Declare `ControlPolicy` type in `1-framework/` (`'managed' | 'tolerated' | 'external' | 'observed'`).
- [ ] Add `control: ControlPolicy` field to the framework `SchemaNode` (or relevant base) so every IR node carries it.
- [ ] Add contract-level `defaultControl?: ControlPolicy` to the framework Contract IR base.
- [ ] Effective-control resolution: per-node value if set, else contract-level default, else `'managed'`. Pure function on the IR; one place, called by both verifier and planner.

### Milestone 2: Verifier dispatch

**Tasks:**

- [ ] Add dispatch table to `SqlSchemaVerifierBase` (and `MongoSchemaVerifierBase`) keyed on `control`. Four strategies as per spec § "Verifier dispatch."
- [ ] Surface "compatible shape" relation as a protected hook on the family base; concrete relation lives in target SPI (Postgres first).
- [ ] Issue taxonomy: `external`-mode mismatches become a distinct `SchemaIssue.kind` so consumers can differentiate "shape diverged but tolerated" from "shape diverged and that's an error."

### Milestone 3: Planner dispatch + cross-cutting safety

**Tasks:**

- [ ] Add dispatch table to the planner: `managed` → full lifecycle, `tolerated` → create-if-missing, `external` / `observed` → emit nothing.
- [ ] Cross-cutting safety: planner refuses to emit ops into a namespace whose declaring contract is `external` even if a `managed` object is mis-declared there. Surface a diagnostic.
- [ ] Round-trip property tests for Postgres, SQLite, Mongo (AC7).

### Milestone 4: TS authoring surface

**Tasks:**

- [ ] `defineContract({ defaultControl?, … })` lowers to contract-level field.
- [ ] `model(name, { control?, … })` lowers to per-object field.
- [ ] Equivalent ergonomics for declarable IR kinds that gain `control` later (indexes, constraints).
- [ ] Integration test exercising AC10 against PGlite.

### Milestone 5: PSL authoring surface

**Tasks:**

- [ ] Settle PSL spelling (attribute vs top-level block) in PE pass.
- [ ] Wire parser → AST → IR lowering so PSL contracts produce the same IR shape as TS-authored ones.
- [ ] Round-trip property test for PSL authoring (AC11).

### Milestone 6: Docs

**Tasks:**

- [ ] Subsystem docs updated to describe `ControlPolicy` and the dispatch tables.
- [ ] ADR drafted capturing the four-policy vocabulary and the framework-vs-target locking.

## Close-out (required)

- [ ] Verify all acceptance criteria in [`projects/control-policy/spec.md`](spec.md).
- [ ] Promote ADR draft to `docs/architecture docs/adrs/`.
- [ ] Confirm subsystem docs (`Data Contract`, `Adapters & Targets`, relevant verifier/planner docs) describe `ControlPolicy`.
- [ ] Strip repo-wide references to `projects/control-policy/**` (replace with canonical `docs/` links or remove).
- [ ] Delete `projects/control-policy/`.
