# Summary

This follow-up removes ID generator “built-ins” from low layers by moving **concrete ID generator implementations** (and generator-owned metadata like storage shape + applicability) out of `@prisma-next/ids` in the framework authoring layer and into **composed framework components** (targets/adapters/extension packs). The core system continues to define **strategy/registry shapes and assembly rules**, while implementations live only in high layers (“thin core, fat interfaces/targets”).

It also clarifies the TS authoring story: instead of low-layer “built-in” ID helpers, TS authoring uses **composition-owned column helpers** (assembled from the target + extension packs) so that helpers like `uuid()` can remain ergonomic while the framework core stays ignorant of their implementation.

# Description

The current ID generator design introduces a privileged “built-in” vocabulary (`builtinGeneratorIds` / `BuiltinGeneratorId`) and concrete generator implementations (via `uniku/*`) in a framework authoring package (`packages/1-framework/2-authoring/ids`). This is a category error relative to the architectural direction established in the mutation-default registry work:

- Low layers should define **registry/strategy shapes** and be able to **assemble/consume** registries deterministically.
- High layers should provide **concrete implementations** of composed behaviors, via the composition mechanics (target/adapter/extension pack descriptors).

This follow-up restores that boundary by:

- eliminating the concept of “built-in” ID generators as a system-wide privileged list
- relocating generator implementations and generator-owned metadata to a composition layer (preferably an extension pack, alternatively a target/adapter)
- ensuring both **PSL lowering** and **runtime mutation defaults** obtain generator behavior only through composed registries
- resolving the awkward coupling where TS authoring helpers living in low layers “want” to expose generator convenience APIs.

This work is intentionally sequenced after the mutation-default registry seam exists, so the migration is mostly mechanical and can be validated via existing conformance fixtures and registry tests.

# Requirements

## Functional Requirements

- Remove any system-wide concept of “built-in generator ids” from low layers.
  - No global `BuiltinGeneratorId` union type exported from framework layers.
  - No `builtinGeneratorIds` list exported from framework layers.
- Ensure concrete ID generator implementations are contributed only by composed components.
  - Implementations are provided by either:
    - a reusable SQL-family extension pack (preferred), and/or
    - specific targets/adapters (acceptable) using the same composition mechanics.
- Ensure generator-owned metadata is not duplicated across authoring surfaces.
  - Applicability (`applicableCodecIds`) and generated-column typing/resolution (including parameterized behaviors like nanoid sizing) must be owned by the same composed contributors that own the generator ids.
  - PSL interpretation must remain a registry consumer and must not embed generator-specific logic.
- Preserve (and where possible simplify) the mutation-default registries model:
  - Control plane: composed default-function lowering registry + generator descriptors
  - Execution plane: composed generator implementations registry
- Define a clear story for the TS authoring surface:
  - TS-first authoring must remain able to express execution defaults with arbitrary ids (escape hatch).
  - TS “convenience helpers” must not require low layers to ship concrete implementations or privileged vocabularies.
  - Provide a composition-owned **column helper registry** for TS authoring:
    - The TS contract authoring callback receives an additional `column` helper (or equivalent) that aggregates registered helpers from the composed target + extension packs.
    - Helpers can produce full column definitions, including:
      - `type` + `nativeType` (and `typeParams`)
      - nullability + default (storage default) and/or execution default (`ExecutionMutationDefaultValue`)
      - any extension-owned attributes where applicable
    - ID generators become one instance of this pattern (e.g. `column.uuid()` / `column.nanoid({ size })`), preserving “packed ID” column sizing logic without introducing a low-layer built-in.
    - Helpers may imply constraints (for example, an id-column helper may imply primary key semantics).
    - Namespacing uses dot notation (e.g. `pgvector.vector(...)`, `ids.uuid(...)`) when needed.
    - Duplicates are hard errors during assembly; there is no override/last-wins.
    - The framework core defines only the helper *shape* and deterministic assembly rules; helper implementations live only in composed contributors.

- Align TS helper design with future PSL improvements:
  - Record the decision to introduce composed registries for **type constructors** (parameterized storage types) and **field presets** (may bundle defaults + constraints) across PSL and TS authoring, per ADR 170.
  - This follow-up does not need to redesign PSL syntax immediately, but it must avoid locking TS helper shapes into a model that PSL cannot adopt.

## Non-Functional Requirements

- Keep layering intact:
  - framework/core/authoring packages define **interfaces, types, registries, assembly rules**
  - targets/adapters/packs define **implementations**
- Deterministic composition:
  - assembled registries are deterministic given an ordered component set
  - duplicates fail fast with actionable “existing owner / incoming owner” metadata
