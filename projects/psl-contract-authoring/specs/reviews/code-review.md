## Summary

This branch adds registry-driven lowering for PSL `@default(...)` expressions into SQL `ContractIR` (execution vs storage defaults), plus integration parity fixtures and diagnostics fixtures to prove Milestone 5 behavior.

## What looks solid

- **Clear boundary between parsing and semantics**: parser remains generic, interpreter owns meaning. The docs reinforce this separation.  
  - [packages/1-framework/2-authoring/psl-parser/README.md (L21–L36)](packages/1-framework/2-authoring/psl-parser/README.md:21-36)
- **Registry design is a good extensibility seam**: `DefaultFunctionRegistry` enables future provider customization without entangling parsing mechanics.  
  - [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L10–L36)](packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:10-36)
- **Behavior is well evidenced**:
  - Unit tests cover supported defaults, invalid arguments, and unknown-function diagnostics.  
    - [packages/2-sql/2-authoring/contract-psl/test/interpreter.test.ts (L573–L682)](packages/2-sql/2-authoring/contract-psl/test/interpreter.test.ts:573-682)
  - Integration parity fixtures exist per supported default, and diagnostics fixtures lock in error codes.  
    - Parity example: [test/integration/test/authoring/parity/default-uuid-v7/schema.prisma (L1–L3)](test/integration/test/authoring/parity/default-uuid-v7/schema.prisma:1-3)  
    - Diagnostics example: [test/integration/test/authoring/diagnostics/unsupported-default-cuid/expected-diagnostics.json (L1–L10)](test/integration/test/authoring/diagnostics/unsupported-default-cuid/expected-diagnostics.json:1-10)

## Blocking issues (must fix before merge)

### F01 — Default function support mismatch (`cuid(2)` intended, `cuid()` rejected)

- **Location**: `projects/psl-contract-authoring/specs/Milestone 5 - ID variants and default function parity.spec.md` (Functional Requirements) vs implemented behavior
- **Issue**: The intended behavior is **support `cuid(2)`** (execution generator id `cuid2`) while **rejecting `cuid()`** (cuid1). This branch currently rejects `cuid()` (good), but does not yet provide a `cuid(2)` parity path.
  - Spec includes `cuid(2)`: [projects/psl-contract-authoring/specs/Milestone 5 - ID variants and default function parity.spec.md (L13–L19)](projects/psl-contract-authoring/specs/Milestone 5 - ID variants and default function parity.spec.md:13-19)
  - Implementation rejects `cuid()` today: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L411–L422)](packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:411-422)
  - Diagnostics fixture asserts `cuid()` rejection: [test/integration/test/authoring/diagnostics/unsupported-default-cuid/schema.prisma (L1–L4)](test/integration/test/authoring/diagnostics/unsupported-default-cuid/schema.prisma:1-4)
  - Contract model already supports execution generator id `cuid2`: [packages/1-framework/1-core/shared/contract/src/types.ts (L83–L86)](packages/1-framework/1-core/shared/contract/src/types.ts:83-86)
- **Suggestion**: Reconcile implementation to the intended split:
  - Milestone 5 spec is now aligned to `cuid(2)` and explicitly excludes `cuid()` in v1.
  - Extend the default registry to support `cuid(2)` → `executionGenerator('cuid2')`, while keeping `cuid()` rejected with an actionable diagnostic (“Use `cuid(2)` instead”).
  - Add a parity fixture for `@default(cuid(2))` (PSL + TS + expected snapshots) alongside the existing diagnostics fixture for `cuid()`.

### F02 — Span math assumes default expressions don’t contain newlines

- **Location**: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L38–L53)](packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:38-53)
- **Issue**: `createSpanFromBase` applies offsets to a base span while keeping `line` constant and adjusting `column` by the same offset. This is only correct if the expression is contained on one line (or if offsets are always single-line).
- **Suggestion**: Resolve explicitly before merge:
  - document the constraint (“default expressions must be single-line”) and add a unit/integration test that locks it, or
  - compute line/column correctly from the raw expression text (more complex).

### F03 — Registry hardcodes special-case `cuid` message; use a single “supported functions” source of truth

