# Follow-up — Pack-provided mutation default functions registry plan

## Summary

Enable mutation default functions and execution-time generators to be extended by composing framework components (target/adapter/extension packs), with deterministic applicability based on `codecId`. This removes provider hardcoding as the extension seam and establishes a reusable system for “which generators/defaults apply to this column?” across authoring surfaces.

**Spec:** `projects/psl-contract-authoring/specs/Follow-up - Pack-provided mutation default functions registry.spec.md`

## Collaborators


| Role         | Person/Team                      | Context                                                           |
| ------------ | -------------------------------- | ----------------------------------------------------------------- |
| Maker        | Contract authoring owner         | Drives SPI design + wiring across authoring/runtime               |
| Reviewer     | Runtime/framework reviewer (TBD) | Reviews new component contribution surface + invariants           |
| Collaborator | Extensions/packs owner (TBD)     | Confirms pack authoring ergonomics and collision/precedence rules |


## Design (decisions locked)

These decisions are the basis for the execution plan below.

- **Applicability lives on generator descriptors**: A generator contributor declares which column types it supports; authoring surfaces do not infer compatibility via types.
- **Applicability key is `codecId` only**: no predicate-based applicability in v1.
- **Runtime validates generator existence only**: runtime errors if a contract references an unknown generator id, but does not perform compatibility checks (assume contract is sane).
- **Duplicates are errors**: duplicate generator ids / default-function names across composed components fail fast; no override mechanism.
- **Flat generator ids**: ids remain short and ergonomic in PSL; avoid introducing a “builtins vs packs” concept for now.
- **Assembly is not owned by `sql-contract-psl`**: vocabulary-driven authoring consumes an assembled registry as an input; assembly is owned by control-plane composition/orchestration (e.g. `family-sql` / CLI wiring).
- **No generator special-casing outside registries**: vocabulary-driven authoring packages must not embed generator id lists, generator-specific branching, or generator-owned storage-shape metadata. Baseline behavior must be expressed by composed registry contributors.

## System additions / behavior changes

### 1) Component contributions (new SPI surfaces)

Introduce component contribution hooks so targets/adapters/extension packs can provide:

- **Default-function lowering handlers (emit-time)**:
  - map: function name → handler
  - handler owns: arg parsing/validation + span-based diagnostics + lowering target:
    - storage `ColumnDefault`, or
    - execution `ExecutionMutationDefaultValue` referencing a generator id
- **Mutation default generators (execution-time)**:
  - map: generator id → implementation
  - each generator provides a **descriptor** declaring supported `codecId`s
  - each generator provides **generator-owned storage-shape metadata** (including any parameterization) so authoring surfaces do not re-encode generator semantics in their own tables

Duplicates (same function name or generator id) are a hard error at assembly time.

### 2) Registry assembly (composition seam)

- **Control plane**: assemble a lowering registry from composed components and pass it into PSL interpretation (no provider hardcoding; assembly owned outside `sql-contract-psl`).
- **Runtime plane**: assemble a generator registry from composed components and use it to resolve `execution.mutations.defaults` generator ids.

### 3) Validation and failure modes

- **PSL / vocabulary-driven authoring**:
  - validates applicability by `codecId` using generator descriptor metadata provided through the assembled registries
  - produces span-based diagnostics for unknown functions, invalid args, and invalid applicability
- **Runtime**:
  - errors if generator id is missing (unknown id)
  - does not validate applicability (no compatibility check at runtime)

## Milestones

### Milestone 1: Add contribution SPIs + assembled registries (core wiring)

Implement the new contribution surfaces and deterministic registry assembly in both planes, without changing the existing default-function vocabulary yet.

**Tasks:**

- Define the SPI types (and error shapes) for:
  - default-function lowering handlers (emit-time), and
  - runtime generator implementations + descriptors (execution-time).
- Define the “generator-owned storage-shape metadata” shape in the descriptor (enough for TS helpers and PSL lowering to avoid re-declaring generator semantics).
- Implement deterministic assembly for:
  - lowering registry (control plane), and
  - generator registry (runtime),
  sourced from composed target/adapter/extension packs.
- Enforce duplicate detection (hard error) for:
  - default-function names, and
  - generator ids.

### Milestone 2: PSL emission uses assembled lowering registry (and tests a pack contribution)

Wire the assembled lowering registry into PSL interpretation and prove pack extensibility via integration tests.

**Tasks:**

- Update the PSL provider/interpreter entrypoint to accept the assembled lowering registry as an input.
- Keep `sql-contract-psl` focused on interpretation: avoid making it the long-term owner of assembly (assembly should live in the control-plane composition layer).
- Ensure `sql-contract-psl` contains no built-in generator/function tables and no generator-specific branching; all behavior must come from registry inputs (including baseline behavior).
- Provide baseline behavior by composing registry contributors (target/adapter/packs) that are initially equivalent to v1 behavior.
- Add integration tests proving:
  - a contributed default-function handler is recognized without PSL provider code changes
  - unknown functions still produce stable, span-based diagnostics

### Milestone 3: Runtime resolves execution defaults via assembled generator registry

Replace the current hardwired runtime generation path with assembled generator registry lookup (with baseline behavior provided by composed contributors), and add missing-id errors.

**Tasks:**

- Assemble a runtime generator registry from composed components (parallel to codecs/operations assembly).
- Update execution mutation default application to:
  - resolve generator id via the registry
  - validate generator id exists (fail with clear error when missing)
  - generate values using the resolved implementation
- Add runtime tests covering:
  - generating a flat id contributed by the baseline composed contributor (regression guard)
  - generating a flat id contributed by a test pack
  - clear error when generator implementation is missing (unknown id)

### Milestone 4: Compatibility + docs (fixtures remain valid)

Make it safe to move from “v1 built-in” to “assembled from components” without breaking existing parity harness cases.

**Tasks:**

- Keep Milestone 5 fixtures passing:
  - by assembling a baseline contributor equivalent to v1 behavior.
- Ensure TS convenience helpers (if any) do not re-declare generator-owned storage-shape metadata; they must consume registry metadata instead.
- Add docs describing:
  - where default-function vocabulary comes from (composition),
  - how to add a new default function via a pack,
  - how to add a new runtime generator via a pack,
  - how generator-owned storage-shape metadata is provided/consumed (no duplicate tables),
  - duplicate-id failure behavior.

## Test Coverage


| Acceptance Criterion                                           | Test Type   | Task/Milestone | Notes                                                               |
| -------------------------------------------------------------- | ----------- | -------------- | ------------------------------------------------------------------- |
| Packs can add default function without PSL provider changes    | Integration | Milestone 2    | A small test pack contributes one handler and a fixture consumes it |
| PSL emission uses assembled registry from framework components | Integration | Milestone 2    | Assert behavior changes when pack is (not) composed                 |
| Runtime generator execution is pack-extensible                 | Integration | Milestone 3    | Registry-driven generation with missing-impl error                  |
| Diagnostics remain stable and span-based                       | Integration | Milestone 2    | Unknown/invalid default cases                                       |
| Milestone 5 fixtures remain valid                              | Integration | Milestone 4    | Regression guard in parity harness                                  |


## Open Items

- None (design decisions locked for this slice).

