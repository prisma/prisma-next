## Summary

Re-review against the updated spec/plan: the previously flagged hardcoded/default behaviors are now removed from vocabulary-driven authoring surfaces, and mutation-default behavior is owned by composed registries. No blocking issues found in this re-review.

## Resolution status (2026-03-03)

- [x] BLOCK-F05 — Removed PSL default target fallback; interpreter now requires explicit target context input.
- [x] BLOCK-F06.1 — Removed hardcoded scalar map from interpreter; scalar descriptors are composed inputs.
- [x] BLOCK-F06 — Removed hardcoded generated-id storage maps/special-casing from interpreter; generator descriptors own generated-column resolution.
- [x] BLOCK-F07 — Re-homed built-in default-function semantics to composed Postgres contributor code.
- [x] BLOCK-F08 — Re-homed built-in generator applicability metadata to contributor-owned descriptors.
- [x] BLOCK-F09 — Centralized generator storage metadata in `@prisma-next/ids` and reused in both TS authoring + composed descriptors.
- [x] BLOCK-F10 — Removed runtime built-in generator table from `sql-runtime`; built-ins are contributed by adapter composition.
- [x] BLOCK-F11 — Removed built-in registry factories/exports from `sql-contract-psl`.
- [x] BLOCK-F12 — Removed provider-local assembly; provider now consumes preassembled inputs.
- [x] F00.2/F01 — Unknown-function diagnostics now derive signatures from registry entries (`usageSignatures`) with fallback.
- [x] F02 — Duplicate runtime generator errors now include both `existingOwner` and `incomingOwner`.
- [x] F03 — Family assembly now uses a minimal callable handler type instead of `unknown`.

## What looks solid

- **Spec/ADR alignment**: declared applicability by `codecId`, composition-first extension seam, and runtime “existence only” validation all match the documented intent.
  - Spec acceptance criteria: [projects/psl-contract-authoring/specs/Follow-up - Pack-provided mutation default functions registry.spec.md (L114–L141)](../Follow-up%20-%20Pack-provided%20mutation%20default%20functions%20registry.spec.md:114-141)
  - ADR decision: [docs/architecture docs/adrs/ADR 169 - Declared applicability for mutation default generators.md (L43–L73)](../../../../docs/architecture%20docs/adrs/ADR%20169%20-%20Declared%20applicability%20for%20mutation%20default%20generators.md:43-73)
- **Clear control-plane SPI** for lowering handlers + diagnostics + span fidelity.
  - [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L10–L62)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:10-62)
- **Targeted runtime failure mode** for missing generator ids (`RUNTIME.MUTATION_DEFAULT_GENERATOR_MISSING`) with focused test coverage.
  - Implementation: [packages/2-sql/5-runtime/src/sql-context.ts (L381–L399)](../../../../packages/2-sql/5-runtime/src/sql-context.ts:381-399)
  - Tests: [packages/2-sql/5-runtime/test/mutation-default-generators.test.ts (L98–L127)](../../../../packages/2-sql/5-runtime/test/mutation-default-generators.test.ts:98-127)
- **Deterministic duplicate rejection** is enforced and tested in the SQL family assembly.
  - [packages/2-sql/3-tooling/family/test/mutation-default-assembly.test.ts (L79–L147)](../../../../packages/2-sql/3-tooling/family/test/mutation-default-assembly.test.ts:79-147)

## Blocking issues
- None found in this re-review.

## Non-blocking concerns
- None noted.

## Nits

- None.

## Acceptance-criteria traceability

Source of truth: [projects/psl-contract-authoring/specs/Follow-up - Pack-provided mutation default functions registry.spec.md (L114–L141)](../Follow-up%20-%20Pack-provided%20mutation%20default%20functions%20registry.spec.md:114-141)

### SPI and Assembly

- **AC**: Component contributes a default-function handler; PSL recognizes it without provider changes.
  - **Implementation**:
    - Handler SPI: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L32–L37)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:32-37)
    - Interpreter uses registry: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L202–L297)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:202-297)
  - **Evidence**:
    - [packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts (L35–L82)](../../../../packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts:35-82)
- **AC**: Component contributes a runtime generator implementation; runtime uses it without hardcoding changes.
  - **Implementation**:
    - Registry assembly: [packages/2-sql/5-runtime/src/sql-context.ts (L375–L401)](../../../../packages/2-sql/5-runtime/src/sql-context.ts:375-401)
    - Lookup + invocation: [packages/2-sql/5-runtime/src/sql-context.ts (L381–L399)](../../../../packages/2-sql/5-runtime/src/sql-context.ts:381-399)
  - **Evidence**:
    - [packages/2-sql/5-runtime/test/mutation-default-generators.test.ts (L56–L97)](../../../../packages/2-sql/5-runtime/test/mutation-default-generators.test.ts:56-97)
