## Sources
- Spec: `projects/psl-contract-authoring/specs/Milestone 5 - ID variants and default function parity.spec.md`
- Commit range: `origin/tml-2019-m4-parameterized-attributes-pgvector-parity...HEAD`

## Intent
Add PSL parity for a TS-aligned subset of ID-related default functions by lowering `@default(...)` expressions into the existing SQL `ContractIR` shapes, then prove parity with fixture-driven integration cases and lock diagnostic behavior for unsupported defaults.

## Change map
- **Implementation**:
  - [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L116–L434)](packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:116-434)
  - [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L221–L291)](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:221-291)
  - [packages/2-sql/2-authoring/contract-psl/src/provider.ts (L26–L65)](packages/2-sql/2-authoring/contract-psl/src/provider.ts:26-65)
- **Tests (evidence)**:
  - [packages/2-sql/2-authoring/contract-psl/test/interpreter.test.ts (L573–L682)](packages/2-sql/2-authoring/contract-psl/test/interpreter.test.ts:573-682)
  - [packages/2-sql/2-authoring/contract-psl/test/provider.test.ts (L165–L256)](packages/2-sql/2-authoring/contract-psl/test/provider.test.ts:165-256)
  - [test/integration/test/authoring/parity/default-uuid-v7/schema.prisma (L1–L3)](test/integration/test/authoring/parity/default-uuid-v7/schema.prisma:1-3)
  - [test/integration/test/authoring/diagnostics/invalid-default-arguments/schema.prisma (L1–L6)](test/integration/test/authoring/diagnostics/invalid-default-arguments/schema.prisma:1-6)

## The story
1. **Introduce a dedicated default-function lowering seam**: default expressions that look like function calls are parsed into a normalized call shape and lowered via a registry, rather than being hardcoded inline in the interpreter.
2. **Route defaults into the correct contract plane**: execution-time generators become `execution.mutations.defaults`, while storage expressions remain column defaults.
3. **Prove parity + lock diagnostics**: add fixture-driven parity cases for each supported function and fixture-driven diagnostics cases for rejection paths.

## Behavior changes & evidence
- **Adds registry-driven lowering for PSL `@default(<function-call>)` expressions**.
  - **Why**: keep the parser semantic-free, keep the interpreter extensible, and align supported default vocabulary to the TS authoring surface via a pluggable boundary.
  - **Implementation**:
    - Call parsing + argument span extraction: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L116–L163)](packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:116-163)
    - Builtin registry + lowering dispatch: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L390–L434)](packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:390-434)
  - **Tests**:
    - Interpreter unit test covering supported + rejected defaults: [packages/2-sql/2-authoring/contract-psl/test/interpreter.test.ts (L573–L682)](packages/2-sql/2-authoring/contract-psl/test/interpreter.test.ts:573-682)

- **Adds execution default lowering for `uuid()`, `uuid(7)`, `ulid()`, `nanoid()`, `nanoid(n)`**.
  - **Why**: these correspond to TS-side execution generators and should not be emitted as storage expressions.
  - **Implementation**:
    - Execution generator lowering (examples): [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L280–L349)](packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:280-349)
    - Interpreter wiring into table builder `.generated(...)`: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L878–L899)](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:878-899)
  - **Tests (evidence)**:
    - Parity fixtures:
      - `uuid(7)`: [test/integration/test/authoring/parity/default-uuid-v7/schema.prisma (L1–L3)](test/integration/test/authoring/parity/default-uuid-v7/schema.prisma:1-3), [test/integration/test/authoring/parity/default-uuid-v7/contract.ts (L1–L17)](test/integration/test/authoring/parity/default-uuid-v7/contract.ts:1-17)
      - `uuid()`: [test/integration/test/authoring/parity/default-uuid-v4/schema.prisma (L1–L3)](test/integration/test/authoring/parity/default-uuid-v4/schema.prisma:1-3)
      - `ulid()`: [test/integration/test/authoring/parity/default-ulid/schema.prisma (L1–L3)](test/integration/test/authoring/parity/default-ulid/schema.prisma:1-3)
      - `nanoid()` / `nanoid(16)`: [test/integration/test/authoring/parity/default-nanoid/schema.prisma (L1–L3)](test/integration/test/authoring/parity/default-nanoid/schema.prisma:1-3), [test/integration/test/authoring/parity/default-nanoid-16/schema.prisma (L1–L3)](test/integration/test/authoring/parity/default-nanoid-16/schema.prisma:1-3)

- **Adds storage default lowering for `dbgenerated("...")`**.
  - **Why**: `dbgenerated` is represented as a storage-layer expression in the existing contract model.
  - **Implementation**:
    - `dbgenerated` handler: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L351–L388)](packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:351-388)
  - **Tests**:
    - Parity fixture: [test/integration/test/authoring/parity/default-dbgenerated/schema.prisma (L1–L3)](test/integration/test/authoring/parity/default-dbgenerated/schema.prisma:1-3), [test/integration/test/authoring/parity/default-dbgenerated/contract.ts (L1–L17)](test/integration/test/authoring/parity/default-dbgenerated/contract.ts:1-17)

- **Adds actionable diagnostics for unsupported defaults and invalid arguments**.
  - **Why**: Milestone 5 requires strict rejection of non-representable defaults with stable, span-aware diagnostics.
  - **Implementation**:
    - Unknown-function handling (including `cuid` special-case): [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L401–L433)](packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:401-433)
  - **Tests (evidence)**:
    - Unsupported `cuid()`: [test/integration/test/authoring/diagnostics/unsupported-default-cuid/schema.prisma (L1–L4)](test/integration/test/authoring/diagnostics/unsupported-default-cuid/schema.prisma:1-4), [test/integration/test/authoring/diagnostics/unsupported-default-cuid/expected-diagnostics.json (L1–L10)](test/integration/test/authoring/diagnostics/unsupported-default-cuid/expected-diagnostics.json:1-10)
    - Invalid args (`uuid(5)`, `nanoid(1)`, `dbgenerated("")`): [test/integration/test/authoring/diagnostics/invalid-default-arguments/schema.prisma (L1–L6)](test/integration/test/authoring/diagnostics/invalid-default-arguments/schema.prisma:1-6)

## Compatibility / migration / risk
- **None noted** for existing supported PSL surfaces, but this introduces new rejection paths (by design) for unsupported defaults (e.g. `cuid()`).

## Follow-ups / open questions
- Add PSL parity support for `cuid(2)` (execution generator `cuid2`) while keeping `cuid()` rejected.

