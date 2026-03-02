# Follow-up — Pack-provided mutation default functions registry plan

## Summary

Replace the v1 provider-supplied built-in PSL default-function registry with a registry assembled from configured framework components (target/adapter/extension packs), and make runtime execution mutation default generation pack-extensible. This operationalizes ADR 164’s “registry as the extension seam” so new default functions/generators do not require PSL provider changes.

**Spec:** `projects/psl-contract-authoring/specs/Follow-up - Pack-provided mutation default functions registry.spec.md`

## Collaborators

| Role | Person/Team | Context |
|---|---|---|
| Maker | Contract authoring owner | Drives SPI design + wiring across authoring/runtime |
| Reviewer | Runtime/framework reviewer (TBD) | Reviews new component contribution surface + invariants |
| Collaborator | Extensions/packs owner (TBD) | Confirms pack authoring ergonomics and collision/precedence rules |

## Milestones

### Milestone 1: Design the contribution interfaces (default functions + generators)

Define the minimal SPI surface area needed for packs/framework components to contribute:

- default-function handlers (PSL function name → argument rules → lowering shape), and
- runtime generator implementations referenced by `execution.mutations.defaults`.

**Tasks:**

- [ ] Define a contribution shape for default-function lowering:
  - input: `{ name, rawArgs, spans, resolvedColumnDescriptor? }`
  - output: either storage `ColumnDefault` or execution `ExecutionMutationDefaultValue`, or diagnostics
  - stable diagnostic codes for unknown function vs invalid args
- [ ] Define how components contribute generator implementations at runtime:
  - generator id namespace rules (avoid collisions)
  - precedence rules when multiple components provide the same generator id/name
  - failure mode when contract references missing generator implementation
- [ ] Decide whether the assembled registry is:
  - config-driven (only composed packs contribute), or
  - includes an always-on built-in baseline (then packs extend/override)
- [ ] Record the decision and link back to ADR 164; update ADR 164 follow-ups if needed.

### Milestone 2: Implement assembly + wiring (control plane + provider)

Thread the contribution surfaces through composition so the PSL provider can interpret defaults via an assembled registry rather than provider hardcoding.

**Tasks:**

- [ ] Implement registry assembly at the composition boundary (config → provider input):
  - collect contributors from target/adapter/extension packs
  - merge into one registry with stable ordering and deterministic precedence
- [ ] Update the PSL provider to accept the assembled registry and remove direct dependency on the built-in registry (or keep the built-in as fallback if the design chose a baseline).
- [ ] Add integration tests proving:
  - a contributed default-function handler is recognized without PSL provider changes
  - unknown functions still produce stable, span-based diagnostics

### Milestone 3: Runtime generator registry (pack-extensible execution defaults)

Ensure execution mutation defaults can be generated via a pack-extensible registry rather than a single hard-wired backend.

**Tasks:**

- [ ] Introduce a runtime generator registry that can be assembled from components (parallel to codecs/operations assembly).
- [ ] Update execution mutation default application to use the registry (and preserve current behavior as baseline).
- [ ] Add runtime tests covering:
  - generating a built-in id (regression guard)
  - generating a pack-provided id
  - clear error when generator implementation is missing

### Milestone 4: Migration path + compatibility (fixtures + docs)

Make it safe to move from “v1 built-in” to “assembled from components” without breaking existing parity harness cases.

**Tasks:**

- [ ] Keep Milestone 5 fixtures passing:
  - either by assembling a baseline registry equivalent to v1, or
  - by providing a mechanical update path and applying it consistently
- [ ] Add documentation describing where default-function vocab comes from (composition), and how to add a new function via a pack.

## Test Coverage

| Acceptance Criterion | Test Type | Task/Milestone | Notes |
|---|---|---|---|
| Packs can add default function without PSL provider changes | Integration | Milestone 2 | A small test pack contributes one handler and a fixture consumes it |
| PSL emission uses assembled registry from framework components | Integration | Milestone 2 | Assert behavior changes when pack is (not) composed |
| Runtime generator execution is pack-extensible | Integration | Milestone 3 | Registry-driven generation with missing-impl error |
| Diagnostics remain stable and span-based | Integration | Milestone 2 | Unknown/invalid default cases |
| Milestone 5 fixtures remain valid | Integration | Milestone 4 | Regression guard in parity harness |

## Open Items

- Decide exact scope boundary between “default-function lowering handlers” vs “generator implementation registry” (can be one SPI or two coordinated SPIs).
- Decide how generator ids are versioned/namespaced if packs contribute them (avoid collisions across packs).