- **AC**: Component declares applicability for a generator id without bespoke authoring-surface logic.
  - **Implementation**:
    - Descriptor: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L39–L47)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:39-47)
    - Interpreter checks `applicableCodecIds`: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L255–L294)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:255-294)
  - **Evidence**:
    - [packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts (L84–L126)](../../../../packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts:84-126)
- **AC**: Assembly order + duplicate handling are deterministic and tested.
  - **Implementation**:
    - Family assembly: [packages/2-sql/3-tooling/family/src/core/assembly.ts (L255–L283)](../../../../packages/2-sql/3-tooling/family/src/core/assembly.ts:255-283)
  - **Evidence**:
    - [packages/2-sql/3-tooling/family/test/mutation-default-assembly.test.ts (L20–L77)](../../../../packages/2-sql/3-tooling/family/test/mutation-default-assembly.test.ts:20-77)
    - [packages/2-sql/3-tooling/family/test/mutation-default-assembly.test.ts (L79–L147)](../../../../packages/2-sql/3-tooling/family/test/mutation-default-assembly.test.ts:79-147)

### Emission and Diagnostics

- **AC**: PSL emission uses an assembled registry derived from configured framework components.
  - **Implementation**:
    - Interpreter consumes `controlMutationDefaults` as an input: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L33–L40)](../../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:33-40)
    - Provider helper passes preassembled inputs through to interpretation: [packages/2-sql/2-authoring/contract-psl/src/provider.ts (L55–L64)](../../../../packages/2-sql/2-authoring/contract-psl/src/provider.ts:55-64)
  - **Evidence**:
    - [packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts (L35–L82)](../../../../packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts:35-82)
    - Postgres built-ins contributed via adapter: [packages/3-targets/6-adapters/postgres/src/exports/control.ts (L10–L17)](../../../../packages/3-targets/6-adapters/postgres/src/exports/control.ts:10-17)
- **AC**: Unknown and invalid-arg diagnostics remain span-based and stable.
  - **Implementation**:
    - Unknown function diagnostic: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L220–L252)](../../../../packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:220-252)
    - Invalid-argument diagnostics are owned by contributed lowering handlers (example implementation): [packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts (L19–L33)](../../../../packages/3-targets/6-adapters/postgres/src/core/control-mutation-defaults.ts:19-33)
  - **Evidence**:
    - Composed registry test asserts unknown diagnostics when no contributors exist: [packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts (L10–L33)](../../../../packages/2-sql/2-authoring/contract-psl/test/composed-mutation-defaults.test.ts:10-33)

### Runtime Behavior

- **AC**: Runtime resolves built-in generator ids through the assembled registry (regression guard).
  - **Implementation**:
    - Postgres adapter contributes built-ins: [packages/3-targets/6-adapters/postgres/src/exports/runtime.ts (L48–L56)](../../../../packages/3-targets/6-adapters/postgres/src/exports/runtime.ts:48-56)
  - **Evidence**:
    - Runtime collects generators from composed contributors: [packages/2-sql/5-runtime/src/sql-context.ts (L352–L379)](../../../../packages/2-sql/5-runtime/src/sql-context.ts:352-379)
- **AC**: Runtime resolves pack-provided generator ids through the assembled registry.
  - **Implementation / Evidence**:
    - [packages/2-sql/5-runtime/test/mutation-default-generators.test.ts (L56–L97)](../../../../packages/2-sql/5-runtime/test/mutation-default-generators.test.ts:56-97)
- **AC**: Missing generator id fails with a clear, stable error.
  - **Implementation / Evidence**:
    - [packages/2-sql/5-runtime/test/mutation-default-generators.test.ts (L98–L127)](../../../../packages/2-sql/5-runtime/test/mutation-default-generators.test.ts:98-127)

### Compatibility and Migration

- **AC**: Documentation explains where default-function vocabulary comes from and how to extend it through packs.
  - **Evidence**:
    - [packages/2-sql/2-authoring/contract-psl/README.md (L16–L66)](../../../../packages/2-sql/2-authoring/contract-psl/README.md:16-66)
    - Parity fixture demonstrating a pack contribution: [test/integration/test/authoring/parity/default-pack-slugid/packs.ts (L1–L49)](../../../../test/integration/test/authoring/parity/default-pack-slugid/packs.ts:1-49)

