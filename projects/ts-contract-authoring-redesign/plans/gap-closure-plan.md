# Refined Option A Gap Closure Plan

## Summary

This plan closes the remaining gaps between the current refined Option A implementation and the design principles in the project spec. Success means TS and PSL share the same semantic registry, pack composition becomes the source of vocabulary, typed local and cross-model refs become the default path, model-level `.sql(...)` shrinks to irreducibly SQL-only detail, and no-emit, parity, and portability stay intact.

**Spec:** `projects/ts-contract-authoring-redesign/spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Project owner | Drives the remaining API and migration decisions |
| Reviewer | SQL authoring maintainer | Reviews public API shape, lowering, and type-level tradeoffs |
| Collaborator | PSL / emitter maintainers | Keep TS and PSL on the same semantic path and preserve canonical output |
| Collaborator | Target / extension pack maintainers | Review registry composition, vocabulary ownership, and portability impact |

## Milestones

### Milestone 1: Shared Semantic Registry

Deliver one shared semantic foundation for TS and PSL so the remaining DSL surface is registry-driven instead of partly hard-coded.

**Tasks:**

- [ ] Define a shared semantic registry shape for type constructors, field presets, relation-local storage overlays, and named storage-type refs inside the existing authoring/tooling package boundaries.
- [ ] Introduce explicit semantic node types for fields, relations, attributes, and local storage overlays so refined TS and PSL lowering consume the same intermediate data structures.
- [ ] Refactor refined Option A lowering to consume registry-backed semantic nodes instead of directly baking portable helpers into `refined-option-a.ts`.
- [ ] Extend SQL family assembly to compose the same semantic registry from targets, adapters, and extension packs with deterministic merge order and duplicate-owner errors.
- [ ] Refactor PSL interpretation to use the shared registry where semantics overlap today, replacing bespoke scalar/default lookups with the shared semantic layer.
- [ ] Add conformance tests proving equivalent TS and PSL authoring paths lower through the same semantic helpers to the same contract IR.
- [ ] Add an internal seam test for future model/client helper derivation so downstream type generation can reuse the same semantic nodes without re-parsing builder state.

### Milestone 2: Domain-First API and Local SQL Overlays

Deliver the public API changes that make typed, application-domain authoring the default path and keep `.sql(...)` as small and local as possible.

**Tasks:**

- [ ] Introduce first-class registry-backed type constructor and field preset namespaces so pack-owned vocabulary can surface without requiring hard-coded framework helpers.
- [ ] Re-express the current built-in helpers (`text`, `timestamp`, `uuid`, `id.uuidv4`, `id.uuidv7`) through that registry so composition, not framework code, owns the vocabulary.
- [ ] Add local storage overlays for field-, relation-, and attribute-level naming/FK options so common constraint names and FK actions live next to the semantic declaration they customize.
- [ ] Restrict model-level `.sql(...)` to table mapping, advanced indexes, and irreducibly SQL-only detail while preserving an escape hatch for advanced storage cases.
- [ ] Keep typed model tokens and `field.namedType(types.X)` as the primary path, and demote string-first fallback helpers in docs and examples.
- [ ] Add authoring diagnostics or lint rules for cases where a string fallback is used even though a typed local alternative is available.
- [ ] Update representative contracts and compare artifacts to demonstrate application-domain-first authoring with database-native descriptors used only as a fallback.

### Milestone 3: Verification, Portability, and Close-out

Prove the gap-closing work does not regress determinism, no-emit typing, or target portability, then close the project cleanly.

**Tasks:**

- [ ] Add type tests for registry-driven autocomplete of pack-owned helpers, typed named storage-type refs, typed model tokens, and local SQL overlays.
- [ ] Add unit tests for registry composition conflicts, local overlay lowering, and semantic validation around duplicated names or ambiguous storage declarations.
- [ ] Add parity fixtures comparing legacy builder, refined TS, and PSL outputs for the supported shared vocabulary.
- [ ] Add a portability fixture showing a representative Postgres contract can switch to SQLite within the target rewrite budget, with target-specific deltas isolated and easy to locate.
- [ ] Re-run no-emit integration coverage through `validateContract`, `schema()`, and `sql()` using the registry-driven surface.
- [ ] Measure TS server/typecheck cost on representative contracts and document any limits or deferred follow-up if the new registry types materially slow authoring.
- [ ] Verify every acceptance criterion against automated tests or explicit manual checks.
- [ ] Finalize long-lived docs and any ADR updates in `docs/`, strip repo-wide references to `projects/ts-contract-authoring-redesign/**`, and delete the transient project folder in the final close-out PR.

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| An author can define a model with `fields` and `relations`, attach `.sql(...)`, and emit a valid SQL contract without separately authoring `.table(...)` and `.model(...)`. | Unit + Integration + Parity | Milestone 2 / Milestone 3 | Re-verify after local overlay and registry changes |
| Common scalar fields no longer require duplicate field-to-column declarations when names match. | Unit | Milestone 2 | Cover default naming plus local field overrides |
| Table and column naming can come from root-level naming strategy with explicit per-table/per-field overrides. | Unit + Integration | Milestone 2 / Milestone 3 | Include local overlay precedence rules |
| `cols` in `.sql(...)` exposes only column-backed scalar fields and excludes relation fields. | Type test | Milestone 3 | Keep scalar-only local refs intact after API reshaping |
| The API supports named PKs, uniques, indexes, and FKs, including composite constraints where currently supported. | Unit + Type test + Parity | Milestone 2 / Milestone 3 | Cover local naming overlays plus current semantic/runtime validation |
| The API supports literal defaults, SQL defaults, generated defaults, and named storage types without changing emitted contract structure. | Unit + Parity | Milestone 1 / Milestone 3 | Registry refactor must preserve canonical output |
| The API supports explicit reverse/query-surface relations while keeping owning-side FK/storage authorship singular. | Unit + Parity | Milestone 2 / Milestone 3 | Verify relation-local FK overlays do not duplicate ownership |
| A representative Postgres contract can switch to SQLite with no more than roughly 10% source changes, excluding intentionally target-specific features. | Integration + Manual | Milestone 3 | Manual budget check may still be needed for final sign-off |
| Downstream `schema()` / `sql()` inference continues to work from no-emit TS-authored contracts built from the new surface. | Integration + Type test | Milestone 3 | Must stay green across registry-driven helpers |
| The lowering pipeline can eventually derive model/client helper types from the same authored contract data used by query-lane inference. | Unit + Manual design verification | Milestone 1 / Milestone 3 | Add an internal semantic-node seam test and document the follow-on derivation path |

## Open Items

- I am assuming the shared semantic registry lands inside existing package boundaries rather than introducing a brand-new top-level authoring package.
- The exact public spelling for pack-owned helper namespaces may still move during implementation as long as vocabulary ownership shifts out of hard-coded framework helpers.
- Some advanced target-specific types will likely remain `field.column(...)` escape hatches even after the registry work; the goal is to make them explicit fallbacks, not to eliminate them.
- If local relation overlays make simple foreign keys derivable from semantic relations, we should decide whether model-level `.sql().foreignKeys` becomes advanced-only or remains a fully supported escape hatch.
- Close-out depends on durable docs being promoted out of `projects/` before deleting the transient project folder.