- Minimize breaking changes for end users:
  - if this repository has examples or templates, provide a mechanical migration path (config/extensionPacks wiring and import updates).

## Non-goals

- Designing a new generator algorithm or changing existing generator semantics (ulid/nanoid/uuid/cuid/ksuid).
- Forcing all projects to use ID generators (they remain optional, and TS escape hatches remain).
- Introducing a new “standard library” of composed behaviors in low layers under a different name.

# Acceptance Criteria

## Layering & ownership

- [ ] `packages/1-framework/2-authoring/ids` contains **no concrete generator implementations** (no `uniku/*` usage) and does not export a privileged “built-in” generator vocabulary.
- [ ] ID generator implementations are provided by composed components (target/adapter/extension pack descriptors).
- [ ] Generator-owned metadata (applicability + generated-column typing/resolution) is owned by those same composed contributors and not duplicated in PSL/TS authoring surfaces.

## Composition behavior

- [ ] Control plane: `controlMutationDefaults.generatorDescriptors` are fully composed; PSL lowering validates applicability and resolves generated-column descriptors without generator special-casing in PSL.
- [ ] Execution plane: runtime mutation defaults resolve generator ids from composed `mutationDefaultGenerators()`; missing ids fail with stable, targeted errors.

## TS authoring story

- [ ] TS-first authoring can still emit execution defaults with arbitrary ids (escape hatch).
- [ ] Any TS “convenience helper” (including ID generator helpers) does not require low layers to ship concrete implementations or “built-in id lists”.
- [ ] The TS authoring surface can opt into composed column helpers (target + extension packs) and use them to define columns without hardcoding helper implementations in the core authoring packages.
- [ ] Column helper assembly:
  - [ ] duplicates are hard errors
  - [ ] dot namespacing is supported for extension-owned helpers
  - [ ] non-namespaced helpers are reserved for family + target contributors (extensions should namespace)

## Evidence

- [ ] Existing mutation-default registry tests continue to pass (or are updated with mechanical composition wiring).
- [ ] At least one parity fixture demonstrates that ID generator defaults are available only when the corresponding contributor is composed.

# Other Considerations

## Security

ID generators are not security primitives, but they affect predictability and collision resistance. This change must not silently swap algorithms or parameter validation. Any validation for parameters (e.g. nanoid size bounds) should remain deterministic and owned by the contributing component.

## Cost

Negligible runtime cost impact. Build/maintenance cost should decrease by removing duplicate sources of truth and reducing cross-layer coupling.

## Observability

Maintain or improve diagnostic clarity:

- control plane: “generator id not available in composed registry”
- runtime: “generator id missing in composed runtime stack”

## Data Protection

No change.

## Analytics

No change.

# References

- Mutation-default registry spec (hard constraint: no built-ins outside the registry): `projects/psl-contract-authoring/specs/Follow-up - Pack-provided mutation default functions registry.spec.md`
- ADR 170 — Pack-provided type constructors and field presets: `docs/architecture docs/adrs/ADR 170 - Pack-provided type constructors and field presets.md`
- Current problematic implementation location: `packages/1-framework/2-authoring/ids/src/generators.ts`
- Current adapter consumers:
  - runtime provisioning: `packages/3-targets/6-adapters/postgres/src/exports/runtime.ts`
  - control-plane descriptors: `packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts`

# Open Questions

1. Where should the shared SQL-family ID generator implementations live by default?
   - **Default assumption**: a reusable SQL-family extension pack under `packages/3-extensions/` that can be composed into any SQL target stack.
   - Alternative: per-target/per-adapter contributions (more explicit, less reuse).

2. What is the desired TS authoring UX for ID generators once implementations live in packs?
  - **Decision**: TS helper functions are provided as composed column helpers (e.g. `column.uuid()`), assembled from the target + extension packs (importing/composing a pack opts into its vocabulary). Duplicates are hard errors; dot namespaces are used when needed. Helpers may imply constraints.
  - Alternative: pack-level helpers without a shared `column` aggregator (more explicit imports, less uniform UX).
  - Alternative: a low-layer helper that only constructs specs with string ids (no privileged union) and relies on composition for meaning/validation (escape hatch, not the primary UX).

3. Do we want to keep any of `@prisma-next/ids` as a package?
   - **Default assumption**: keep only minimal types (if any) that do not encode privileged vocabularies; remove concrete implementations and “builtin” tables entirely.

4. How do column helper names compose?
  - **Decision**: strict duplicate detection (hard error). Use dot namespaces when needed.
  - **Constraint**: reserve non-namespaced helper names for family + target contributors; extensions should contribute namespaced helpers by default (ADR 170).

