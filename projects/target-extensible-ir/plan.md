# Project Plan

## Summary

_Drafted via principal-engineer pass on `projects/target-extensible-ir/spec.md`. To be filled in once the spec is validated and the PE has sized the cost ledger and sequencing._

**Spec:** `projects/target-extensible-ir/spec.md`

## Sequencing context for the PE pass

The structural sequencing is partly settled by the spec; what remains is the infrastructure-vs-exemplar interleaving and the Mongo-migration timing. The settled shape:

1. **Foundational infrastructure**: framework interfaces (`SchemaNode`, `Namespace`, `SchemaVerifier`, `ContractHydrator`), family abstract bases (`SqlNode`, `SqlSchemaVerifier`, `MongoSchemaNode` lifted), JSON ↔ class round-trip plumbing, single `validateContract` route. Pre-requisite for everything else.

2. **Exemplar 1 — Enums (refactor)**: the low-risk first demonstration. Lifts the existing codec-hook glue for enum verification into first-class IR nodes (`SqlEnumType`, `PostgresEnumType`). Concrete win: codec-hook glue removed for the enum case. Proof of concept that the new pattern works on a real existing concept.

3. **Exemplar 2 — Namespace (new concept)**: the higher-risk second demonstration. Introduces `Namespace` as a framework-level concept with target concretions (`PostgresSchema`, SQLite singleton) and the `__unspecified__` sentinel. Multi-namespace Postgres contracts and intra-space cross-schema FKs become possible. Connection-bound resolution unblocks multi-tenancy.

4. **Mongo migration**: family/target split for Mongo Schema IR + Contract IR flip. Can run in parallel with (1)–(3) or after (1) lands; PE decides based on team capacity and risk appetite. The Mongo work is mechanical-but-broad.

5. **Documentation deliverables**: `AGENTS.md` / `CLAUDE.md` rule update; `docs/reference/typescript-patterns.md` AST/IR section; `docs/Architecture Overview.md` principles update; ADR drafts under `projects/target-extensible-ir/specs/`. Timing flexible — some during execution (so reviewers see the convention as they review), some at close-out (ADR promotion, subsystem doc updates).

## Milestones

_Pending PE pass. The PE conversation will:_

- _Size the refactor's blast radius (Contract IR class flip, Schema IR class flip, Mongo migration, SQL family/target restructure, hydration call sites, all consumers of `validateContract`)._
- _Decide infrastructure sequencing (lay foundation first vs just-in-time per exemplar)._
- _Decide Mongo migration timing (parallel, after foundation, after enums, after namespace)._
- _Decide documentation timing (during execution vs at close-out)._
- _Identify load-bearing risks and rollback positions._
- _Resolve the Open Questions in the spec to the extent they pin the milestones._

### Milestone 1: [Pending PE pass]

**Tasks:**

- [ ] _Replace this placeholder once milestones are defined._

## Close-out (required)

- [ ] Verify all acceptance criteria in `projects/target-extensible-ir/spec.md`.
- [ ] Promote ADR drafts (3-layer IR convention; architectural principles) from `projects/target-extensible-ir/specs/` to `docs/architecture docs/adrs/`.
- [ ] Update affected subsystem docs in `docs/architecture docs/subsystems/` (Data Contract, Contract Emitter & Types, Adapters & Targets, Migration System).
- [ ] Confirm `AGENTS.md` / `CLAUDE.md` Golden Rule is updated and `docs/reference/typescript-patterns.md` carries the new AST/IR section.
- [ ] Confirm `docs/Architecture Overview.md` § "Guiding Principles" surfaces "framework provides affordances; targets implement specifics" and "familiar with one target, fluent in another".
- [ ] Migrate any other long-lived docs into `docs/`.
- [ ] Strip repo-wide references to `projects/target-extensible-ir/**` (replace with canonical `docs/` links or remove).
- [ ] Delete `projects/target-extensible-ir/`.
