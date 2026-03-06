# Summary

Remove the need to hard-code mutation default function vocabulary and per-column compatibility in the PSL provider by introducing a framework-component contribution surface for **default-function lowering** and **execution generator registries**.

# Description

Milestone 5 establishes registry-driven PSL default function lowering (see ADR 164), but v1 ships with a provider-supplied built-in registry because packs cannot yet contribute generator/default-function vocabulary.

This follow-up defines and implements the missing SPI so targets/adapters/extension packs can contribute:

- a default-function vocabulary (name + argument rules + lowering shape), and
- a generator registry (how to generate values at runtime for generator IDs referenced in `execution.mutations.defaults`),

so that PSL and TS can share a single source of truth and adding new default functions does not require changing the PSL provider.

# Requirements

## Functional Requirements

- Define a contribution interface for framework components to provide default-function handlers and/or generator metadata.
- Assemble the default-function registry for PSL interpretation from configured framework components (target/adapter/extension packs) rather than provider hardcoding.
- Assemble the runtime execution generator registry from framework components so execution mutation defaults can be generated without a single hard-wired implementation.
- Preserve stable, span-based diagnostics for:
  - unknown default function names
  - invalid argument shapes
  - missing runtime generator implementations (if applicable)
- Provide a migration path from the v1 built-in registry to the pack-assembled registry without breaking existing fixtures.

## Non-Functional Requirements

- Keep the PSL parser and core interpreter generic (registry-driven; no function-specific logic in those layers).
- Keep compatibility implicit: the vocabulary encodes per-column applicability (no runtime return-type vs column-type comparisons).
- Avoid connector-specific Prisma ORM semantics; stay aligned to Prisma Next contract model.

## Non-goals

- Expanding the default function vocabulary beyond what is needed to prove the SPI works.
- Changing PSL syntax for default functions as part of this follow-up.

# Acceptance Criteria

- [ ] Packs can add a new default function (and its argument rules + lowering) without modifying the PSL provider.
- [ ] PSL emission uses an assembled registry derived from configured framework components.
- [ ] Runtime generator execution is pack-extensible (no single hard-wired generator backend).
- [ ] Diagnostics remain stable and span-based for unknown/invalid defaults.
- [ ] Existing Milestone 5 fixtures continue to pass (or have a documented, mechanical update path).

# References

- ADR 164: `docs/architecture docs/adrs/ADR 164 - Registry-driven PSL default function lowering.md`
- Follow-up Linear ticket: `TML-2025`
- Project plan: `projects/psl-contract-authoring/plans/plan.md`
