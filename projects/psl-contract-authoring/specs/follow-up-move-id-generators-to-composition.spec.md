# Summary

This follow-up removes ID generator “built-ins” from low layers by moving **concrete ID generator implementations** (and generator-owned metadata like storage shape + applicability) out of `@prisma-next/ids` in the framework authoring layer and into **composed framework components** (targets/adapters/extension packs). The core system continues to define **strategy/registry shapes and assembly rules**, while implementations live only in high layers (“thin core, fat interfaces/targets”).

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
  - TS “convenience helpers” for ID generators must not require low layers to ship concrete implementations or privileged vocabularies.
  - Preferred direction: TS convenience helpers for ID generators live with the composed implementation contributor (pack/adapter), not in framework core.

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
- [ ] Any TS “ID generator convenience API” does not require low layers to ship concrete implementations or “built-in id lists”.

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
- Current problematic implementation location: `packages/1-framework/2-authoring/ids/src/generators.ts`
- Current adapter consumers:
  - runtime provisioning: `packages/3-targets/6-adapters/postgres/src/exports/runtime.ts`
  - control-plane descriptors: `packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts`

# Open Questions

1. Where should the shared SQL-family ID generator implementations live by default?
   - **Default assumption**: a reusable SQL-family extension pack under `packages/3-extensions/` that can be composed into any SQL target stack.
   - Alternative: per-target/per-adapter contributions (more explicit, less reuse).

2. What is the desired TS authoring UX for ID generators once implementations live in packs?
   - **Default assumption**: TS helper functions live in the pack (importing the pack opts into the vocabulary).
   - Alternative: TS helper stays low but only constructs specs with string ids (no privileged union) and relies on composition for meaning/validation.

3. Do we want to keep any of `@prisma-next/ids` as a package?
   - **Default assumption**: keep only minimal types (if any) that do not encode privileged vocabularies; remove concrete implementations and “builtin” tables entirely.

