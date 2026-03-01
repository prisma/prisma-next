## Sources

- Spec: `projects/psl-contract-authoring/specs/Milestone 5 - ID variants and default function parity.spec.md`
- Commit range: `origin/tml-2019-m4-parameterized-attributes-pgvector-parity...HEAD`

## Summary

This change set adds a **registry-driven lowering pipeline** for PSL `@default(...)` expressions, enabling parity with the TS contract authoring surface for a curated set of ID-related default functions. The interpreter now maps supported defaults into either **storage defaults** or **execution (mutation) defaults**, while producing **actionable, span-aware diagnostics** for unsupported functions and invalid arguments.

## What problem is being solved (new guarantees)

- **PSL can express TS-aligned default functions** (subset) and deterministically lower them into the existing SQL `ContractIR` shapes.
  - **Execution defaults**: model/field defaults that must be generated at execution time.
  - **Storage defaults**: defaults represented as storage-layer expressions.
- **Unsupported defaults are rejected** with stable diagnostic codes and spans.

## Architecture fit (subsystems and boundaries)

- **Parser remains semantic-free**. `@prisma-next/psl-parser` continues to parse attributes generically, preserving `@default(uuid(7))` as a positional argument value `uuid(7)` without semantic interpretation.
  - Example guidance added in parser docs: [packages/1-framework/2-authoring/psl-parser/README.md (L21–L36)](packages/1-framework/2-authoring/psl-parser/README.md:21-36)
  - Parser test coverage for default function expressions: [packages/1-framework/2-authoring/psl-parser/test/parser.test.ts (L292–L375)](packages/1-framework/2-authoring/psl-parser/test/parser.test.ts:292-375)
- **Interpreter owns semantics**. `@prisma-next/sql-contract-psl` interprets PSL into SQL `ContractIR` and now owns:
  - default expression validation and lowering: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L221–L291)](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:221-291)
  - routing into storage vs execution: [packages/2-sql/2-authoring/contract-psl/src/interpreter.ts (L878–L899)](packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:878-899)
- **Provider composes policy**. The PSL provider helper supplies a builtin registry instance at the boundary, keeping the interpreter generic/extensible:
  - [packages/2-sql/2-authoring/contract-psl/src/provider.ts (L26–L65)](packages/2-sql/2-authoring/contract-psl/src/provider.ts:26-65)

## Default-function lowering design

### Registry boundary (why it matters)

The registry:

- isolates “supported default functions” policy from parsing mechanics
- keeps `@default(...)` semantic lowering testable and extensible
- allows future provider variants (or targets) to supply alternate sets/semantics without changing the parser

Implementation: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L10–L434)](packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:10-434)

### Execution vs storage defaults (shape alignment)

- Functions like `uuid()`, `ulid()`, `nanoid()` are lowered into **execution mutation defaults** (generator entries).
  - Evidence: interpreter unit test for execution defaults: [packages/2-sql/2-authoring/contract-psl/test/interpreter.test.ts (L573–L639)](packages/2-sql/2-authoring/contract-psl/test/interpreter.test.ts:573-639)
  - Parity fixtures (PSL ↔ TS): e.g.
    - `uuid(7)`: [test/integration/test/authoring/parity/default-uuid-v7/schema.prisma (L1–L3)](test/integration/test/authoring/parity/default-uuid-v7/schema.prisma:1-3), [test/integration/test/authoring/parity/default-uuid-v7/contract.ts (L1–L17)](test/integration/test/authoring/parity/default-uuid-v7/contract.ts:1-17)
    - `nanoid(16)`: [test/integration/test/authoring/parity/default-nanoid-16/schema.prisma (L1–L3)](test/integration/test/authoring/parity/default-nanoid-16/schema.prisma:1-3), [test/integration/test/authoring/parity/default-nanoid-16/contract.ts (L1–L17)](test/integration/test/authoring/parity/default-nanoid-16/contract.ts:1-17)
- `dbgenerated("...")` is lowered into a **storage default** function expression string (not an execution generator).
  - Evidence: parity fixture: [test/integration/test/authoring/parity/default-dbgenerated/schema.prisma (L1–L3)](test/integration/test/authoring/parity/default-dbgenerated/schema.prisma:1-3), [test/integration/test/authoring/parity/default-dbgenerated/contract.ts (L1–L17)](test/integration/test/authoring/parity/default-dbgenerated/contract.ts:1-17)

## Diagnostics architecture (codes, spans, “actionable”)

The interpreter/provider return structured diagnostics with stable codes and spans; integration fixtures assert diagnostic shapes.

- Invalid arguments fixture: [test/integration/test/authoring/diagnostics/invalid-default-arguments/schema.prisma (L1–L6)](test/integration/test/authoring/diagnostics/invalid-default-arguments/schema.prisma:1-6) with expected codes: [test/integration/test/authoring/diagnostics/invalid-default-arguments/expected-diagnostics.json (L1–L20)](test/integration/test/authoring/diagnostics/invalid-default-arguments/expected-diagnostics.json:1-20)
- Unknown function fixture (`cuid()`): [test/integration/test/authoring/diagnostics/unsupported-default-cuid/schema.prisma (L1–L4)](test/integration/test/authoring/diagnostics/unsupported-default-cuid/schema.prisma:1-4) with expected code: [test/integration/test/authoring/diagnostics/unsupported-default-cuid/expected-diagnostics.json (L1–L10)](test/integration/test/authoring/diagnostics/unsupported-default-cuid/expected-diagnostics.json:1-10)

## Determinism / hashing implications

This design is compatible with determinism goals because:

- the parser remains deterministic for identical input (already tested)
- the interpreter lowering is pure for a given AST + registry (no file I/O, no randomness)
- parity fixtures compare canonical outputs/hashes across PSL ↔ TS authoring cases

## Spec alignment notes (important)

The Milestone 5 spec now targets `cuid(2)` (cuid v2) and explicitly excludes `cuid()` (cuid v1). This branch currently **rejects `cuid()`** (with fixture coverage) but does not yet implement a parity path for `cuid(2)`, so the remaining work is implementation + fixtures (not spec alignment).

## Test strategy adequacy (architectural view)

- **Unit tests** assert lowering output shape within `contract-psl` (execution vs storage) and span-aware diagnostics:
  - [packages/2-sql/2-authoring/contract-psl/test/interpreter.test.ts (L573–L682)](packages/2-sql/2-authoring/contract-psl/test/interpreter.test.ts:573-682)
  - Provider integration tests for file → parse → interpret: [packages/2-sql/2-authoring/contract-psl/test/provider.test.ts (L165–L256)](packages/2-sql/2-authoring/contract-psl/test/provider.test.ts:165-256)
- **Integration parity fixtures** provide end-to-end contract snapshot parity between PSL and TS authoring surfaces for each supported default function (plus diagnostics fixtures for unsupported cases).

## Risks / follow-ups

- **Span computation assumes same-line offsets**: lowering logic builds spans by applying offsets to a base span’s `line/column` without accounting for embedded newlines in expressions. This is likely fine for the intended PSL surface (defaults written on one line), but should be documented or defended with a constraint test.
  - Implementation touchpoint: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L38–L53)](packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:38-53)
- **String-literal escaping semantics** for `dbgenerated("...")`: the current parser extracts raw content but does not unescape. If PSL supports escape sequences, consider whether parity expectations require unescaped values (to align with TS string literal behavior).
  - Touchpoint: [packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts (L224–L388)](packages/2-sql/2-authoring/contract-psl/src/default-function-registry.ts:224-388)