- **Location**: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L401–L433)](packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:401-433)
- **Issue**: There’s a bespoke `cuid` diagnostic message plus a general fallback message. If supported functions evolve, keeping messages consistent can drift.
- **Suggestion**: Generate the “supported functions” list from the registry keys (plus any additional syntax like `uuid(7)` / `nanoid(n)`), and keep targeted suggestions (“use uuid/ulid/nanoid instead”) as an additive layer.

## Non-blocking concerns (important, but not merge-gating)

### F04 — `dbgenerated("...")` string-literal escape semantics may diverge from TS parity

- **Location**: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L224–L388)](packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:224-388)
- **Issue**: `parseStringLiteral()` extracts the inner content but does not unescape sequences. If PSL permits escape sequences inside string literals, this could produce different expression strings than TS authoring would.
- **Suggestion**: Decide what PSL string literal semantics you want for parity (raw vs unescaped) and add at least one fixture or unit test covering an escaped-string case.
  - If the primary concern is ergonomics (escaping/quoting), consider introducing TS-only sugar like `sql\`...\`` to build the same `{ kind: 'function', expression: '...' }` shape, while keeping PSL as `dbgenerated("...")` (or a future PSL function like `sql("...")`). PSL itself can’t express a backtick template literal without changing the PSL grammar.

## Nits (optional polish)

### F05 — Tighten README wording for `uuid()` variants consistency

- **Location**: [packages/2-sql/2-authoring/contract-psl/README.md (L40–L45)](packages/2-sql/2-authoring/contract-psl/README.md:40-45)
- **Issue**: The supported-defaults list mixes `uuid(7)` with `uuid()` and `uuid(4)`. It’s correct but could read more uniformly.
- **Suggestion**: Minor phrasing cleanup only (no behavior impact).

## Acceptance-criteria traceability

- **AC1: Each supported default function has at least one parity fixture**  
  - **Implementation**: default lowering registry + interpreter routing
    - [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L390–L434)](packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:390-434)
    - [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L221–L291)](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:221-291)
  - **Evidence** (parity fixtures):
    - `uuid()` / `uuid(7)`: [test/integration/test/authoring/parity/default-uuid-v4/schema.prisma (L1–L3)](test/integration/test/authoring/parity/default-uuid-v4/schema.prisma:1-3), [test/integration/test/authoring/parity/default-uuid-v7/schema.prisma (L1–L3)](test/integration/test/authoring/parity/default-uuid-v7/schema.prisma:1-3)
    - `ulid()`: [test/integration/test/authoring/parity/default-ulid/schema.prisma (L1–L3)](test/integration/test/authoring/parity/default-ulid/schema.prisma:1-3)
    - `nanoid()` / `nanoid(16)`: [test/integration/test/authoring/parity/default-nanoid/schema.prisma (L1–L3)](test/integration/test/authoring/parity/default-nanoid/schema.prisma:1-3), [test/integration/test/authoring/parity/default-nanoid-16/schema.prisma (L1–L3)](test/integration/test/authoring/parity/default-nanoid-16/schema.prisma:1-3)
    - `dbgenerated("...")`: [test/integration/test/authoring/parity/default-dbgenerated/schema.prisma (L1–L3)](test/integration/test/authoring/parity/default-dbgenerated/schema.prisma:1-3)
- **AC2: Canonical contract.json + stable hash parity holds**  
  - **Evidence**: expected snapshots per parity case (see each `expected.contract.json` under the parity case directories).
- **AC3: Unsupported defaults fail with actionable diagnostics**  
  - **Implementation**: unknown/invalid default handling
    - [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L164–L433)](packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:164-433)
  - **Evidence**:
    - Unsupported `cuid()`: [test/integration/test/authoring/diagnostics/unsupported-default-cuid/schema.prisma (L1–L4)](test/integration/test/authoring/diagnostics/unsupported-default-cuid/schema.prisma:1-4)
    - Invalid args: [test/integration/test/authoring/diagnostics/invalid-default-arguments/schema.prisma (L1–L6)](test/integration/test/authoring/diagnostics/invalid-default-arguments/schema.prisma:1-6)

